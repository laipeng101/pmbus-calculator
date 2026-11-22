#!/usr/bin/env node
/// <reference lib="dom.asynciterable" />
import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { isSafePagesPath } from './pages-network-policy.mjs'

/** @param {string} value */
function pagesBase(value) {
  const url = URL.parse(value)
  if (
    !url ||
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error('Base URL must be HTTP(S) without credentials, query or fragment')
  }
  if (!url.pathname.endsWith('/')) url.pathname += '/'
  return url
}

/** @param {string} directory */
function readManifest(directory) {
  if (!lstatSync(directory, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error('Site must be a real directory')
  }
  const entries = readdirSync(directory, { recursive: true, withFileTypes: true })
  const manifest = entries
    .filter((entry) => !entry.isDirectory())
    .map((entry) => {
      const file = path.join(entry.parentPath, entry.name)
      const relative = path.relative(directory, file).split(path.sep).join('/')
      if (!entry.isFile() || !isSafePagesPath(relative)) {
        throw new Error(`Invalid site file: ${JSON.stringify(relative)}`)
      }
      const bytes = readFileSync(file)
      return {
        relative,
        size: bytes.length,
        hash: createHash('sha256').update(bytes).digest('hex'),
      }
    })
  if (manifest.length === 0) throw new Error('Site contains no files')
  return manifest
}

/**
 * @param {URL} target
 * @param {ReturnType<typeof readManifest>[number]} entity
 * @param {AbortSignal} signal
 */
async function verifyEntity(target, entity, signal) {
  // Each uploaded file has a direct URL. Following Location could send a
  // cache-busting request outside the Pages origin or deployment prefix.
  const response = await fetch(target, {
    redirect: 'manual',
    headers: { 'Accept-Encoding': 'identity', 'Cache-Control': 'no-cache' },
    signal,
  })
  if (response.status !== 200) throw new Error(`HTTP ${response.status} (expected 200)`)
  const encoding = response.headers.get('content-encoding')
  if (encoding !== null && encoding.toLowerCase() !== 'identity') {
    throw new Error('Expected identity Content-Encoding')
  }
  if (!response.body) throw new Error('Missing response body')

  // A body larger than the staged file cannot match. Leaving the loop cancels it.
  const hash = createHash('sha256')
  let size = 0
  for await (const chunk of response.body) {
    size += chunk.byteLength
    if (size > entity.size) break
    hash.update(chunk)
  }
  if (size === entity.size && hash.digest('hex') === entity.hash) return

  const contentType = response.headers.get('content-type')?.toLowerCase()
  if (!entity.relative.endsWith('.html') && contentType?.includes('text/html')) {
    throw new Error('Unexpected HTML response for an asset')
  }
  if (size !== entity.size) {
    const received = size > entity.size ? `at least ${size}` : size
    throw new Error(`Length mismatch: expected ${entity.size} bytes, received ${received}`)
  }
  throw new Error('SHA-256 mismatch')
}

/**
 * @param {string} siteDir
 * @param {string} baseUrl
 * @param {{ concurrency?: number, deadlineMs?: number, requestTimeoutMs?: number, query?: string|null }} [options]
 */
export async function verifyPagesEntities(
  siteDir,
  baseUrl,
  { concurrency = 8, deadlineMs = 120_000, requestTimeoutMs = 30_000, query = null } = {},
) {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new Error('Concurrency must be a positive integer')
  }
  const started = performance.now()
  const base = pagesBase(baseUrl)
  const manifest = readManifest(siteDir)
  const deadline = AbortSignal.timeout(deadlineMs)
  const stopped = new AbortController()
  const runSignal = AbortSignal.any([deadline, stopped.signal])
  let next = 0
  let okCount = 0
  /** @type {{ path: string, reason: string } | null} */
  let firstFailure = null

  async function worker() {
    while (!runSignal.aborted && next < manifest.length) {
      const entity = manifest[next++]
      const target = new URL(entity.relative.split('/').map(encodeURIComponent).join('/'), base)
      if (query !== null) target.searchParams.set('cb', query)
      const signal = AbortSignal.any([runSignal, AbortSignal.timeout(requestTimeoutMs)])
      try {
        await verifyEntity(target, entity, signal)
        okCount += 1
      } catch (error) {
        if (stopped.signal.aborted) return
        let reason =
          error instanceof Error && !(error instanceof TypeError)
            ? error.message
            : 'Network request failed'
        if (deadline.aborted) reason = 'Shared deadline exceeded'
        else if (signal.aborted) reason = 'Request timed out'
        firstFailure = { path: entity.relative, reason }
        stopped.abort()
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, manifest.length) }, worker))
  return {
    manifest: { count: manifest.length },
    okCount,
    failures: Number(firstFailure !== null),
    firstFailure: /** @type {{ path: string, reason: string } | null} */ (firstFailure),
    elapsedMs: Math.round(performance.now() - started),
  }
}

/** @param {string[]} args */
async function runCli(args) {
  const { values } = parseArgs({
    args,
    options: {
      site: { type: 'string' },
      'base-url': { type: 'string' },
      query: { type: 'string' },
    },
  })
  const site = values.site
  const baseUrl = values['base-url']
  if (!site || !baseUrl) {
    throw new Error('Usage: verify-pages-entities.mjs --site _site --base-url URL [--query TOKEN]')
  }
  const result = await verifyPagesEntities(site, baseUrl, { query: values.query })
  console.log(
    `Pages: ${result.okCount}/${result.manifest.count} files verified in ${result.elapsedMs} ms`,
  )
  if (result.firstFailure) {
    console.error(
      `Pages: ${JSON.stringify(result.firstFailure.path)}: ${result.firstFailure.reason}`,
    )
    process.exitCode = 1
  }
}

if (import.meta.main) {
  try {
    await runCli(process.argv.slice(2))
  } catch (error) {
    console.error(`Pages: ${error instanceof Error ? error.message : 'Verification failed'}`)
    process.exitCode = 1
  }
}
