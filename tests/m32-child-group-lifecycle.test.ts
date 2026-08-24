// M32 WP-B: process-group lifecycle — the direct child's 'close' is NOT
// proof that the controlled process group is gone (probe P1: a grandchild
// that ALONE ignores SIGTERM survived the M31 implementation; the promise
// settled and the sentinel kept growing), and a post-spawn ChildProcess
// 'error' is NOT a spawn failure (probe P2: the M31 implementation rejected
// with "failed to start", emptied the registry while the process was alive,
// and leaked the escalation timer).
//
// Test-first (red against M31 main):
//   M1. direct child does NOT ignore SIGTERM, grandchild does NOT ignore
//   M2. direct child IGNORES SIGTERM, grandchild does not
//   M3. direct child does not, grandchild ALONE IGNORES (P1 core)
//   M4. BOTH ignore SIGTERM (SIGKILL escalation removes the whole tree)
//   M5. post-spawn SIGTERM kill-error -> no "failed to start", fail closed
//   M6. post-spawn SIGKILL kill-error/EPERM -> fail closed, lock semantics
//   M7. ENOENT (never-created child) keeps the controlled early rejection
//   M8. registry contract across success/nonzero/timeout/kill-false/spawn
//       failure (post-spawn error registry semantics live in M5/M6)
//   M9. every timeout path: wrapper+grandchild ESRCH, strict quiescence,
//       ALL owned timers cleared
//   M10. bounded group-settle constants exported; runCli refuses to release
//       the lock while the registry is non-empty (fail-closed coordination)
//
// Cleanup contract (WP-B #10): every test force-cleans the process tree it
// created in a finally block (and the file-level afterAll re-checks), never
// a best-effort directory removal standing in for process cleanup.

import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, describe, expect, it } from 'vitest'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MODULE_PATH = path.join(REPO_ROOT, 'scripts', 'prepare-release-assets.mjs')

const tempDirs: string[] = []
function makeTempDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'm32-child-'))
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

/** Every PID this file ever spawned, for the file-level orphan sweep. */
const spawnedPids: number[] = []
function recordPid(pid: number): void {
  if (Number.isInteger(pid) && pid > 0 && !spawnedPids.includes(pid)) spawnedPids.push(pid)
}
function readPid(file: string): number {
  const pid = Number(fs.readFileSync(file, 'utf8').trim())
  recordPid(pid)
  return pid
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Best-effort real process-tree cleanup (never a fake). */
async function forceCleanTree(pids: number[]): Promise<void> {
  for (const pid of pids) {
    if (!Number.isInteger(pid) || pid <= 0) continue
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      // group already gone -- fine
    }
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // process already gone -- fine
    }
  }
  // give the kernel a beat to reap; then sweep remaining singles
  await sleep(250)
  for (const pid of pids) {
    if (pidAlive(pid)) {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        // raced away -- fine
      }
    }
  }
  await sleep(100)
}

afterAll(async () => {
  // File-level orphan sweep: anything recorded but still alive gets killed.
  const still = spawnedPids.filter(pidAlive)
  if (still.length > 0) {
    await forceCleanTree(still)
    const left = still.filter(pidAlive)
    if (left.length > 0) {
      throw new Error(`M32 probe left orphan processes: ${left.join(',')}`)
    }
  }
})

/** Python code that appends SENTINEL lines forever; optionally SIG_IGN. */
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
 * Wrapper with INDEPENDENT SIGTERM handling for the direct child and the
 * grandchild (the M31 helper coupled both to one boolean -- probe P3).
 */
function treeWrapper(
  tmp: string,
  sentinelFile: string,
  opts: {
    directIgnore?: boolean
    grandchildIgnore?: boolean
    pidfile?: string
    wrapperPidfile?: string
  } = {},
): string {
  const lines = ['import subprocess, time, os']
  if (opts.directIgnore) {
    lines.push('import signal', 'signal.signal(signal.SIGTERM, signal.SIG_IGN)')
  }
  lines.push(
    `p = subprocess.Popen(['python3', '-u', '-c', ${JSON.stringify(
      fileWriterCode(sentinelFile, opts.grandchildIgnore === true),
    )}])`,
  )
  if (opts.pidfile) {
    lines.push(`with open(${JSON.stringify(opts.pidfile)}, 'w') as f: f.write(str(p.pid))`)
  }
  if (opts.wrapperPidfile) {
    lines.push(
      `with open(${JSON.stringify(opts.wrapperPidfile)}, 'w') as f: f.write(str(os.getpid()))`,
    )
  }
  lines.push('time.sleep(30)')
  const p = path.join(tmp, 'wrapper.py')
  fs.writeFileSync(p, lines.join('\n'))
  fs.chmodSync(p, 0o755)
  return p
}

/** Strict quiescence snapshot: byte size + sha256 of the sentinel. */
function sentinelSnapshot(p: string): { size: number; hash: string } {
  if (!fs.existsSync(p)) return { size: 0, hash: '' }
  const buf = fs.readFileSync(p)
  return { size: buf.length, hash: createHash('sha256').update(buf).digest('hex') }
}

/** Stable window, then >=1.5s with ZERO change; writer must have produced data. */
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
  expect(snap1.size).toBeGreaterThan(0)
}

function expectDead(pid: number, label: string): void {
  expect(pid, `${label} PID missing`).toBeGreaterThan(0)
  expect(() => process.kill(pid, 0), `${label} (pid ${pid}) still alive after settle`).toThrow(
    /ESRCH/,
  )
}

interface TreeCase {
  directIgnore: boolean
  grandchildIgnore: boolean
}

/** Shared timeout-tree scenario: rejects with TimeoutError, tree proven gone. */
async function runTreeCase(c: TreeCase, timeoutMs = 800): Promise<void> {
  const mod = await import(MODULE_PATH)
  const tmp = makeTempDir()
  const sentinelFile = path.join(tmp, 'sentinel.log')
  const gpidfile = path.join(tmp, 'grandchild.pid')
  const wpidfile = path.join(tmp, 'wrapper.pid')
  const wrapper = treeWrapper(tmp, sentinelFile, {
    directIgnore: c.directIgnore,
    grandchildIgnore: c.grandchildIgnore,
    pidfile: gpidfile,
    wrapperPidfile: wpidfile,
  })
  let message = ''
  try {
    await mod.execFileAsync('python3', [wrapper], {
      stdio: ['pipe', 'inherit', 'inherit'],
      timeout: timeoutMs,
      // M33 WP-D: short deterministic escalation for tests.
      timingProfile: { escalationDelayMs: 1500, settleDeadlineMs: 3000 },
    })
  } catch (e) {
    message = e instanceof Error ? e.message : String(e)
  }
  // WP-B #10: assertions run BEFORE the cleanup finally; a failing assertion
  // still force-cleans the tree so a red test never leaves orphans.
  try {
    expect(message).toMatch(/timed out|timeout/i)
    expect((mod.activeChildren as Set<unknown>).size).toBe(0)
    await expectQuiescent(sentinelFile)
    expectDead(readPid(gpidfile), 'grandchild')
    expectDead(readPid(wpidfile), 'direct child (wrapper)')
  } finally {
    await forceCleanTree([readPid(gpidfile), readPid(wpidfile)])
  }
}

describe('M32 WP-B process-group lifecycle (direct close != group gone)', () => {
  it('M1: direct does NOT ignore, grandchild does NOT ignore -- tree proven gone', async () => {
    await runTreeCase({ directIgnore: false, grandchildIgnore: false })
  }, 30_000)

  it('M2: direct IGNORES, grandchild does not -- SIGKILL escalation on the direct child', async () => {
    await runTreeCase({ directIgnore: true, grandchildIgnore: false })
  }, 30_000)

  it('M3: direct does NOT ignore, grandchild ALONE IGNORES -- P1 core; group must be proven gone before settle', async () => {
    await runTreeCase({ directIgnore: false, grandchildIgnore: true })
  }, 30_000)

  it('M4: BOTH ignore SIGTERM -- SIGKILL escalation removes the whole tree', async () => {
    await runTreeCase({ directIgnore: true, grandchildIgnore: true })
  }, 30_000)

  it('M5: post-spawn SIGTERM kill-error -- no "failed to start", fail closed, registry preserved', async () => {
    const mod = await import(MODULE_PATH)
    const tmp = makeTempDir()
    const wpidfile = path.join(tmp, 'wrapper.pid')
    const wrapper = treeWrapper(tmp, path.join(tmp, 'unused.log'), { wrapperPidfile: wpidfile })
    const child = path.join(tmp, 'probe.mjs')
    fs.writeFileSync(
      child,
      [
        `import { activeChildren, execFileAsync } from ${JSON.stringify('file://' + MODULE_PATH)}`,
        'const origSetTimeout = globalThis.setTimeout',
        'const origClearTimeout = globalThis.clearTimeout',
        'let created = 0',
        'let cleared = 0',
        'const live = new Set()',
        'globalThis.setTimeout = (fn, ms, ...args) => { created++; const t = origSetTimeout(fn, ms, ...args); live.add(t); return t }',
        'globalThis.clearTimeout = (t) => { if (t !== undefined && live.has(t)) { cleared++; live.delete(t) } return origClearTimeout(t) }',
        "const eperm = new Error('kill EPERM (injected)')",
        "eperm.code = 'EPERM'",
        'let recordedPid = null',
        'try {',
        `  await execFileAsync(${JSON.stringify('python3')}, [${JSON.stringify(wrapper)}], {`,
        "    stdio: ['pipe', 'inherit', 'inherit'],",
        '    timeout: 400,',
        // M33 WP-D: short deterministic timing profile (production defaults
        // stay safe; tests must not wait the 10s production deadline).
        '    timingProfile: { settleDeadlineMs: 500, escalationDelayMs: 100 },',
        '  }, {',
        '    kill: (child, signal) => {',
        '      if (recordedPid === null) recordedPid = child.pid',
        "      child.emit('error', eperm)",
        '      return false',
        '    },',
        '  })',
        '  console.log("OUTCOME: resolved")',
        '} catch (e) {',
        '  console.log("OUTCOME: rejected")',
        '  console.log("MESSAGE: " + (e && e.message ? e.message : String(e)))',
        '}',
        'let alive = false',
        'try { process.kill(recordedPid, 0); alive = true } catch {}',
        'console.log("PID_ALIVE_AT_REJECT: " + alive)',
        'console.log("REGISTRY_SIZE: " + activeChildren.size)',
        'await new Promise((r) => setImmediate(() => setImmediate(r)))',
        'console.log("TIMERS_CREATED: " + created)',
        'console.log("TIMERS_CLEARED: " + cleared)',
        'if (recordedPid !== null) {',
        "  try { process.kill(-recordedPid, 'SIGKILL') } catch {}",
        "  try { process.kill(recordedPid, 'SIGKILL') } catch {}",
        '  await new Promise((r) => setTimeout(r, 300))',
        '  let dead = true',
        '  try { process.kill(recordedPid, 0); dead = false } catch {}',
        '  console.log("CLEANUP_ESRCH: " + dead)',
        '  for (const c of [...activeChildren]) activeChildren.delete(c)',
        '}',
        'process.exit(0)',
      ].join('\n'),
    )
    const res = spawnSync(process.execPath, [child], { encoding: 'utf8', timeout: 25_000 })
    const stdout = String(res.stdout)
    const wpid = readPid(wpidfile)
    // Even if the child script misbehaves, the test cleans up the real tree.
    await forceCleanTree([wpid])
    expect(res.status).toBe(0)
    expect(stdout).toContain('OUTCOME: rejected')
    expect(stdout).not.toMatch(/failed to start/i)
    expect(stdout).toMatch(/FAILED CLOSED|failed after spawn/i)
    expect(stdout).toContain('PID_ALIVE_AT_REJECT: true')
    expect(stdout).toContain('REGISTRY_SIZE: 1')
    expect(stdout).toContain('CLEANUP_ESRCH: true')
    const created = Number(stdout.match(/TIMERS_CREATED: (\d+)/)?.[1] ?? '0')
    const cleared = Number(stdout.match(/TIMERS_CLEARED: (\d+)/)?.[1] ?? '-1')
    expect(created).toBeGreaterThanOrEqual(3)
    expect(cleared).toBe(created)
    expect((mod.activeChildren as Set<unknown>).size).toBe(0)
  }, 40_000)

  it('M6: post-spawn SIGKILL kill-error/EPERM -- fail closed; lock must not be released', async () => {
    const mod = await import(MODULE_PATH)
    const tmp = makeTempDir()
    const wpidfile = path.join(tmp, 'wrapper.pid')
    // direct child IGNORES SIGTERM so the injected SIGKILL failure is the
    // only way the tree can stop -- and it is made to fail (EPERM).
    const wrapper = treeWrapper(tmp, path.join(tmp, 'unused.log'), {
      directIgnore: true,
      wrapperPidfile: wpidfile,
    })
    const child = path.join(tmp, 'probe.mjs')
    fs.writeFileSync(
      child,
      [
        `import { activeChildren, execFileAsync } from ${JSON.stringify('file://' + MODULE_PATH)}`,
        "const eperm = new Error('kill EPERM (injected)')",
        "eperm.code = 'EPERM'",
        'let recordedPid = null',
        'let sigkillErrorObserved = false',
        'try {',
        `  await execFileAsync(${JSON.stringify('python3')}, [${JSON.stringify(wrapper)}], {`,
        "    stdio: ['pipe', 'inherit', 'inherit'],",
        '    timeout: 400,',
        // M33 WP-D: short deterministic timing profile.
        '    timingProfile: { settleDeadlineMs: 500, escalationDelayMs: 100 },',
        '  }, {',
        '    kill: (child, signal) => {',
        '      if (recordedPid === null) recordedPid = child.pid',
        '      if (signal === "SIGKILL") {',
        '        sigkillErrorObserved = true',
        "        child.emit('error', eperm)",
        '        return false',
        '      }',
        '      // SIGTERM: deliver for real (the wrapper ignores it)',
        '      try { process.kill(-child.pid, signal); return true } catch { return false }',
        '    },',
        '  })',
        '  console.log("OUTCOME: resolved")',
        '} catch (e) {',
        '  console.log("OUTCOME: rejected")',
        '  console.log("MESSAGE: " + (e && e.message ? e.message : String(e)))',
        '}',
        'console.log("SIGKILL_ERROR_OBSERVED: " + sigkillErrorObserved)',
        'console.log("REGISTRY_SIZE: " + activeChildren.size)',
        'let alive = false',
        'try { process.kill(recordedPid, 0); alive = true } catch {}',
        'console.log("PID_ALIVE_AT_REJECT: " + alive)',
        'if (recordedPid !== null) {',
        "  try { process.kill(-recordedPid, 'SIGKILL') } catch {}",
        "  try { process.kill(recordedPid, 'SIGKILL') } catch {}",
        '  await new Promise((r) => setTimeout(r, 300))',
        '  let dead = true',
        '  try { process.kill(recordedPid, 0); dead = false } catch {}',
        '  console.log("CLEANUP_ESRCH: " + dead)',
        '  for (const c of [...activeChildren]) activeChildren.delete(c)',
        '}',
        'process.exit(0)',
      ].join('\n'),
    )
    const res = spawnSync(process.execPath, [child], { encoding: 'utf8', timeout: 25_000 })
    const stdout = String(res.stdout)
    await forceCleanTree([readPid(wpidfile)])
    expect(res.status).toBe(0)
    expect(stdout).toContain('SIGKILL_ERROR_OBSERVED: true')
    expect(stdout).toContain('OUTCOME: rejected')
    expect(stdout).not.toMatch(/failed to start/i)
    expect(stdout).toMatch(/FAILED CLOSED|failed after spawn/i)
    expect(stdout).toContain('PID_ALIVE_AT_REJECT: true')
    expect(stdout).toContain('REGISTRY_SIZE: 1')
    expect(stdout).toContain('CLEANUP_ESRCH: true')
    expect((mod.activeChildren as Set<unknown>).size).toBe(0)
  }, 40_000)

  it('M7: ENOENT (never-created child) keeps the controlled early rejection with a clean registry', async () => {
    const mod = await import(MODULE_PATH)
    let settled: 'resolve' | 'reject' | null = null
    let msg = ''
    try {
      await mod.execFileAsync('/nonexistent/m32-no-such-binary-xyz', [])
      settled = 'resolve'
    } catch (e) {
      settled = 'reject'
      msg = e instanceof Error ? e.message : String(e)
    }
    expect(settled).toBe('reject')
    expect(msg).toMatch(/failed to start/)
    expect((mod.activeChildren as Set<unknown>).size).toBe(0)
  })

  it('M8: registry contract across success / nonzero / timeout / kill-false / spawn failure (all empty when settled)', async () => {
    const mod = await import(MODULE_PATH)
    const tmp = makeTempDir()
    const ok = path.join(tmp, 'ok.py')
    fs.writeFileSync(ok, 'print("ok")\n')
    await mod.execFileAsync('python3', [ok], { stdio: ['pipe', 'inherit', 'inherit'] })
    expect((mod.activeChildren as Set<unknown>).size).toBe(0)

    const bad = path.join(tmp, 'bad.py')
    fs.writeFileSync(bad, 'import sys\nsys.exit(3)\n')
    await expect(
      mod.execFileAsync('python3', [bad], { stdio: ['pipe', 'inherit', 'inherit'] }),
    ).rejects.toThrow()
    expect((mod.activeChildren as Set<unknown>).size).toBe(0)

    const sleeper = path.join(tmp, 'sleeper.py')
    fs.writeFileSync(sleeper, 'import time\ntime.sleep(1.5)\n')
    await expect(
      mod.execFileAsync(
        'python3',
        [sleeper],
        { stdio: ['pipe', 'inherit', 'inherit'], timeout: 200 },
        { kill: () => false },
      ),
    ).rejects.toThrow(/timed out|timeout/i)
    expect((mod.activeChildren as Set<unknown>).size).toBe(0)

    await expect(mod.execFileAsync('/nonexistent/m32-xyz', [])).rejects.toThrow()
    expect((mod.activeChildren as Set<unknown>).size).toBe(0)
  }, 20_000)

  it('M9: every timeout path leaves ZERO live timer handles (main + escalation + deadline + group poll)', async () => {
    const origSetTimeout = globalThis.setTimeout
    const origClearTimeout = globalThis.clearTimeout
    let created = 0
    let cleared = 0
    const live = new Set<unknown>()
    const patchedSetTimeout = (fn: TimerHandler, ms?: number, ...args: unknown[]) => {
      created++
      // M33 T12: a FIRED timer is no longer a live handle -- remove it from
      // `live` when it runs, so `live.size` is the authoritative still-live
      // count (cleared === created would fail when the group poll fires more
      // than once on slow machines: earlier polls fired and need no clear).
      const t = origSetTimeout(
        () => {
          live.delete(t)
          ;(fn as (...args: unknown[]) => void)(...args)
        },
        ms,
        ...args,
      )
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
    const mod = await import(MODULE_PATH)
    const tmp = makeTempDir()
    const sentinelFile = path.join(tmp, 'sentinel.log')
    const gpidfile = path.join(tmp, 'grandchild.pid')
    const wpidfile = path.join(tmp, 'wrapper.pid')
    // P1 shape: grandchild ALONE ignores SIGTERM, so the group survives the
    // direct child's close and the group-poll/escalation machinery must run.
    const wrapper = treeWrapper(tmp, sentinelFile, {
      directIgnore: false,
      grandchildIgnore: true,
      pidfile: gpidfile,
      wrapperPidfile: wpidfile,
    })
    let message = ''
    globalThis.setTimeout = patchedSetTimeout as typeof globalThis.setTimeout
    globalThis.clearTimeout = patchedClearTimeout as typeof globalThis.clearTimeout
    try {
      try {
        await mod.execFileAsync('python3', [wrapper], {
          stdio: ['pipe', 'inherit', 'inherit'],
          timeout: 300,
          // M33 WP-D: short deterministic timing profile.
          timingProfile: { escalationDelayMs: 1500, settleDeadlineMs: 2000 },
        })
      } catch (e) {
        message = e instanceof Error ? e.message : String(e)
      }
    } finally {
      // Restore BEFORE any sleep-based quiescence check so the patch only
      // counts timers owned by execFileAsync (sleep() timers are never
      // cleared and would pollute the equality).
      globalThis.setTimeout = origSetTimeout
      globalThis.clearTimeout = origClearTimeout
    }
    try {
      expect(message).toMatch(/timed out|timeout/i)
      expect((mod.activeChildren as Set<unknown>).size).toBe(0)
      await expectQuiescent(sentinelFile)
      expectDead(readPid(gpidfile), 'grandchild')
      expectDead(readPid(wpidfile), 'direct child (wrapper)')
      await new Promise((r) => setImmediate(() => setImmediate(r)))
      expect(
        created,
        'expected main + escalation + deadline (group poll when needed)',
      ).toBeGreaterThanOrEqual(3)
      // M33 T12: the authoritative still-live count is `live` -- fired timers
      // were removed on fire and settled ones were cleared; zero live handles
      // is the contract (NOT cleared === created, which breaks when the group
      // poll legitimately fires more than once on slow machines).
      expect(
        live.size,
        `live timer handles must be 0 after settle (created=${created}, cleared=${cleared})`,
      ).toBe(0)
    } finally {
      await forceCleanTree([readPid(gpidfile), readPid(wpidfile)])
    }
  }, 30_000)

  it('M10: bounded group-settle constants are exported; runCli refuses to release the lock while the registry is non-empty', async () => {
    const mod = await import(MODULE_PATH)
    expect(Number.isInteger(mod.GROUP_SETTLE_POLL_MS)).toBe(true)
    expect(mod.GROUP_SETTLE_POLL_MS).toBeGreaterThan(0)
    expect(Number.isInteger(mod.GROUP_SETTLE_DEADLINE_MS)).toBe(true)
    expect(mod.GROUP_SETTLE_DEADLINE_MS).toBeGreaterThan(0)
    // The fail-closed coordination: a preserved registry entry must force the
    // lock to stay held (structure-pinned; the behavior is covered by M5/M6).
    const src = fs.readFileSync(MODULE_PATH, 'utf8')
    const finallyBlock = src.slice(src.indexOf('} finally {'))
    expect(finallyBlock).toMatch(/activeChildren\.size > 0/)
    expect(finallyBlock).toMatch(/refusing to release/)
  })
})
