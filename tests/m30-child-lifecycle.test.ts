// M30 WP-B / M31 WP-B: controlled child / process-tree lifecycle
// (test-first).
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
//   1. the promise settles only after the child emits 'close' (spawn
//      failures that never created a process are the documented exception:
//      they reject from the 'error' event, M31)
//   2. timeout records TimeoutError, requests stop, waits for close,
//      escalates to SIGKILL if needed, cleans the controlled process
//      group/descendants, and only then rejects
//   3. child.kill() returning false never crashes
//   4. stdin EPIPE/error is captured into a controlled rejection
//   5. an active-child registry is maintained and empty on EVERY settle path
//   6. descendants must not keep writing to the release path after settle
//
// M31 WP-B strengthening (probe P3: the old "<2048 bytes written after
// reject" assertion PASSED while a slow grandchild was still alive):
//   - strict quiescence: after settle, wait a short stable window, snapshot
//     sentinel size AND sha256, wait >=1.5s, require both unchanged
//   - POSIX tests record the grandchild PID and require kill(pid, 0) -> ESRCH
//   - a scenario where BOTH the direct child and the grandchild ignore
//     SIGTERM: SIGKILL escalation must remove the whole tree
//   - both the main timeout timer and the escalation timer must be cleared
//     when the promise settles (no leftover timers)
//   - spawn failure contract: an ENOENT/never-created child rejects from the
//     'error' event with a clean registry; a successfully spawned child still
//     settles only on 'close'

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Python one-liner-ish code that appends SENTINEL lines to a file forever. */
function fileWriterCode(sentinelFile: string, ignoreTerm = false): string {
  const lines = ['import time']
  if (ignoreTerm) {
    lines.push('import signal', 'signal.signal(signal.SIGTERM, signal.SIG_IGN)')
  }
  lines.push(
    `f = open(${JSON.stringify(sentinelFile)}, 'a')`,
    'while True:',
    "  f.write('SENTINEL\\n')",
    '  f.flush()',
    '  time.sleep(0.05)',
  )
  return lines.join('\n')
}

/**
 * Wrapper that spawns a file-writing grandchild and then sleeps. When
 * `ignoreTerm` is set BOTH the wrapper and the grandchild ignore SIGTERM.
 * Grandchild (and optionally wrapper) PIDs are recorded for ESRCH checks.
 */
function grandchildWrapper(
  tmp: string,
  sentinelFile: string,
  ignoreTerm = false,
  pidfile?: string,
  wrapperPidfile?: string,
): string {
  const lines = ['import subprocess, sys, time, os']
  if (ignoreTerm) {
    lines.push('import signal', 'signal.signal(signal.SIGTERM, signal.SIG_IGN)')
  }
  lines.push(
    `p = subprocess.Popen(['python3', '-u', '-c', ${JSON.stringify(fileWriterCode(sentinelFile, ignoreTerm))}])`,
  )
  if (pidfile) lines.push(`with open(${JSON.stringify(pidfile)}, 'w') as f: f.write(str(p.pid))`)
  if (wrapperPidfile) {
    lines.push(`with open(${JSON.stringify(wrapperPidfile)}, 'w') as f: f.write(str(os.getpid()))`)
  }
  lines.push('time.sleep(30)')
  return writeWrapper(tmp, lines.join('\n'))
}

function writeWrapper(tmp: string, body: string): string {
  const p = path.join(tmp, 'wrapper.py')
  fs.writeFileSync(p, body)
  fs.chmodSync(p, 0o755)
  return p
}

/** Strict quiescence snapshot: byte size + sha256 of the sentinel file. */
function sentinelSnapshot(p: string): { size: number; hash: string } {
  if (!fs.existsSync(p)) return { size: 0, hash: '' }
  const buf = fs.readFileSync(p)
  return { size: buf.length, hash: createHash('sha256').update(buf).digest('hex') }
}

/** Assert strict quiescence: stable window, then >=1.5s with zero change. */
async function expectQuiescent(sentinelFile: string, stableMs = 500, waitMs = 1500): Promise<void> {
  await sleep(stableMs)
  const snap1 = sentinelSnapshot(sentinelFile)
  await sleep(waitMs)
  const snap2 = sentinelSnapshot(sentinelFile)
  expect(snap2.size, 'sentinel size changed after settle -- process tree still writing').toBe(
    snap1.size,
  )
  expect(snap2.hash, 'sentinel content changed after settle -- process tree still writing').toBe(
    snap1.hash,
  )
  // The writer must have produced output before being stopped (not vacuous).
  expect(snap1.size).toBeGreaterThan(0)
}

function expectDead(pid: number, label: string): void {
  expect(pid, `${label} PID missing`).toBeGreaterThan(0)
  expect(() => process.kill(pid, 0), `${label} (pid ${pid}) still alive after settle`).toThrow(
    /ESRCH/,
  )
}

describe('M30 WP-B controlled child/process-tree lifecycle', () => {
  it('B1: execFileAsync and the active-child registry are exported', async () => {
    const mod = await import(MODULE_PATH)
    expect(typeof mod.execFileAsync).toBe('function')
    expect(mod.activeChildren).toBeDefined()
    expect(typeof (mod.activeChildren as Set<unknown>).size).toBe('number')
  })

  it('B2: timeout rejects only after the child closes AND the tree is strictly quiescent (grandchild ESRCH)', async () => {
    const mod = await import(MODULE_PATH)
    const tmp = makeTempDir()
    const sentinelFile = path.join(tmp, 'sentinel.log')
    const pidfile = path.join(tmp, 'grandchild.pid')
    const wrapper = grandchildWrapper(tmp, sentinelFile, false, pidfile)
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
    expect(rejectAt, `expected a timeout rejection, got: ${message}`).not.toBeNull()
    expect(message).toMatch(/timed out|timeout/i)
    // The registry must be empty again after settlement.
    expect((mod.activeChildren as Set<unknown>).size).toBe(0)
    // M31: strict quiescence -- a slow residual writer must NOT pass.
    await expectQuiescent(sentinelFile)
    // The grandchild PID must be gone.
    expectDead(Number(fs.readFileSync(pidfile, 'utf8').trim()), 'grandchild')
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

  it('B5: escalation -- a grandchild that ignores SIGTERM is still removed; strict quiescence + ESRCH', async () => {
    const mod = await import(MODULE_PATH)
    const tmp = makeTempDir()
    const sentinelFile = path.join(tmp, 'sentinel5.log')
    const pidfile = path.join(tmp, 'grandchild5.pid')
    const wrapper = grandchildWrapper(tmp, sentinelFile, true, pidfile)
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
    expect(rejectAt).not.toBeNull()
    expect(message).toMatch(/timed out|timeout/i)
    expect((mod.activeChildren as Set<unknown>).size).toBe(0)
    await expectQuiescent(sentinelFile)
    expectDead(Number(fs.readFileSync(pidfile, 'utf8').trim()), 'grandchild')
  }, 30_000)

  it('B6: BOTH the direct child and the grandchild ignore SIGTERM -- SIGKILL escalation removes the whole tree', async () => {
    const mod = await import(MODULE_PATH)
    const tmp = makeTempDir()
    const sentinelFile = path.join(tmp, 'sentinel6.log')
    const gpidfile = path.join(tmp, 'gpid6.txt')
    const wpidfile = path.join(tmp, 'wpid6.txt')
    const wrapper = grandchildWrapper(tmp, sentinelFile, true, gpidfile, wpidfile)
    let message = ''
    try {
      await mod.execFileAsync('python3', [wrapper], {
        stdio: ['pipe', 'inherit', 'inherit'],
        timeout: 800,
      })
    } catch (e) {
      message = (e as Error).message
    }
    expect(message).toMatch(/timed out|timeout/i)
    expect((mod.activeChildren as Set<unknown>).size).toBe(0)
    await expectQuiescent(sentinelFile)
    // The wrapper ignored SIGTERM, so only the SIGKILL escalation could have
    // killed it; the grandchild ignored SIGTERM too and must also be gone.
    expectDead(Number(fs.readFileSync(wpidfile, 'utf8').trim()), 'direct child (wrapper)')
    expectDead(Number(fs.readFileSync(gpidfile, 'utf8').trim()), 'grandchild')
  }, 30_000)

  it('B7: both the main timeout timer and the escalation timer are cleared on settle (no leftover timers)', async () => {
    const origSetTimeout = globalThis.setTimeout
    const origClearTimeout = globalThis.clearTimeout
    let created = 0
    let cleared = 0
    const live = new Set<unknown>()
    // Timer accounting patch: note the jsdom/DOM type of setTimeout returns
    // number, but the runtime (Node) returns a Timeout object -- the set is
    // untyped on purpose.
    const patchedSetTimeout = (fn: TimerHandler, ms?: number, ...args: unknown[]) => {
      created++
      const t = origSetTimeout(fn, ms, ...args)
      live.add(t)
      return t
    }
    const patchedClearTimeout = (t?: ReturnType<typeof setTimeout>) => {
      if (t !== undefined && live.has(t)) {
        cleared++
        live.delete(t)
      }
      return origClearTimeout(t)
    }
    globalThis.setTimeout = patchedSetTimeout as typeof globalThis.setTimeout
    globalThis.clearTimeout = patchedClearTimeout as typeof globalThis.clearTimeout
    try {
      const mod = await import(MODULE_PATH)
      const tmp = makeTempDir()
      const wrapper = writeWrapper(
        tmp,
        ['import time', 'time.sleep(2)', 'print("done")'].join('\n'),
      )
      try {
        await mod.execFileAsync('python3', [wrapper], {
          stdio: ['pipe', 'inherit', 'inherit'],
          timeout: 300,
        })
      } catch {
        // timeout expected
      }
      // Give any late clear a beat WITHOUT creating a counted setTimeout
      // (the patch would count our own sleep timer and break the equality).
      await new Promise((r) => setImmediate(() => setImmediate(r)))
      expect(created, 'expected at least the main timer + escalation timer').toBeGreaterThanOrEqual(
        2,
      )
      expect(cleared).toBe(created)
    } finally {
      globalThis.setTimeout = origSetTimeout
      globalThis.clearTimeout = origClearTimeout
    }
  }, 20_000)

  it('B8: spawn failure (ENOENT) rejects from the error event with a clean registry', async () => {
    const mod = await import(MODULE_PATH)
    let settled: 'resolve' | 'reject' | null = null
    let msg = ''
    try {
      await mod.execFileAsync('/nonexistent/m31-no-such-binary-xyz', [])
      settled = 'resolve'
    } catch (e) {
      settled = 'reject'
      msg = (e as Error).message
    }
    expect(settled).toBe('reject')
    expect(msg).toMatch(/failed to start/)
    expect((mod.activeChildren as Set<unknown>).size).toBe(0)
  })

  it('B9: activeChildren is empty on EVERY settle path (success, nonzero exit, timeout, kill-false, spawn error)', async () => {
    const mod = await import(MODULE_PATH)
    const tmp = makeTempDir()
    // success
    const ok = writeWrapper(tmp, 'print("ok")\n')
    await mod.execFileAsync('python3', [ok], { stdio: ['pipe', 'inherit', 'inherit'] })
    expect((mod.activeChildren as Set<unknown>).size).toBe(0)
    // nonzero exit
    const bad = writeWrapper(tmp, 'import sys\nsys.exit(3)\n')
    await expect(
      mod.execFileAsync('python3', [bad], { stdio: ['pipe', 'inherit', 'inherit'] }),
    ).rejects.toThrow()
    expect((mod.activeChildren as Set<unknown>).size).toBe(0)
    // kill-false timeout (child exits by itself later)
    const sleeper = writeWrapper(tmp, 'import time\ntime.sleep(1.5)\n')
    await expect(
      mod.execFileAsync(
        'python3',
        [sleeper],
        { stdio: ['pipe', 'inherit', 'inherit'], timeout: 200 },
        { kill: () => false },
      ),
    ).rejects.toThrow(/timed out|timeout/i)
    expect((mod.activeChildren as Set<unknown>).size).toBe(0)
    // spawn error (never-created child)
    await expect(mod.execFileAsync('/nonexistent/m31-xyz', [])).rejects.toThrow()
    expect((mod.activeChildren as Set<unknown>).size).toBe(0)
  }, 20_000)
})
