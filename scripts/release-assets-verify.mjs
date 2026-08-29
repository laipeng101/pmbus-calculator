#!/usr/bin/env node
/**
 * Release asset readiness verifier (v2.5.8; JSON data interface since v2.5.9;
 * exported core since v2.5.12).
 *
 * Single source for the "are the release assets actually ready?" contract.
 * Consumed by the real Pages workflow BEFORE any download/deploy action and
 * by the release operator against the DRAFT release BEFORE publishing — the
 * v2.5.7 race (publish → upload) must be impossible to reintroduce, and an
 * upload-in-progress asset must never be mistaken for a ready one.
 *
 * Input: a GitHub REST release object (JSON file) with the shape
 *   { tag_name, draft, prerelease, assets: [{ name, state, size, browser_download_url }] }
 * Produced by `GET /releases/tags/<tag>` (published) or
 * `gh api repos/OWNER/REPO/releases --jq '.[] | select(.tag_name=="<tag>")'`
 * (drafts are not reachable via /releases/tags).
 *
 * Modes:
 *   --mode published (default): draft must be false — the Pages entry gate.
 *   --mode draft: draft must be true — the operator's pre-publish check.
 * Both modes require prerelease === false and an exact tag match, because a
 * prerelease or retagged release must never reach the stable Pages flow.
 *
 * Output contract (v2.5.9, data-not-code): stdout carries ONE JSON object
 *   {"tag":"vX.Y.Z","mode":"published","zip":{"name","size","url"},"sums":{...}}
 * and ALL diagnostics go to stderr. The previous `key=value` stdout was
 * consumed by `source` in the Pages workflow, which executed command
 * substitutions embedded in metadata strings (v2.5.9 boundary defect); JSON
 * consumers extract values with static queries and never re-interpret
 * metadata text as code. The Pages workflow consumes this JSON through
 * `scripts/download-release-assets.mjs`, which re-validates every URL via
 * `scripts/release-url-contract.mjs`.
 *
 * URL contract: each `browser_download_url` must be the canonical public
 * GitHub download URL for the expected repository (`--repo owner/repo`),
 * tag and asset name — validated with the URL parser (scheme, host, path,
 * no userinfo/query/fragment/control characters), not a string prefix.
 * `--mode draft` additionally accepts GitHub's draft placeholder tag
 * segment (`releases/download/untagged-<hex>/<name>` — a draft release's
 * asset URLs keep that form until publish); `--mode published` (the Pages
 * gate) requires the exact tag path.
 *
 * Exit codes (documented contract; tests pin them):
 *   0  ready — JSON resolution on stdout
 *   2  usage error, unreadable/invalid JSON, or malformed release shape
 *   3  release metadata contract violation (tag mismatch, draft/prerelease)
 *   4  asset list empty
 *   5  duplicate asset name among the expected assets
 *   6  an expected asset is missing
 *   7  an expected asset exists but is not in the 'uploaded' state
 *   8  an expected asset has a non-positive/unknown size or an invalid URL
 *
 * Since v2.5.12 the contract lives in the exported `resolveReleaseAssets`
 * (throwing `ReleaseVerifyError` with the codes above) so the DOWNLOADED
 * asset gate `scripts/verify-downloaded-assets.mjs` can reuse the exact
 * same metadata resolution in-process. The CLI wrapper keeps its behavior
 * byte-for-byte. Checksum, local-size and zip-content contracts live in the
 * downloaded-asset gate; offline tests pin both (tests/release-assets-verify.test.ts,
 * tests/verify-downloaded-assets.test.ts, tests/zip-helper-security.test.ts).
 */

import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import process from 'node:process'
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
  const sumsName = options.sumsName ?? 'SHA256SUMS.txt'
  const zipName = options.zipName ?? `pmbus-calculator-${tag}-web.zip`
  if (!tag || !/^v[1-9][0-9]*\.[0-9]+\.[0-9]+$/.test(tag)) {
    throw new ReleaseVerifyError(2, '--tag must be a stable SemVer tag like v1.2.3')
  }
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
    /** @type {{ tag_name?: unknown, draft?: unknown, prerelease?: unknown, assets?: unknown }} */ (
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
  /** @type {{ positional: string[], tag: string|null, repo: string|null, mode: 'published'|'draft', zipName: string|null, sumsName: string, help: boolean }} */
  const args = {
    positional: [],
    tag: null,
    repo: null,
    mode: 'published',
    zipName: null,
    sumsName: 'SHA256SUMS.txt',
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
 * CLI wrapper: same behavior as the pre-2.5.12 top-level script.
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
