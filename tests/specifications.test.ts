import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ALLOWED_DOWNLOAD_HOSTS,
  DEFAULT_CACHE_DIR,
  checkSpecifications,
  fetchOneDocument,
  fetchSpecifications,
  isSafeFileName,
  isValidBytes,
  isValidSha256,
  listSpecifications,
  parseFetchArgs,
  sha256Buffer,
  validateManifest,
  verifyCache,
} from '../scripts/specifications.mjs'

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

function toArrayBuffer(buffer: Buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
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

function makeDocument(overrides: Record<string, unknown> = {}) {
  const content = bufferFromString('fake-pdf-bytes')
  return {
    id: 'doc-1',
    title: 'Test Specification',
    revision: '1.0',
    publishedDate: '2020-01-01',
    officialLandingPage: 'https://pmbus.org/specification-archives/',
    downloadUrl: 'https://pmbusprod.wpenginepowered.com/wp-content/uploads/2022/01/doc.pdf',
    fileName: 'doc.pdf',
    bytes: content.byteLength,
    sha256: sha256('fake-pdf-bytes'),
    rightsHolder: 'SMIF',
    rightsNotice: 'Third-party specification.',
    redistributionStatus: 'not-established-by-project',
    ...overrides,
  }
}

function mockResponse(
  body: Buffer,
  url = 'https://pmbusprod.wpenginepowered.com/wp-content/uploads/2022/01/doc.pdf',
) {
  return {
    ok: true,
    status: 200,
    url,
    arrayBuffer: async () => toArrayBuffer(body),
  }
}

describe('specifications fetch', () => {
  it('downloads, verifies, and atomically writes a correct response', async () => {
    const cacheDir = await makeTempRoot()
    const content = bufferFromString('correct-pdf-content')
    const document = makeDocument({
      bytes: content.byteLength,
      sha256: sha256('correct-pdf-content'),
    })
    const fetchImpl = vi.fn(async () => mockResponse(content))

    const result = await fetchOneDocument({
      document,
      cacheDir,
      fetchImpl,
      downloadHosts: ALLOWED_DOWNLOAD_HOSTS,
    })

    expect(result.status).toBe('downloaded')
    expect(result.bytes).toBe(content.byteLength)
    expect(result.sha256).toBe(sha256('correct-pdf-content'))
    await expect(fs.readFile(path.join(cacheDir, 'doc.pdf'), 'utf8')).resolves.toBe(
      'correct-pdf-content',
    )
    const entries = await fs.readdir(cacheDir)
    expect(entries).toEqual(['doc.pdf'])
  })

  it('hash mismatch fails and leaves no final file', async () => {
    const cacheDir = await makeTempRoot()
    const content = bufferFromString('tampered-pdf-content')
    const document = makeDocument({
      bytes: content.byteLength,
      sha256: '0'.repeat(64),
    })

    await expect(
      fetchOneDocument({ document, cacheDir, fetchImpl: async () => mockResponse(content) }),
    ).rejects.toThrow(/sha256 mismatch/)

    await expect(fs.stat(path.join(cacheDir, 'doc.pdf'))).rejects.toThrow()
    const entries = await fs.readdir(cacheDir).catch(() => [])
    expect(entries).toEqual([])
  })

  it('byte count mismatch fails and leaves no final file', async () => {
    const cacheDir = await makeTempRoot()
    const content = bufferFromString('wrong-size-pdf-content')
    const document = makeDocument({
      bytes: content.byteLength + 1,
      sha256: sha256('wrong-size-pdf-content'),
    })

    await expect(
      fetchOneDocument({ document, cacheDir, fetchImpl: async () => mockResponse(content) }),
    ).rejects.toThrow(/byte count mismatch/)

    await expect(fs.stat(path.join(cacheDir, 'doc.pdf'))).rejects.toThrow()
  })

  it('skips an existing correct cache file idempotently', async () => {
    const cacheDir = await makeTempRoot()
    const content = bufferFromString('cached-pdf-content')
    const document = makeDocument({
      bytes: content.byteLength,
      sha256: sha256('cached-pdf-content'),
    })
    await fs.writeFile(path.join(cacheDir, 'doc.pdf'), content)
    const fetchImpl = vi.fn(async () => mockResponse(content))

    const result = await fetchOneDocument({ document, cacheDir, fetchImpl })

    expect(result.status).toBe('skip')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('verify-cache detects a tampered cached file', async () => {
    const repoRoot = await makeTempRoot()
    const content = bufferFromString('good-pdf-content')
    const document = makeDocument({
      bytes: content.byteLength,
      sha256: sha256('good-pdf-content'),
    })
    const cacheDir = path.join(repoRoot, DEFAULT_CACHE_DIR)
    await fs.mkdir(cacheDir, { recursive: true })
    await fs.writeFile(path.join(cacheDir, 'doc.pdf'), 'bad-pdf-content!')
    const errors: string[] = []

    const result = await verifyCache({
      repoRoot,
      manifest: { schemaVersion: 1, documents: [document] },
      log: () => {},
      error: (message: string) => errors.push(message),
    })

    expect(result.ok).toBe(false)
    expect(result.results[0]).toMatchObject({ id: 'doc-1', ok: false })
    expect(errors.some((message) => message.includes('HASH MISMATCH'))).toBe(true)
  })

  it('verify-cache reports missing files and fails without downloading', async () => {
    const repoRoot = await makeTempRoot()
    const document = makeDocument()
    const errors: string[] = []

    const result = await verifyCache({
      repoRoot,
      manifest: { schemaVersion: 1, documents: [document] },
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
    const fetchImpl = vi.fn(async () => mockResponse(bufferFromString('should-not-be-called')))

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
        fetchImpl: async () => mockResponse(bufferFromString('x')),
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
