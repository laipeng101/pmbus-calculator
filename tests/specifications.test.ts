import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { ReadableStream } from 'node:stream/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ALLOWED_DOWNLOAD_HOSTS,
  DEFAULT_CACHE_DIR,
  checkSpecifications,
  fetchOneDocument,
  fetchSpecifications,
  fetchWithRedirects,
  isSafeFileName,
  isValidBytes,
  isValidSha256,
  listSpecifications,
  MAX_REDIRECTS,
  parseFetchArgs,
  sha256Buffer,
  validateManifest,
  verifyCache,
} from '../scripts/specifications.mjs'

const ALLOWED_DOWNLOAD_URL =
  'https://pmbusprod.wpenginepowered.com/wp-content/uploads/2022/01/doc.pdf'
const ALLOWED_DOWNLOAD_URL_2 =
  'https://pmbusprod.wpenginepowered.com/wp-content/uploads/2022/01/doc-2.pdf'

const roots: string[] = []

async function makeTempRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pmbus-specs-test-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

function bufferFromString(value: string) {
  return Buffer.from(value, 'utf8')
}

function sha256(value: string) {
  return sha256Buffer(bufferFromString(value))
}

async function writeActualManifest(repoRoot: string) {
  const actual = await fs.readFile(path.resolve('document/specifications.json'), 'utf8')
  const manifestPath = path.join(repoRoot, 'document/specifications.json')
  await fs.mkdir(path.dirname(manifestPath), { recursive: true })
  await fs.writeFile(manifestPath, actual)
  return JSON.parse(actual)
}

async function initRepo(repoRoot: string) {
  await execFileSync('git', ['init', '-q'], { cwd: repoRoot })
  await execFileSync('git', ['config', 'user.name', 'Specs Test'], { cwd: repoRoot })
  await execFileSync('git', ['config', 'user.email', 'specs@example.com'], { cwd: repoRoot })
}

function cloneActualManifest() {
  const raw = readFileSync(path.resolve('document/specifications.json'), 'utf8')
  return JSON.parse(raw)
}

function makeDocument(overrides: Record<string, unknown> = {}) {
  const content = bufferFromString('fake-pdf-bytes')
  return {
    id: 'doc-1',
    title: 'Test Specification',
    revision: '1.0',
    publishedDate: '2020-01-01',
    officialLandingPage: 'https://pmbus.org/specification-archives/',
    downloadUrl: ALLOWED_DOWNLOAD_URL,
    fileName: 'doc-1.pdf',
    bytes: content.byteLength,
    sha256: sha256('fake-pdf-bytes'),
    rightsHolder: 'SMIF',
    rightsNotice: 'Third-party specification.',
    redistributionStatus: 'not-established-by-project',
    ...overrides,
  }
}

function makeTestManifest(overrides: Record<string, unknown> = {}) {
  const documents = ['doc-1', 'doc-2', 'doc-3', 'doc-4'].map((id) =>
    makeDocument({ id, fileName: `${id}.pdf`, downloadUrl: `${ALLOWED_DOWNLOAD_URL}?id=${id}` }),
  )
  return { schemaVersion: 1, documents, ...overrides }
}

function makeStream(chunks: Array<string | Uint8Array>) {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk)
      }
      controller.close()
    },
  })
}

function makeNeverStream() {
  return new ReadableStream({ start() {} })
}

function mockResponse(overrides: Record<string, unknown> = {}) {
  const status = typeof overrides.status === 'number' ? overrides.status : 200
  return {
    status,
    ok: status >= 200 && status < 300,
    url: ALLOWED_DOWNLOAD_URL,
    headers: {},
    body: null,
    ...overrides,
  }
}

function redirectResponse(location: string, url = ALLOWED_DOWNLOAD_URL) {
  return mockResponse({ status: 302, ok: false, url, headers: { location }, body: makeStream([]) })
}

describe('specifications manifest validation', () => {
  it('current manifest has 4 valid records', async () => {
    const manifest = await fs.readFile(path.resolve('document/specifications.json'), 'utf8')
    const parsed = JSON.parse(manifest)
    const validation = validateManifest(parsed)

    expect(validation.ok).toBe(true)
    expect(validation.errors).toEqual([])
    expect(parsed.documents).toHaveLength(4)
    expect(parsed.documents.map((document: { id: string }) => document.id)).toEqual([
      'pmbus-1.3-part-i',
      'pmbus-1.3-part-ii',
      'pmbus-1.3-part-iii',
      'smbus-3.0',
    ])
  })

  it('rejects duplicate id', () => {
    const manifest = cloneActualManifest()
    manifest.documents[1].id = manifest.documents[0].id

    const validation = validateManifest(manifest)

    expect(validation.ok).toBe(false)
    expect(validation.errors.some((message) => message.includes('duplicate id'))).toBe(true)
  })

  it('rejects duplicate fileName', () => {
    const manifest = cloneActualManifest()
    manifest.documents[1].fileName = manifest.documents[0].fileName

    const validation = validateManifest(manifest)

    expect(validation.ok).toBe(false)
    expect(validation.errors.some((message) => message.includes('duplicate fileName'))).toBe(true)
  })

  it('rejects non-HTTPS URLs', () => {
    const manifest = cloneActualManifest()
    manifest.documents[0].downloadUrl = 'http://pmbusprod.wpenginepowered.com/file.pdf'

    const validation = validateManifest(manifest)

    expect(validation.ok).toBe(false)
    expect(
      validation.errors.some((message) => message.includes('downloadUrl must be an HTTPS URL')),
    ).toBe(true)
  })

  it('rejects non-allowlisted hosts', () => {
    const manifest = cloneActualManifest()
    manifest.documents[0].officialLandingPage = 'https://example.com/specs/'

    const validation = validateManifest(manifest)

    expect(validation.ok).toBe(false)
    expect(
      validation.errors.some((message) =>
        message.includes('officialLandingPage must be an HTTPS URL on an allowed landing host'),
      ),
    ).toBe(true)
  })

  it('rejects path-escape fileName', () => {
    const manifest = cloneActualManifest()
    manifest.documents[0].fileName = '../evil.pdf'

    const validation = validateManifest(manifest)

    expect(validation.ok).toBe(false)
    expect(
      validation.errors.some((message) =>
        message.includes('path escape or is not a plain file name'),
      ),
    ).toBe(true)
    expect(isSafeFileName('../evil.pdf')).toBe(false)
    expect(isSafeFileName('evil.pdf')).toBe(true)
  })

  it('rejects invalid SHA-256', () => {
    const manifest = cloneActualManifest()
    manifest.documents[0].sha256 = 'not-a-sha256'

    const validation = validateManifest(manifest)

    expect(validation.ok).toBe(false)
    expect(validation.errors.some((message) => message.includes('64 lowercase hexadecimal'))).toBe(
      true,
    )
    expect(isValidSha256('a'.repeat(64))).toBe(true)
    expect(isValidSha256('A'.repeat(64))).toBe(false)
  })

  it('rejects invalid bytes', () => {
    const manifest = cloneActualManifest()
    manifest.documents[0].bytes = 0

    const validation = validateManifest(manifest)

    expect(validation.ok).toBe(false)
    expect(
      validation.errors.some((message) => message.includes('bytes must be a positive integer')),
    ).toBe(true)
    expect(isValidBytes(1)).toBe(true)
    expect(isValidBytes(0)).toBe(false)
    expect(isValidBytes(1.5)).toBe(false)
  })
})

describe('specifications validation at public entry points', () => {
  it('list rejects an invalid manifest', () => {
    const manifest = makeTestManifest({ documents: [makeDocument()] })

    expect(() => listSpecifications(manifest, { log: () => {} })).toThrow(
      /invalid specification manifest/,
    )
  })

  it('fetch rejects an invalid manifest before any network call', async () => {
    const repoRoot = await makeTempRoot()
    const fetchImpl = vi.fn(async () => mockResponse({ body: makeStream(['x']) }))
    const manifest = makeTestManifest({ documents: [makeDocument()] })

    await expect(
      fetchSpecifications({ repoRoot, manifest, ids: ['doc-1'], fetchImpl }),
    ).rejects.toThrow(/invalid specification manifest/)

    expect(fetchImpl).not.toHaveBeenCalled()
    await expect(fs.stat(path.join(repoRoot, DEFAULT_CACHE_DIR))).rejects.toThrow()
  })

  it('verify-cache rejects an invalid manifest before reading cache paths', async () => {
    const repoRoot = await makeTempRoot()
    const manifest = makeTestManifest({ documents: [makeDocument()] })

    await expect(
      verifyCache({ repoRoot, manifest, log: () => {}, error: () => {} }),
    ).rejects.toThrow(/invalid specification manifest/)
  })

  it('rejects path-escape fileName before any write', async () => {
    const cacheDir = await makeTempRoot()
    const fetchImpl = vi.fn(async () => mockResponse({ body: makeStream(['x']) }))
    const document = makeDocument({ fileName: '../../escaped.pdf' })

    await expect(
      fetchOneDocument({ document, cacheDir, fetchImpl, downloadHosts: ALLOWED_DOWNLOAD_HOSTS }),
    ).rejects.toThrow(/invalid specification document/)

    expect(fetchImpl).not.toHaveBeenCalled()
    await expect(fs.readdir(cacheDir)).resolves.toEqual([])
  })

  it('rejects a cache symlink pointing outside the repository', async () => {
    const repoRoot = await makeTempRoot()
    const outside = await makeTempRoot()
    await fs.writeFile(path.join(repoRoot, '.gitignore'), '.cache/\n')
    await initRepo(repoRoot)
    await fs.symlink(outside, path.join(repoRoot, '.cache'), 'dir')
    const manifest = await writeActualManifest(repoRoot)
    const fetchImpl = vi.fn(async () => mockResponse({ body: makeStream(['x']) }))

    await expect(
      fetchSpecifications({ repoRoot, manifest, ids: ['pmbus-1.3-part-i'], fetchImpl }),
    ).rejects.toThrow(/symlink|refusing symlink/)

    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects an existing symlink target file', async () => {
    const cacheDir = await makeTempRoot()
    const outside = await makeTempRoot()
    const outsideFile = path.join(outside, 'doc-1.pdf')
    await fs.writeFile(outsideFile, 'outside')
    await fs.symlink(outsideFile, path.join(cacheDir, 'doc-1.pdf'))
    const document = makeDocument()
    const fetchImpl = vi.fn(async () => mockResponse({ body: makeStream(['x']) }))

    await expect(
      fetchOneDocument({ document, cacheDir, fetchImpl, downloadHosts: ALLOWED_DOWNLOAD_HOSTS }),
    ).rejects.toThrow(/symbolic link/)

    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects an existing non-regular target file', async () => {
    const cacheDir = await makeTempRoot()
    await fs.mkdir(path.join(cacheDir, 'doc-1.pdf'))
    const document = makeDocument()
    const fetchImpl = vi.fn(async () => mockResponse({ body: makeStream(['x']) }))

    await expect(
      fetchOneDocument({ document, cacheDir, fetchImpl, downloadHosts: ALLOWED_DOWNLOAD_HOSTS }),
    ).rejects.toThrow(/not a regular file/)

    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('specifications fetch timeout', () => {
  it('times out while waiting for response headers', async () => {
    const cacheDir = await makeTempRoot()
    const document = makeDocument()
    const fetchImpl = vi.fn(() => new Promise(() => {}))

    await expect(
      fetchOneDocument({ document, cacheDir, fetchImpl, timeoutMs: 40 }),
    ).rejects.toThrow(/timed out/)

    await expect(fs.readdir(cacheDir)).resolves.toEqual([])
  })

  it('times out while waiting for a stalled response body', async () => {
    const cacheDir = await makeTempRoot()
    const document = makeDocument()
    const fetchImpl = vi.fn(async () => mockResponse({ body: makeNeverStream() }))

    await expect(
      fetchOneDocument({ document, cacheDir, fetchImpl, timeoutMs: 40 }),
    ).rejects.toThrow(/timed out/)

    await expect(fs.readdir(cacheDir)).resolves.toEqual([])
  })

  it('applies one absolute deadline across redirect and body reads', async () => {
    const cacheDir = await makeTempRoot()
    const document = makeDocument()
    const firstUrl = ALLOWED_DOWNLOAD_URL
    const secondUrl = ALLOWED_DOWNLOAD_URL_2
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === firstUrl) return redirectResponse(secondUrl, firstUrl)
      return mockResponse({ url: secondUrl, body: makeNeverStream() })
    })

    await expect(
      fetchOneDocument({ document, cacheDir, fetchImpl, timeoutMs: 60 }),
    ).rejects.toThrow(/timed out/)

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    await expect(fs.readdir(cacheDir)).resolves.toEqual([])
  })
})

describe('specifications streaming download', () => {
  it('streams a correct body into place with bytes and SHA-256 verified', async () => {
    const cacheDir = await makeTempRoot()
    const content = bufferFromString('correct-pdf-content')
    const document = makeDocument({
      bytes: content.byteLength,
      sha256: sha256('correct-pdf-content'),
    })
    const fetchImpl = vi.fn(async () =>
      mockResponse({ body: makeStream(['correct-', 'pdf-', 'content']) }),
    )

    const result = await fetchOneDocument({
      document,
      cacheDir,
      fetchImpl,
      downloadHosts: ALLOWED_DOWNLOAD_HOSTS,
    })

    expect(result.status).toBe('downloaded')
    expect(result.bytes).toBe(content.byteLength)
    expect(result.sha256).toBe(sha256('correct-pdf-content'))
    await expect(fs.readFile(path.join(cacheDir, 'doc-1.pdf'), 'utf8')).resolves.toBe(
      'correct-pdf-content',
    )
    const entries = await fs.readdir(cacheDir)
    expect(entries).toEqual(['doc-1.pdf'])
  })

  it('skips an existing correct cache file idempotently', async () => {
    const cacheDir = await makeTempRoot()
    const content = bufferFromString('cached-pdf-content')
    const document = makeDocument({
      bytes: content.byteLength,
      sha256: sha256('cached-pdf-content'),
    })
    await fs.writeFile(path.join(cacheDir, 'doc-1.pdf'), content)
    const fetchImpl = vi.fn(async () => mockResponse({ body: makeStream(['x']) }))

    const result = await fetchOneDocument({ document, cacheDir, fetchImpl })

    expect(result.status).toBe('skip')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('fails immediately when the body exceeds the manifest bytes and leaves no files', async () => {
    const cacheDir = await makeTempRoot()
    const content = bufferFromString('too-long-body')
    const document = makeDocument({ bytes: content.byteLength - 2 })
    const fetchImpl = vi.fn(async () => mockResponse({ body: makeStream([content]) }))

    await expect(
      fetchOneDocument({ document, cacheDir, fetchImpl, downloadHosts: ALLOWED_DOWNLOAD_HOSTS }),
    ).rejects.toThrow(/byte count mismatch/)

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    await expect(fs.readdir(cacheDir)).resolves.toEqual([])
  })

  it('fails when the body is shorter than the manifest bytes and leaves no files', async () => {
    const cacheDir = await makeTempRoot()
    const content = bufferFromString('short')
    const document = makeDocument({ bytes: content.byteLength + 5 })
    const fetchImpl = vi.fn(async () => mockResponse({ body: makeStream([content]) }))

    await expect(
      fetchOneDocument({ document, cacheDir, fetchImpl, downloadHosts: ALLOWED_DOWNLOAD_HOSTS }),
    ).rejects.toThrow(/byte count mismatch/)

    await expect(fs.readdir(cacheDir)).resolves.toEqual([])
  })

  it('fails when the SHA-256 mismatches and leaves no files', async () => {
    const cacheDir = await makeTempRoot()
    const content = bufferFromString('tampered-content!')
    const document = makeDocument({ bytes: content.byteLength, sha256: '0'.repeat(64) })
    const fetchImpl = vi.fn(async () => mockResponse({ body: makeStream([content]) }))

    await expect(
      fetchOneDocument({ document, cacheDir, fetchImpl, downloadHosts: ALLOWED_DOWNLOAD_HOSTS }),
    ).rejects.toThrow(/sha256 mismatch/)

    await expect(fs.readdir(cacheDir)).resolves.toEqual([])
  })
})

describe('specifications redirect handling', () => {
  it('follows an allowed HTTPS redirect and downloads the final body', async () => {
    const cacheDir = await makeTempRoot()
    const content = bufferFromString('redirect-pdf-content')
    const document = makeDocument({
      downloadUrl: ALLOWED_DOWNLOAD_URL,
      bytes: content.byteLength,
      sha256: sha256('redirect-pdf-content'),
    })
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === ALLOWED_DOWNLOAD_URL)
        return redirectResponse(ALLOWED_DOWNLOAD_URL_2, ALLOWED_DOWNLOAD_URL)
      return mockResponse({ url: ALLOWED_DOWNLOAD_URL_2, body: makeStream([content]) })
    })

    const result = await fetchOneDocument({ document, cacheDir, fetchImpl })

    expect(result.status).toBe('downloaded')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      ALLOWED_DOWNLOAD_URL,
      expect.objectContaining({ redirect: 'manual' }),
    )
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      ALLOWED_DOWNLOAD_URL_2,
      expect.objectContaining({ redirect: 'manual' }),
    )
  })

  it('rejects a redirect to a non-allowlisted host before making the next request', async () => {
    const cacheDir = await makeTempRoot()
    const document = makeDocument()
    const fetchImpl = vi.fn(async () =>
      redirectResponse('https://evil.example.com/file.pdf', ALLOWED_DOWNLOAD_URL),
    )

    await expect(
      fetchOneDocument({ document, cacheDir, fetchImpl, downloadHosts: ALLOWED_DOWNLOAD_HOSTS }),
    ).rejects.toThrow(/redirect target host is not allowed/)

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    await expect(fs.readdir(cacheDir)).resolves.toEqual([])
  })

  it('rejects a redirect loop', async () => {
    const cacheDir = await makeTempRoot()
    const document = makeDocument()
    const fetchImpl = vi.fn(async () =>
      redirectResponse(ALLOWED_DOWNLOAD_URL, ALLOWED_DOWNLOAD_URL),
    )

    await expect(
      fetchOneDocument({ document, cacheDir, fetchImpl, downloadHosts: ALLOWED_DOWNLOAD_HOSTS }),
    ).rejects.toThrow(/redirect loop/)

    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('rejects redirect chains longer than MAX_REDIRECTS', async () => {
    const cacheDir = await makeTempRoot()
    const document = makeDocument()
    const urls = Array.from(
      { length: MAX_REDIRECTS + 2 },
      (_, index) => `${ALLOWED_DOWNLOAD_URL}?step=${index}`,
    )
    const fetchImpl = vi.fn(async (url: string) => {
      const index = urls.indexOf(url)
      return redirectResponse(urls[index + 1], url)
    })

    await expect(
      fetchOneDocument({ document, cacheDir, fetchImpl, downloadHosts: ALLOWED_DOWNLOAD_HOSTS }),
    ).rejects.toThrow(/too many redirects/)

    expect(fetchImpl).toHaveBeenCalledTimes(MAX_REDIRECTS + 1)
  })

  it('fetchWithRedirects rejects a missing Location', async () => {
    const fetchImpl = vi.fn(async () =>
      mockResponse({
        status: 302,
        ok: false,
        url: ALLOWED_DOWNLOAD_URL,
        headers: {},
        body: makeStream([]),
      }),
    )

    await expect(
      fetchWithRedirects(ALLOWED_DOWNLOAD_URL, {
        fetchImpl,
        downloadHosts: ALLOWED_DOWNLOAD_HOSTS,
      }),
    ).rejects.toThrow(/missing Location/)
  })
})

describe('specifications cache verification', () => {
  it('verify-cache detects a tampered cached file', async () => {
    const repoRoot = await makeTempRoot()
    const manifest = makeTestManifest()
    const content = bufferFromString('good-pdf-content')
    const first = manifest.documents[0]
    first.bytes = content.byteLength
    first.sha256 = sha256('good-pdf-content')
    const cacheDir = path.join(repoRoot, DEFAULT_CACHE_DIR)
    await fs.mkdir(cacheDir, { recursive: true })
    await fs.writeFile(path.join(cacheDir, first.fileName), 'bad-pdf-content!')
    const errors: string[] = []

    const result = await verifyCache({
      repoRoot,
      manifest,
      log: () => {},
      error: (message: string) => errors.push(message),
    })

    expect(result.ok).toBe(false)
    expect(result.results[0]).toMatchObject({ id: first.id, ok: false })
    expect(errors.some((message) => message.includes('HASH MISMATCH'))).toBe(true)
  })

  it('verify-cache reports missing files and fails without downloading', async () => {
    const repoRoot = await makeTempRoot()
    const manifest = makeTestManifest()
    const errors: string[] = []

    const result = await verifyCache({
      repoRoot,
      manifest,
      log: () => {},
      error: (message: string) => errors.push(message),
    })

    expect(result.ok).toBe(false)
    expect(result.results[0]).toMatchObject({ id: 'doc-1', ok: false, error: 'missing' })
    expect(errors.some((message) => message.includes('MISSING'))).toBe(true)
  })

  it('does not download without explicit --all or --id', async () => {
    const repoRoot = await makeTempRoot()
    const manifest = await writeActualManifest(repoRoot)
    await fs.writeFile(path.join(repoRoot, '.gitignore'), '.cache/\n')
    await initRepo(repoRoot)
    const fetchImpl = vi.fn(async () => mockResponse({ body: makeStream(['x']) }))

    await expect(fetchSpecifications({ repoRoot, manifest, fetchImpl })).rejects.toThrow(
      /--all or --id/,
    )
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects unknown fetch options and unknown ids', async () => {
    const repoRoot = await makeTempRoot()
    const manifest = await writeActualManifest(repoRoot)
    await fs.writeFile(path.join(repoRoot, '.gitignore'), '.cache/\n')
    await initRepo(repoRoot)

    expect(() => parseFetchArgs(['--unknown'])).toThrow(/unknown fetch option/)
    await expect(
      fetchSpecifications({
        repoRoot,
        manifest,
        ids: ['unknown-id'],
        fetchImpl: async () => mockResponse({ body: makeStream(['x']) }),
      }),
    ).rejects.toThrow(/unknown specification id/)
  })
})

describe('specifications CLI', () => {
  it('check succeeds in a clean temporary repository', async () => {
    const repoRoot = await makeTempRoot()
    await writeActualManifest(repoRoot)
    await initRepo(repoRoot)
    const scriptPath = await installScriptCopy(repoRoot)

    const run = spawnSync(process.execPath, [scriptPath, 'check'], {
      cwd: repoRoot,
      encoding: 'utf8',
    })

    expect(run.status).toBe(0)
    expect(run.stdout).toContain('specs:check OK')
    expect(run.stdout).toContain('manifest entries: 4')
  })

  it('list succeeds and prints manifest entries without downloading', async () => {
    const repoRoot = await makeTempRoot()
    await writeActualManifest(repoRoot)
    await initRepo(repoRoot)
    const scriptPath = await installScriptCopy(repoRoot)

    const run = spawnSync(process.execPath, [scriptPath, 'list'], {
      cwd: repoRoot,
      encoding: 'utf8',
    })

    expect(run.status).toBe(0)
    expect(run.stdout).toContain('pmbus-1.3-part-i')
    expect(run.stdout).toContain('smbus-3.0')
    expect(run.stdout).toContain('https://pmbus.org/specification-archives/')
  })

  it('list exits non-zero for an invalid manifest', async () => {
    const repoRoot = await makeTempRoot()
    await initRepo(repoRoot)
    const manifestPath = path.join(repoRoot, 'document/specifications.json')
    await fs.mkdir(path.dirname(manifestPath), { recursive: true })
    await fs.writeFile(manifestPath, JSON.stringify({ schemaVersion: 1, documents: [] }))
    const scriptPath = await installScriptCopy(repoRoot)

    const run = spawnSync(process.execPath, [scriptPath, 'list'], {
      cwd: repoRoot,
      encoding: 'utf8',
    })

    expect(run.status).not.toBe(0)
    expect(run.stderr).toContain('invalid specification manifest')
  })

  it('fetch exits non-zero for an invalid manifest without network access', async () => {
    const repoRoot = await makeTempRoot()
    await initRepo(repoRoot)
    const manifestPath = path.join(repoRoot, 'document/specifications.json')
    await fs.mkdir(path.dirname(manifestPath), { recursive: true })
    await fs.writeFile(manifestPath, JSON.stringify({ schemaVersion: 1, documents: [] }))
    const scriptPath = await installScriptCopy(repoRoot)

    const run = spawnSync(process.execPath, [scriptPath, 'fetch', '--id', 'doc-1'], {
      cwd: repoRoot,
      encoding: 'utf8',
    })

    expect(run.status).not.toBe(0)
    expect(run.stderr).toContain('invalid specification manifest')
  })

  it('verify-cache exits non-zero for an invalid manifest', async () => {
    const repoRoot = await makeTempRoot()
    await initRepo(repoRoot)
    const manifestPath = path.join(repoRoot, 'document/specifications.json')
    await fs.mkdir(path.dirname(manifestPath), { recursive: true })
    await fs.writeFile(manifestPath, JSON.stringify({ schemaVersion: 1, documents: [] }))
    const scriptPath = await installScriptCopy(repoRoot)

    const run = spawnSync(process.execPath, [scriptPath, 'verify-cache'], {
      cwd: repoRoot,
      encoding: 'utf8',
    })

    expect(run.status).not.toBe(0)
    expect(run.stderr).toContain('invalid specification manifest')
  })

  it('fetch with unknown option exits non-zero without network access', () => {
    const run = spawnSync(
      process.execPath,
      [path.resolve('scripts/specifications.mjs'), 'fetch', '--unknown'],
      { encoding: 'utf8' },
    )

    expect(run.status).not.toBe(0)
    expect(run.stderr).toContain('unknown fetch option')
  })

  it('fetch with unknown id exits non-zero without network access', () => {
    const run = spawnSync(
      process.execPath,
      [path.resolve('scripts/specifications.mjs'), 'fetch', '--id', 'unknown-id'],
      { encoding: 'utf8' },
    )

    expect(run.status).not.toBe(0)
    expect(run.stderr).toContain('unknown specification id')
  })

  it('check and list do not perform real external requests', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const repoRoot = await makeTempRoot()
    const manifest = await writeActualManifest(repoRoot)
    await initRepo(repoRoot)

    const checkResult = checkSpecifications({ repoRoot, log: () => {}, error: () => {} })
    listSpecifications(manifest, { log: () => {} })

    expect(checkResult.ok).toBe(true)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

async function installScriptCopy(repoRoot: string) {
  const source = path.resolve('scripts/specifications.mjs')
  const targetDir = path.join(repoRoot, 'scripts')
  await fs.mkdir(targetDir, { recursive: true })
  await fs.copyFile(source, path.join(targetDir, 'specifications.mjs'))
  return path.join(targetDir, 'specifications.mjs')
}
