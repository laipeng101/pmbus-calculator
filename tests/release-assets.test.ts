import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { extractReleaseZip, generateAssets } from '../scripts/prepare-release-assets.mjs'

let root: string
let dist: string
let output: string
const html = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'"><link rel="stylesheet" href="./assets/app.css"><script src="./assets/app.js"></script>`

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'pmbus-release-'))
  dist = path.join(root, 'dist')
  output = path.join(root, 'release-output')
  fs.mkdirSync(path.join(dist, 'assets'), { recursive: true })
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '1.2.3' }))
  fs.writeFileSync(path.join(dist, 'index.html'), html)
  fs.writeFileSync(path.join(dist, 'assets', 'app.css'), 'body {}')
  fs.writeFileSync(path.join(dist, 'assets', 'app.js'), 'console.log("ok")')
})

afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

it('writes a reproducible ZIP and checksum that extract to the original files', () => {
  const { zipName, sumsName, zipSize } = generateAssets(dist, output)
  const zip = path.join(output, zipName)
  const contents = fs.readFileSync(zip)
  const checksum = createHash('sha256').update(contents).digest('hex')
  expect(zipName).toBe('pmbus-calculator-v1.2.3-web.zip')
  expect(contents.byteLength).toBe(zipSize)
  expect(fs.readFileSync(path.join(output, sumsName), 'utf8')).toBe(`${checksum}  ${zipName}\n`)
  expect(fs.readdirSync(output).sort()).toEqual([sumsName, zipName].sort())

  const site = path.join(root, '_site')
  extractReleaseZip(zip, site)
  expect(fs.readFileSync(path.join(site, 'index.html'), 'utf8')).toBe(html)
  for (const name of ['app.css', 'app.js']) {
    expect(fs.readFileSync(path.join(site, 'assets', name))).toEqual(
      fs.readFileSync(path.join(dist, 'assets', name)),
    )
  }
  expect(() => extractReleaseZip(zip, site)).toThrow()
  expect(fs.readFileSync(path.join(site, 'index.html'), 'utf8')).toBe(html)

  expect(() => generateAssets(dist, output)).toThrow(/--force/)
  generateAssets(dist, output, true)
  expect(fs.readFileSync(zip)).toEqual(contents)
})

it('requires explicit replacement and preserves unrelated files even with --force', () => {
  fs.mkdirSync(output)
  const notes = path.join(output, 'notes.txt')
  fs.writeFileSync(notes, 'keep me')
  expect(() => generateAssets(dist, output)).toThrow(/--force/)
  expect(() => generateAssets(dist, output, true)).toThrow(/Refusing to replace/)
  expect(fs.readFileSync(notes, 'utf8')).toBe('keep me')
})

it('preserves a file added while replacing the previous assets', () => {
  const { zipName } = generateAssets(dist, output)
  const notes = path.join(output, 'notes.txt')
  const rename = fs.renameSync
  const move = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
    if (from === output) fs.writeFileSync(notes, 'keep me')
    rename(from, to)
  })
  try {
    expect(() => generateAssets(dist, output, true)).toThrow(/Refusing to replace/)
  } finally {
    move.mockRestore()
  }
  expect(fs.readFileSync(notes, 'utf8')).toBe('keep me')
  expect(fs.existsSync(path.join(output, zipName))).toBe(true)
})

it('preserves the old assets after a failed build and permits replacing them for a new version', () => {
  const first = generateAssets(dist, output)
  const zip = path.join(output, first.zipName)
  const sums = path.join(output, first.sumsName)
  const oldZip = fs.readFileSync(zip)
  const oldSums = fs.readFileSync(sums)
  const index = path.join(dist, 'index.html')
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '1.2.4' }))
  fs.writeFileSync(index, html.replace('Content-Security-Policy', 'broken'))
  expect(() => generateAssets(dist, output, true)).toThrow(/Content-Security-Policy/)
  expect(fs.readFileSync(zip)).toEqual(oldZip)
  expect(fs.readFileSync(sums)).toEqual(oldSums)

  fs.writeFileSync(index, html)
  const second = generateAssets(dist, output, true)
  expect(second.zipName).toBe('pmbus-calculator-v1.2.4-web.zip')
  expect(fs.readdirSync(output).sort()).toEqual([second.sumsName, second.zipName].sort())
})

it.skipIf(process.platform === 'win32')('rejects a symlink to a directory inside dist', () => {
  fs.symlinkSync(path.join(dist, 'assets'), path.join(dist, 'linked-assets'), 'dir')
  expect(() => generateAssets(dist, output)).toThrow(/not a regular build directory/)
  expect(fs.existsSync(output)).toBe(false)
})
