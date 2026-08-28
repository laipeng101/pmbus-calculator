#!/usr/bin/env node
/**
 * Release asset downloader — the real Pages workflow consumer (v2.5.9).
 *
 * Consumes the JSON produced by `scripts/release-assets-verify.mjs` and
 * downloads the two verified assets with size verification, replacing the
 * previous `source release-assets.env` consumption. Metadata text is data:
 * values are read with static JSON access, URLs are re-validated through
 * `scripts/release-url-contract.mjs`, and every network/file call receives
 * the values as plain arguments — nothing is ever re-interpreted as code
 * (no source/eval/shell string building), so command-substitution text in a
 * metadata field can never execute.
 *
 * CLI:
 *   node scripts/download-release-assets.mjs <verified-json> --repo owner/repo [--out-dir .]
 *
 * Exit codes (CLI mapping of ReleaseDownloadError.code):
 *   0  both assets downloaded, byte sizes match the verified metadata
 *   2  usage error or unreadable/invalid verified metadata
 *   9  a downloaded file's byte count does not match the verified metadata
 *  10  a download failed (network error, timeout, or non-OK HTTP status)
 *
 * Deadline contract (v2.5.10): the WHOLE download operation shares ONE
 * cumulative budget of `TOTAL_DOWNLOAD_BUDGET_MS` (5 minutes) — retries and
 * backoff consume the same budget, and no attempt ever starts with a fresh
 * full timeout. Each fetch's AbortSignal is the REMAINING budget, so a hung
 * request is cut off when the budget runs out and the operation exits with
 * the stable code 10 / "deadline exhausted" diagnostic. The budget is
 * deliberately far below the Pages job's `timeout-minutes: 20` so npm ci,
 * verification, upload, deploy and the remote smoke keep their time; retrying
 * is limited to transient transport failures (network errors, HTTP
 * 408/429/5xx) with a bounded attempt count and a short backoff, while
 * permanent HTTP contract errors fail fast. Files are written only after BOTH
 * downloads finished and passed the size check. The exported
 * `downloadVerifiedAssets` takes the budget/clock/sleep boundaries as
 * injectable options so offline tests exercise the deadline deterministically
 * without waiting real minutes.
 */

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import {
  assertCanonicalAssetDownloadUrl,
  assertSafeAssetName,
  assertValidRepoSlug,
} from './release-url-contract.mjs'

/** Shared budget for the WHOLE operation (both assets, retries, backoff). */
const TOTAL_DOWNLOAD_BUDGET_MS = 5 * 60_000
/** Maximum fetch attempts per asset — bounded, and every retry consumes budget. */
const MAX_ATTEMPTS_PER_ASSET = 3
/** Short backoff between transient-failure retries; consumed from the budget. */
const RETRY_BACKOFF_MS = 2_000

/** Typed failure so tests can assert codes while the CLI maps them to exits. */
export class ReleaseDownloadError extends Error {
  /**
   * @param {number} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message)
    /** @type {number} */
    this.code = code
  }
}

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  /** @type {{ positional: string[], repo: string|null, outDir: string, help: boolean }} */
  const args = { positional: [], repo: null, outDir: '.', help: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--repo') {
      args.repo = argv[++i]
    } else if (arg === '--out-dir') {
      args.outDir = argv[++i]
    } else if (arg === '--help' || arg === '-h') {
      args.help = true
    } else if (arg.startsWith('--')) {
      throw new ReleaseDownloadError(2, `unknown option: ${arg}`)
    } else {
      args.positional.push(arg)
    }
  }
  return args
}

/**
 * Fetch one asset under the shared deadline. Every attempt receives the
 * REMAINING budget as its AbortSignal; retries (network errors and transient
 * 408/429/5xx only) consume the same budget via the shared deadline.
 * @param {string} url
 * @param {{
 *   fetchImpl: typeof fetch,
 *   deadline: number,
 *   nowImpl: () => number,
 *   sleepImpl: (ms: number) => Promise<void>,
 * }} io
 * @returns {Promise<Uint8Array>}
 */
async function fetchAsset(url, io) {
  let lastError = new Error('unreachable')
  for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_ASSET; attempt++) {
    const remaining = io.deadline - io.nowImpl()
    if (remaining <= 0) {
      throw new ReleaseDownloadError(
        10,
        `download deadline exhausted before attempt ${attempt} for ${url}: the total budget is shared across assets, retries and backoff`,
      )
    }
    try {
      const response = await io.fetchImpl(url, {
        signal: AbortSignal.timeout(remaining),
        redirect: 'follow',
      })
      if (!response.ok) {
        // 408/429/5xx are transport-side transients; other 4xx contract
        // errors fail fast.
        const transient =
          response.status === 408 || response.status === 429 || response.status >= 500
        if (!transient || attempt === MAX_ATTEMPTS_PER_ASSET) {
          throw new ReleaseDownloadError(
            10,
            `download failed with HTTP ${response.status} for ${url}`,
          )
        }
        lastError = new Error(`HTTP ${response.status}`)
        await io.sleepImpl(Math.min(RETRY_BACKOFF_MS, Math.max(0, io.deadline - io.nowImpl())))
        continue
      }
      return new Uint8Array(await response.arrayBuffer())
    } catch (error) {
      if (error instanceof ReleaseDownloadError) throw error
      lastError = /** @type {Error} */ (error)
      if (attempt === MAX_ATTEMPTS_PER_ASSET) break
    }
  }
  throw new ReleaseDownloadError(
    10,
    `download failed after ${MAX_ATTEMPTS_PER_ASSET} attempts: ${lastError.message}`,
  )
}

/**
 * Download both verified assets into `outDir`, checking byte sizes against
 * the verified metadata before anything is written. One deadline covers the
 * whole operation; `budgetMs`, the clock and the sleep are injectable so
 * tests can exhaust the budget deterministically.
 * @param {{ tag?: string, zip?: { name?: string, size?: number, url?: string }, sums?: { name?: string, size?: number, url?: string } }} verified
 * @param {{
 *   repo: string,
 *   outDir?: string,
 *   fetchImpl?: typeof fetch,
 *   budgetMs?: number,
 *   nowImpl?: () => number,
 *   sleepImpl?: (ms: number) => Promise<void>,
 * }} options
 */
export async function downloadVerifiedAssets(
  verified,
  {
    repo,
    outDir = '.',
    fetchImpl = fetch,
    budgetMs = TOTAL_DOWNLOAD_BUDGET_MS,
    nowImpl = () => Date.now(),
    sleepImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  },
) {
  if (!verified || typeof verified !== 'object' || Array.isArray(verified)) {
    throw new ReleaseDownloadError(2, 'verified release assets must be a JSON object')
  }
  try {
    assertValidRepoSlug(repo, '--repo')
  } catch (error) {
    throw new ReleaseDownloadError(2, error instanceof Error ? error.message : String(error))
  }
  const targets = /** @type {const} */ ([
    { key: 'zip', name: verified.zip?.name, size: verified.zip?.size, url: verified.zip?.url },
    { key: 'sums', name: verified.sums?.name, size: verified.sums?.size, url: verified.sums?.url },
  ])
  /** @type {Array<{ name: string, bytes: Uint8Array }>} */
  const downloaded = []
  const deadline = nowImpl() + budgetMs
  for (const target of targets) {
    if (
      typeof target.name !== 'string' ||
      typeof target.size !== 'number' ||
      typeof target.url !== 'string'
    ) {
      throw new ReleaseDownloadError(2, `verified metadata entry "${target.key}" is incomplete`)
    }
    try {
      assertSafeAssetName(target.name, `verified asset name for "${target.key}"`)
      assertCanonicalAssetDownloadUrl(target.url, {
        repo,
        tag: /** @type {string} */ (verified.tag),
        name: target.name,
      })
    } catch (error) {
      throw new ReleaseDownloadError(
        2,
        `verified asset "${target.name}": ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    const bytes = await fetchAsset(target.url, { fetchImpl, deadline, nowImpl, sleepImpl })
    if (bytes.length !== target.size) {
      throw new ReleaseDownloadError(
        9,
        `downloaded ${target.name} is ${bytes.length} bytes; verified metadata size is ${target.size}`,
      )
    }
    downloaded.push({ name: target.name, bytes })
  }
  const resolvedOut = path.resolve(outDir)
  for (const { name, bytes } of downloaded) {
    fs.writeFileSync(path.join(resolvedOut, name), bytes)
    console.error(`downloaded: ${name} (${bytes.length} bytes)`)
  }
}

async function run() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(
      'usage: download-release-assets.mjs <verified-json> --repo owner/repo [--out-dir .]',
    )
    return
  }
  if (args.positional.length !== 1 || !args.repo) {
    throw new ReleaseDownloadError(
      2,
      'usage: download-release-assets.mjs <verified-json> --repo owner/repo [--out-dir .]',
    )
  }
  let verified
  try {
    verified = JSON.parse(fs.readFileSync(args.positional[0], 'utf8'))
  } catch (error) {
    throw new ReleaseDownloadError(
      2,
      `cannot read/parse verified assets (${args.positional[0]}): ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  await downloadVerifiedAssets(verified, { repo: args.repo, outDir: args.outDir })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    const code = error instanceof ReleaseDownloadError ? error.code : 10
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(code)
  })
}
