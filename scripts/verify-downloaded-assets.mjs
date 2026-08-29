#!/usr/bin/env node
/**
 * Downloaded release asset byte gate (v2.5.12).
 *
 * The single, repository-owned verification entry for release assets that
 * ALREADY sit on local disk, consumed by two real flows:
 *
 * 1. the release operator's draft pre-publish check: after `gh release
 *    download` of the DRAFT assets into a temp dir, call this gate with the
 *    draft metadata (`gh api repos/OWNER/REPO/releases --jq ...`, draft:true,
 *    untagged-<hex> placeholder URLs) and --mode draft;
 * 2. the Pages workflow's post-download check: after
 *    scripts/download-release-assets.mjs fetched the PUBLISHED assets, call
 *    this gate before extraction with --mode published.
 *
 * Checks (in order, each failure class with its own exit code):
 *   - release metadata contract — delegated IN-PROCESS to
 *     scripts/release-assets-verify.mjs `resolveReleaseAssets` (exit 2-8:
 *     tag/draft/prerelease, asset presence, uniqueness, uploaded state,
 *     positive size, canonical URL policy). The published mode keeps the
 *     strict canonical tag URL contract; only draft mode accepts GitHub's
 *     untagged placeholder. Nothing here relaxes the Pages downloader.
 *   - local presence (exit 10): each expected asset exists in --dir as a
 *     regular file (exact name; no subdirectories, no symlinks).
 *   - local size (exit 11): the local byte size equals the metadata size.
 *   - SHA256SUMS.txt contract (exit 12): strict
 *     `<64 lowercase hex>  <name>` lines (two spaces), exactly one entry for
 *     the zip, no duplicates, no unexpected names, sums file not self-listed.
 *   - checksum (exit 13): the local zip's SHA-256 (node:crypto, no sha256sum
 *     binary dependency) matches the sums entry.
 *   - zip safety (exit 14): the shared python verifier
 *     .github/workflows/scripts/verify_release_zip.py validates entry names
 *     (traversal/symlink/absolute/forbidden segments/source maps), index.html
 *     CSP markers and relative asset references.
 *
 * Output contract (data-not-code, v2.5.9): stdout carries ONE JSON object
 *   {"tag","mode","dir","zip":{"name","size","sha256"},"sums":{"name","size","sha256"}}
 * and ALL diagnostics go to stderr. Metadata is parsed as data — never
 * source'd, eval'd or handed to a shell.
 *
 * Exit codes: 0 ready; 2 usage/JSON errors; 3-8 metadata contract (see
 * release-assets-verify.mjs); 10 missing local file; 11 local size mismatch;
 * 12 checksum-file contract violation; 13 checksum mismatch; 14 zip safety.
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import process from 'node:process'
import { ReleaseVerifyError, resolveReleaseAssets } from './release-assets-verify.mjs'

const VERIFY_ZIP_PY = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '.github',
  'workflows',
  'scripts',
  'verify_release_zip.py',
)

/**
 * @param {number} code
 * @param {string} message
 * @returns {never}
 */
function fail(code, message) {
  console.error(`error: ${message}`)
  process.exit(code)
}

/** Downloaded-asset failure carrying its documented exit code. */
class DownloadedAssetError extends Error {
  /**
   * @param {number} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message)
    this.name = 'DownloadedAssetError'
    this.code = code
  }
}

const USAGE =
  'usage: verify-downloaded-assets.mjs --metadata <release.json> --dir <download-dir> ' +
  '--tag vX.Y.Z --repo owner/repo [--mode published|draft] [--zip-name <n>] [--sums-name <n>]'

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  /** @type {{ metadata: string|null, dir: string|null, tag: string|null, repo: string|null, mode: 'published'|'draft', zipName: string|null, sumsName: string, help: boolean }} */
  const args = {
    metadata: null,
    dir: null,
    tag: null,
    repo: null,
    mode: 'published',
    zipName: null,
    sumsName: 'SHA256SUMS.txt',
    help: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--metadata') {
      args.metadata = argv[++i]
    } else if (arg === '--dir') {
      args.dir = argv[++i]
    } else if (arg === '--tag') {
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
      fail(2, `unexpected positional argument: ${arg}`)
    }
  }
  return args
}

/**
 * Strict SHA256SUMS.txt parser: `<64 hex>␠␠<name>` lines, no duplicates,
 * no names outside the expected set, no self-listing.
 *
 * @param {string} text raw sums file content
 * @param {{ zipName: string, sumsName: string }} expected
 * @returns {string} the zip's recorded hex digest
 */
export function parseSha256Sums(text, expected) {
  const lines = text.split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  if (lines.length === 0) {
    throw new DownloadedAssetError(12, 'SHA256SUMS.txt is empty')
  }
  /** @type {Map<string, string>} */
  const entries = new Map()
  for (const line of lines) {
    const match = /^([0-9a-f]{64})  (.+)$/.exec(line)
    if (!match) {
      throw new DownloadedAssetError(
        12,
        `SHA256SUMS.txt line does not match "<64 hex>  <name>": ${JSON.stringify(line.slice(0, 80))}`,
      )
    }
    const name = match[2]
    if (name === expected.sumsName) {
      throw new DownloadedAssetError(
        12,
        'SHA256SUMS.txt lists itself; a sums file cannot self-verify',
      )
    }
    if (entries.has(name)) {
      throw new DownloadedAssetError(12, `SHA256SUMS.txt lists "${name}" more than once`)
    }
    if (name !== expected.zipName) {
      throw new DownloadedAssetError(
        12,
        `SHA256SUMS.txt lists unexpected asset "${name}" (expected only "${expected.zipName}")`,
      )
    }
    entries.set(name, match[1])
  }
  const zipDigest = entries.get(expected.zipName)
  if (!zipDigest) {
    throw new DownloadedAssetError(12, `SHA256SUMS.txt has no entry for "${expected.zipName}"`)
  }
  return zipDigest
}

/**
 * Local byte gate for one resolved asset.
 *
 * @param {string} dir
 * @param {{ name: string, size: number, url: string }} asset
 * @returns {string} the file's sha256 hex digest
 */
function hashLocalAsset(dir, asset) {
  const localPath = path.join(dir, asset.name)
  let stats
  try {
    stats = fs.lstatSync(localPath)
  } catch {
    throw new DownloadedAssetError(10, `downloaded asset "${asset.name}" is missing from ${dir}`)
  }
  if (!stats.isFile()) {
    throw new DownloadedAssetError(
      10,
      `downloaded asset "${asset.name}" is not a regular file (symlink/dir)`,
    )
  }
  if (stats.size !== asset.size) {
    throw new DownloadedAssetError(
      11,
      `downloaded asset "${asset.name}" has ${stats.size} local bytes but metadata says ${asset.size}`,
    )
  }
  const hash = createHash('sha256')
  hash.update(fs.readFileSync(localPath))
  return hash.digest('hex')
}

/**
 * Default zip-safety runner: the shared python verifier, executed inside the
 * download directory so it validates the same bytes that deploy.
 *
 * @param {string} dir
 * @param {string} zipName
 */
function runZipSafetyVerifier(dir, zipName) {
  execFileSync('python3', [VERIFY_ZIP_PY, zipName], {
    cwd: dir,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

/**
 * Core downloaded-asset verification, shared by runCli and tests.
 *
 * @param {unknown} release parsed release metadata JSON
 * @param {{ metadataDir: string, tag: string, repo: string, mode: 'published'|'draft', zipName?: string|null, sumsName?: string, zipVerifier?: (dir: string, zipName: string) => void }} options
 */
export function verifyDownloadedAssets(release, options) {
  // Metadata contract first (exit 2-8, one implementation shared with the CLI).
  const resolved = resolveReleaseAssets(release, {
    tag: options.tag,
    repo: options.repo,
    mode: options.mode,
    zipName: options.zipName ?? undefined,
    sumsName: options.sumsName,
  })
  const dir = options.metadataDir

  // Local presence + size (exit 10/11), then hashes.
  const zipDigest = hashLocalAsset(dir, resolved.zip)
  const sumsDigest = hashLocalAsset(dir, resolved.sums)

  // SHA256SUMS.txt contract (exit 12) — read AFTER the local size matched.
  const sumsLocal = fs.readFileSync(path.join(dir, resolved.sums.name), 'utf8')
  const recordedZipDigest = parseSha256Sums(sumsLocal, {
    zipName: resolved.zip.name,
    sumsName: resolved.sums.name,
  })

  // Checksum (exit 13).
  if (zipDigest !== recordedZipDigest) {
    throw new DownloadedAssetError(
      13,
      `zip "${resolved.zip.name}" sha256 mismatch: local ${zipDigest}, SHA256SUMS.txt ${recordedZipDigest}`,
    )
  }

  // Zip safety (exit 14) — the shared python verifier owns the entry-name,
  // symlink, CSP and relative-reference contracts; never reimplemented here.
  try {
    const verify = options.zipVerifier ?? runZipSafetyVerifier
    verify(dir, resolved.zip.name)
  } catch (error) {
    const stderr = /** @type {{stderr?: Buffer|Uint8Array}} */ (error)?.stderr
    const detail = stderr ? stderr.toString('utf8').trim().split('\n').pop() : ''
    throw new DownloadedAssetError(
      14,
      `zip safety contract failed for "${resolved.zip.name}": ${detail || String(error)}`,
    )
  }

  return {
    tag: resolved.tag,
    mode: resolved.mode,
    dir,
    zip: { name: resolved.zip.name, size: resolved.zip.size, sha256: zipDigest },
    sums: { name: resolved.sums.name, size: resolved.sums.size, sha256: sumsDigest },
  }
}

/**
 * @param {string[]} argv
 */
export function runCli(argv) {
  const args = parseArgs(argv)
  if (args.help) {
    console.log(USAGE)
    process.exit(0)
  }
  for (const [flag, value] of [
    ['--metadata', args.metadata],
    ['--dir', args.dir],
    ['--tag', args.tag],
    ['--repo', args.repo],
  ]) {
    if (!value) fail(2, `${flag} is required\n${USAGE}`)
  }
  try {
    let release
    try {
      release = JSON.parse(fs.readFileSync(/** @type {string} */ (args.metadata), 'utf8'))
    } catch (error) {
      throw new ReleaseVerifyError(
        2,
        `cannot read/parse release metadata (${args.metadata}): ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    const result = verifyDownloadedAssets(release, {
      metadataDir: /** @type {string} */ (args.dir),
      tag: /** @type {string} */ (args.tag),
      repo: /** @type {string} */ (args.repo),
      mode: args.mode,
      zipName: args.zipName,
      sumsName: args.sumsName,
    })

    // Data-only JSON on stdout; diagnostics on stderr. Never shell-source it.
    console.log(JSON.stringify(result))
    console.error(
      `ok: downloaded release ${result.tag} (${result.mode}) assets verified in ${result.dir}: ` +
        `${result.zip.name} (${result.zip.size} bytes, sha256 ${result.zip.sha256}), ` +
        `${result.sums.name} (${result.sums.size} bytes, sha256 ${result.sums.sha256})`,
    )
  } catch (error) {
    if (error instanceof ReleaseVerifyError) fail(error.code, error.message)
    if (error instanceof DownloadedAssetError) fail(error.code, error.message)
    throw error
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) {
  runCli(process.argv.slice(2))
}
