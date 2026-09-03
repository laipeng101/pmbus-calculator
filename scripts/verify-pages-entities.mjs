#!/usr/bin/env node
/**
 * Deployed Pages entity full-manifest verifier (post-deploy).
 *
 * After actions/deploy-pages publishes a release, this gate dynamically
 * enumerates the FULL manifest from the already-verified, already-extracted
 * `_site` directory (whose bytes were byte-bound to the tagged build and the
 * release zip by the pre-deploy release-assets / rebuild gates) and GETs every
 * real relative URL from the live Pages origin, then requires the response
 * entity's origin, status, content-encoding, length and SHA-256 to match the
 * local manifest. It closes the gap where a browser-scoped smoke only touches
 * first-screen resources: a file that is broken, missing, served as a 200 HTML
 * fallback, or redirected cross-origin anywhere in the manifest now fails
 * here.
 *
 * Design contract (data-not-code, same as the other release verifiers):
 *   - The manifest is DERIVED at runtime from `--site`; file count, asset
 *     names, the Pages root path and any per-release secret are never
 *     hard-coded in production logic. Adding or removing a file from `_site`
 *     only changes manifest size, never a test constant.
 *   - Every relative path is parsed safely against `--base-url`; the final
 *     (post-redirect) URL must stay same-origin AND within the base pathname
 *     prefix. Any path escaping the base fails path-safety (exit 3).
 *   - Requests are plain identity GETs: `Accept-Encoding: identity` makes a
 *     non-identity Content-Encoding an explicit failure class (the host
 *     compressing an entity would make the local hash comparison meaningless),
 *     and `Cache-Control: no-cache` plus a CALLER-provided unique cache-busting
 *     query (the workflow passes its unique run id as `--query`, appended as
 *     `?cb=<token>`, so the token never lives in the repo) avoids a stale
 *     edge. Without --query the gate still verifies, just without
 *     cache-busting.
 *   - Every request is bounded end-to-end: the per-request timer and the
 *     shared-deadline abort forwarding stay armed until the response body has
 *     been fully consumed (or the attempt failed), so a host that sends 200
 *     headers quickly and then stalls the body still exits 28/29 instead of
 *     hanging the gate.
 *   - No credentials; no Authorization/Cookie headers are ever sent or
 *     printed, and production diagnostics never echo the cache-busting query,
 *     headers or full URLs — only the logical path and a failure class.
 *   - Any failure exits non-zero with a distinct code per class; stdout still
 *     carries exactly ONE JSON summary object and ALL diagnostics go to stderr.
 *   - The local expected hash is `node:crypto` SHA-256 of the `_site` byte
 *     file, so this gate never trusts the host's ETag/Last-Modified/
 *     Content-Length as correctness — those are only surface diagnostics.
 *
 * Check classes and exit codes:
 *   2  usage / argv contract
 *   3  local site-path / manifest problem (missing site, unreadable,
 *      symlink, empty tree, or a relative path that cannot safely resolve
 *      under the base)
 *   20 network error (DNS/TLS/connection/redirect-loop)
 *   21 HTTP status != 200
 *   23 final URL left the same-origin / base pathname prefix
 *   24 non-identity Content-Encoding on a 200
 *   25 200 HTML fallback: a non-index entity served as text/html whose
 *      bytes (length or hash) diverge from the manifest
 *   26 entity length differs from the local manifest byte size
 *   27 entity SHA-256 differs from the local manifest (byte content mismatch)
 *   28 a single request exceeded its per-request timeout budget
 *   29 the shared total deadline was exhausted; no more requests may start
 *
 * Output contract: stdout carries ONE JSON object
 *   {"baseUrl","concurrency","deadlineMs","manifest":{"count","bytes"},
 *    "okCount","failures":N,"firstFailure":{"path","class","category"},
 *    "failedEntities":[{path,class,category,message},...],"elapsedMs"}
 * and every diagnostic goes to stderr. Failure entries carry only the
 * logical path and a classification message — never the cache-busting
 * query, headers or full URLs.
 */

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

const DEFAULT_CONCURRENCY = 8
const DEFAULT_DEADLINE_MS = 120_000
const DEFAULT_PER_REQUEST_TIMEOUT_MS = 30_000

const USAGE =
  'usage: verify-pages-entities.mjs --site <extracted-site-dir> --base-url <pages-url>' +
  ' [--concurrency N] [--deadline-ms N] [--request-timeout-ms N] [--query <unique-token>]'

/**
 * A failure with a distinct exit code and category.
 */
class PagesVerifyError extends Error {
  /**
   * @param {number} code
   * @param {string} category
   * @param {string} message
   */
  constructor(code, category, message) {
    super(message)
    this.name = 'PagesVerifyError'
    this.code = code
    this.category = category
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
 * @param {string} value
 * @param {string} flag
 * @returns {number}
 */
function parsePositiveInt(value, flag) {
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new PagesVerifyError(
      2,
      'usage',
      `${flag} must be a positive integer (got ${JSON.stringify(value)})`,
    )
  }
  return Number(value)
}

/**
 * @param {string[]} argv
 * @returns {{ site: string|null, baseUrl: string|null, concurrency: number, deadlineMs: number, requestTimeoutMs: number, query: string|null, help: boolean }}
 */
function parseArgs(argv) {
  /** @type {{ site: string|null, baseUrl: string|null, concurrency: number, deadlineMs: number, requestTimeoutMs: number, query: string|null, help: boolean }} */
  const args = {
    site: null,
    baseUrl: null,
    concurrency: DEFAULT_CONCURRENCY,
    deadlineMs: DEFAULT_DEADLINE_MS,
    requestTimeoutMs: DEFAULT_PER_REQUEST_TIMEOUT_MS,
    query: null,
    help: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const requireValue = (/** @type {string} */ flag) => {
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('--')) {
        throw new PagesVerifyError(2, 'usage', `${flag} requires a value\n${USAGE}`)
      }
      i++
      return value
    }
    try {
      if (arg === '--site') {
        args.site = requireValue('--site')
      } else if (arg === '--base-url') {
        args.baseUrl = requireValue('--base-url')
      } else if (arg === '--concurrency') {
        args.concurrency = parsePositiveInt(requireValue('--concurrency'), '--concurrency')
      } else if (arg === '--deadline-ms') {
        args.deadlineMs = parsePositiveInt(requireValue('--deadline-ms'), '--deadline-ms')
      } else if (arg === '--request-timeout-ms') {
        args.requestTimeoutMs = parsePositiveInt(
          requireValue('--request-timeout-ms'),
          '--request-timeout-ms',
        )
      } else if (arg === '--query') {
        args.query = requireValue('--query')
      } else if (arg === '--help' || arg === '-h') {
        args.help = true
      } else if (arg.startsWith('--')) {
        fail(2, `unknown option: ${arg}\n${USAGE}`)
      } else {
        fail(2, `unexpected positional argument: ${arg}\n${USAGE}`)
      }
    } catch (error) {
      if (error instanceof PagesVerifyError) fail(error.code, error.message)
      throw error
    }
  }
  return args
}

/**
 * Parse and validate the base URL: absolute http(s), no credentials, no
 * query/fragment.
 *
 * @param {string} baseUrl
 * @returns {URL}
 */
function parseBaseUrl(baseUrl) {
  let url
  try {
    url = new URL(baseUrl)
  } catch {
    throw new PagesVerifyError(3, 'base-path', `base-url is not a valid absolute URL: ${baseUrl}`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new PagesVerifyError(3, 'base-path', `base-url must be http(s), got ${url.protocol}//`)
  }
  if (url.username !== '' || url.password !== '') {
    throw new PagesVerifyError(3, 'base-path', 'base-url must not carry credentials')
  }
  if (url.search !== '' || url.hash !== '') {
    throw new PagesVerifyError(3, 'base-path', 'base-url must not carry a query string or fragment')
  }
  return url
}

/**
 * Is a manifest-relative path safe to resolve under the base? A zip-derived
 * relative path should be a plain posix path; anything that could escape the
 * base pathname (leading slash, dot-dot, backslash, URL specials, or a raw
 * absolute/form-scheme reference) is rejected.
 *
 * @param {string} relative
 * @returns {boolean}
 */
export function isSafeRelativePath(relative) {
  if (relative === '' || relative === '.') return false
  if (/^(\.\.?)(\/|$)/.test(relative)) return false
  if (/\/\.\.(\/|$)/.test(relative)) return false
  if (/[\\\u0000-\u001f]/.test(relative)) return false
  if (relative.endsWith('/')) return false
  if (/^\/|\/\//.test(relative)) return false
  if (/[?#]/.test(relative)) return false
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(relative)) return false
  return true
}

/**
 * Resolve a relative manifest path against the base URL and require the final
 * URL to stay same-origin and within the base pathname prefix. The base must
 * trail with a slash so bare `index.html` resolves under the prefix, not a
 * sibling level up.
 *
 * @param {URL} base
 * @param {string} relative
 * @returns {URL}
 */
function resolveEntityUrl(base, relative) {
  const baseWithTrailingSlash = pathEnsureSlash(base)
  const url = new URL(relative, baseWithTrailingSlash)
  if (url.origin !== base.origin) {
    throw new PagesVerifyError(3, 'base-path', `relative path leaves the base origin: ${relative}`)
  }
  const prefix = base.pathname.endsWith('/') ? base.pathname : base.pathname + '/'
  if (prefix !== '/' && !(url.pathname === base.pathname || url.pathname.startsWith(prefix))) {
    throw new PagesVerifyError(
      3,
      'base-path',
      `relative path leaves the base pathname: ${relative}`,
    )
  }
  return url
}

/**
 * Clone the base URL with a trailing slash on its pathname — the resolution
 * anchor for bare relative names like `index.html`.
 *
 * @param {URL} base
 * @returns {URL}
 */
function pathEnsureSlash(base) {
  const withSlash = new URL(base.href)
  if (!withSlash.pathname.endsWith('/')) withSlash.pathname += '/'
  return withSlash
}

/**
 * Enumerate the full manifest from the extracted site directory: every regular
 * file under it, with its posix-relative path (the entity's logical URL path)
 * and the local SHA-256 of its exact bytes.
 *
 * @param {string} siteDir
 * @returns {{ relative: string, size: number, sha256: string }[]}
 */
function buildManifest(siteDir) {
  let stat
  try {
    stat = fs.statSync(siteDir)
  } catch {
    throw new PagesVerifyError(3, 'manifest', `site directory is missing: ${siteDir}`)
  }
  if (!stat.isDirectory()) {
    throw new PagesVerifyError(3, 'manifest', `site path is not a directory: ${siteDir}`)
  }
  /** @type {{ relative: string, size: number, sha256: string }[]} */
  const manifest = []
  const walk = (/** @type {string} */ dir) => {
    /** @type {fs.Dirent[]} */
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch (error) {
      throw new PagesVerifyError(
        3,
        'manifest',
        `cannot read site directory ${dir}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (entry.isFile()) {
        const relative = path.relative(siteDir, full).split(path.sep).join('/')
        const hash = createHash('sha256')
        hash.update(fs.readFileSync(full))
        manifest.push({ relative, size: fs.statSync(full).size, sha256: hash.digest('hex') })
      } else if (entry.isSymbolicLink()) {
        throw new PagesVerifyError(
          3,
          'manifest',
          `symlink not allowed in site tree: ${path.relative(siteDir, full).split(path.sep).join('/')}`,
        )
      }
    }
  }
  walk(siteDir)
  if (manifest.length === 0) {
    throw new PagesVerifyError(3, 'manifest', `site directory ${siteDir} contains no files`)
  }
  return manifest
}

/**
 * Hash already-read body bytes with node:crypto.
 *
 * @param {Buffer} body
 * @returns {string}
 */
function sha256(body) {
  const hash = createHash('sha256')
  hash.update(body)
  return hash.digest('hex')
}

/**
 * @typedef {{ relative: string, ok: true, status: number, length: number, sha256: string, redirects: number, timingMs: number }} OkResult
 */

/**
 * Verify one manifest entity against the live origin. Returns the OK summary
 * or throws a PagesVerifyError for every failure class.
 *
 * @param {URL} baseUrl
 * @param {{ relative: string, size: number, sha256: string }} entity
 * @param {{ query: string|null, requestTimeoutMs: number, signal: AbortSignal }} options
 * @returns {Promise<OkResult>}
 */
async function verifyEntity(baseUrl, entity, options) {
  const relative = entity.relative
  if (!isSafeRelativePath(relative)) {
    throw new PagesVerifyError(3, 'path-safety', `unsafe relative path in manifest: ${relative}`)
  }
  const url = resolveEntityUrl(baseUrl, relative)
  const target = new URL(url.href)
  if (options.query !== null) {
    target.searchParams.append('cb', options.query)
  }

  const started = Date.now()
  const controller = new AbortController()
  const onOuterAbort = () => controller.abort()
  options.signal.addEventListener('abort', onOuterAbort, { once: true })
  const requestTimer = setTimeout(() => controller.abort(), options.requestTimeoutMs)

  // The per-request timer and the shared-deadline forwarding live until the
  // entity's response body has been FULLY consumed (or the attempt fails):
  // a host that sends 200 headers quickly and then stalls the body must hit
  // the same timeout/deadline budget as one that never responds at all.
  try {
    const response = await fetch(target.href, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        Accept: 'application/octet-stream, text/html;q=0.8, */*;q=0.1',
        'Accept-Encoding': 'identity',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      },
      signal: controller.signal,
    })

    // Redirect and origin contract: the landing URL must stay same-origin and
    // within the base pathname prefix.
    const finalUrl = new URL(response.url || target.href)
    if (finalUrl.origin !== baseUrl.origin) {
      throw new PagesVerifyError(23, 'origin', `final URL left the Pages origin: ${relative}`)
    }
    const prefix = baseUrl.pathname.endsWith('/') ? baseUrl.pathname : baseUrl.pathname + '/'
    const inPrefix =
      prefix === '/' ||
      finalUrl.pathname === baseUrl.pathname ||
      finalUrl.pathname.startsWith(prefix)
    if (!inPrefix) {
      throw new PagesVerifyError(23, 'origin', `final URL left the Pages pathname: ${relative}`)
    }
    const redirects = response.redirected ? 1 : 0

    if (response.status !== 200) {
      throw new PagesVerifyError(
        21,
        'status',
        `HTTP ${response.status} for ${relative} (expected 200)`,
      )
    }

    // A non-identity Content-Encoding on a 200 means the host transformed the
    // entity; the local-hash comparison would be meaningless.
    const contentEncoding = response.headers.get('content-encoding')
    if (contentEncoding !== null && contentEncoding.toLowerCase() !== 'identity') {
      throw new PagesVerifyError(
        24,
        'content-encoding',
        `entity served with Content-Encoding "${contentEncoding}" (identity required): ${relative}`,
      )
    }

    const body = Buffer.from(await response.arrayBuffer())
    const actualHash = sha256(body)
    const sizeOk = body.length === entity.size
    const contentOk = actualHash === entity.sha256

    // A 200 text/html that is NOT index.html and does not match the manifest is
    // the SPA/404 fallback signature (the real entity is a script/css/font
    // served as the index page). Classify the evidence explicitly BEFORE the
    // generic length/hash classes: a fallback usually differs in both, and
    // "served as HTML" is the actionable fact.
    const contentType = response.headers.get('content-type') ?? ''
    const isIndex = relative === 'index.html'
    if (!isIndex && contentType.includes('text/html') && !(sizeOk && contentOk)) {
      throw new PagesVerifyError(
        25,
        'fallback',
        `200 text/html fallback for ${relative} (expected ${describeEntity(relative)}, ` +
          `entity ${body.length} bytes vs manifest ${entity.size})`,
      )
    }

    if (!sizeOk) {
      throw new PagesVerifyError(
        26,
        'length',
        `${relative}: entity length ${body.length} != manifest ${entity.size} bytes`,
      )
    }

    if (!contentOk) {
      throw new PagesVerifyError(
        27,
        'hash',
        `${relative}: entity sha256 ${actualHash} != manifest ${entity.sha256}`,
      )
    }

    return {
      relative,
      ok: true,
      status: response.status,
      length: body.length,
      sha256: actualHash,
      redirects,
      timingMs: Date.now() - started,
    }
  } catch (error) {
    if (error instanceof PagesVerifyError) throw error
    const cause = /** @type {{name?: string, code?: string}} */ (error)
    if (options.signal.aborted) {
      throw new PagesVerifyError(
        29,
        'deadline',
        `shared deadline exhausted while fetching ${relative}`,
      )
    }
    if (cause.name === 'AbortError') {
      // The per-request timeout aborted this request (the shared deadline was
      // ruled out above) — either before the response head arrived or while
      // the response body was still being consumed.
      throw new PagesVerifyError(
        28,
        'timeout',
        `per-request timeout after ${options.requestTimeoutMs}ms: ${relative}`,
      )
    }
    throw new PagesVerifyError(
      20,
      'network',
      `network error fetching ${relative}: ${cause.code ?? cause.name ?? String(error)}`,
    )
  } finally {
    clearTimeout(requestTimer)
    options.signal.removeEventListener('abort', onOuterAbort)
  }
}

/**
 * @param {string} relative
 * @returns {string}
 */
function describeEntity(relative) {
  const ext = path.posix.extname(relative)
  return ext ? `"${ext}" entity` : 'non-HTML entity'
}

/**
 * Run the bounded-concurrency full-manifest sweep with a shared total
 * deadline. Each entity is checked; once a failure appears no new request
 * starts (fail-fast), anything still in flight is aborted at the deadline,
 * and never-expired in-flight work still lands in the summary.
 *
 * @param {string} siteDir
 * @param {string} baseUrl
 * @param {{ concurrency: number, deadlineMs: number, requestTimeoutMs: number, query: string|null }} options
 * @returns {Promise<{ baseUrl: string, concurrency: number, deadlineMs: number, manifest: {count: number, bytes: number}, okCount: number, failures: number, firstFailure: {path: string, class: number, category: string} | null, failedEntities: {path: string, class: number, category: string, message: string}[], elapsedMs: number }>}
 */
export async function verifyPagesEntities(siteDir, baseUrl, options) {
  const started = Date.now()
  const base = parseBaseUrl(baseUrl)
  const manifest = buildManifest(siteDir)

  const controller = new AbortController()
  const deadlineTimer = setTimeout(() => controller.abort(), options.deadlineMs)

  /** @type {OkResult[]} */
  const ok = []
  /** @type {{ path: string, class: number, category: string, message: string }[]} */
  const failures = []
  let nextIndex = 0

  const worker = async () => {
    for (;;) {
      if (controller.signal.aborted) break
      if (failures.length > 0) break
      const index = nextIndex++
      if (index >= manifest.length) break
      try {
        const result = await verifyEntity(base, manifest[index], {
          query: options.query,
          requestTimeoutMs: options.requestTimeoutMs,
          signal: controller.signal,
        })
        ok.push(result)
      } catch (error) {
        if (error instanceof PagesVerifyError) {
          failures.push({
            path: manifest[index].relative,
            class: error.code,
            category: error.category,
            message: error.message,
          })
        } else {
          throw error
        }
      }
    }
  }

  const workerCount = Math.min(options.concurrency, manifest.length)
  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  clearTimeout(deadlineTimer)

  const manifestBytes = manifest.reduce((sum, entry) => sum + entry.size, 0)
  let first = null
  if (failures.length > 0) {
    first = { path: failures[0].path, class: failures[0].class, category: failures[0].category }
  }

  return {
    baseUrl,
    concurrency: options.concurrency,
    deadlineMs: options.deadlineMs,
    manifest: { count: manifest.length, bytes: manifestBytes },
    okCount: ok.length,
    failures: failures.length,
    firstFailure: first,
    failedEntities: failures.map((failure) => ({
      path: failure.path,
      class: failure.class,
      category: failure.category,
      message: failure.message,
    })),
    elapsedMs: Date.now() - started,
  }
}

/**
 * CLI entry: stdout carries ONE JSON summary, all diagnostics go to stderr.
 *
 * @param {string[]} argv
 */
export function runCli(argv) {
  let args
  try {
    args = parseArgs(argv)
  } catch (error) {
    if (error instanceof PagesVerifyError) fail(error.code, error.message)
    throw error
  }
  if (args.help) {
    console.log(USAGE)
    process.exit(0)
  }
  for (const [flag, value] of [
    ['--site', args.site],
    ['--base-url', args.baseUrl],
  ]) {
    if (!value) fail(2, `${flag} is required\n${USAGE}`)
  }
  verifyPagesEntities(/** @type {string} */ (args.site), /** @type {string} */ (args.baseUrl), {
    concurrency: args.concurrency,
    deadlineMs: args.deadlineMs,
    requestTimeoutMs: args.requestTimeoutMs,
    query: args.query,
  })
    .then((result) => {
      console.log(JSON.stringify(result))
      for (const failure of result.failedEntities) {
        console.error(`entity ${failure.path}: ${failure.message}`)
      }
      if (result.failures > 0) {
        console.error(
          `error: ${result.failures} entity check(s) failed ` +
            `(first: ${result.firstFailure?.category}/${result.firstFailure?.path}); ` +
            `${result.okCount}/${result.manifest.count} entities verified`,
        )
        process.exitCode = /** @type {number} */ (result.firstFailure?.class ?? 20)
      } else {
        console.error(
          `ok: ${result.okCount}/${result.manifest.count} Pages entities verified ` +
            `(sha256/length/origin/status/identity) in ${result.elapsedMs}ms`,
        )
      }
    })
    .catch((error) => {
      console.error(`error: ${error instanceof Error ? error.message : String(error)}`)
      process.exitCode = error instanceof PagesVerifyError ? error.code : 20
    })
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) {
  runCli(process.argv.slice(2))
}
