import { execFileSync, spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MANIFEST_PATH = 'document/specifications.json'
const EXPECTED_DOCUMENT_COUNT = 4

export const DEFAULT_CACHE_DIR = '.cache/specifications'
export const DEFAULT_TIMEOUT_MS = 30_000
export const MAX_REDIRECTS = 5

export const ALLOWED_LANDING_HOSTS = ['pmbus.org', 'www.smbus.org']
export const ALLOWED_DOWNLOAD_HOSTS = ['pmbusprod.wpenginepowered.com', 'www.smbus.org']

const HELP = `specifications.mjs — manage third-party PMBus/SMBus specification PDF provenance and cache

Usage:
  node scripts/specifications.mjs check
  node scripts/specifications.mjs list
  node scripts/specifications.mjs fetch --all
  node scripts/specifications.mjs fetch --id <id>
  node scripts/specifications.mjs verify-cache

Commands:
  check         Offline manifest/schema/git-index validation. No network access.
  list          Print manifest entries without downloading anything.
  fetch         Download only when --all or --id is explicitly given.
                Files are written to the ignored .cache/specifications/ directory
                after byte count and SHA-256 verification.
  verify-cache  Offline verification of files already present in the cache.
`

export function repoRootFromScript(importMetaUrl) {
  return path.resolve(path.dirname(fileURLToPath(importMetaUrl)), '..')
}

function matchesHost(url, allowlist) {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && allowlist.includes(parsed.host)
  } catch {
    return false
  }
}

export function isSafeFileName(fileName) {
  if (typeof fileName !== 'string' || fileName.length === 0) return false
  if (fileName === '.' || fileName === '..') return false
  if (fileName !== path.basename(fileName)) return false
  if (fileName.includes('\\') || fileName.includes('/')) return false
  return true
}

export function isValidSha256(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
}

export function isValidBytes(value) {
  return Number.isInteger(value) && value > 0
}

function pushIf(condition, errors, message) {
  if (condition) errors.push(message)
}

export function validateManifest(manifest, options = {}) {
  const errors = []
  const expectedDocumentCount = options.expectedDocumentCount ?? EXPECTED_DOCUMENT_COUNT
  const landingHosts = options.landingHosts ?? ALLOWED_LANDING_HOSTS
  const downloadHosts = options.downloadHosts ?? ALLOWED_DOWNLOAD_HOSTS

  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { ok: false, errors: ['manifest must be a JSON object'], manifest }
  }

  if (manifest.schemaVersion !== 1) {
    errors.push(`schemaVersion must be 1 (received ${String(manifest.schemaVersion)})`)
  }

  if (Array.isArray(manifest.documents) === false) {
    errors.push('documents must be an array')
    return { ok: false, errors, manifest }
  }

  if (manifest.documents.length !== expectedDocumentCount) {
    errors.push(
      `manifest must contain exactly ${expectedDocumentCount} specification records (received ${manifest.documents.length})`,
    )
  }

  const ids = new Set()
  const fileNames = new Set()
  const requiredStringFields = [
    'id',
    'title',
    'revision',
    'publishedDate',
    'officialLandingPage',
    'downloadUrl',
    'fileName',
    'rightsHolder',
    'rightsNotice',
    'redistributionStatus',
  ]

  for (const [index, document] of manifest.documents.entries()) {
    const label = `documents[${index}]`
    if (document === null || typeof document !== 'object' || Array.isArray(document)) {
      errors.push(`${label} must be an object`)
      continue
    }

    for (const field of requiredStringFields) {
      if (typeof document[field] !== 'string' || document[field].length === 0) {
        errors.push(`${label}.${field} must be a non-empty string`)
      }
    }

    if (typeof document.id === 'string') {
      if (ids.has(document.id)) errors.push(`duplicate id: ${document.id}`)
      ids.add(document.id)
    }

    if (typeof document.fileName === 'string') {
      if (fileNames.has(document.fileName)) errors.push(`duplicate fileName: ${document.fileName}`)
      fileNames.add(document.fileName)
      if (isSafeFileName(document.fileName) === false) {
        errors.push(`${label}.fileName contains a path escape or is not a plain file name`)
      }
    }

    if (isValidBytes(document.bytes) === false) {
      errors.push(`${label}.bytes must be a positive integer`)
    }

    if (isValidSha256(document.sha256) === false) {
      errors.push(`${label}.sha256 must be 64 lowercase hexadecimal characters`)
    }

    if (matchesHost(document.officialLandingPage, landingHosts) === false) {
      errors.push(`${label}.officialLandingPage must be an HTTPS URL on an allowed landing host`)
    }

    if (matchesHost(document.downloadUrl, downloadHosts) === false) {
      errors.push(`${label}.downloadUrl must be an HTTPS URL on an allowed download host`)
    }

    if (document.redistributionStatus !== 'not-established-by-project') {
      errors.push(
        `${label}.redistributionStatus must be the neutral value 'not-established-by-project' unless an official, citable license permits a different value`,
      )
    }
  }

  return { ok: errors.length === 0, errors, manifest }
}

export function validateDocument(document, options = {}) {
  return validateManifest(
    { schemaVersion: 1, documents: [document] },
    { ...options, expectedDocumentCount: 1 },
  )
}

export function assertValidManifest(manifest, options = {}) {
  const validation = validateManifest(manifest, options)
  if (validation.ok === false) {
    throw new Error(`invalid specification manifest: ${validation.errors.join('; ')}`)
  }
  return validation.manifest
}

export function assertValidDocument(document, options = {}) {
  const validation = validateDocument(document, options)
  if (validation.ok === false) {
    throw new Error(`invalid specification document: ${validation.errors.join('; ')}`)
  }
  return document
}

export async function loadManifest(repoRoot) {
  const manifestPath = path.join(repoRoot, MANIFEST_PATH)
  let text
  try {
    text = await fs.readFile(manifestPath, 'utf8')
  } catch (error) {
    throw new Error(`failed to read manifest at ${manifestPath}: ${error.message ?? error}`)
  }

  let manifest
  try {
    manifest = JSON.parse(text)
  } catch (error) {
    throw new Error(`failed to parse manifest at ${manifestPath}: ${error.message ?? error}`)
  }

  assertValidManifest(manifest)
  return manifest
}

export function gitTrackedPdfs(repoRoot) {
  const output = execFileSync('git', ['-C', repoRoot, 'ls-files', '-z', '--', '*.pdf'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  return output.split('\0').filter(Boolean)
}

export function checkSpecifications({ repoRoot, log = console.log, error = console.error } = {}) {
  const result = {
    manifest: null,
    manifestOk: false,
    trackedPdfs: [],
    ok: false,
    errors: [],
  }

  try {
    result.manifest = JSON.parse(readFileSync(path.join(repoRoot, MANIFEST_PATH), 'utf8'))
    const validation = validateManifest(result.manifest)
    result.manifestOk = validation.ok
    result.errors.push(...validation.errors)
  } catch (caught) {
    result.errors.push(caught.message ?? caught)
  }

  try {
    result.trackedPdfs = gitTrackedPdfs(repoRoot)
  } catch (caught) {
    result.errors.push(`failed to inspect tracked PDFs: ${caught.message ?? caught}`)
  }

  if (result.trackedPdfs.length > 0) {
    result.errors.push(
      `tracked PDFs are not allowed; use scripts/specifications.mjs fetch to download specifications into ${DEFAULT_CACHE_DIR}: ${result.trackedPdfs.join(', ')}`,
    )
  }

  result.ok = result.manifestOk && result.trackedPdfs.length === 0 && result.errors.length === 0

  if (result.ok) {
    log('specs:check OK')
    log(`specs:check manifest entries: ${result.manifest.documents.length}`)
    log('specs:check tracked PDFs: 0')
  } else {
    for (const message of result.errors) error(`specs:check error: ${message}`)
    error('specs:check FAILED')
  }

  return result
}

export function listSpecifications(manifest, { log = console.log } = {}) {
  assertValidManifest(manifest)
  for (const document of manifest.documents) {
    log(
      [
        document.id,
        `rev ${document.revision}`,
        document.officialLandingPage,
        document.downloadUrl,
        `${document.bytes} bytes`,
        document.sha256.slice(0, 12),
      ].join('\t'),
    )
  }
  return manifest.documents
}

export function parseFetchArgs(args) {
  const all = args.includes('--all')
  const ids = []
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--all') continue
    if (arg === '--id') {
      const value = args[index + 1]
      if (value === undefined || value.startsWith('--')) {
        throw new Error('fetch --id requires a document id')
      }
      ids.push(value)
      index += 1
      continue
    }
    throw new Error(`unknown fetch option: ${arg}`)
  }
  return { all, ids }
}

function selectDocuments(manifest, { all, ids }) {
  if (all === false && ids.length === 0) {
    throw new Error('fetch requires --all or --id <id>')
  }
  if (all) return manifest.documents
  const byId = new Map(manifest.documents.map((document) => [document.id, document]))
  const selected = []
  for (const id of ids) {
    const document = byId.get(id)
    if (document === undefined) throw new Error(`unknown specification id: ${id}`)
    selected.push(document)
  }
  return selected
}

async function realpathOrThrow(target, description) {
  try {
    return await fs.realpath(target)
  } catch (error) {
    throw new Error(`failed to resolve ${description} ${target}: ${error.message ?? error}`)
  }
}

async function rejectSymlinkSegments(repoRoot, absoluteTarget) {
  const segments = path.relative(repoRoot, absoluteTarget).split(path.sep)
  let current = repoRoot
  for (const segment of segments) {
    if (segment.length === 0) continue
    current = path.join(current, segment)
    let stat = null
    try {
      stat = await fs.lstat(current)
    } catch {
      stat = null
    }
    if (stat !== null && stat.isSymbolicLink()) {
      throw new Error(`refusing symlink in cache path: ${current}`)
    }
  }
}

export async function resolveVerifiedCacheDir(repoRoot, cacheDir) {
  const realRoot = await realpathOrThrow(repoRoot, 'repository root')
  const absolute = path.resolve(realRoot, cacheDir)
  const relative = path.relative(realRoot, absolute)
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`cache directory escapes repository root: ${cacheDir}`)
  }
  await rejectSymlinkSegments(realRoot, absolute)
  return { realRoot, absoluteCacheDir: absolute }
}

export function isCachePathIgnored(repoRoot, cacheDir) {
  const probe = spawnSync('git', ['-C', repoRoot, 'check-ignore', '-q', '--', cacheDir], {
    encoding: 'utf8',
  })
  return probe.status === 0
}

async function ensureCacheIsIgnored(repoRoot, cacheDir) {
  if (isCachePathIgnored(repoRoot, cacheDir) === false) {
    throw new Error(`cache directory must be git-ignored before downloading: ${cacheDir}`)
  }
}

async function existingFileState(filePath) {
  let stat = null
  try {
    stat = await fs.lstat(filePath)
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
  if (stat.isSymbolicLink()) throw new Error(`cache path is a symbolic link: ${filePath}`)
  if (stat.isFile() === false) throw new Error(`cache path is not a regular file: ${filePath}`)
  const bytes = stat.size
  const sha256 = await sha256File(filePath)
  return { filePath, bytes, sha256 }
}

export async function sha256File(filePath) {
  const hash = crypto.createHash('sha256')
  const handle = await fs.open(filePath, 'r')
  try {
    const buffer = Buffer.alloc(1024 * 1024)
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null)
      if (bytesRead <= 0) break
      hash.update(buffer.subarray(0, bytesRead))
    }
  } finally {
    await handle.close()
  }
  return hash.digest('hex')
}

export function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

function makeTempPath(targetPath) {
  return path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.tmp-${process.pid}-${crypto.randomUUID()}`,
  )
}

function getResponseHeader(response, name) {
  const headers = response.headers
  if (headers && typeof headers.get === 'function') {
    const value = headers.get(name)
    return value === null ? undefined : value
  }
  if (headers && typeof headers === 'object') {
    return headers[name.toLowerCase()] ?? headers[name]
  }
  return undefined
}

async function cancelResponseBody(response) {
  try {
    if (response.body && typeof response.body.cancel === 'function') {
      await response.body.cancel()
    }
  } catch {
    // best-effort cleanup; never mask the original redirect/validation error
  }
}

function abortErrorFor(signal) {
  if (signal && signal.reason instanceof Error) return signal.reason
  return new Error('aborted')
}

async function raceWithSignal(promise, signal) {
  if (signal?.aborted) throw abortErrorFor(signal)
  return await new Promise((resolve, reject) => {
    const onAbort = () => reject(abortErrorFor(signal))
    signal?.addEventListener('abort', onAbort, { once: true })
    Promise.resolve(promise).then(
      (value) => {
        signal?.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error) => {
        signal?.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

async function readChunkWithSignal(reader, signal) {
  if (signal?.aborted) throw abortErrorFor(signal)
  return await new Promise((resolve, reject) => {
    const onAbort = () => {
      reader.cancel().catch(() => {})
      reject(abortErrorFor(signal))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    reader.read().then(
      (result) => {
        signal?.removeEventListener('abort', onAbort)
        resolve(result)
      },
      (error) => {
        signal?.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

async function streamResponseToTempFile(response, targetPath, document, signal) {
  if (response.body === null || response.body === undefined) {
    throw new Error(`response body is missing for ${document.downloadUrl}`)
  }
  const reader = response.body.getReader?.()
  if (reader === undefined) {
    throw new Error(`response body is not a readable stream for ${document.downloadUrl}`)
  }

  const hash = crypto.createHash('sha256')
  let bytes = 0
  let handle = null
  let tempPath = null

  try {
    tempPath = makeTempPath(targetPath)
    handle = await fs.open(tempPath, 'wx')

    while (true) {
      const { done, value } = await readChunkWithSignal(reader, signal)
      if (done) break
      bytes += value.byteLength
      if (bytes > document.bytes) {
        await reader.cancel().catch(() => {})
        throw new Error(
          `byte count mismatch for ${document.id}: expected ${document.bytes}, received more than ${document.bytes}`,
        )
      }
      hash.update(value)
      await handle.write(value)
    }

    await handle.close()
    handle = null

    if (bytes !== document.bytes) {
      throw new Error(
        `byte count mismatch for ${document.id}: expected ${document.bytes}, received ${bytes}`,
      )
    }

    const sha256 = hash.digest('hex')
    if (sha256 !== document.sha256) {
      throw new Error(
        `sha256 mismatch for ${document.id}: expected ${document.sha256}, received ${sha256}`,
      )
    }

    return { tempPath, bytes, sha256 }
  } catch (error) {
    if (handle !== null) await handle.close().catch(() => {})
    if (tempPath !== null) await fs.rm(tempPath, { force: true }).catch(() => {})
    await reader.cancel().catch(() => {})
    throw error
  }
}

export async function fetchWithRedirects(
  url,
  { fetchImpl = fetch, signal, downloadHosts = ALLOWED_DOWNLOAD_HOSTS } = {},
) {
  let currentUrl = url
  const seen = new Set()

  for (let redirects = 0; ; redirects += 1) {
    if (signal?.aborted) throw abortErrorFor(signal)
    if (redirects > MAX_REDIRECTS) {
      throw new Error(`too many redirects (${redirects}) for ${url}`)
    }
    if (matchesHost(currentUrl, downloadHosts) === false) {
      throw new Error(`redirect target host is not allowed: ${currentUrl}`)
    }
    if (seen.has(currentUrl)) {
      throw new Error(`redirect loop detected at ${currentUrl}`)
    }
    seen.add(currentUrl)

    const response = await raceWithSignal(
      fetchImpl(currentUrl, { redirect: 'manual', signal }),
      signal,
    )

    if (response === null || response === undefined || typeof response.status !== 'number') {
      throw new Error(`fetch transport returned an invalid response for ${currentUrl}`)
    }

    if (response.status >= 300 && response.status < 400) {
      const location = getResponseHeader(response, 'location')
      if (location === undefined || location.length === 0) {
        throw new Error(`redirect response missing Location for ${currentUrl}`)
      }
      let nextUrl
      try {
        nextUrl = new URL(location, currentUrl).toString()
      } catch {
        throw new Error(`invalid redirect Location for ${currentUrl}: ${location}`)
      }
      await cancelResponseBody(response)
      currentUrl = nextUrl
      continue
    }

    if (response.ok === false) {
      throw new Error(`HTTP ${response.status} for ${currentUrl}`)
    }

    const finalUrl = response.url || currentUrl
    if (matchesHost(finalUrl, downloadHosts) === false) {
      throw new Error(`final response URL host is not allowed: ${finalUrl}`)
    }
    return response
  }
}

export async function fetchOneDocument({
  document,
  cacheDir,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  log = console.log,
  downloadHosts = ALLOWED_DOWNLOAD_HOSTS,
}) {
  assertValidDocument(document, { downloadHosts })
  if (
    typeof cacheDir !== 'string' ||
    cacheDir.length === 0 ||
    path.isAbsolute(cacheDir) === false
  ) {
    throw new Error(`cacheDir must be an absolute path: ${cacheDir}`)
  }

  const targetPath = path.join(cacheDir, document.fileName)
  if (path.dirname(targetPath) !== cacheDir) {
    throw new Error(`fileName escapes cache directory: ${document.fileName}`)
  }

  const existing = await existingFileState(targetPath)
  if (existing && existing.bytes === document.bytes && existing.sha256 === document.sha256) {
    log(`specs:fetch skip (already valid): ${targetPath}`)
    return {
      id: document.id,
      status: 'skip',
      sourceUrl: document.downloadUrl,
      targetPath,
      bytes: existing.bytes,
      sha256: existing.sha256,
    }
  }
  if (existing) {
    log(
      `specs:fetch cache file exists but is invalid (bytes=${existing.bytes}, sha256=${existing.sha256.slice(0, 12)}); replacing from official source`,
    )
  }

  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort(new Error(`timed out after ${timeoutMs}ms for ${document.id}`))
  }, timeoutMs)

  let tempPath = null
  try {
    const response = await fetchWithRedirects(document.downloadUrl, {
      fetchImpl,
      signal: controller.signal,
      downloadHosts,
    })
    const streamed = await streamResponseToTempFile(
      response,
      targetPath,
      document,
      controller.signal,
    )
    tempPath = streamed.tempPath
    await fs.rename(tempPath, targetPath)
    tempPath = null

    log(`specs:fetch OK: ${document.downloadUrl} -> ${targetPath}`)
    log(`specs:fetch verified: ${streamed.bytes} bytes, sha256=${streamed.sha256}`)
    return {
      id: document.id,
      status: 'downloaded',
      sourceUrl: document.downloadUrl,
      targetPath,
      bytes: streamed.bytes,
      sha256: streamed.sha256,
    }
  } catch (error) {
    if (tempPath !== null) {
      await fs.rm(tempPath, { force: true }).catch(() => {})
    }
    if (timedOut || controller.signal.aborted) {
      throw new Error(
        `timed out after ${timeoutMs}ms for ${document.id}: ${error?.message ?? error}`,
      )
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

export async function fetchSpecifications({
  repoRoot,
  manifest,
  all = false,
  ids = [],
  cacheDir = DEFAULT_CACHE_DIR,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  log = console.log,
  downloadHosts = ALLOWED_DOWNLOAD_HOSTS,
} = {}) {
  assertValidManifest(manifest, { downloadHosts })

  if (all === false && ids.length === 0) {
    throw new Error('fetch requires --all or --id <id>')
  }

  const selected = selectDocuments(manifest, { all, ids })
  const { realRoot, absoluteCacheDir } = await resolveVerifiedCacheDir(repoRoot, cacheDir)
  await ensureCacheIsIgnored(repoRoot, cacheDir)
  await fs.mkdir(absoluteCacheDir, { recursive: true })

  const realCacheDir = await realpathOrThrow(absoluteCacheDir, 'cache directory')
  const realCacheRelative = path.relative(realRoot, realCacheDir)
  if (
    realCacheRelative === '' ||
    realCacheRelative.startsWith('..') ||
    path.isAbsolute(realCacheRelative)
  ) {
    throw new Error(`cache directory resolves outside repository root: ${realCacheDir}`)
  }

  const results = []
  for (const document of selected) {
    results.push(
      await fetchOneDocument({
        document,
        cacheDir: realCacheDir,
        fetchImpl,
        timeoutMs,
        log,
        downloadHosts,
      }),
    )
  }
  return results
}

export async function verifyCache({
  repoRoot,
  manifest,
  cacheDir = DEFAULT_CACHE_DIR,
  log = console.log,
  error = console.error,
} = {}) {
  assertValidManifest(manifest)

  const { absoluteCacheDir } = await resolveVerifiedCacheDir(repoRoot, cacheDir)
  const results = []
  let failed = false

  for (const document of manifest.documents) {
    const targetPath = path.join(absoluteCacheDir, document.fileName)
    if (path.dirname(targetPath) !== absoluteCacheDir) {
      throw new Error(`fileName escapes cache directory: ${document.fileName}`)
    }
    const state = await existingFileState(targetPath)
    if (state === null) {
      failed = true
      error(`specs:verify-cache MISSING: ${targetPath}`)
      results.push({ id: document.id, ok: false, targetPath, error: 'missing' })
      continue
    }
    if (state.bytes !== document.bytes) {
      failed = true
      error(
        `specs:verify-cache BYTE MISMATCH: ${targetPath} (expected ${document.bytes}, received ${state.bytes})`,
      )
      results.push({ id: document.id, ok: false, targetPath, error: 'byte-count-mismatch' })
      continue
    }
    if (state.sha256 !== document.sha256) {
      failed = true
      error(
        `specs:verify-cache HASH MISMATCH: ${targetPath} (expected ${document.sha256}, received ${state.sha256})`,
      )
      results.push({ id: document.id, ok: false, targetPath, error: 'sha256-mismatch' })
      continue
    }
    log(`specs:verify-cache OK: ${targetPath}`)
    results.push({ id: document.id, ok: true, targetPath })
  }

  if (failed) {
    error('specs:verify-cache FAILED')
  } else {
    log('specs:verify-cache OK')
  }
  return { ok: failed === false, results }
}

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help') || args.includes('-h') || args.length === 0) {
    process.stdout.write(HELP)
    process.exitCode = args.length === 0 ? 2 : 0
    return
  }

  const [command, ...commandArgs] = args
  const repoRoot = repoRootFromScript(import.meta.url)

  if (command === 'check') {
    if (commandArgs.length > 0) {
      process.stderr.write(`unknown option(s): ${commandArgs.join(' ')}\n`)
      process.exitCode = 2
      return
    }
    const result = checkSpecifications({ repoRoot })
    process.exitCode = result.ok ? 0 : 1
    return
  }

  if (command === 'list') {
    if (commandArgs.length > 0) {
      process.stderr.write(`unknown option(s): ${commandArgs.join(' ')}\n`)
      process.exitCode = 2
      return
    }
    try {
      const manifest = await loadManifest(repoRoot)
      listSpecifications(manifest)
    } catch (caught) {
      process.stderr.write(`specs:list failed: ${caught.message ?? caught}\n`)
      process.exitCode = 1
    }
    return
  }

  if (command === 'fetch') {
    try {
      const { all, ids } = parseFetchArgs(commandArgs)
      const manifest = await loadManifest(repoRoot)
      await fetchSpecifications({ repoRoot, manifest, all, ids })
    } catch (caught) {
      process.stderr.write(`specs:fetch failed: ${caught.message ?? caught}\n`)
      process.exitCode = 1
    }
    return
  }

  if (command === 'verify-cache') {
    if (commandArgs.length > 0) {
      process.stderr.write(`unknown option(s): ${commandArgs.join(' ')}\n`)
      process.exitCode = 2
      return
    }
    try {
      const manifest = await loadManifest(repoRoot)
      const result = await verifyCache({ repoRoot, manifest })
      process.exitCode = result.ok ? 0 : 1
    } catch (caught) {
      process.stderr.write(`specs:verify-cache failed: ${caught.message ?? caught}\n`)
      process.exitCode = 1
    }
    return
  }

  process.stderr.write(`unknown command: ${command}\n\n${HELP}`)
  process.exitCode = 2
}

const isDirectRun =
  typeof process.argv[1] === 'string' &&
  process.argv[1].length > 0 &&
  realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])

if (isDirectRun) {
  main()
}
