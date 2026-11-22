import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it, vi } from 'vitest'
import { fetchSpecification, loadSpecifications } from '../scripts/specifications.mjs'

const goodPdf = Buffer.from('%PDF reference')
const doc = {
  id: 'test-spec',
  downloadUrl: 'https://www.smbus.org/specs/test.pdf',
  fileName: 'Bus reference.pdf',
  bytes: goodPdf.length,
  sha256: createHash('sha256').update(goodPdf).digest('hex'),
}
const tempRoots: string[] = []

async function fixture(documents: unknown[] = [doc]) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pmbus-specs-'))
  tempRoots.push(root)
  await fs.mkdir(path.join(root, 'document'))
  await fs.writeFile(path.join(root, 'document/specifications.json'), JSON.stringify({ documents }))
  return root
}

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
  )
})

it('loads the repository manifest and includes the PMBus and SMBus baseline documents', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url))
  const entries = await loadSpecifications(root)
  expect([...entries.keys()]).toEqual(
    expect.arrayContaining(['pmbus-1.3-part-ii', 'pmbus-1.3.1-part-ii', 'smbus-3.0']),
  )
})

it.each([
  [{ fileName: '../test.pdf' }, /文件名无效/],
  [{ downloadUrl: 'http://www.smbus.org/test.pdf' }, /官方 HTTPS/],
  [{ downloadUrl: 'https://www.smbus.org.example.com/test.pdf' }, /官方 HTTPS/],
  [{ sha256: 'bad' }, /SHA-256 无效/],
])('rejects an invalid entry %o', async (change, error) => {
  const root = await fixture([{ ...doc, ...change }])
  await expect(loadSpecifications(root)).rejects.toThrow(error)
})

it('rejects entries that would write to the same cache file', async () => {
  const root = await fixture([doc, { ...doc, id: 'other', fileName: 'bus reference.pdf' }])
  await expect(loadSpecifications(root)).rejects.toThrow(/重复的规范文件名/)
})

it('fetches by ID, repairs a damaged cache, then reuses the verified file without a request', async () => {
  const root = await fixture()
  const cache = path.join(root, '.cache/specifications')
  const target = path.join(cache, doc.fileName)
  await fs.mkdir(cache, { recursive: true })
  await fs.writeFile(target, Buffer.alloc(doc.bytes))
  const download = vi.fn(async () => goodPdf)

  await expect(fetchSpecification(root, doc.id, download)).resolves.toBe(target)
  await expect(fs.readFile(target)).resolves.toEqual(goodPdf)
  await expect(fetchSpecification(root, doc.id, download)).resolves.toBe(target)
  expect(download).toHaveBeenCalledTimes(1)
  await expect(fs.readdir(cache)).resolves.toEqual([doc.fileName])
})

it.each([
  [Buffer.from('too short'), /文件大小与清单不符/],
  [Buffer.alloc(doc.bytes), /SHA-256 与清单不符/],
])('keeps the previous file when downloaded content is invalid', async (contents, error) => {
  const root = await fixture()
  const cache = path.join(root, '.cache/specifications')
  const target = path.join(cache, doc.fileName)
  const previous = 'previous cache'
  await fs.mkdir(cache, { recursive: true })
  await fs.writeFile(target, previous)

  await expect(fetchSpecification(root, doc.id, async () => contents)).rejects.toThrow(error)
  await expect(fs.readFile(target, 'utf8')).resolves.toBe(previous)
  await expect(fs.readdir(cache)).resolves.toEqual([doc.fileName])
})

it('validates the ID before touching the cache or contacting a server', async () => {
  const root = await fixture()
  const download = vi.fn()
  await expect(fetchSpecification(root, '../test-spec', download)).rejects.toThrow(/未找到规范/)
  expect(download).not.toHaveBeenCalled()
  await expect(fs.readdir(root)).resolves.toEqual(['document'])
})

it.skipIf(process.platform === 'win32')(
  'does not write through a symlink in the cache path',
  async () => {
    const root = await fixture()
    const other = await fixture()
    await fs.symlink(other, path.join(root, '.cache'), 'dir')
    const download = vi.fn(async () => goodPdf)

    await expect(fetchSpecification(root, doc.id, download)).rejects.toThrow(/必须是普通目录/)
    expect(download).not.toHaveBeenCalled()
    await expect(fs.readdir(other)).resolves.toEqual(['document'])
  },
)

it.skipIf(process.platform === 'win32')('does not follow a symlinked cache file', async () => {
  const root = await fixture()
  const other = await fixture()
  const cache = path.join(root, '.cache/specifications')
  const outside = path.join(other, doc.fileName)
  const download = vi.fn(async () => goodPdf)
  await fs.mkdir(cache, { recursive: true })
  await fs.writeFile(outside, 'existing outside cache')
  await fs.symlink(outside, path.join(cache, doc.fileName))

  await expect(fetchSpecification(root, doc.id, download)).rejects.toThrow(/必须是普通文件/)
  expect(download).not.toHaveBeenCalled()
  await expect(fs.readFile(outside, 'utf8')).resolves.toBe('existing outside cache')
})
