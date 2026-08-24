// M34: child-state invariant safety, bounded signal termination, formal
// MANUAL audit acknowledgement, nonce-qualified sidecar race safety and
// truthful evidence counting.
//
// Contract under test (M34 WP-A/WP-B/WP-C/WP-F):
//   T1. QUIESCENCE_PROVEN + live/non-null PGID      -> validator + recover refuse
//   T2. EMPTY + live/non-null PID fields            -> refuse (impossible state)
//   T3. ACTIVE null/mismatched/impossible fields    -> refuse
//   T4. sidecar symlink/FIFO/directory/oversize     -> read/recover refuse
//   T5. nonce-qualified sidecar: an old recovery's cleanup never touches a
//       new acquisition's sidecar
//   T6. MANUAL: normal recover refuses; wrong nonce/PGID/live group refuse;
//       exact acknowledgement after group ESRCH succeeds
//   T7. helper ignoring TERM/INT: user signal starts the bounded controlled
//       termination (escalation + deadline) -- the CLI NEVER waits out the
//       helper's own 60s timeout
//   T8. evidence collector counts binary changed files (WP-F #1)
//
// Cleanup contract: every test force-cleans the process tree it created in a
// finally block; the file-level afterAll re-checks (0 orphans, 0 /tmp residue).

import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, describe, expect, it } from 'vitest'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MODULE_PATH = path.join(REPO_ROOT, 'scripts', 'prepare-release-assets.mjs')

const tempDirs: string[] = []
function makeTempDir(prefix = 'm34-gate-'): string {
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
function groupAlive(pgid: number): boolean {
  if (!Number.isInteger(pgid) || pgid <= 0) return false
  try {
    process.kill(-pgid, 0)
    return true
  } catch {
    return false
  }
}
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
      throw new Error(`M34 test left orphan processes: ${left.join(',')}`)
    }
  }
  // zero /tmp residue for this file's prefix
  const residue = fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('m34-gate-'))
  if (residue.length > 0) {
    throw new Error(`M34 test left /tmp residue: ${residue.join(',')}`)
  }
})

/** PID of a process that has exited (ESRCH now). */
function deadPid(): Promise<number> {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' })
    p.on('close', () => resolve(p.pid as number))
  })
}

/** Start a detached (setsid) long-running helper; returns { pidfile, pgid } once ready. */
async function spawnDetachedHelper(
  dir: string,
  ignoreSignals = true,
): Promise<{ pidfile: string; pid: number }> {
  const pidfile = path.join(dir, 'helper.pid')
  const helper = path.join(dir, 'helper.py')
  const lines = ['import os, time']
  if (ignoreSignals) {
    lines.push(
      'import signal',
      'signal.signal(signal.SIGTERM, signal.SIG_IGN)',
      'signal.signal(signal.SIGINT, signal.SIG_IGN)',
    )
  }
  lines.push(
    `with open(${JSON.stringify(pidfile)}, 'w') as f: f.write(str(os.getpid()))`,
    'time.sleep(60)',
  )
  fs.writeFileSync(helper, lines.join('\n'))
  const child = spawn('python3', [helper], { detached: true, stdio: 'ignore' })
  child.unref()
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (fs.existsSync(pidfile)) {
      const pid = Number(fs.readFileSync(pidfile, 'utf8').trim())
      if (Number.isInteger(pid) && pid > 0) {
        recordPid(pid)
        return { pidfile, pid }
      }
    }
    await sleep(20)
  }
  throw new Error('helper pidfile timeout')
}

function sidecarName(nonce: string): string {
  return `.release-staging.child-state-${nonce}.json`
}

/** Write a schema-v3 lock + nonce-qualified sidecar. */
function writeLock(
  dir: string,
  ownerPid: number,
  nonce: string,
  childState: Record<string, unknown>,
): void {
  const repoRealpath = fs.realpathSync(dir)
  const lock = {
    schemaVersion: 3,
    pid: ownerPid,
    startedAt: new Date().toISOString(),
    nonce,
    repoRealpath,
    childStateFile: sidecarName(nonce),
    childState,
  }
  fs.writeFileSync(path.join(dir, '.release-staging.lock'), JSON.stringify(lock) + '\n')
  fs.writeFileSync(path.join(dir, sidecarName(nonce)), JSON.stringify(childState) + '\n')
}

function baseChildState(nonce: string, dir: string, state: string): Record<string, unknown> {
  return {
    schemaVersion: 2,
    nonce,
    repoRealpath: fs.realpathSync(dir),
    state,
    pgid: null,
    helperPid: null,
    updatedAt: new Date().toISOString(),
  }
}

const CSP_HTML =
  '<!DOCTYPE html><html><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'"><link rel="stylesheet" href="assets/app.css"><script src="assets/app.js"></script></html>'

describe('M34 WP-A child-state invariants and recovery safety', () => {
  it('T1: QUIESCENCE_PROVEN with a live pgid/helperPid is impossible -- validator and recover refuse', async () => {
    const mod = await import(MODULE_PATH)
    const tmp = makeTempDir()
    const nonce = randomUUID()
    const ownerPid = await deadPid()
    const { pid, pidfile } = await spawnDetachedHelper(tmp)
    void pidfile
    const cs = { ...baseChildState(nonce, tmp, 'QUIESCENCE_PROVEN'), pgid: pid, helperPid: pid }
    writeLock(tmp, ownerPid, nonce, cs)
    try {
      const v = mod.validateChildState(cs, nonce, fs.realpathSync(tmp))
      expect(
        v.ok,
        `validator must reject impossible QUIESCENCE_PROVEN: ${'reason' in v ? v.reason : ''}`,
      ).toBe(false)
      const r = mod.recoverLock(tmp)
      expect(r.recovered, `recover must refuse while the group lives: ${r.reason}`).toBe(false)
      expect(fs.existsSync(path.join(tmp, '.release-staging.lock'))).toBe(true)
    } finally {
      await forceCleanTree([pid])
    }
  })

  it('T2: EMPTY with non-null PID fields is impossible -- refuse', async () => {
    const mod = await import(MODULE_PATH)
    const tmp = makeTempDir()
    const nonce = randomUUID()
    const ownerPid = await deadPid()
    const { pid } = await spawnDetachedHelper(tmp)
    const cs = { ...baseChildState(nonce, tmp, 'EMPTY'), pgid: pid, helperPid: pid }
    writeLock(tmp, ownerPid, nonce, cs)
    try {
      const v = mod.validateChildState(cs, nonce, fs.realpathSync(tmp))
      expect(v.ok).toBe(false)
      const r = mod.recoverLock(tmp)
      expect(r.recovered).toBe(false)
      expect(fs.existsSync(path.join(tmp, '.release-staging.lock'))).toBe(true)
    } finally {
      await forceCleanTree([pid])
    }
  })

  it('T3: ACTIVE null/mismatched/impossible fields -- refuse', async () => {
    const mod = await import(MODULE_PATH)
    const tmp = makeTempDir()
    const nonce = randomUUID()
    const ownerPid = await deadPid()
    const { pid } = await spawnDetachedHelper(tmp)
    // null pgid
    const cs1 = { ...baseChildState(nonce, tmp, 'ACTIVE'), pgid: null, helperPid: pid }
    writeLock(tmp, ownerPid, nonce, cs1)
    try {
      expect(mod.validateChildState(cs1, nonce, fs.realpathSync(tmp)).ok).toBe(false)
      expect(mod.recoverLock(tmp).recovered).toBe(false)
    } finally {
      await forceCleanTree([pid])
    }
    // pgid !== helperPid (mismatch)
    const other = await deadPid()
    const cs2 = { ...baseChildState(nonce, tmp, 'ACTIVE'), pgid: pid, helperPid: other }
    writeLock(tmp, ownerPid, nonce, cs2)
    try {
      const v = mod.validateChildState(cs2, nonce, fs.realpathSync(tmp))
      expect(v.ok, `mismatched ACTIVE must be rejected`).toBe(false)
      expect(mod.recoverLock(tmp).recovered).toBe(false)
    } finally {
      await forceCleanTree([pid])
    }
    // extra dangerous field
    const cs3 = {
      ...baseChildState(nonce, tmp, 'ACTIVE'),
      pgid: pid,
      helperPid: pid,
      command: 'rm -rf /',
    }
    writeLock(tmp, ownerPid, nonce, cs3)
    try {
      const v = mod.validateChildState(cs3, nonce, fs.realpathSync(tmp))
      expect(v.ok, `extra field must be rejected`).toBe(false)
      expect(mod.recoverLock(tmp).recovered).toBe(false)
    } finally {
      await forceCleanTree([pid])
    }
    // invalid timestamp
    const cs4 = {
      ...baseChildState(nonce, tmp, 'ACTIVE'),
      pgid: pid,
      helperPid: pid,
      updatedAt: 'not-a-date',
    }
    writeLock(tmp, ownerPid, nonce, cs4)
    try {
      expect(mod.validateChildState(cs4, nonce, fs.realpathSync(tmp)).ok).toBe(false)
      expect(mod.recoverLock(tmp).recovered).toBe(false)
    } finally {
      await forceCleanTree([pid])
    }
  })

  it('T4: sidecar symlink / FIFO / directory / oversized -- recovery refuses or is bounded', async () => {
    const mod = await import(MODULE_PATH)
    const tmp = makeTempDir()
    const nonce = randomUUID()
    const ownerPid = await deadPid()
    const { pid } = await spawnDetachedHelper(tmp)
    // clean up the helper up front -- these cases must refuse on SHAPE alone
    await forceCleanTree([pid])
    const cs = baseChildState(nonce, tmp, 'EMPTY')

    // symlink sidecar (followed in M33 -- P2-1a) must refuse
    fs.writeFileSync(
      path.join(tmp, '.release-staging.lock'),
      JSON.stringify({
        schemaVersion: 3,
        pid: ownerPid,
        startedAt: new Date().toISOString(),
        nonce,
        repoRealpath: fs.realpathSync(tmp),
        childStateFile: sidecarName(nonce),
        childState: cs,
      }) + '\n',
    )
    fs.symlinkSync(path.join(tmp, 'real-target.json'), path.join(tmp, sidecarName(nonce)))
    fs.writeFileSync(path.join(tmp, 'real-target.json'), JSON.stringify(cs) + '\n')
    const symlinkRes = mod.recoverLock(tmp)
    expect(symlinkRes.recovered, `symlink sidecar must be refused: ${symlinkRes.reason}`).toBe(
      false,
    )
    fs.unlinkSync(path.join(tmp, 'real-target.json'))
    fs.unlinkSync(path.join(tmp, '.release-staging.lock'))

    // directory sidecar
    fs.unlinkSync(path.join(tmp, sidecarName(nonce))) // remove the refused symlink first
    fs.writeFileSync(
      path.join(tmp, '.release-staging.lock'),
      JSON.stringify({
        schemaVersion: 3,
        pid: ownerPid,
        startedAt: new Date().toISOString(),
        nonce,
        repoRealpath: fs.realpathSync(tmp),
        childStateFile: sidecarName(nonce),
        childState: cs,
      }) + '\n',
    )
    fs.mkdirSync(path.join(tmp, sidecarName(nonce)))
    const dirRes = mod.recoverLock(tmp)
    expect(dirRes.recovered, `directory sidecar must be refused`).toBe(false)
    fs.rmdirSync(path.join(tmp, sidecarName(nonce)))
    fs.unlinkSync(path.join(tmp, '.release-staging.lock'))

    // oversized sidecar (> CHILD_STATE_MAX_BYTES)
    fs.writeFileSync(
      path.join(tmp, '.release-staging.lock'),
      JSON.stringify({
        schemaVersion: 3,
        pid: ownerPid,
        startedAt: new Date().toISOString(),
        nonce,
        repoRealpath: fs.realpathSync(tmp),
        childStateFile: sidecarName(nonce),
        childState: cs,
      }) + '\n',
    )
    fs.writeFileSync(path.join(tmp, sidecarName(nonce)), 'A'.repeat(70 * 1024) + '\n')
    const bigRes = mod.recoverLock(tmp)
    expect(bigRes.recovered, `oversized sidecar must be refused`).toBe(false)
    fs.unlinkSync(path.join(tmp, '.release-staging.lock'))

    // FIFO sidecar must NOT hang recovery -- bounded via a child process
    fs.writeFileSync(
      path.join(tmp, '.release-staging.lock'),
      JSON.stringify({
        schemaVersion: 3,
        pid: ownerPid,
        startedAt: new Date().toISOString(),
        nonce,
        repoRealpath: fs.realpathSync(tmp),
        childStateFile: sidecarName(nonce),
        childState: cs,
      }) + '\n',
    )
    spawnSync('mkfifo', [path.join(tmp, sidecarName(nonce))])
    const fifoChild = spawn(
      process.execPath,
      [
        '-e',
        `import('${'file://' + MODULE_PATH}').then(async (m) => { await m.recoverLock(${JSON.stringify(tmp)}) })`,
      ],
      { stdio: 'ignore' },
    )
    recordPid(fifoChild.pid ?? -1)
    const fifoHangs = await new Promise<boolean>((resolve) => {
      const t = setTimeout(() => resolve(true), 3000)
      fifoChild.on('close', () => {
        clearTimeout(t)
        resolve(false)
      })
    })
    if (fifoHangs) fifoChild.kill('SIGKILL')
    expect(fifoHangs, 'FIFO sidecar must not block recovery (read path must be hardened)').toBe(
      false,
    )
  })

  it('T5: nonce-qualified sidecar -- an old recovery cleanup never touches a new acquisition', async () => {
    const mod = await import(MODULE_PATH)
    const tmp = makeTempDir()
    // old acquisition (dead owner, EMPTY) recovered normally
    const nonceA = randomUUID()
    const ownerA = await deadPid()
    writeLock(tmp, ownerA, nonceA, baseChildState(nonceA, tmp, 'EMPTY'))
    const recovered = mod.recoverLock(tmp)
    expect(recovered.recovered).toBe(true)
    // a NEW acquisition writes its OWN nonce-qualified sidecar
    const newLock = mod.acquireLock(tmp)
    const newNonce = newLock.nonce
    const newSidecar = path.join(tmp, sidecarName(newNonce))
    expect(fs.existsSync(newSidecar)).toBe(true)
    expect(fs.existsSync(path.join(tmp, sidecarName(nonceA)))).toBe(false)
    // simulate the OLD recovery's stale cleanup (fixed-name in M33): it can
    // only ever address nonceA's basename -- the new sidecar must survive
    try {
      fs.unlinkSync(path.join(tmp, sidecarName(nonceA)))
    } catch {
      // already gone
    }
    expect(fs.existsSync(newSidecar), 'new acquisition sidecar must survive old cleanup').toBe(true)
    expect(JSON.parse(fs.readFileSync(newSidecar, 'utf8')).nonce).toBe(newNonce)
    // cleanup
    newLock.childState.cleanup()
    try {
      fs.unlinkSync(path.join(tmp, '.release-staging.lock'))
    } catch {
      /* best effort */
    }
  })

  it('T6: MANUAL -- normal recover refuses; wrong nonce/PGID/live group refuse; exact acknowledgement after ESRCH succeeds', async () => {
    const mod = await import(MODULE_PATH)
    const tmp = makeTempDir()
    const nonce = randomUUID()
    const ownerPid = await deadPid()
    const { pid } = await spawnDetachedHelper(tmp)
    const cs = {
      ...baseChildState(nonce, tmp, 'MANUAL_AUDIT_REQUIRED'),
      lastKnownPgid: pid,
      lastKnownHelperPid: pid,
      auditReason: 'm34-test',
    }
    writeLock(tmp, ownerPid, nonce, cs)
    try {
      // normal --recover-lock refuses MANUAL
      const recover = mod.recoverLock(tmp)
      expect(recover.recovered).toBe(false)
      expect(String(recover.reason)).toMatch(/audit/i)
      // wrong nonce
      const wrongNonce = mod.auditLockAcknowledgement(tmp, {
        nonce: randomUUID(),
        lastKnownPgid: pid,
      })
      expect(wrongNonce.acknowledged).toBe(false)
      // wrong PGID
      const wrongPgid = mod.auditLockAcknowledgement(tmp, { nonce, lastKnownPgid: pid + 1 })
      expect(wrongPgid.acknowledged).toBe(false)
      // live group
      const live = mod.auditLockAcknowledgement(tmp, { nonce, lastKnownPgid: pid })
      expect(live.acknowledged).toBe(false)
      expect(fs.existsSync(path.join(tmp, '.release-staging.lock'))).toBe(true)
      // clean the group externally, then acknowledge
      await forceCleanTree([pid])
      expect(groupAlive(pid)).toBe(false)
      const ok = mod.auditLockAcknowledgement(tmp, { nonce, lastKnownPgid: pid })
      expect(ok.acknowledged, `exact acknowledgement: ${ok.reason}`).toBe(true)
      expect(fs.existsSync(path.join(tmp, '.release-staging.lock'))).toBe(false)
      expect(fs.existsSync(path.join(tmp, sidecarName(nonce)))).toBe(false)
    } finally {
      await forceCleanTree([pid])
      try {
        fs.unlinkSync(path.join(tmp, '.release-staging.lock'))
      } catch {
        /* best effort */
      }
    }
  })

  it('T7: helper ignoring TERM/INT -- user signal starts bounded termination; CLI never waits out the helper timeout', async () => {
    for (const scenario of [
      { signal: 'SIGTERM', expected: 143 },
      { signal: 'SIGINT', expected: 130 },
    ]) {
      const tmp = makeTempDir()
      fs.mkdirSync(path.join(tmp, 'dist', 'assets'), { recursive: true })
      fs.writeFileSync(path.join(tmp, 'dist', 'index.html'), CSP_HTML)
      fs.writeFileSync(path.join(tmp, 'dist', 'assets', 'app.js'), 'console.log("x")')
      fs.writeFileSync(path.join(tmp, 'dist', 'assets', 'app.css'), 'body{}')
      fs.writeFileSync(
        path.join(tmp, 'package.json'),
        JSON.stringify({ name: 't', version: '1.1.5', private: true }),
      )
      const helperPidfile = path.join(tmp, 'helper.pid')
      const shim = path.join(tmp, 'slow-python3')
      // helper ignores BOTH signals; the execFileAsync deadline is 10s, the
      // shim would sleep 15s -- a bounded termination must end the CLI first.
      fs.writeFileSync(
        shim,
        '#!/bin/sh\necho $$ > "' +
          helperPidfile +
          '"\ntrap "" TERM INT\nsleep 15\nexec /usr/bin/env python3 "$@"\n',
      )
      fs.chmodSync(shim, 0o755)
      const childScript = path.join(tmp, 'child.mjs')
      fs.writeFileSync(
        childScript,
        'const mod = await import(' +
          JSON.stringify('file://' + MODULE_PATH) +
          ');\n' +
          'const rc = await mod.runCli(["node", "prepare-release-assets.mjs"], {\n' +
          '  repoRoot: ' +
          JSON.stringify(tmp) +
          ',\n' +
          '  env: { ...process.env, PYTHON3: ' +
          JSON.stringify(shim) +
          ' },\n' +
          '  stdout: { write: (s) => process.stdout.write(String(s)) },\n' +
          '  stderr: { write: (s) => process.stderr.write(String(s)) },\n' +
          '});\n' +
          'process.exit(rc);\n',
      )
      const child = spawn(process.execPath, [childScript], {
        cwd: tmp,
        env: { ...process.env, PYTHON3: shim },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      recordPid(child.pid ?? -1)
      let err = ''
      let out = ''
      child.stderr.on('data', (d) => (err += String(d)))
      child.stdout.on('data', (d) => (out += String(d)))
      const lockPath = path.join(tmp, '.release-staging.lock')
      // deterministic handshake: lock + pidfile + ACTIVE sidecar
      let helperPid = -1
      const deadline = Date.now() + 20_000
      while (Date.now() < deadline) {
        let state = ''
        let nonce = ''
        try {
          const lockRaw = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
          nonce = lockRaw.nonce
          state = JSON.parse(fs.readFileSync(path.join(tmp, sidecarName(nonce)), 'utf8')).state
        } catch {
          // lock/sidecar not yet durable -- keep polling
        }
        if (fs.existsSync(lockPath) && fs.existsSync(helperPidfile) && state === 'ACTIVE') {
          helperPid = Number(fs.readFileSync(helperPidfile, 'utf8').trim())
          recordPid(helperPid)
          break
        }
        await sleep(20)
      }
      expect(helperPid, 'handshake must reach ACTIVE').toBeGreaterThan(0)
      const sentAt = Date.now()
      child.kill(scenario.signal as NodeJS.Signals)
      const code = await new Promise<number | null>((resolve) =>
        child.on('close', (c) => resolve(c)),
      )
      const elapsed = Date.now() - sentAt
      try {
        // bounded exit: well under the 15s shim sleep / 60s helper timeout
        expect(elapsed, `bounded exit for ${scenario.signal} (took ${elapsed}ms)`).toBeLessThan(
          12_000,
        )
        expect(code).toBe(scenario.expected)
        expect(out).not.toMatch(/Done:/)
        // the controlled termination must have ESCALATED or failed closed:
        // either SIGKILL in stderr, or a MANUAL_AUDIT_REQUIRED sidecar
        const escalated = /SIGKILL|terminated by signal/.test(err)
        let sidecarState = ''
        try {
          const lockRaw = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
          sidecarState = JSON.parse(
            fs.readFileSync(path.join(tmp, sidecarName(lockRaw.nonce)), 'utf8'),
          ).state
        } catch {
          // sidecar not readable at close -- treat as unobservable
        }
        expect(
          escalated ||
            sidecarState === 'MANUAL_AUDIT_REQUIRED' ||
            sidecarState === 'QUIESCENCE_PROVEN',
        ).toBe(true)
      } finally {
        if (helperPid > 0) {
          try {
            process.kill(-helperPid, 'SIGKILL')
          } catch {
            // group already gone
          }
        }
        await forceCleanTree([helperPid, child.pid ?? -1])
      }
    }
  })

  it('T8: evidence collector counts binary changed files (WP-F #1)', async () => {
    // run the real collector against a fixture repo with a binary diff
    const dir = makeTempDir('m34-evidence-')
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 't', version: '1.1.5', private: true }),
    )
    spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: dir })
    spawnSync('git', ['config', 'user.email', 'a@b.c'], { cwd: dir })
    spawnSync('git', ['config', 'user.name', 't'], { cwd: dir })
    fs.writeFileSync(path.join(dir, 'a.txt'), 'hello\n')
    fs.writeFileSync(path.join(dir, 'b.bin'), Buffer.from([0, 1, 2, 3]))
    spawnSync('git', ['add', '.'], { cwd: dir })
    spawnSync('git', ['commit', '-qm', 'base'], { cwd: dir })
    fs.writeFileSync(path.join(dir, 'a.txt'), 'hello2\n')
    fs.writeFileSync(path.join(dir, 'b.bin'), Buffer.from([9, 9, 9, 9, 9]))
    fs.writeFileSync(path.join(dir, 'c.txt'), 'new\n')
    spawnSync('git', ['add', '.'], { cwd: dir })
    spawnSync('git', ['commit', '-qm', 'change'], { cwd: dir })
    const res = spawnSync(
      process.execPath,
      [
        path.join(REPO_ROOT, 'scripts', 'collect-verification-evidence.mjs'),
        '--repo',
        dir,
        '--base',
        'HEAD~1',
        '--json',
      ],
      { cwd: REPO_ROOT, encoding: 'utf8', timeout: 20_000 },
    )
    expect(res.status).toBe(0)
    const evidence = JSON.parse(String(res.stdout))
    expect(evidence.changed.files).toBe(3) // a.txt + b.bin (binary!) + c.txt
    expect(evidence.changed.fileList).toContain('b.bin')
    const binaryEntry = evidence.changed.fileEntries.find(
      (e: { file: string }) => e.file === 'b.bin',
    )
    expect(binaryEntry.binary).toBe(true)
  })
})
