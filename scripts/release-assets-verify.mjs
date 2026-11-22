#!/usr/bin/env node
/**
 * Resolve the two assets from a GitHub REST release object. Both modes require
 * a matching stable tag and uploaded, nonempty assets with canonical URLs.
 * Published mode requires an immutable release. Draft mode allows GitHub's
 * untagged-<hex> URLs while the release is still private.
 *
 * The CLI writes one JSON object to stdout and diagnostics to stderr. Pages
 * reads the JSON as data. The downloaded-asset verifier reuses this resolver
 * before checking file bytes and ZIP contents.
 *
 * Exit codes:
 *   0  assets ready
 *   2  usage, invalid JSON or malformed release data
 *   3  wrong tag or release state
 *   4  empty asset list
 *   5  duplicate asset
 *   6  missing asset
 *   7  asset not uploaded
 *   8  invalid asset size or URL
 */

import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import process from 'node:process'
import { isStableReleaseTag, releaseAssetNames } from './release-artifact-contract.mjs'
import {
  assertCanonicalAssetDownloadUrl,
  assertSafeAssetName,
  assertValidRepoSlug,
} from './release-url-contract.mjs'

/** Contract error carrying the documented exit code (2-8). */
export class ReleaseVerifyError extends Error {
  /**
   * @param {number} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message)
    this.name = 'ReleaseVerifyError'
    this.code = code
  }
}

/**
 * @param {number} code
 * @param {string} message
 * @returns {never}
 */
function fail(code, message) {
  console.error(`error: ${message}`)
  process.exit(code)
}

/**
 * Core metadata resolution: every release-metadata contract check, shared by
 * the CLI and the downloaded-asset gate. Throws ReleaseVerifyError with the
 * documented exit code; returns the data-only resolution object.
 *
 * @param {unknown} release parsed GitHub release JSON
 * @param {{ tag: string, repo: string, mode?: 'published'|'draft', zipName?: string|null, sumsName?: string }} options
 */
export function resolveReleaseAssets(release, options) {
  const tag = options.tag
  const repo = options.repo
  const mode = options.mode ?? 'published'
  if (!isStableReleaseTag(tag)) {
    throw new ReleaseVerifyError(2, '--tag must be a stable SemVer tag like v1.2.3')
  }
  const names = releaseAssetNames(tag)
  const sumsName = options.sumsName ?? names.sumsName
  const zipName = options.zipName ?? names.zipName
  if (!repo) throw new ReleaseVerifyError(2, '--repo is required')
  try {
    assertValidRepoSlug(repo)
  } catch (error) {
    throw new ReleaseVerifyError(2, error instanceof Error ? error.message : String(error))
  }
  if (mode !== 'published' && mode !== 'draft') {
    throw new ReleaseVerifyError(2, "--mode must be 'published' or 'draft'")
  }
  try {
    assertSafeAssetName(sumsName, '--sums-name')
  } catch (error) {
    throw new ReleaseVerifyError(2, error instanceof Error ? error.message : String(error))
  }

  if (release === null || typeof release !== 'object' || Array.isArray(release)) {
    throw new ReleaseVerifyError(2, 'release metadata must be a JSON object')
  }
  const rec =
    /** @type {{ tag_name?: unknown, draft?: unknown, prerelease?: unknown, immutable?: unknown, assets?: unknown }} */ (
      release
    )
  if (typeof rec.tag_name !== 'string') {
    throw new ReleaseVerifyError(2, 'release metadata has no string tag_name')
  }

  // ---- Release metadata contract (exit 3) ----
  if (rec.tag_name !== tag) {
    throw new ReleaseVerifyError(
      3,
      `release tag mismatch: metadata says ${rec.tag_name}, expected ${tag}`,
    )
  }
  const wantDraft = mode === 'draft'
  if (rec.draft !== wantDraft) {
    throw new ReleaseVerifyError(
      3,
      mode === 'published'
        ? `release ${tag} is ${rec.draft ? 'a draft' : 'not published'}; the Pages entry gate requires a published release`
        : `release ${tag} is not a draft; the pre-publish verification requires the draft release`,
    )
  }
  if (rec.prerelease !== false) {
    throw new ReleaseVerifyError(
      3,
      `release ${tag} is a prerelease; the stable Pages flow only deploys stable releases`,
    )
  }
  if (mode === 'published' && rec.immutable !== true) {
    // Fail closed on any non-true value (false, absent, null, string): the
    // Pages flow must only ever deploy releases whose assets GitHub has
    // made immutable (docs/RELEASING.md). Drafts are never immutable, so
    // --mode draft does not run this check.
    throw new ReleaseVerifyError(
      3,
      `release ${tag} is not immutable (immutable: ${JSON.stringify(rec.immutable ?? null)}); ` +
        'the Pages flow only deploys immutable releases',
    )
  }

  // ---- Asset contract ----
  const assets = rec.assets
  if (!Array.isArray(assets)) {
    throw new ReleaseVerifyError(2, 'release metadata has no assets array')
  }
  if (assets.length === 0) throw new ReleaseVerifyError(4, `release ${tag} has no assets at all`)

  const expected = [
    { key: 'zip', name: zipName },
    { key: 'sums', name: sumsName },
  ]
  /** @type {Record<string, { name: string, size: number, url: string }>} */
  const resolved = {}

  for (const { key, name } of expected) {
    const matches = assets.filter((asset) => asset && asset.name === name)
    if (matches.length === 0) {
      throw new ReleaseVerifyError(
        6,
        `asset "${name}" is missing from release ${tag} (assets: ${assets.map((a) => a?.name).join(', ') || 'none'})`,
      )
    }
    if (matches.length > 1) {
      throw new ReleaseVerifyError(
        5,
        `asset "${name}" appears ${matches.length} times; asset names must be unique`,
      )
    }
    const asset = matches[0]
    if (asset.state !== 'uploaded') {
      throw new ReleaseVerifyError(
        7,
        `asset "${name}" is in state "${asset.state}", not "uploaded" — the upload has not finished`,
      )
    }
    if (!Number.isInteger(asset.size) || asset.size <= 0) {
      throw new ReleaseVerifyError(
        8,
        `asset "${name}" has size ${asset.size}; a ready asset must have a positive size`,
      )
    }
    const url = asset.browser_download_url
    try {
      assertCanonicalAssetDownloadUrl(url, {
        repo,
        tag,
        name,
        // GitHub draft releases carry a placeholder `untagged-<hex>` tag
        // segment in browser_download_url until publish (live REST behavior):
        // the operator's draft check must accept it, while the published
        // Pages gate keeps the strict tag form.
        allowUntaggedPlaceholder: mode === 'draft',
      })
    } catch (error) {
      throw new ReleaseVerifyError(
        8,
        `asset "${name}": ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    resolved[key] = { name, size: asset.size, url }
  }

  return { tag, mode, repo, zip: resolved.zip, sums: resolved.sums }
}

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  /** @type {{ positional: string[], tag: string|null, repo: string|null, mode: 'published'|'draft', zipName: string|null, sumsName?: string, help: boolean }} */
  const args = {
    positional: [],
    tag: null,
    repo: null,
    mode: 'published',
    zipName: null,
    help: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--tag') {
      args.tag = argv[++i]
    } else if (arg === '--repo') {
      args.repo = argv[++i]
    } else if (arg === '--mode') {
      args.mode = /** @type {'published'|'draft'} */ (argv[++i])
    } else if (arg === '--zip-name') {
      args.zipName = argv[++i]
    } else if (arg === '--sums-name') {
      args.sumsName = argv[++i]
    } else if (arg === '--help' || arg === '-h') {
      args.help = true
    } else if (arg.startsWith('--')) {
      fail(2, `unknown option: ${arg}`)
    } else {
      args.positional.push(arg)
    }
  }
  return args
}

const USAGE =
  'usage: release-assets-verify.mjs <release-json-file> --tag vX.Y.Z --repo owner/repo ' +
  '[--mode published|draft] [--zip-name <name>] [--sums-name <name>]'

/**
 * CLI entry for resolving GitHub Release metadata.
 * @param {string[]} argv
 */
export function runCli(argv) {
  const args = parseArgs(argv)
  if (args.help) {
    console.log(USAGE)
    process.exit(0)
  }
  try {
    if (!args.positional || args.positional.length !== 1) {
      throw new ReleaseVerifyError(2, USAGE)
    }
    if (!args.tag) throw new ReleaseVerifyError(2, USAGE)
    if (!args.repo) throw new ReleaseVerifyError(2, USAGE)
    try {
      if (args.zipName !== null) assertSafeAssetName(args.zipName, '--zip-name')
    } catch (error) {
      throw new ReleaseVerifyError(2, error instanceof Error ? error.message : String(error))
    }

    const releasePath = args.positional[0]
    let release
    try {
      release = JSON.parse(fs.readFileSync(releasePath, 'utf8'))
    } catch (error) {
      throw new ReleaseVerifyError(
        2,
        `cannot read/parse release metadata (${releasePath}): ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    const resolved = resolveReleaseAssets(release, {
      tag: args.tag,
      repo: args.repo,
      mode: args.mode,
      zipName: args.zipName,
      sumsName: args.sumsName,
    })

    // ---- Resolved values for the caller (Pages workflow / release operator) ----
    // Data-only JSON on stdout; diagnostics live on stderr. Never shell-source it.
    console.log(
      JSON.stringify({
        tag: resolved.tag,
        mode: resolved.mode,
        repo: resolved.repo,
        zip: resolved.zip,
        sums: resolved.sums,
      }),
    )
    console.error(
      `ok: release ${resolved.tag} (${resolved.mode}) assets ready: ${resolved.zip.name} (${resolved.zip.size} bytes), ` +
        `${resolved.sums.name} (${resolved.sums.size} bytes)`,
    )
  } catch (error) {
    if (error instanceof ReleaseVerifyError) fail(error.code, error.message)
    throw error
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) {
  runCli(process.argv.slice(2))
}
