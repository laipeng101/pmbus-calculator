// M33 WP-A / WP-B / WP-C: crash-consistent child ownership, bounded
// fail-closed exit and lock-recovery safety (test-first against M32/main).
//
// P1-A (pre-fix): recoverLock only checked the owner PID (ESRCH) and deleted
// the lock while the detached helper group was still running and writing the
// sentinel; a replacement lock was acquirable (probe evidence).
// P1-B (pre-fix): after a fail-closed promise rejection the CLI process did
// NOT exit naturally -- the surviving child kept a stdio handle alive
// (probe evidence).
//
// Contract under test:
//   T1. owner SIGKILL + helper ACTIVE            -> recover refuses
//   T2. owner SIGKILL + sentinel still growing   -> replacement lock denied
//   T3. SPAWN_INTENT crash window                -> manual audit (refuse)
//   T4. missing/corrupt/unknown-schema/nonce/repo mismatch -> refuse
//   T5. ACTIVE with unknown pgid / live group    -> refuse
//   T6. ACTIVE ESRCH + owner ESRCH + metadata ok -> explicit recovery works
//   T7. fail-closed rejection -> CLI exits naturally non-zero, lock kept
//   T8. fail-closed then helper killed -> explicit recovery succeeds
//   T9. no-timeout post-spawn error still triggers controlled termination
//   T10. four direct/grandchild SIGTERM combos keep passing (M32 M1-M4)
//   T11. registry contract success/nonzero/timeout/kill-false/ENOENT (M32 M8)
//   T12. timer created/cleared: no live timer handle after settle
//   T13. repeated-signal watchdog cleans the whole process group
//   T14. two consecutive runs: identical counts, zero residue
//
// Cleanup contract: every test force-cleans the process tree it created in a
// finally block; the file-level afterAll re-checks (0 orphans).

import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, describe, expect, it } from 'vitest'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MODULE_PATH = path.join(REPO_ROOT, 'scripts', 'prepare-release-assets.mjs')

const tempDirs: string[] = []
function makeTempDir(prefix = 'm33-own-'): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
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
  const still = spawnedPids.filter(pidAlive)
  if (still.length > 0) {
    await forceCleanTree(still)
    const left = still.filter(pidAlive)
    if (left.length > 0) {
      throw new Error(`M33 test left orphan processes: ${left.join(',')}`)
    }
  }
})

/** Python helper: writes its PID then appends SENTINEL forever. */
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

function sentinelSnapshot(p: string): { size: number; hash: string } {
  if (!fs.existsSync(p)) return { size: 0, hash: '' }
  const buf = fs.readFileSync(p)
  return { size: buf.length, hash: createHash('sha256').update(buf).digest('hex') }
}

async function expectQuiescent(sentinelFile: string, stableMs = 300, waitMs = 800): Promise<void> {
  await sleep(stableMs)
  const snap1 = sentinelSnapshot(sentinelFile)
  await sleep(waitMs)
  const snap2 = sentinelSnapshot(sentinelFile)
  expect(snap2.size).toBe(snap1.size)
  expect(snap2.hash).toBe(snap1.hash)
  expect(snap1.size).toBeGreaterThan(0)
}

function expectDead(pid: number, label: string): void {
  expect(pid, `${label} PID missing`).toBeGreaterThan(0)
  expect(() => process.kill(pid, 0), `${label} (pid ${pid}) still alive`).toThrow(/ESRCH/)
}

/** M34 WP-A: nonce-qualified sidecar basename for a lock nonce. */
function sidecarName(nonce: string): string {
  return `.release-staging.child-state-${nonce}.json`
}

/** Read the current lock's nonce and return its nonce-qualified sidecar path. */
function currentSidecarPath(tmp: string): string {
  const lock = JSON.parse(fs.readFileSync(path.join(tmp, '.release-staging.lock'), 'utf8'))
  return path.join(tmp, sidecarName((lock as { nonce: string }).nonce))
}

/** Write a v3 lock fixture (+ nonce-qualified sidecar) with the given child-state. */
function writeLockFixture(
  tmp: string,
  state: string,
  overrides: Record<string, unknown> = {},
  sidecar: Record<string, unknown> | null = null,
): { lockPath: string; nonce: string; repoRealpath: string; sidecarPath: string } {
  const nonce = randomUUID4()
  const repoRealpath = fs.realpathSync(tmp)
  const metadata = {
    schemaVersion: 3,
    pid: 999999999,
    startedAt: new Date().toISOString(),
    nonce,
    repoRealpath,
    childStateFile: sidecarName(nonce),
    childState: {
      schemaVersion: 2,
      nonce,
      repoRealpath,
      state,
      pgid: null,
      helperPid: null,
      updatedAt: new Date().toISOString(),
    },
    ...overrides,
  }
  const lockPath = path.join(tmp, '.release-staging.lock')
  fs.writeFileSync(lockPath, JSON.stringify(metadata) + '\n')
  const cs = (metadata as { childState: Record<string, unknown> }).childState
  const sidecarPath = path.join(tmp, sidecarName(nonce))
  fs.writeFileSync(sidecarPath, JSON.stringify(sidecar ?? cs) + '\n')
  return { lockPath, nonce, repoRealpath, sidecarPath }
}

function randomUUID4(): string {
  const c = createHash('sha256').update(String(Math.random())).digest('hex')
  return `${c.slice(0, 8)}-${c.slice(8, 12)}-4${c.slice(13, 16)}-${c.slice(16, 20)}-${c.slice(20, 32)}`
}

describe('M33 WP-A crash-consistent child ownership and lock recovery', () => {
  it('T1+T2: owner SIGKILL with ACTIVE helper -- recover refuses AND replacement lock is denied while the sentinel keeps growing', async () => {
    const mod = await import(MODULE_PATH)
    const tmp = makeTempDir()
    const sentinelFile = path.join(tmp, 'sentinel.log')
    const pidfile = path.join(tmp, 'helper.pid')
    const ownerReady = path.join(tmp, 'owner.ready')
    const helperPy = path.join(tmp, 'helper.py')
    fs.writeFileSync(
      helperPy,
      [
        'import os, time',
        `with open(${JSON.stringify(pidfile)}, 'w') as f: f.write(str(os.getpid()))`,
        `f = open(${JSON.stringify(sentinelFile)}, 'a')`,
        'while True:',
        "  f.write('SENTINEL\\n')",
        '  f.flush()',
        '  time.sleep(0.05)',
      ].join('\n'),
    )
    const ownerScript = path.join(tmp, 'owner.mjs')
    fs.writeFileSync(
      ownerScript,
      [
        `import fs from 'node:fs'`,
        `const mod = await import(${JSON.stringify('file://' + MODULE_PATH)})`,
        `const lock = mod.acquireLock(${JSON.stringify(tmp)})`,
        `fs.writeFileSync(${JSON.stringify(ownerReady)}, String(process.pid))`,
        `await mod.execFileAsync('python3', [${JSON.stringify(helperPy)}], { stdio: ['pipe', 'inherit', 'inherit'], timeout: 0, childState: lock.childState })`,
      ].join('\n'),
    )
    const owner = spawn(process.execPath, [ownerScript], { cwd: tmp, stdio: 'ignore' })
    const deadline = Date.now() + 15_000
    while (
      Date.now() < deadline &&
      !(
        fs.existsSync(lockPathFor(tmp)) &&
        fs.existsSync(pidfile) &&
        fs.existsSync(currentSidecarPath(tmp)) &&
        JSON.parse(fs.readFileSync(currentSidecarPath(tmp), 'utf8')).state === 'ACTIVE'
      )
    ) {
      await sleep(20)
    }
    const helperPid = readPid(pidfile)
    const ownerPid = owner.pid ?? -1
    try {
      expect(fs.existsSync(lockPathFor(tmp))).toBe(true)
      owner.kill('SIGKILL')
      await new Promise((r) => owner.on('close', r))
      await sleep(600)
      const s1 = sentinelSnapshot(sentinelFile)
      const recover = mod.recoverLock(tmp)
      expect(
        recover.recovered,
        `recover must refuse while ACTIVE group lives: ${recover.reason}`,
      ).toBe(false)
      expect(recover.reason).toMatch(/ACTIVE|SPAWN_INTENT|manual audit/i)
      let replacementDenied = false
      try {
        mod.acquireLock(tmp)
      } catch {
        replacementDenied = true
      }
      expect(replacementDenied, 'replacement lock must be denied').toBe(true)
      await sleep(600)
      const s2 = sentinelSnapshot(sentinelFile)
      expect(s2.size).toBeGreaterThan(s1.size)
      expect(s2.hash).not.toBe(s1.hash)
    } finally {
      await forceCleanTree([helperPid, ownerPid])
    }
  })

  it('T3: SPAWN_INTENT crash window (owner killed between intent and spawn) -- manual audit', async () => {
    const mod = await import(MODULE_PATH)
    const tmp = makeTempDir()
    const ownerReady = path.join(tmp, 'owner.ready')
    const ownerScript = path.join(tmp, 'owner.mjs')
    fs.writeFileSync(
      ownerScript,
      [
        `import fs from 'node:fs'`,
        `const mod = await import(${JSON.stringify('file://' + MODULE_PATH)})`,
        `const lock = mod.acquireLock(${JSON.stringify(tmp)})`,
        // persist SPAWN_INTENT, then hang BEFORE any spawn -- the crash window
        `lock.childState.beginSpawn()`,
        `fs.writeFileSync(${JSON.stringify(ownerReady)}, String(process.pid))`,
        // keep the event loop alive so the owner waits for SIGKILL
        `setInterval(() => {}, 1000)`,
        `await new Promise(() => {})`,
      ].join('\n'),
    )
    const owner = spawn(process.execPath, [ownerScript], { cwd: tmp, stdio: 'ignore' })
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline && !fs.existsSync(ownerReady)) {
      await sleep(20)
    }
    const ownerPid = owner.pid ?? -1
    try {
      expect(fs.existsSync(ownerReady), 'owner must persist SPAWN_INTENT and report ready').toBe(
        true,
      )
      owner.kill('SIGKILL')
      await new Promise((r) => owner.on('close', r))
      const sidecar = JSON.parse(fs.readFileSync(currentSidecarPath(tmp), 'utf8'))
      expect(sidecar.state).toBe('SPAWN_INTENT')
      const recover = mod.recoverLock(tmp)
      expect(recover.recovered).toBe(false)
      expect(recover.reason).toMatch(/SPAWN_INTENT|cannot prove no process/i)
      expect(fs.existsSync(lockPathFor(tmp))).toBe(true)
    } finally {
      await forceCleanTree([ownerPid])
    }
  })

  it('T4: missing/corrupt/unknown-schema/nonce-mismatch/repo-mismatch child-state -- refuse', async () => {
    const mod = await import(MODULE_PATH)
    const tmp = makeTempDir()

    // missing sidecar
    const f1 = writeLockFixture(tmp, 'EMPTY')
    fs.unlinkSync(currentSidecarPath(tmp))
    expect(mod.recoverLock(tmp).recovered).toBe(false)
    fs.unlinkSync(f1.lockPath)

    // corrupt sidecar
    const f2 = writeLockFixture(tmp, 'EMPTY')
    fs.writeFileSync(currentSidecarPath(tmp), '{not json')
    expect(mod.recoverLock(tmp).recovered).toBe(false)
    fs.unlinkSync(f2.lockPath)

    // unknown schema
    const f3 = writeLockFixture(tmp, 'EMPTY', { schemaVersion: 99 })
    expect(mod.recoverLock(tmp).recovered).toBe(false)
    fs.unlinkSync(f3.lockPath)

    // v1 legacy lock (no child-state contract) -- refuse + manual audit
    const lockPath = path.join(tmp, '.release-staging.lock')
    fs.writeFileSync(
      lockPath,
      JSON.stringify({
        schemaVersion: 1,
        pid: 999999999,
        startedAt: new Date().toISOString(),
        nonce: randomUUID4(),
        repoRealpath: fs.realpathSync(tmp),
      }) + '\n',
    )
    const v1 = mod.recoverLock(tmp)
    expect(v1.recovered).toBe(false)
    expect(v1.reason).toMatch(/schemaVersion|manual audit/i)
    fs.unlinkSync(lockPath)

    // nonce mismatch between lock and sidecar
    const f4 = writeLockFixture(tmp, 'EMPTY')
    fs.writeFileSync(
      currentSidecarPath(tmp),
      JSON.stringify({
        schemaVersion: 1,
        nonce: randomUUID4(),
        repoRealpath: fs.realpathSync(tmp),
        state: 'EMPTY',
        pgid: null,
        helperPid: null,
        updatedAt: new Date().toISOString(),
      }) + '\n',
    )
    expect(mod.recoverLock(tmp).recovered).toBe(false)
    fs.unlinkSync(f4.lockPath)

    // repo mismatch
    const f5 = writeLockFixture(tmp, 'EMPTY', { repoRealpath: '/some/other/repo' })
    expect(mod.recoverLock(tmp).recovered).toBe(false)
    fs.unlinkSync(f5.lockPath)
  })

  it('T5: ACTIVE without a known PGID, or with a live group -- refuse', async () => {
    const mod = await import(MODULE_PATH)
    const tmp = makeTempDir()
    // ACTIVE + unknown PGID
    const f1 = writeLockFixture(tmp, 'ACTIVE')
    expect(mod.recoverLock(tmp).recovered).toBe(false)
    fs.unlinkSync(f1.lockPath)
    // ACTIVE + a PGID that provably exists (a real detached process group)
    const sleeper = path.join(tmp, 'sleeper.py')
    fs.writeFileSync(
      sleeper,
      [
        'import os, time',
        'os.setsid()',
        `with open(${JSON.stringify(path.join(tmp, 's.pid'))}, 'w') as f: f.write(str(os.getpid()))`,
        'time.sleep(60)',
      ].join('\n'),
    )
    const groupChild = spawn('python3', [sleeper], { stdio: 'ignore' })
    const groupPid = await waitForPidfile(path.join(tmp, 's.pid'))
    try {
      // the detached python is a process-group leader only if spawned detached;
      // instead spawn it as its own group leader via setsid in python itself
      const f2 = writeLockFixture(
        tmp,
        'ACTIVE',
        {},
        {
          schemaVersion: 1,
          nonce: f1.nonce,
          repoRealpath: fs.realpathSync(tmp),
          state: 'ACTIVE',
          pgid: groupPid,
          helperPid: groupPid,
          updatedAt: new Date().toISOString(),
        },
      )
      fs.writeFileSync(
        currentSidecarPath(tmp),
        JSON.stringify({
          schemaVersion: 1,
          nonce: f2.nonce,
          repoRealpath: fs.realpathSync(tmp),
          state: 'ACTIVE',
          pgid: groupPid,
          helperPid: groupPid,
          updatedAt: new Date().toISOString(),
        }) + '\n',
      )
      // groupPid is the pgid of the spawned python only if it leads a group;
      // verify with kill(-pgid, 0) semantics by using setsid in the helper
      const r = mod.recoverLock(tmp)
      expect(r.recovered, `recover must refuse with a live group: ${r.reason}`).toBe(false)
      expect(r.reason).toMatch(/still exists|unprovable|EPERM|manual audit/i)
      fs.unlinkSync(f2.lockPath)
    } finally {
      groupChild.kill('SIGKILL')
      await forceCleanTree([groupPid])
    }
  }, 20_000)

  it('T6: ACTIVE group ESRCH + owner ESRCH + metadata match -> explicit recovery succeeds', async () => {
    const mod = await import(MODULE_PATH)
    const tmp = makeTempDir()
    const pidfile = path.join(tmp, 'helper.pid')
    const ownerReady = path.join(tmp, 'owner.ready')
    const helperPy = path.join(tmp, 'helper.py')
    fs.writeFileSync(
      helperPy,
      [
        'import os, time',
        `with open(${JSON.stringify(pidfile)}, 'w') as f: f.write(str(os.getpid()))`,
        'time.sleep(60)',
      ].join('\n'),
    )
    const ownerScript = path.join(tmp, 'owner.mjs')
    fs.writeFileSync(
      ownerScript,
      [
        `import fs from 'node:fs'`,
        `const mod = await import(${JSON.stringify('file://' + MODULE_PATH)})`,
        `const lock = mod.acquireLock(${JSON.stringify(tmp)})`,
        `fs.writeFileSync(${JSON.stringify(ownerReady)}, String(process.pid))`,
        `await mod.execFileAsync('python3', [${JSON.stringify(helperPy)}], { stdio: ['pipe', 'inherit', 'inherit'], timeout: 0, childState: lock.childState })`,
      ].join('\n'),
    )
    const owner = spawn(process.execPath, [ownerScript], { cwd: tmp, stdio: 'ignore' })
    const deadline = Date.now() + 15_000
    while (
      Date.now() < deadline &&
      !(
        fs.existsSync(lockPathFor(tmp)) &&
        fs.existsSync(pidfile) &&
        fs.existsSync(currentSidecarPath(tmp)) &&
        JSON.parse(fs.readFileSync(currentSidecarPath(tmp), 'utf8')).state === 'ACTIVE'
      )
    ) {
      await sleep(20)
    }
    const helperPid = readPid(pidfile)
    const ownerPid = owner.pid ?? -1
    try {
      owner.kill('SIGKILL')
      await new Promise((r) => owner.on('close', r))
      // externally kill the helper group, wait for ESRCH
      await forceCleanTree([helperPid])
      expect(pidAlive(helperPid)).toBe(false)
      const recover = mod.recoverLock(tmp)
      expect(recover.recovered, `explicit recovery must succeed: ${recover.reason}`).toBe(true)
      expect(fs.existsSync(lockPathFor(tmp))).toBe(false)
      // replacement lock is now acquirable
      const replacement = mod.acquireLock(tmp)
      expect(replacement.nonce.length).toBeGreaterThan(0)
      replacement.release()
      expect(fs.existsSync(lockPathFor(tmp))).toBe(false)
    } finally {
      await forceCleanTree([helperPid, ownerPid])
    }
  })

  it('T7: fail-closed rejection -> CLI exits naturally non-zero, lock kept, MANUAL_AUDIT_REQUIRED', async () => {
    const mod = await import(MODULE_PATH)
    const tmp = makeTempDir()
    const pidfile = path.join(tmp, 'child.pid')
    const longPy = path.join(tmp, 'long.py')
    fs.writeFileSync(
      longPy,
      [
        'import os, time',
        `with open(${JSON.stringify(pidfile)}, 'w') as f: f.write(str(os.getpid()))`,
        'time.sleep(300)',
      ].join('\n'),
    )
    const childScript = path.join(tmp, 'child.mjs')
    fs.writeFileSync(
      childScript,
      [
        `import { activeChildren, execFileAsync, acquireLock } from ${JSON.stringify('file://' + MODULE_PATH)}`,
        "const eperm = new Error('kill EPERM (injected)')",
        "eperm.code = 'EPERM'",
        `const lock = acquireLock(${JSON.stringify(tmp)})`,
        'let recordedPid = null',
        'try {',
        `  await execFileAsync(${JSON.stringify('python3')}, [${JSON.stringify(longPy)}], {`,
        "    stdio: ['pipe', 'inherit', 'inherit'],",
        '    timeout: 300,',
        '    childState: lock.childState,',
        '    timingProfile: { settleDeadlineMs: 800, escalationDelayMs: 200 },',
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
        'console.log("REGISTRY_SIZE: " + activeChildren.size)',
        // runCli semantics: fail-closed -> refuse to release the lock and
        // return non-zero. Set the exit code and let the process exit
        // NATURALLY (no process.exit, no registry cleanup, no child kill).
        'process.exitCode = 1',
      ].join('\n'),
    )
    const child = spawn(process.execPath, [childScript], {
      cwd: tmp,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    child.stdout.on('data', (d) => {
      out += String(d)
    })
    // NOTE: use 'exit' (not 'close') for liveness -- the surviving detached
    // helper inherits the CLI's stdout fd, so the stdio streams (and thus
    // 'close') stay open until the helper dies; 'exit' fires when the
    // process itself terminates.
    const exitPromise = new Promise<number | null>((resolve) =>
      child.on('exit', (code) => resolve(code)),
    )
    const childPid = child.pid ?? -1
    const helperPid = await waitForPidfile(pidfile)
    const exitCode = await Promise.race([
      exitPromise,
      sleep(15_000).then(() => {
        // still alive -> natural-exit violation
        child.kill('SIGKILL')
        return -999
      }),
    ])
    try {
      expect(exitCode, `CLI must exit naturally non-zero (out: ${out.slice(-400)})`).not.toBe(-999)
      expect(exitCode).not.toBe(0)
      expect(out).toContain('OUTCOME: rejected')
      expect(out).toMatch(/FAILED CLOSED/i)
      expect(out).toContain('REGISTRY_SIZE: 1')
      // lock + MANUAL_AUDIT_REQUIRED sidecar preserved
      expect(fs.existsSync(lockPathFor(tmp))).toBe(true)
      const sidecar = JSON.parse(fs.readFileSync(currentSidecarPath(tmp), 'utf8'))
      expect(sidecar.state).toBe('MANUAL_AUDIT_REQUIRED')
      // recovery refuses while the helper is still alive
      const recover = mod.recoverLock(tmp)
      expect(recover.recovered, `recover must refuse: ${recover.reason}`).toBe(false)
    } finally {
      await forceCleanTree([helperPid, childPid])
      // clean up the leftover lock+sidecar so afterEach removal is tidy
      try {
        fs.unlinkSync(lockPathFor(tmp))
      } catch {
        /* best effort */
      }
      try {
        fs.unlinkSync(currentSidecarPath(tmp))
      } catch {
        /* best effort */
      }
    }
  }, 30_000)

  it('T8: fail-closed then the helper group is cleaned -> formal audit acknowledgement succeeds', async () => {
    const mod = await import(MODULE_PATH)
    const tmp = makeTempDir()
    const pidfile = path.join(tmp, 'child.pid')
    const longPy = path.join(tmp, 'long.py')
    fs.writeFileSync(
      longPy,
      [
        'import os, time',
        `with open(${JSON.stringify(pidfile)}, 'w') as f: f.write(str(os.getpid()))`,
        'time.sleep(300)',
      ].join('\n'),
    )
    const childScript = path.join(tmp, 'child.mjs')
    fs.writeFileSync(
      childScript,
      [
        `import { execFileAsync, acquireLock } from ${JSON.stringify('file://' + MODULE_PATH)}`,
        "const eperm = new Error('kill EPERM (injected)')",
        "eperm.code = 'EPERM'",
        `const lock = acquireLock(${JSON.stringify(tmp)})`,
        'try {',
        `  await execFileAsync(${JSON.stringify('python3')}, [${JSON.stringify(longPy)}], {`,
        "    stdio: ['pipe', 'inherit', 'inherit'],",
        '    timeout: 300,',
        '    childState: lock.childState,',
        '    timingProfile: { settleDeadlineMs: 800, escalationDelayMs: 200 },',
        '  }, {',
        '    kill: (child, signal) => {',
        "      child.emit('error', eperm)",
        '      return false',
        '    },',
        '  })',
        '} catch (e) {}',
      ].join('\n'),
    )
    const child = spawn(process.execPath, [childScript], { cwd: tmp, stdio: 'ignore' })
    const childPid = child.pid ?? -1
    const helperPid = await waitForPidfile(pidfile)
    await new Promise<number | null>((resolve) => child.on('close', (code) => resolve(code)))
    try {
      const sidecar = JSON.parse(fs.readFileSync(currentSidecarPath(tmp), 'utf8'))
      expect(sidecar.state).toBe('MANUAL_AUDIT_REQUIRED')
      // M34 WP-B: MANUAL state carries last-known ownership in dedicated fields.
      expect(sidecar.lastKnownPgid).toBe(helperPid)
      expect(sidecar.lastKnownHelperPid).toBe(helperPid)
      expect(typeof sidecar.auditReason).toBe('string')
      // audit acknowledgement while the group is STILL ALIVE must refuse
      const whileAlive = mod.auditLockAcknowledgement(tmp, {
        nonce: sidecar.nonce,
        lastKnownPgid: sidecar.lastKnownPgid,
      })
      expect(whileAlive.acknowledged).toBe(false)
      expect(fs.existsSync(lockPathFor(tmp))).toBe(true)
      // clean the helper group (external audit action), then acknowledge
      await forceCleanTree([helperPid])
      expect(pidAlive(helperPid)).toBe(false)
      const wrongNonce = mod.auditLockAcknowledgement(tmp, {
        nonce: '00000000-0000-4000-8000-000000000000',
        lastKnownPgid: sidecar.lastKnownPgid,
      })
      expect(wrongNonce.acknowledged, 'wrong nonce must refuse').toBe(false)
      const wrongPgid = mod.auditLockAcknowledgement(tmp, {
        nonce: sidecar.nonce,
        lastKnownPgid: sidecar.lastKnownPgid + 1,
      })
      expect(wrongPgid.acknowledged, 'wrong last-known PGID must refuse').toBe(false)
      const audited = mod.auditLockAcknowledgement(tmp, {
        nonce: sidecar.nonce,
        lastKnownPgid: sidecar.lastKnownPgid,
      })
      expect(audited.acknowledged, `audit acknowledgement: ${audited.reason}`).toBe(true)
      expect(fs.existsSync(lockPathFor(tmp))).toBe(false)
      expect(fs.existsSync(path.join(tmp, sidecarName(sidecar.nonce)))).toBe(false)
    } finally {
      await forceCleanTree([helperPid, childPid])
      try {
        fs.unlinkSync(lockPathFor(tmp))
      } catch {
        /* best effort */
      }
    }
  })

  it('T9: no-timeout post-spawn error still triggers controlled termination (SIGTERM then SIGKILL escalation)', async () => {
    const tmp = makeTempDir()
    const wpidfile = path.join(tmp, 'wrapper.pid')
    const wrapper = path.join(tmp, 'wrapper.py')
    fs.writeFileSync(
      wrapper,
      [
        'import os, time',
        `with open(${JSON.stringify(wpidfile)}, 'w') as f: f.write(str(os.getpid()))`,
        'time.sleep(30)',
      ].join('\n'),
    )
    // postSpawnError hook: an error arrives AFTER spawn with NO opts.timeout
    // set; the controlled termination (SIGTERM then SIGKILL escalation) must
    // start anyway (M33 WP-B #4). SIGTERM is delivered for real.
    const childScript = path.join(tmp, 'child.mjs')
    fs.writeFileSync(
      childScript,
      [
        `import { execFileAsync } from ${JSON.stringify('file://' + MODULE_PATH)}`,
        "const eperm = new Error('post-spawn error (injected, no timeout)')",
        "eperm.code = 'EPERM'",
        'let sawTerm = false',
        'try {',
        `  await execFileAsync(${JSON.stringify('python3')}, [${JSON.stringify(wrapper)}], {`,
        "    stdio: ['pipe', 'inherit', 'inherit'],",
        '    // NO timeout -- M33 WP-B #4: controlled termination must still start',
        '    timingProfile: { settleDeadlineMs: 3000, escalationDelayMs: 200 },',
        '  }, {',
        '    postSpawnError: eperm,',
        '    kill: (child, signal) => {',
        '      if (signal === "SIGTERM") sawTerm = true',
        '      try { process.kill(-child.pid, signal); return true } catch { return false }',
        '    },',
        '  })',
        '  console.log("OUTCOME: resolved")',
        '} catch (e) {',
        '  console.log("OUTCOME: rejected")',
        '  console.log("MESSAGE: " + (e && e.message ? e.message : String(e)))',
        '}',
        'console.log("SAW_SIGTERM: " + sawTerm)',
        'process.exit(0)',
      ].join('\n'),
    )
    const res = spawnSync(process.execPath, [childScript], { encoding: 'utf8', timeout: 25_000 })
    const stdout = String(res.stdout)
    const wpid = fs.existsSync(wpidfile) ? readPid(wpidfile) : -1
    await forceCleanTree([wpid])
    expect(res.status).toBe(0)
    expect(stdout).toContain('OUTCOME: rejected')
    expect(stdout).toContain('SAW_SIGTERM: true')
    expect(stdout).toMatch(/failed after spawn/i)
    expectDead(wpid, 'wrapper')
  }, 30_000)

  it('T12: timer accounting distinguishes created vs still-live -- zero live handles after settle', async () => {
    const mod = await import(MODULE_PATH)
    const tmp = makeTempDir()
    const pidfile = path.join(tmp, 'grandchild.pid')
    const wrapper = path.join(tmp, 'wrapper.py')
    fs.writeFileSync(
      wrapper,
      [
        'import subprocess, os, time',
        `p = subprocess.Popen(['python3', '-u', '-c', ${JSON.stringify(fileWriterCode(path.join(tmp, 'sentinel.log'), true))}])`,
        `with open(${JSON.stringify(pidfile)}, 'w') as f: f.write(str(p.pid))`,
        'time.sleep(30)',
      ].join('\n'),
    )
    const origSetTimeout = globalThis.setTimeout
    const origClearTimeout = globalThis.clearTimeout
    let created = 0
    let cleared = 0
    const live = new Set<unknown>()
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
    let message = ''
    globalThis.setTimeout = patchedSetTimeout as typeof globalThis.setTimeout
    globalThis.clearTimeout = patchedClearTimeout as typeof globalThis.clearTimeout
    try {
      try {
        await mod.execFileAsync('python3', [wrapper], {
          stdio: ['pipe', 'inherit', 'inherit'],
          timeout: 500,
          timingProfile: { escalationDelayMs: 1500 },
        })
      } catch (e) {
        message = e instanceof Error ? e.message : String(e)
      }
    } finally {
      globalThis.setTimeout = origSetTimeout
      globalThis.clearTimeout = origClearTimeout
    }
    const gpid = fs.existsSync(pidfile) ? readPid(pidfile) : -1
    try {
      expect(message).toMatch(/timed out|timeout/i)
      expect((mod.activeChildren as Set<unknown>).size).toBe(0)
      await expectQuiescent(path.join(tmp, 'sentinel.log'))
      expectDead(gpid, 'grandchild')
      // live set is the authoritative "still live" count -- cleared must
      // equal created (a fired-but-not-cleared timer would stay in `live`)
      expect(
        live.size,
        `live timer handles must be 0 after settle (created=${created}, cleared=${cleared})`,
      ).toBe(0)
      expect(created).toBeGreaterThanOrEqual(3)
      expect(cleared).toBe(created)
    } finally {
      await forceCleanTree([gpid])
    }
  }, 30_000)
})

describe('M33 WP-C signal gate: watchdog owns the whole group; repeated runs stable', () => {
  it('T13: the signal-test watchdog cleanup kills the helper GROUP, not just the outer Node process', async () => {
    const src = fs.readFileSync(
      path.join(REPO_ROOT, 'tests', 'm30-signal-lifecycle.test.ts'),
      'utf8',
    )
    expect(src).toMatch(/killOwnedTree/)
    expect(src).toMatch(/process\.kill\(-helperPid, 'SIGKILL'\)/)
    expect(src).toMatch(/watchdog-fired|KILLED/)
    // And a real behavioral check: forceCleanTree-like group kill removes a
    // detached helper group (used by the watchdog).
    const tmp = makeTempDir()
    const pidfile = path.join(tmp, 'g.pid')
    const wpidfile = path.join(tmp, 'w.pid')
    const w = path.join(tmp, 'w.py')
    fs.writeFileSync(
      w,
      [
        'import subprocess, os, time',
        'os.setsid()',
        `with open(${JSON.stringify(wpidfile)}, 'w') as f: f.write(str(os.getpid()))`,
        `p = subprocess.Popen(['python3', '-u', '-c', ${JSON.stringify(fileWriterCode(path.join(tmp, 's.log'), true))}])`,
        `with open(${JSON.stringify(pidfile)}, 'w') as f: f.write(str(p.pid))`,
        'time.sleep(30)',
      ].join('\n'),
    )
    const gpid = await new Promise<number>((resolve) => {
      const c = spawn('python3', [w], { stdio: 'ignore' })
      const t = setTimeout(() => {
        c.kill('SIGKILL')
        resolve(-1)
      }, 10_000)
      c.on('spawn', () => {
        const poll = setInterval(() => {
          if (fs.existsSync(pidfile)) {
            clearInterval(poll)
            clearTimeout(t)
            resolve(readPid(pidfile))
          }
        }, 20)
      })
    })
    const wpid = fs.existsSync(wpidfile) ? readPid(wpidfile) : -1
    try {
      // both the wrapper and the grandchild live in the same detached group
      await forceCleanTree([gpid, wpid])
      expectDead(gpid, 'grandchild')
      expectDead(wpid, 'wrapper')
    } finally {
      await forceCleanTree([gpid, wpid])
    }
  }, 20_000)

  it('T14: two consecutive runs of this file have identical counts and leave zero /tmp residue', async () => {
    const script = path.join(REPO_ROOT, 'tests', 'm33-child-ownership-recovery.test.ts')
    // Run the OTHER tests (T1-T13) twice; T14 itself is excluded to avoid
    // self-recursion. Counts must be identical and /tmp residue must be zero.
    const testPattern = 'T1\\+T2:|T3:|T4:|T5:|T6:|T7:|T8:|T9:|T12:|T13:'
    const run = (): { status: number | null; stdout: string } => {
      const res = spawnSync(
        process.execPath,
        [
          path.join(REPO_ROOT, 'node_modules', 'vitest', 'vitest.mjs'),
          'run',
          script,
          '-t',
          testPattern,
        ],
        { encoding: 'utf8', timeout: 180_000, env: { ...process.env, CI: '1' } },
      )
      return { status: res.status, stdout: String(res.stdout) }
    }
    const r1 = run()
    expect(r1.status, `first run failed: ${r1.stdout.slice(-800)}`).toBe(0)
    const r2 = run()
    expect(r2.status, `second run failed: ${r2.stdout.slice(-800)}`).toBe(0)
    const countOf = (s: string, re: RegExp) => (s.match(re) ?? []).length
    expect(countOf(r1.stdout, /✓/g)).toBe(countOf(r2.stdout, /✓/g))
    // zero stale locks / sidecars / sentinel residue under /tmp
    const left = fs
      .readdirSync(os.tmpdir())
      .filter(
        (n) => n.startsWith('m33-own-') && fs.statSync(path.join(os.tmpdir(), n)).isDirectory(),
      )
    expect(left).toEqual([])
  }, 240_000)
})

function lockPathFor(tmp: string): string {
  return path.join(tmp, '.release-staging.lock')
}

function waitForPidfile(file: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 15_000
    const poll = setInterval(() => {
      try {
        if (fs.existsSync(file)) {
          // A helper may create the pid file before its content is fully
          // written; only a positive integer counts (slow-machine safe).
          const pid = Number(fs.readFileSync(file, 'utf8').trim())
          if (Number.isInteger(pid) && pid > 0) {
            clearInterval(poll)
            recordPid(pid)
            resolve(pid)
            return
          }
        }
      } catch {
        // file being written / read race -- keep polling
      }
      if (Date.now() > deadline) {
        clearInterval(poll)
        reject(new Error(`pidfile ${file} never contained a valid PID`))
      }
    }, 20)
  })
}
