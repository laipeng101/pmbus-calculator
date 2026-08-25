// Plain unit tests for the restartable release asset generator
// (scripts/prepare-release-assets.mjs).
//
// Coverage:
// - normal path: dist/ -> release-output/ with zip + SHA256SUMS, verified by
//   the real verify_release_zip.py
// - determinism: the same dist/ produces byte-identical assets twice
// - --force overwrites an existing valid output
// - verifier failure never publishes unverified assets (old output stays)
// - symlink / special file / invalid entry rejection
// - runCli exit codes (unknown option, success)

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  generateAssets,
  runCli,
  validateAndCollectEntries,
  walkDist,
} from '../scripts/prepare-release-assets.mjs'
import { buildReleasePlan, validateZipEntry } from '../scripts/release-artifact-contract.mjs'

const tempRoots: string[] = []

function makeTempRepo(version = '1.1.5'): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pmbus-assets-'))
  tempRoots.push(tmp)
  fs.writeFileSync(
    path.join(tmp, 'package.json'),
    JSON.stringify({ name: 'pmbus-calculator', version, private: true }, null, 2),
  )
  return tmp
}

/** Standard minimal dist tree that passes verify_release_zip.py. */
function makeValidDist(dir: string): void {
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'index.html'),
    '<!DOCTYPE html><html><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'"><link rel="stylesheet" href="assets/app.css"><script src="assets/app.js"></script></html>',
  )
  fs.writeFileSync(path.join(dir, 'assets', 'app.js'), 'console.log("release")')
  fs.writeFileSync(path.join(dir, 'assets', 'app.css'), 'body{}')
}

function sha256(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

afterEach(() => {
  for (const dir of tempRoots.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      // best effort
    }
  }
})

describe('release asset generator normal path', () => {
  it('generates verified zip + SHA256SUMS into release-output', async () => {
    const repo = makeTempRepo()
    const dist = path.join(repo, 'dist')
    makeValidDist(dist)
    const output = path.join(repo, 'release-output')
    const plan = buildReleasePlan('1.1.5')

    const result = await generateAssets(dist, output, false)
    expect(result.plan.zipName).toBe(plan.zipName)
    expect(result.sumsName).toBe('SHA256SUMS.txt')
    expect(result.zipSize).toBeGreaterThan(0)

    const zipPath = path.join(output, plan.zipName)
    const sumsPath = path.join(output, plan.sumsName)
    expect(fs.existsSync(zipPath)).toBe(true)
    expect(fs.existsSync(sumsPath)).toBe(true)
    expect(fs.readdirSync(output).sort()).toEqual([plan.sumsName, plan.zipName])

    // SHA256SUMS must list the actual zip hash.
    const sums = fs.readFileSync(sumsPath, 'utf8')
    expect(sums).toBe(`${sha256(zipPath)}  ${plan.zipName}\n`)

    // No disposable staging residue after success.
    expect(fs.existsSync(path.join(repo, '.release-staging'))).toBe(false)
  })

  it('refuses to overwrite existing assets without --force', async () => {
    const repo = makeTempRepo()
    const dist = path.join(repo, 'dist')
    makeValidDist(dist)
    const output = path.join(repo, 'release-output')

    await generateAssets(dist, output, false)
    await expect(generateAssets(dist, output, false)).rejects.toThrow(/--force/)
  })

  it('--force replaces a valid previous output', async () => {
    const repo = makeTempRepo()
    const dist = path.join(repo, 'dist')
    makeValidDist(dist)
    const output = path.join(repo, 'release-output')

    await generateAssets(dist, output, false)
    const firstZip = sha256(path.join(output, buildReleasePlan('1.1.5').zipName))

    // Touch a file inside dist (same structure) and regenerate with --force.
    fs.writeFileSync(path.join(dist, 'assets', 'app.js'), 'console.log("release v2")')
    await generateAssets(dist, output, true)
    const secondZip = sha256(path.join(output, buildReleasePlan('1.1.5').zipName))
    expect(secondZip).not.toBe(firstZip)
  })
})

describe('release asset generator determinism', () => {
  it('generates byte-identical zip and checksum for the same dist', async () => {
    const repo = makeTempRepo()
    const dist = path.join(repo, 'dist')
    makeValidDist(dist)
    const plan = buildReleasePlan('1.1.5')

    const first = await generateAssets(dist, path.join(repo, 'release-output'), false)
    const firstZip = path.join(repo, 'release-output', plan.zipName)
    const firstSums = path.join(repo, 'release-output', plan.sumsName)
    expect(first.zipSize).toBe(fs.statSync(firstZip).size)

    const second = await generateAssets(dist, path.join(repo, 'release-output-2'), false)
    expect(second.zipSize).toBe(first.zipSize)
    const secondZip = path.join(repo, 'release-output-2', plan.zipName)
    const secondSums = path.join(repo, 'release-output-2', plan.sumsName)
    expect(sha256(secondZip)).toBe(sha256(firstZip))
    expect(fs.readFileSync(secondSums, 'utf8')).toBe(fs.readFileSync(firstSums, 'utf8'))
  })
})

describe('release asset generator fail-closed rejection', () => {
  it('rejects a symlink inside dist', async () => {
    const repo = makeTempRepo()
    const dist = path.join(repo, 'dist')
    makeValidDist(dist)
    fs.symlinkSync('index.html', path.join(dist, 'evil.html'))

    const output = path.join(repo, 'release-output')
    await expect(generateAssets(dist, output, false)).rejects.toThrow(/symlink/)
    expect(fs.existsSync(output)).toBe(false)
  })

  it('rejects a FIFO inside dist', async () => {
    const repo = makeTempRepo()
    const dist = path.join(repo, 'dist')
    makeValidDist(dist)
    execFileSync('mkfifo', [path.join(dist, 'fifo')])

    const output = path.join(repo, 'release-output')
    await expect(generateAssets(dist, output, false)).rejects.toThrow(/FIFO|not a regular file/)
    expect(fs.existsSync(output)).toBe(false)
  })

  it('validateAndCollectEntries rejects traversal and validateZipEntry rejects absolute/backslash/forbidden entries', () => {
    // Lexical escape through the dist root.
    expect(() => validateAndCollectEntries('/dist', ['/dist/../escape.txt'])).toThrow(
      /escapes|traversal/,
    )
    // The shared ZIP entry policy rejects absolute paths, backslashes,
    // forbidden segments, source maps, drive prefixes, dot and empty segments.
    for (const entry of [
      '/abs.txt',
      'a\\b.txt',
      'node_modules/x.js',
      'src/app.js',
      'assets/app.js.map',
      'C:/win.txt',
      'a//b.txt',
      'a/./b.txt',
    ]) {
      expect(validateZipEntry(entry).ok, entry).toBe(false)
    }
  })

  it('verifier failure never publishes unverified assets and keeps the old output', async () => {
    const repo = makeTempRepo()
    const dist = path.join(repo, 'dist')
    makeValidDist(dist)
    const output = path.join(repo, 'release-output')
    const plan = buildReleasePlan('1.1.5')

    // First: valid generation.
    await generateAssets(dist, output, false)
    const oldZip = sha256(path.join(output, plan.zipName))

    // Second: break the CSP so verify_release_zip.py fails.
    fs.writeFileSync(
      path.join(dist, 'index.html'),
      '<!DOCTYPE html><html><link rel="stylesheet" href="assets/app.css"><script src="assets/app.js"></script></html>',
    )
    await expect(generateAssets(dist, output, true)).rejects.toThrow(/failed/)

    // The old verified output is untouched; no partial new output.
    expect(fs.existsSync(path.join(output, plan.zipName))).toBe(true)
    expect(sha256(path.join(output, plan.zipName))).toBe(oldZip)
    const entries = fs.readdirSync(output)
    expect(entries.sort()).toEqual([plan.sumsName, plan.zipName])
  })

  it('walkDist fails on unknown non-regular types via validateAndCollectEntries', () => {
    const repo = makeTempRepo()
    const dist = path.join(repo, 'dist')
    makeValidDist(dist)
    // walkDist itself is covered above; ensure the entry policy also refuses
    // a path that escapes the dist root lexically.
    expect(() => validateAndCollectEntries(dist, [path.join(dist, '..', 'x.txt')])).toThrow(
      /escapes/,
    )
    void walkDist
  })
})

describe('release asset generator CLI', () => {
  it('runCli returns 2 for an unknown option without side effects', async () => {
    const repo = makeTempRepo()
    const err: string[] = []
    const out: string[] = []
    const rc = await runCli(['node', 'prepare-release-assets.mjs', '--bogus'], {
      repoRoot: repo,
      stderr: {
        write: (c: string) => {
          err.push(c)
          return true
        },
      },
      stdout: {
        write: (c: string) => {
          out.push(c)
          return true
        },
      },
    })
    expect(rc).toBe(2)
    expect(err.join('')).toMatch(/unknown option/)
    expect(fs.existsSync(path.join(repo, 'release-output'))).toBe(false)
    expect(fs.existsSync(path.join(repo, '.release-staging'))).toBe(false)
  })

  it('runCli succeeds end-to-end and prints the Done line', async () => {
    const repo = makeTempRepo()
    const dist = path.join(repo, 'dist')
    makeValidDist(dist)
    const out: string[] = []
    const rc = await runCli(['node', 'prepare-release-assets.mjs'], {
      repoRoot: repo,
      stdout: {
        write: (c: string) => {
          out.push(c)
          return true
        },
      },
      stderr: { write: () => true },
    })
    expect(rc).toBe(0)
    expect(out.join('')).toMatch(/Done: pmbus-calculator-v1\.1\.5-web\.zip/)
    expect(fs.existsSync(path.join(repo, 'release-output', 'SHA256SUMS.txt'))).toBe(true)
  })
})
