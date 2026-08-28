#!/usr/bin/env node
/**
 * Release asset readiness verifier (v2.5.8).
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
 * Exit codes (documented contract; tests pin them):
 *   0  ready — resolves the two asset URLs/sizes on stdout as KEY=value lines
 *   2  usage error, unreadable/invalid JSON, or malformed release shape
 *   3  release metadata contract violation (tag mismatch, draft/prerelease)
 *   4  asset list empty
 *   5  duplicate asset name among the expected assets
 *   6  an expected asset is missing
 *   7  an expected asset exists but is not in the 'uploaded' state
 *   8  an expected asset has a non-positive/unknown size or an invalid URL
 *
 * Checksum and zip-content contracts stay where they belong: `sha256sum -c`
 * and `scripts/verify_release_zip.py` (Pages workflow) / the offline tests
 * (tests/zip-helper-security.test.ts, tests/release-assets.test.ts).
 */

import fs from 'node:fs'
import process from 'node:process'

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
 * @param {string[]} argv
 */
function parseArgs(argv) {
  /** @type {{ positional: string[], tag: string|null, mode: 'published'|'draft', zipName: string|null, sumsName: string, help: boolean }} */
  const args = {
    positional: [],
    tag: null,
    mode: 'published',
    zipName: null,
    sumsName: 'SHA256SUMS.txt',
    help: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--tag') {
      args.tag = argv[++i]
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
  'usage: release-assets-verify.mjs <release-json-file> --tag vX.Y.Z [--mode published|draft] ' +
  '[--zip-name <name>] [--sums-name <name>]'

const args = parseArgs(process.argv.slice(2))
if (args.help) {
  console.log(USAGE)
  process.exit(0)
}
if (!args.positional || args.positional.length !== 1) fail(2, USAGE)
if (!args.tag || !/^v[1-9][0-9]*\.[0-9]+\.[0-9]+$/.test(args.tag)) {
  fail(2, '--tag must be a stable SemVer tag like v1.2.3')
}
if (args.mode !== 'published' && args.mode !== 'draft') {
  fail(2, "--mode must be 'published' or 'draft'")
}

const releasePath = args.positional[0]
let release
try {
  release = JSON.parse(fs.readFileSync(releasePath, 'utf8'))
} catch (error) {
  fail(
    2,
    `cannot read/parse release metadata (${releasePath}): ${error instanceof Error ? error.message : String(error)}`,
  )
}
if (release === null || typeof release !== 'object' || Array.isArray(release)) {
  fail(2, 'release metadata must be a JSON object')
}
if (typeof release.tag_name !== 'string') fail(2, 'release metadata has no string tag_name')

// ---- Release metadata contract (exit 3) ----
if (release.tag_name !== args.tag) {
  fail(3, `release tag mismatch: metadata says ${release.tag_name}, expected ${args.tag}`)
}
const wantDraft = args.mode === 'draft'
if (release.draft !== wantDraft) {
  fail(
    3,
    args.mode === 'published'
      ? `release ${args.tag} is ${release.draft ? 'a draft' : 'not published'}; the Pages entry gate requires a published release`
      : `release ${args.tag} is not a draft; the pre-publish verification requires the draft release`,
  )
}
if (release.prerelease !== false) {
  fail(3, `release ${args.tag} is a prerelease; the stable Pages flow only deploys stable releases`)
}

// ---- Asset contract ----
const assets = release.assets
if (!Array.isArray(assets)) fail(2, 'release metadata has no assets array')
if (assets.length === 0) fail(4, `release ${args.tag} has no assets at all`)

const zipName = args.zipName ?? `pmbus-calculator-${args.tag}-web.zip`
const expected = [
  { key: 'zip', name: zipName },
  { key: 'sums', name: args.sumsName },
]
/** @type {Record<string, { name: string, size: number, url: string }>} */
const resolved = {}

for (const { key, name } of expected) {
  const matches = assets.filter((asset) => asset && asset.name === name)
  if (matches.length === 0) {
    fail(
      6,
      `asset "${name}" is missing from release ${args.tag} (assets: ${assets.map((a) => a?.name).join(', ') || 'none'})`,
    )
  }
  if (matches.length > 1) {
    fail(5, `asset "${name}" appears ${matches.length} times; asset names must be unique`)
  }
  const asset = matches[0]
  if (asset.state !== 'uploaded') {
    fail(
      7,
      `asset "${name}" is in state "${asset.state}", not "uploaded" — the upload has not finished`,
    )
  }
  if (!Number.isInteger(asset.size) || asset.size <= 0) {
    fail(8, `asset "${name}" has size ${asset.size}; a ready asset must have a positive size`)
  }
  const url = asset.browser_download_url
  if (typeof url !== 'string' || !url.startsWith('https://')) {
    fail(8, `asset "${name}" has no valid https browser_download_url`)
  }
  resolved[key] = { name, size: asset.size, url }
}

// ---- Resolved values for the caller (Pages workflow / release operator) ----
for (const { key } of expected) {
  console.log(`${key}_name=${resolved[key].name}`)
  console.log(`${key}_size=${resolved[key].size}`)
  console.log(`${key}_url=${resolved[key].url}`)
}
console.error(
  `ok: release ${args.tag} (${args.mode}) assets ready: ${resolved.zip.name} (${resolved.zip.size} bytes), ` +
    `${resolved.sums.name} (${resolved.sums.size} bytes)`,
)
