// M30 WP-B: controlled child / process-tree lifecycle (test-first).
//
// The M29 execFileAsync is a private module function; the timeout branch
// kills the direct child with SIGKILL and REJECTS IMMEDIATELY -- before the
// child emits 'close' and before any descendants are terminated (probe C:
// a grandchild kept writing SENTINEL after the promise settled). The stdin
// pipe has NO error handling, so an EPIPE from a helper that exits before
// reading the manifest crashes the whole process with an unhandled stream
// error (probe D).
//
// The M30 contract:
//   1. the promise settles only after the child emits 'close'
//   2. timeout records TimeoutError, requests stop, waits for close,
//      escalates to SIGKILL if needed, cleans the controlled process
//      group/descendants, and only then rejects
//   3. child.kill() returning false never crashes
//   4. stdin EPIPE/error is captured into a controlled rejection
//   5. an active-child registry is maintained and empty before lock release
//   6. descendants must not keep writing to the release path after settle
//
// execFileAsync and the registry must be exported by
// scripts/prepare-release-assets.mjs for these tests (they are not in M29).

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MODULE_PATH = path.join(REPO_ROOT, 'scripts', 'prepare-release-assets.mjs')

const tempDirs: string[] = []
function makeTempDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'm30-child-'))
  tempDirs.push(d)
  return d
}
afterEach(() => {
  for (const d of tempDirs.splice(0)) {
    try {
      fs.rmSync(d, { recursive: true, force: true })
    } catch {
      // best effort
    }
  }
})

/** Python one-liner-ish code that appends SENTINEL lines to a file forever. */
function fileWriterCode(sentinelFile: string): string {
  return [
    'import time',
    `f = open(${JSON.stringify(sentinelFile)}, 'a')`,
    'while True:',
    "  f.write('SENTINEL\\n')",
    '  f.flush()',
    '  time.sleep(0.05)',
  ].join('\n')
}

/** Wrapper that spawns a file-writing grandchild and then sleeps. */
function grandchildWrapper(tmp: string, sentinelFile: string, ignoreTerm = false): string {
  const lines = ['import subprocess, sys, time']
  if (ignoreTerm) lines.push('import signal', 'signal.signal(signal.SIGTERM, signal.SIG_IGN)')
  lines.push(
    `subprocess.Popen(['python3', '-u', '-c', ${JSON.stringify(fileWriterCode(sentinelFile))}])`,
    'time.sleep(30)',
  )
  return writeWrapper(tmp, lines.join('\n'))
}

function writeWrapper(tmp: string, body: string): string {
  const p = path.join(tmp, 'wrapper.py')
  fs.writeFileSync(p, body)
  fs.chmodSync(p, 0o755)
  return p
}

describe('M30 WP-B controlled child/process-tree lifecycle', () => {
  it('B1: execFileAsync and the active-child registry are exported', async () => {
    const mod = await import(MODULE_PATH)
    expect(typeof mod.execFileAsync).toBe('function')
    expect(mod.activeChildren).toBeDefined()
    expect(typeof (mod.activeChildren as Set<unknown>).size).toBe('number')
  })

  it('B2: timeout rejects only after the child closes AND the process tree is zeroed (grandchild stops writing)', async () => {
    const mod = await import(MODULE_PATH)
    const tmp = makeTempDir()
    const sentinelFile = path.join(tmp, 'sentinel.log')
    const wrapper = grandchildWrapper(tmp, sentinelFile)
    let rejectAt: number | null = null
    let message = ''
    try {
      await mod.execFileAsync('python3', [wrapper], {
        stdio: ['pipe', 'inherit', 'inherit'],
        timeout: 800,
      })
    } catch (e) {
      rejectAt = Date.now()
      message = (e as Error).message
    }
    const sizeAtReject = fs.existsSync(sentinelFile) ? fs.statSync(sentinelFile).size : 0
    // Wait for the tree cleanup to settle.
    await new Promise((r) => setTimeout(r, 1200))
    const sizeAfter = fs.existsSync(sentinelFile) ? fs.statSync(sentinelFile).size : 0

    expect(rejectAt, `expected a timeout rejection, got: ${message}`).not.toBeNull()
    expect(message).toMatch(/timed out|timeout/i)
    // The registry must be empty again after settlement.
    expect((mod.activeChildren as Set<unknown>).size).toBe(0)
    // The grandchild must stop writing shortly after the rejection -- the
    // whole controlled process group was cleaned, not just the direct child.
    expect(sizeAfter - sizeAtReject).toBeLessThan(2048)
  }, 30_000)

  it('B3: stdin EPIPE (helper exits before reading the manifest) becomes a controlled rejection, not an unhandled stream error', () => {
    const tmp = makeTempDir()
    const exitEarly = path.join(tmp, 'exit-early.py')
    fs.writeFileSync(
      exitEarly,
      ['import sys, time', 'sys.stdin.close()', 'time.sleep(1)', 'sys.exit(3)'].join('\n'),
    )
    fs.chmodSync(exitEarly, 0o755)
    const childScript = path.join(tmp, 'child.mjs')
    const bigInput = 'x'.repeat(512 * 1024)
    fs.writeFileSync(
      childScript,
      'const mod = await import(' +
        JSON.stringify('file://' + MODULE_PATH) +
        ');\n' +
        'try {\n' +
        '  await mod.execFileAsync(' +
        JSON.stringify('python3') +
        ', [' +
        JSON.stringify(exitEarly) +
        '], { input: ' +
        JSON.stringify(bigInput) +
        ', stdio: ["pipe", "inherit", "inherit"], timeout: 10_000 });\n' +
        '  console.log("RESOLVED");\n' +
        '} catch (e) {\n' +
        '  console.log("REJECTED: " + (e && e.message ? e.message : String(e)));\n' +
        '}\n' +
        'process.exit(0);\n',
    )
    const res = spawnSync(process.execPath, [childScript], {
      encoding: 'utf8',
      timeout: 30_000,
    })
    const stdout = String(res.stdout)
    expect(res.status).toBe(0)
    expect(stdout).toMatch(/REJECTED:/)
    // An unhandled 'error' crash would print the node:events thrower.
    expect(String(res.stderr)).not.toMatch(/Unhandled 'error' event|write EPIPE/)
  }, 40_000)

  it('B4: child.kill() returning false never crashes and the promise still settles', async () => {
    const mod = await import(MODULE_PATH)
    const tmp = makeTempDir()
    const wrapper = writeWrapper(tmp, ['import time', 'time.sleep(1)', 'print("done")'].join('\n'))
    let settled: 'resolve' | 'reject' | null = null
    let msg = ''
    try {
      await mod.execFileAsync(
        'python3',
        [wrapper],
        { stdio: ['pipe', 'inherit', 'inherit'], timeout: 500 },
        { kill: () => false },
      )
      settled = 'resolve'
    } catch (e) {
      settled = 'reject'
      msg = (e as Error).message
    }
    expect(settled).not.toBeNull()
    // Timeout already happened: the promise must reject with the TimeoutError
    // even though kill() returned false (child later exited by itself).
    expect(settled).toBe('reject')
    expect(msg).toMatch(/timed out|timeout/i)
    expect((mod.activeChildren as Set<unknown>).size).toBe(0)
  }, 20_000)

  it('B5: escalation -- a child that ignores SIGTERM is SIGKILLed and the tree is still cleaned', async () => {
    const mod = await import(MODULE_PATH)
    const tmp = makeTempDir()
    const sentinelFile = path.join(tmp, 'sentinel5.log')
    const wrapper = grandchildWrapper(tmp, sentinelFile, true)
    let rejectAt: number | null = null
    let message = ''
    try {
      await mod.execFileAsync('python3', [wrapper], {
        stdio: ['pipe', 'inherit', 'inherit'],
        timeout: 800,
      })
    } catch (e) {
      rejectAt = Date.now()
      message = (e as Error).message
    }
    const sizeAtReject = fs.existsSync(sentinelFile) ? fs.statSync(sentinelFile).size : 0
    await new Promise((r) => setTimeout(r, 1500))
    const sizeAfter = fs.existsSync(sentinelFile) ? fs.statSync(sentinelFile).size : 0
    expect(rejectAt).not.toBeNull()
    expect(message).toMatch(/timed out|timeout/i)
    expect((mod.activeChildren as Set<unknown>).size).toBe(0)
    expect(sizeAfter - sizeAtReject).toBeLessThan(2048)
  }, 30_000)
})
