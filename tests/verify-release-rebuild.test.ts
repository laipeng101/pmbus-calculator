// Release provenance gate: the rebuilt zip (fresh deterministic build from
// the tagged source) must be BYTE-IDENTICAL to the downloaded release zip.
// These tests exercise the real CLI (scripts/verify-release-rebuild.mjs) via
// spawnSync — the same spawn-the-real-script style as
// tests/check-repo-hygiene.test.ts — against temp-file fixtures:
//   identical bytes → exit 0 with a data-only JSON report on stdout;
//   same size, flipped byte → exit 5 naming the first differing offset;
//   size mismatch → exit 4; missing/symlink input → exit 3; argv
//   contract violations → exit 2.

import { spawnSync } from 'node:child_process'
import type { SpawnSyncReturns } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { afterAll, describe, expect, it } from 'vitest'

const scriptPath = path.resolve(process.cwd(), 'scripts/verify-release-rebuild.mjs')

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-release-rebuild-'))
const tempDirs: string[] = []

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(tempRoot, 'case-'))
  tempDirs.push(dir)
  return dir
}

/** 1.5 MiB of pseudo-random-but-deterministic bytes: crosses the script's
 * 1 MiB chunk boundary so the streaming loop is exercised end to end. */
function deterministicBytes(size: number, seedTick: number): Buffer {
  const bytes = Buffer.allocUnsafe(size)
  let state = 0x9e3779b9 ^ seedTick
  for (let i = 0; i < size; i++) {
    state = (state * 1664525 + 1013904223) >>> 0
    bytes[i] = state & 0xff
  }
  return bytes
}

function runCli(args: string[]): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    encoding: 'utf8',
  }) as SpawnSyncReturns<string>
}

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true })
})

describe('verify-release-rebuild byte gate', () => {
  it('accepts byte-identical files with a single data-only JSON report on stdout', () => {
    const dir = makeTempDir()
    const bytes = deterministicBytes(1.5 * 1024 * 1024, 1)
    const expected = path.join(dir, 'release.zip')
    const actual = path.join(dir, 'rebuilt.zip')
    fs.writeFileSync(expected, bytes)
    fs.writeFileSync(actual, bytes)

    const result = runCli(['--expected', expected, '--actual', actual])
    expect(result.status).toBe(0)

    // stdout carries exactly ONE JSON object (data, not shell program text).
    const report = JSON.parse(result.stdout) as {
      expected: { path: string; size: number; sha256: string }
      actual: { path: string; size: number; sha256: string }
      equal: boolean
    }
    expect(report.equal).toBe(true)
    expect(report.expected.size).toBe(bytes.length)
    expect(report.actual.size).toBe(bytes.length)
    expect(report.actual.sha256).toBe(report.expected.sha256)
    expect(report.expected.path).toBe(path.resolve(expected))
    expect(result.stderr).toContain('ok:')
    expect(result.stderr).toContain('byte-identical')
  })

  it('rejects same-size files with one flipped byte and names the first differing offset', () => {
    const dir = makeTempDir()
    const bytes = deterministicBytes(1.5 * 1024 * 1024, 2)
    const flipped = Buffer.from(bytes)
    const flipOffset = 1_200_000
    flipped[flipOffset] = bytes[flipOffset] ^ 0xff
    const expected = path.join(dir, 'release.zip')
    const actual = path.join(dir, 'rebuilt.zip')
    fs.writeFileSync(expected, bytes)
    fs.writeFileSync(actual, flipped)

    const result = runCli(['--expected', expected, '--actual', actual])
    expect(result.status).toBe(5)
    expect(result.stderr).toContain(`byte offset ${flipOffset}`)
    expect(result.stdout).toBe('')
  })

  it('rejects different sizes with the size-mismatch exit code', () => {
    const dir = makeTempDir()
    const expected = path.join(dir, 'release.zip')
    const actual = path.join(dir, 'rebuilt.zip')
    fs.writeFileSync(expected, deterministicBytes(4096, 3))
    fs.writeFileSync(actual, deterministicBytes(4095, 3))

    const result = runCli(['--expected', expected, '--actual', actual])
    expect(result.status).toBe(4)
    expect(result.stderr).toContain('size mismatch')
    expect(result.stderr).toContain('4096')
    expect(result.stderr).toContain('4095')
  })

  it('rejects a missing file with the presence exit code', () => {
    const dir = makeTempDir()
    const expected = path.join(dir, 'release.zip')
    fs.writeFileSync(expected, deterministicBytes(1024, 4))

    const result = runCli(['--expected', expected, '--actual', path.join(dir, 'absent.zip')])
    expect(result.status).toBe(3)
    expect(result.stderr).toContain('missing')
  })

  it('rejects a symlinked path instead of following it', () => {
    const dir = makeTempDir()
    const bytes = deterministicBytes(1024, 5)
    const expected = path.join(dir, 'release.zip')
    const real = path.join(dir, 'real.bin')
    const link = path.join(dir, 'link.bin')
    fs.writeFileSync(expected, bytes)
    fs.writeFileSync(real, bytes)
    fs.symlinkSync(real, link)

    const result = runCli(['--expected', expected, '--actual', link])
    expect(result.status).toBe(3)
    expect(result.stderr).toContain('not a regular file')
  })

  it('enforces the argv contract: unknown flag, positional token and missing values exit 2', () => {
    const dir = makeTempDir()
    const file = path.join(dir, 'a.bin')
    fs.writeFileSync(file, 'x')

    expect(runCli(['--bogus', 'x']).status).toBe(2)
    expect(runCli([file, file]).status).toBe(2)
    expect(runCli(['--expected', file]).status).toBe(2)
    expect(runCli(['--expected', '--actual', file]).status).toBe(2)
    expect(runCli([]).status).toBe(2)
  })

  it('prints a single usage line and exits 0 on --help', () => {
    const result = runCli(['--help'])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('usage: verify-release-rebuild.mjs')
  })
})
