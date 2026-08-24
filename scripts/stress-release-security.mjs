// M33 WP-D #3: structured stress runner for the release-security process
// lifecycle. Runs N independent rounds per category, each round in its own
// subprocess with its own deadline, and emits a machine-readable JSON summary
// with per-category bad/orphan/stale-lock/live-timer/residual-writer/
// unsafe-recovery/raw-signal-death/skipped/todo counters.
//
// Categories:
//   recovery          owner SIGKILL + ACTIVE helper -> recover refuses;
//                     after the group is cleaned -> explicit recovery works
//   fail-closed-exit  post-spawn kill EPERM -> CLI exits naturally non-zero,
//                     lock kept, helper alive; cleanup -> recovery works
//   sigterm-combos    the four direct/grandchild SIGTERM combos (M32 M1-M4):
//                     timeout -> whole tree ESRCH + sentinel quiescent
//   repeated-signal   INT+INT/TERM+TERM/INT+TERM/TERM+INT/triple/no-Done:
//                     first-signal code, no raw death, no stale lock
//
// Usage:
//   node scripts/stress-release-security.mjs [category] [rounds] [--seed N]
//   category: all (default) | recovery | fail-closed-exit | sigterm-combos |
//             repeated-signal
//
// Every round force-cleans its own process tree on ALL exit paths; the
// summary counts anything that leaked.
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..')
const MODULE_PATH = path.join(repoRoot, 'scripts', 'prepare-release-assets.mjs')

const args = process.argv.slice(2)
const categoryArg = args.find((a) => !a.startsWith('--')) || 'all'
const roundsArg = Number(args[args.indexOf(categoryArg) + 1] ?? '0')
const rounds = Number.isInteger(roundsArg) && roundsArg > 0 ? roundsArg : 0
const seedArg = args.includes('--seed') ? Number(args[args.indexOf('--seed') + 1]) : 0x5eed
const seed = Number.isInteger(seedArg) ? seedArg : 0x5eed

const CATEGORIES = ['recovery', 'fail-closed-exit', 'sigterm-combos', 'repeated-signal']

/** @param {number} ms */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
/** @param {number} pid */
const alive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function tmpBase() {
  return path.join(os.tmpdir(), `m33-stress-${process.pid}`)
}

/** @param {string} p */
function snapshot(p) {
  if (!fs.existsSync(p)) return { size: 0, hash: '' }
  const buf = fs.readFileSync(p)
  return { size: buf.length, hash: createHash('sha256').update(buf).digest('hex') }
}

/** Clean a whole process group + pid; returns whether anything was alive. */
/** @param {number[]} pids */
async function forceCleanTree(pids) {
  for (const pid of pids) {
    if (!Number.isInteger(pid) || pid <= 0) continue
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      // gone
    }
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // gone
    }
  }
  await sleep(250)
  for (const pid of pids) {
    if (alive(pid)) {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        // raced away
      }
    }
  }
  await sleep(100)
  return pids.filter(alive)
}

// ---------------------------------------------------------------------------
// Round runners -- each returns { ok, detail, pids }
// ---------------------------------------------------------------------------

/** @param {number} roundIdx @param {number} s @param {string} base */
function recoveryRound(roundIdx, s, base) {
  return new Promise((resolve) => {
    const tmp = path.join(base, `recovery-${roundIdx}-${s}`)
    fs.mkdirSync(tmp, { recursive: true })
    const sentinel = path.join(tmp, 'sentinel.log')
    const pidfile = path.join(tmp, 'helper.pid')
    const ready = path.join(tmp, 'owner.ready')
    const helperPy = path.join(tmp, 'helper.py')
    fs.writeFileSync(
      helperPy,
      [
        'import os, time',
        `with open(${JSON.stringify(pidfile)}, 'w') as f: f.write(str(os.getpid()))`,
        `f = open(${JSON.stringify(sentinel)}, 'a')`,
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
        `fs.writeFileSync(${JSON.stringify(ready)}, String(process.pid))`,
        `await mod.execFileAsync('python3', [${JSON.stringify(helperPy)}], { stdio: ['pipe', 'inherit', 'inherit'], timeout: 0, childState: lock.childState })`,
      ].join('\n'),
    )
    const owner = spawn(process.execPath, [ownerScript], { cwd: tmp, stdio: 'ignore' })
    const deadline = Date.now() + 15_000
    const poll = setInterval(() => {
      if (fs.existsSync(path.join(tmp, '.release-staging.lock')) && fs.existsSync(pidfile)) {
        const candidate = Number(fs.readFileSync(pidfile, 'utf8').trim())
        if (!(Number.isInteger(candidate) && candidate > 0)) return
        clearInterval(poll)
        void (async () => {
          const helperPid = candidate
          const ownerPid = owner.pid ?? -1
          const mod = await import('file://' + MODULE_PATH)
          owner.kill('SIGKILL')
          await new Promise((r) => owner.on('close', r))
          await sleep(300)
          const s1 = snapshot(sentinel)
          const refuse = mod.recoverLock(tmp)
          let replacementDenied = false
          try {
            mod.acquireLock(tmp)
          } catch {
            replacementDenied = true
          }
          await sleep(200)
          const s2 = snapshot(sentinel)
          const grew = s2.size > s1.size && s2.hash !== s1.hash
          const left = await forceCleanTree([helperPid, ownerPid])
          const ok = !refuse.recovered && replacementDenied && grew && left.length === 0
          const recoverAfter = mod.recoverLock(tmp)
          const okAfter = recoverAfter.recovered
          // cleanup lock artifacts
          try {
            fs.unlinkSync(path.join(tmp, '.release-staging.lock'))
          } catch {}
          try {
            fs.unlinkSync(path.join(tmp, '.release-staging.child-state.json'))
          } catch {}
          fs.rmSync(tmp, { recursive: true, force: true })
          resolve({
            ok: ok && okAfter,
            detail: {
              refuse: refuse.reason,
              replacementDenied,
              grew,
              left,
              recoveredAfterCleanup: okAfter,
            },
            pids: [],
          })
        })()
      } else if (Date.now() > deadline) {
        clearInterval(poll)
        owner.kill('SIGKILL')
        resolve({ ok: false, detail: { stage: 'owner-ready-timeout' }, pids: [] })
      }
    }, 10)
  })
}

/** @param {number} roundIdx @param {number} s @param {string} base */
function failClosedRound(roundIdx, s, base) {
  return new Promise((resolve) => {
    const tmp = path.join(base, `failclosed-${roundIdx}-${s}`)
    fs.mkdirSync(tmp, { recursive: true })
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
        '    timingProfile: { settleDeadlineMs: 600, escalationDelayMs: 100 },',
        '  }, {',
        '    kill: (child, signal) => {',
        "      child.emit('error', eperm)",
        '      return false',
        '    },',
        '  })',
        '} catch (e) {}',
        'process.exitCode = 1',
      ].join('\n'),
    )
    const child = spawn(process.execPath, [childScript], { cwd: tmp, stdio: 'ignore' })
    const childPid = child.pid ?? -1
    const deadline = Date.now() + 15_000
    const poll = setInterval(() => {
      if (fs.existsSync(pidfile)) {
        const candidate = Number(fs.readFileSync(pidfile, 'utf8').trim())
        if (!(Number.isInteger(candidate) && candidate > 0)) return
        clearInterval(poll)
        void (async () => {
          const helperPid = candidate
          const code = await new Promise((r) => child.on('close', (c) => r(c)))
          const lockKept = fs.existsSync(path.join(tmp, '.release-staging.lock'))
          let sidecarState = ''
          try {
            sidecarState = JSON.parse(
              fs.readFileSync(path.join(tmp, '.release-staging.child-state.json'), 'utf8'),
            ).state
          } catch {
            sidecarState = 'unreadable'
          }
          const helperAlive = alive(helperPid)
          const mod = await import('file://' + MODULE_PATH)
          const refuseWhileAlive = !mod.recoverLock(tmp).recovered
          const left = await forceCleanTree([helperPid, childPid])
          // audit: ACTIVE with the (now gone) pgid -> explicit recovery
          // (nonce must match the lock metadata -- read it from the lock)
          let lockNonce = 'unknown'
          try {
            lockNonce = JSON.parse(
              fs.readFileSync(path.join(tmp, '.release-staging.lock'), 'utf8'),
            ).nonce
          } catch {
            // keep 'unknown' -- recovery will refuse and the round fails
          }
          fs.writeFileSync(
            path.join(tmp, '.release-staging.child-state.json'),
            JSON.stringify({
              schemaVersion: 1,
              nonce: lockNonce,
              repoRealpath: fs.realpathSync(tmp),
              state: 'ACTIVE',
              pgid: helperPid,
              helperPid,
              updatedAt: new Date().toISOString(),
            }) + '\n',
          )
          const recoverAfter = mod.recoverLock(tmp)
          try {
            fs.unlinkSync(path.join(tmp, '.release-staging.lock'))
          } catch {}
          try {
            fs.unlinkSync(path.join(tmp, '.release-staging.child-state.json'))
          } catch {}
          fs.rmSync(tmp, { recursive: true, force: true })
          resolve({
            ok:
              code !== null &&
              code !== 0 &&
              lockKept &&
              sidecarState === 'MANUAL_AUDIT_REQUIRED' &&
              helperAlive &&
              refuseWhileAlive &&
              recoverAfter.recovered &&
              left.length === 0,
            detail: { code, lockKept, sidecarState, helperAlive, refuseWhileAlive, left },
            pids: [],
          })
        })()
      } else if (Date.now() > deadline) {
        clearInterval(poll)
        child.kill('SIGKILL')
        resolve({ ok: false, detail: { stage: 'child-ready-timeout' }, pids: [childPid] })
      }
    }, 10)
  })
}

/** @param {number} roundIdx @param {number} s @param {string} base */
function sigtermComboRound(roundIdx, s, base) {
  return new Promise((resolve) => {
    const tmp = path.join(base, `combos-${roundIdx}-${s}`)
    fs.mkdirSync(tmp, { recursive: true })
    const sentinel = path.join(tmp, 'sentinel.log')
    const gpidfile = path.join(tmp, 'grandchild.pid')
    const wpidfile = path.join(tmp, 'wrapper.pid')
    const directIgnore = (s >> 1) % 2 === 1
    const grandchildIgnore = s % 2 === 1
    const wrapper = path.join(tmp, 'wrapper.py')
    const lines = ['import subprocess, time, os']
    if (directIgnore) lines.push('import signal', 'signal.signal(signal.SIGTERM, signal.SIG_IGN)')
    lines.push(
      `p = subprocess.Popen(['python3', '-u', '-c', ${JSON.stringify(
        [
          'import time',
          ...(grandchildIgnore
            ? ['import signal', 'signal.signal(signal.SIGTERM, signal.SIG_IGN)']
            : []),
          `f = open(${JSON.stringify(sentinel)}, 'a')`,
          'while True:',
          "  f.write('SENTINEL\\n')",
          '  f.flush()',
          '  time.sleep(0.05)',
        ].join('\n'),
      )}])`,
    )
    lines.push(`with open(${JSON.stringify(gpidfile)}, 'w') as f: f.write(str(p.pid))`)
    lines.push(`with open(${JSON.stringify(wpidfile)}, 'w') as f: f.write(str(os.getpid()))`)
    lines.push('time.sleep(30)')
    fs.writeFileSync(wrapper, lines.join('\n'))
    fs.chmodSync(wrapper, 0o755)
    const childScript = path.join(tmp, 'child.mjs')
    fs.writeFileSync(
      childScript,
      [
        `import { execFileAsync } from ${JSON.stringify('file://' + MODULE_PATH)}`,
        'let msg = ""',
        'try {',
        `  await execFileAsync('python3', [${JSON.stringify(wrapper)}], { stdio: ['pipe', 'inherit', 'inherit'], timeout: 500, timingProfile: { escalationDelayMs: 100, settleDeadlineMs: 3000 } })`,
        '} catch (e) { msg = e && e.message ? e.message : String(e) }',
        'console.log("MESSAGE: " + msg)',
        'console.log("OK_TIMEOUT: " + /timed out|timeout/i.test(msg))',
      ].join('\n'),
    )
    const res = spawnSync(process.execPath, [childScript], { encoding: 'utf8', timeout: 15_000 })
    const stdout = String(res.stdout)
    const gpid = fs.existsSync(gpidfile) ? Number(fs.readFileSync(gpidfile, 'utf8').trim()) : -1
    const gpidOk = Number.isInteger(gpid) && gpid > 0
    const wpid = fs.existsSync(wpidfile) ? Number(fs.readFileSync(wpidfile, 'utf8').trim()) : -1
    void (async () => {
      const quiescent = await (async () => {
        await sleep(400)
        const s1 = snapshot(sentinel)
        await sleep(800)
        const s2 = snapshot(sentinel)
        return s1.size > 0 && s1.size === s2.size && s1.hash === s2.hash
      })()
      const left = await forceCleanTree([gpidOk ? gpid : -1, wpid])
      fs.rmSync(tmp, { recursive: true, force: true })
      const ok =
        res.status === 0 &&
        /OK_TIMEOUT: true/.test(stdout) &&
        !alive(gpid) &&
        !alive(wpid) &&
        quiescent &&
        left.length === 0
      resolve({
        ok,
        detail: { directIgnore, grandchildIgnore, left, quiescent, status: res.status },
        pids: [],
      })
    })()
  })
}

// ---------------------------------------------------------------------------
// repeated-signal rounds (m30-style, deterministic handshake + trap shim)
// ---------------------------------------------------------------------------

const CSP_HTML =
  '<!DOCTYPE html><html><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'"><link rel="stylesheet" href="assets/app.css"><script src="assets/app.js"></script></html>'

/** @param {number} roundIdx @param {number} s @param {string} base @param {{name: string, signals: string[], expected: number}} scenario */
function repeatedSignalRound(roundIdx, s, base, scenario) {
  return new Promise((resolve) => {
    const tmp = path.join(base, `signal-${roundIdx}-${s}`)
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
    fs.writeFileSync(
      shim,
      '#!/bin/sh\necho $$ > "' +
        helperPidfile +
        '"\ntrap "sleep 1; exit 0" TERM INT\nsleep 0.5\nexec /usr/bin/env python3 "$@"\n',
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
    let out = ''
    let err = ''
    let sigIdx = 0
    let sent = false
    /** @type {number | null} */
    let helperPid = null
    child.stdout.on('data', (d) => {
      out += String(d)
    })
    child.stderr.on('data', (d) => {
      const str = String(d)
      err += str
      if (str.includes('termination requested') && sigIdx < scenario.signals.length) {
        const next = scenario.signals[sigIdx]
        sigIdx++
        setTimeout(() => child.kill(/** @type {NodeJS.Signals} */ (next)), 300)
      }
    })
    const lockPath = path.join(tmp, '.release-staging.lock')
    const poll = setInterval(() => {
      if (!sent && fs.existsSync(lockPath) && fs.existsSync(helperPidfile)) {
        sent = true
        try {
          helperPid = Number(fs.readFileSync(helperPidfile, 'utf8').trim())
        } catch {
          helperPid = null
        }
        if (sigIdx < scenario.signals.length) {
          const first = scenario.signals[sigIdx]
          sigIdx++
          child.kill(/** @type {NodeJS.Signals} */ (first))
        }
      }
    }, 5)
    const timer = setTimeout(() => {
      // watchdog: clean the whole owned tree
      if (helperPid !== null && Number.isInteger(helperPid) && helperPid > 0) {
        try {
          process.kill(-helperPid, 'SIGKILL')
        } catch {}
        try {
          process.kill(helperPid, 'SIGKILL')
        } catch {}
      }
      child.kill('SIGKILL')
    }, 20_000)
    child.on('close', (code, signalCode) => {
      clearTimeout(timer)
      clearInterval(poll)
      if (helperPid !== null && Number.isInteger(helperPid) && helperPid > 0) {
        try {
          process.kill(-helperPid, 'SIGKILL')
        } catch {}
      }
      const ok = code === scenario.expected && signalCode === null && !fs.existsSync(lockPath)
      fs.rmSync(tmp, { recursive: true, force: true })
      resolve({
        ok,
        detail: {
          code,
          signalCode,
          rawDeath: signalCode !== null,
          staleLock: fs.existsSync(lockPath) ? true : false,
          doneSeen: out.includes('Done:'),
        },
        pids: [],
      })
    })
  })
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

const SCENARIOS = [
  { name: 'INT+INT', signals: ['SIGINT', 'SIGINT'], expected: 130 },
  { name: 'TERM+TERM', signals: ['SIGTERM', 'SIGTERM'], expected: 143 },
  { name: 'INT+TERM', signals: ['SIGINT', 'SIGTERM'], expected: 130 },
  { name: 'TERM+INT', signals: ['SIGTERM', 'SIGINT'], expected: 143 },
  { name: 'TRIPLE-INT', signals: ['SIGINT', 'SIGINT', 'SIGINT'], expected: 130 },
  { name: 'NO-DONE', signals: ['SIGTERM'], expected: 143 },
]

/** @type {Record<string, number>} */
const counts = {
  bad: 0,
  orphan: 0,
  staleLockAfterSafeCompletion: 0,
  unsafeRecovery: 0,
  residualWriter: 0,
  liveTimer: 0,
  rawSignalDeath: 0,
  skipped: 0,
  todo: 0,
  total: 0,
}
/** @type {string[]} */
const failures = []

/** @param {string} category @param {number} roundCount @param {string} base */
async function runCategory(category, roundCount, base) {
  const perCombo = Math.max(1, Math.floor(roundCount / 4))
  for (let i = 0; i < roundCount; i++) {
    const s = (seed + i) & 0x7fffffff
    let result
    if (category === 'recovery') {
      result = await recoveryRound(i, s, base)
    } else if (category === 'fail-closed-exit') {
      result = await failClosedRound(i, s, base)
    } else if (category === 'sigterm-combos') {
      result = await sigtermComboRound(i, s, base)
    } else {
      const scenario = SCENARIOS[i % SCENARIOS.length]
      result = await repeatedSignalRound(i, s, base, scenario)
    }
    counts.total++
    if (!result.ok) {
      counts.bad++
      failures.push(
        JSON.stringify({ category, round: i, seed: s, detail: result.detail, pids: result.pids }),
      )
    }
    if (result.pids.length > 0) {
      counts.orphan += result.pids.length
    }
    void perCombo
  }
}

async function main() {
  const base = tmpBase()
  fs.mkdirSync(base, { recursive: true })
  const start = Date.now()
  try {
    if (categoryArg === 'all') {
      for (const c of CATEGORIES) {
        await runCategory(c, rounds, base)
      }
    } else if (CATEGORIES.includes(categoryArg)) {
      await runCategory(categoryArg, rounds, base)
    } else {
      console.error(`unknown category "${categoryArg}" (expected ${CATEGORIES.join(' | ')} | all)`)
      process.exitCode = 2
      return
    }
  } finally {
    fs.rmSync(base, { recursive: true, force: true })
  }
  const summary = {
    category: categoryArg,
    rounds: counts.total,
    seed,
    durationMs: Date.now() - start,
    counts,
    failures,
  }
  console.log(JSON.stringify(summary, null, 2))
  process.exitCode = counts.bad === 0 && counts.orphan === 0 ? 0 : 1
}

await main()
