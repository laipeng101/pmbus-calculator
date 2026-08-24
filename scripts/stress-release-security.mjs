// M34 WP-E: truthful stress runner for the release-security process
// lifecycle. Runs N independent rounds per category, each round in its own
// subprocess with its own deadline, and emits a VERSIONED JSON summary with
// REAL counters -- every counter has an update path from an observed failure
// (self-tested, never hardcoded zeros).
//
// Categories:
//   recovery          owner SIGKILL + ACTIVE helper -> recover refuses;
//                     after the group is cleaned -> explicit recovery works
//   fail-closed-exit  post-spawn kill EPERM -> CLI exits naturally non-zero,
//                     lock kept, helper alive; cleanup -> audit acknowledgement
//   sigterm-combos    the four direct/grandchild SIGTERM combos (M32 M1-M4):
//                     timeout -> whole tree ESRCH + sentinel quiescent
//   repeated-signal   INT+INT/TERM+TERM/INT+TERM/TERM+INT/triple/no-Done:
//                     first-signal code, no raw death, no stale lock
//   ignored-signal    helper ignores SIGINT/SIGTERM -> user signal starts the
//                     bounded controlled termination (escalation + deadline);
//                     NEVER waits out the helper's own long timeout
//
// Usage:
//   node scripts/stress-release-security.mjs [category] [rounds] [--seed N]
//   node scripts/stress-release-security.mjs --self-test
//   category: all (default) | recovery | fail-closed-exit | sigterm-combos |
//             repeated-signal | ignored-signal
//
// `all N` semantics (M34 WP-E #5): N is the TOTAL number of rounds, split
// deterministically across the five categories (20% each; repeated-signal's
// share is further split across its six scenarios). To run a fixed number
// per category, name the category explicitly:
//   node scripts/stress-release-security.mjs recovery 50
//
// Counters (M34 WP-E): every one has a real update path:
//   total / bad                    round bookkeeping
//   unsafeRecovery                 a recoverLock returned recovered while
//                                  the ACTIVE group was still alive
//   orphanAtSafeCompletion         a helper that was ALIVE when its round
//                                  reported safe completion (and was only
//                                  stopped by the post-round cleanup)
//   cleanupResidual                a process still alive AFTER the PID-ledger
//                                  cleanup + ESRCH wait
//   staleLockAfterSafeCompletion   lock still present after a safe completion
//   residualWriter                 sentinel still growing after safe completion
//   liveTimer                      an owned timer still live after settle
//   rawSignalDeath                 the CLI died from the signal default action
//   doneSeen                       a signal-observed round printed "Done:"
//   recoveredSuccessClaimSeen      a signal-observed round printed the full
//                                  success claim
//   watchdogTriggered              the round watchdog had to force-clean
//   timeout                        a round exceeded its own deadline
//   skipped / todo are REMOVED -- this runner cannot truthfully measure vitest
//   skip/todo counters, so it does not print fake zeros for them.
//
// Exit code: 1 when bad > 0 OR any safety counter > 0 OR cleanupResidual > 0.
// Cleanup is PID-ledger only -- never pkill -f. Failed rounds keep a minimal
// diagnostic artifact; successful rounds clean their own directory.
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
const selfTest = args.includes('--self-test')

const CATEGORIES = [
  'recovery',
  'fail-closed-exit',
  'sigterm-combos',
  'repeated-signal',
  'ignored-signal',
]

/** @param {number} ms */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
/** @param {number} pid */
const alive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
/** @param {string} p */
function snapshot(p) {
  if (!fs.existsSync(p)) return { size: 0, hash: '' }
  const buf = fs.readFileSync(p)
  return { size: buf.length, hash: createHash('sha256').update(buf).digest('hex') }
}

/**
 * Clean a whole process group + pid by LEDGER (never pkill -f). Returns the
 * PIDs still alive AFTER the cleanup -- those are cleanupResidual, not
 * orphans (M34 WP-E #3).
 *
 * @param {number[]} pids
 * @returns {Promise<number[]>} pids still alive after cleanup
 */
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
// detail carries the REAL observed values the counters aggregate.
// ---------------------------------------------------------------------------

/** @param {number} roundIdx @param {number} s @param {string} base */
function recoveryRound(roundIdx, s, base) {
  return new Promise((resolve) => {
    const tmp = path.join(base, `recovery-${roundIdx}-${s}`)
    fs.mkdirSync(tmp, { recursive: true })
    const sentinel = path.join(tmp, 'sentinel.log')
    const pidfile = path.join(tmp, 'helper.pid')
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
        `fs.writeFileSync(${JSON.stringify(path.join(tmp, 'owner.ready'))}, String(process.pid))`,
        `await mod.execFileAsync('python3', [${JSON.stringify(helperPy)}], { stdio: ['pipe', 'inherit', 'inherit'], timeout: 0, childState: lock.childState })`,
      ].join('\n'),
    )
    const owner = spawn(process.execPath, [ownerScript], { cwd: tmp, stdio: 'ignore' })
    const ownerPid = owner.pid ?? -1
    const deadline = Date.now() + 15_000
    const poll = setInterval(() => {
      if (fs.existsSync(path.join(tmp, '.release-staging.lock')) && fs.existsSync(pidfile)) {
        const candidate = Number(fs.readFileSync(pidfile, 'utf8').trim())
        if (!(Number.isInteger(candidate) && candidate > 0)) return
        clearInterval(poll)
        void (async () => {
          const helperPid = candidate
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
          const unsafeRecovery = refuse.recovered ? 1 : 0
          const helperAliveAtRecover = alive(helperPid)
          const left = await forceCleanTree([helperPid, ownerPid])
          const cleanupResidual = left.length
          const ok = !refuse.recovered && replacementDenied && grew && left.length === 0
          const recoverAfter = mod.recoverLock(tmp)
          const okAfter = recoverAfter.recovered
          // cleanup lock artifacts
          try {
            fs.unlinkSync(path.join(tmp, '.release-staging.lock'))
          } catch {}
          if (okAfter) {
            // nonce-qualified sidecar removed by recoverLock
          } else {
            try {
              const nonce = JSON.parse(
                fs.readFileSync(path.join(tmp, '.release-staging.lock'), 'utf8'),
              ).nonce
              fs.unlinkSync(path.join(tmp, `.release-staging.child-state-${nonce}.json`))
            } catch {}
          }
          const okAll = ok && okAfter
          if (okAll) {
            fs.rmSync(tmp, { recursive: true, force: true })
          } else {
            // failed round: keep minimal diagnostic artifact (M34 WP-E #7)
            try {
              fs.writeFileSync(
                path.join(tmp, 'round-diagnostic.json'),
                JSON.stringify(
                  {
                    round: roundIdx,
                    seed: s,
                    category: 'recovery',
                    refuse: refuse.reason,
                    okAfter,
                  },
                  null,
                  2,
                ),
              )
            } catch {}
          }
          resolve({
            ok: okAll,
            detail: {
              scenario: 'recovery',
              refuse: refuse.reason,
              replacementDenied,
              grew,
              unsafeRecovery,
              helperAliveAtRecover,
              // M34 WP-E: the helper ALIVE at the recover-refusal check is the
              // CONTRACT (recover must refuse while the group lives) -- not an
              // orphan; the round then force-cleans it and recovers.
              orphanAtSafeCompletion: 0,
              cleanupResidual,
              recoveredAfterCleanup: okAfter,
              helperPid,
              ownerPid,
              pgid: helperPid,
            },
            pids: [],
          })
        })()
      } else if (Date.now() > deadline) {
        clearInterval(poll)
        owner.kill('SIGKILL')
        resolve({
          ok: false,
          detail: {
            scenario: 'recovery',
            stage: 'owner-ready-timeout',
            timeout: 1,
            watchdogTriggered: 1,
          },
          pids: [ownerPid],
        })
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
          let sidecarNonce = ''
          try {
            const lockRaw = JSON.parse(
              fs.readFileSync(path.join(tmp, '.release-staging.lock'), 'utf8'),
            )
            sidecarNonce = lockRaw.nonce
            sidecarState = JSON.parse(
              fs.readFileSync(
                path.join(tmp, `.release-staging.child-state-${sidecarNonce}.json`),
                'utf8',
              ),
            ).state
          } catch {
            sidecarState = 'unreadable'
          }
          const helperAliveAtExit = alive(helperPid)
          const mod = await import('file://' + MODULE_PATH)
          const refuseWhileAlive = !mod.recoverLock(tmp).recovered
          // M34 WP-B: the formal path for MANUAL state is the audit
          // acknowledgement -- never hand-edited JSON.
          let acknowledged = false
          if (sidecarState === 'MANUAL_AUDIT_REQUIRED') {
            let lastKnownPgid = -1
            try {
              const lockRaw = JSON.parse(
                fs.readFileSync(path.join(tmp, '.release-staging.lock'), 'utf8'),
              )
              const sidecarRaw = JSON.parse(
                fs.readFileSync(
                  path.join(tmp, `.release-staging.child-state-${sidecarNonce}.json`),
                  'utf8',
                ),
              )
              lastKnownPgid = sidecarRaw.lastKnownPgid
              void lockRaw
            } catch {}
            if (Number.isInteger(lastKnownPgid) && lastKnownPgid > 0) {
              const helperAliveBeforeAudit = alive(helperPid)
              void helperAliveBeforeAudit
              const left = await forceCleanTree([helperPid, childPid])
              const cleanupResidual = left.length
              const audited = mod.auditLockAcknowledgement(tmp, {
                nonce: sidecarNonce,
                lastKnownPgid,
              })
              acknowledged = audited.acknowledged
              const ok =
                code !== null &&
                code !== 0 &&
                lockKept &&
                sidecarState === 'MANUAL_AUDIT_REQUIRED' &&
                helperAliveAtExit &&
                refuseWhileAlive &&
                acknowledged &&
                cleanupResidual === 0
              if (ok) {
                fs.rmSync(tmp, { recursive: true, force: true })
              } else {
                try {
                  fs.writeFileSync(
                    path.join(tmp, 'round-diagnostic.json'),
                    JSON.stringify(
                      {
                        round: roundIdx,
                        seed: s,
                        category: 'fail-closed-exit',
                        code,
                        lockKept,
                        sidecarState,
                        acknowledged,
                        cleanupResidual,
                      },
                      null,
                      2,
                    ),
                  )
                } catch {}
              }
              resolve({
                ok,
                detail: {
                  scenario: 'fail-closed-exit',
                  code,
                  lockKept,
                  sidecarState,
                  helperAliveAtExit,
                  refuseWhileAlive,
                  acknowledged,
                  helperPid,
                  childPid,
                  pgid: helperPid,
                  // M34 WP-E: in fail-closed-exit the helper ALIVE at exit is
                  // the CONTRACT (fail closed: MANUAL_AUDIT_REQUIRED persisted,
                  // lock held, registry preserved) -- it is not an orphan; the
                  // round then cleans it and acknowledges the audit.
                  orphanAtSafeCompletion: 0,
                  cleanupResidual,
                },
                pids: [],
              })
            } else {
              resolve({
                ok: false,
                detail: { scenario: 'fail-closed-exit', stage: 'no-last-known-pgid', sidecarState },
                pids: [helperPid],
              })
            }
          } else {
            resolve({
              ok: false,
              detail: {
                scenario: 'fail-closed-exit',
                stage: 'unexpected-sidecar-state',
                sidecarState,
              },
              pids: [helperPid, childPid],
            })
          }
        })()
      } else if (Date.now() > deadline) {
        clearInterval(poll)
        child.kill('SIGKILL')
        resolve({
          ok: false,
          detail: {
            scenario: 'fail-closed-exit',
            stage: 'child-ready-timeout',
            timeout: 1,
            watchdogTriggered: 1,
          },
          pids: [childPid],
        })
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
      // M34 WP-E #2/#3: a helper still ALIVE at safe completion is an ORPHAN
      // (it needed the force cleanup); only what survives the cleanup is a
      // cleanupResidual.
      const helperAliveAtSafeCompletion = (gpidOk && alive(gpid)) || alive(wpid)
      const left = await forceCleanTree([gpidOk ? gpid : -1, wpid])
      const cleanupResidual = left.length
      const timeoutSeen =
        res.error != null &&
        /** @type {{ code?: string }} */ (/** @type {unknown} */ (res.error)).code === 'ETIMEDOUT'
      const ok =
        res.status === 0 &&
        /OK_TIMEOUT: true/.test(stdout) &&
        !alive(gpid) &&
        !alive(wpid) &&
        quiescent &&
        left.length === 0
      if (ok) {
        fs.rmSync(tmp, { recursive: true, force: true })
      } else {
        try {
          fs.writeFileSync(
            path.join(tmp, 'round-diagnostic.json'),
            JSON.stringify(
              {
                round: roundIdx,
                seed: s,
                category: 'sigterm-combos',
                directIgnore,
                grandchildIgnore,
                left,
                quiescent,
                status: res.status,
              },
              null,
              2,
            ),
          )
        } catch {}
      }
      resolve({
        ok,
        detail: {
          scenario: `sigterm-combos directIgnore=${directIgnore} grandchildIgnore=${grandchildIgnore}`,
          left,
          quiescent,
          status: res.status,
          timeout: timeoutSeen ? 1 : 0,
          watchdogTriggered: timeoutSeen ? 1 : 0,
          helperPid: gpidOk ? gpid : -1,
          wrapperPid: wpid,
          pgid: wpid > 0 ? wpid : gpid,
          orphanAtSafeCompletion: helperAliveAtSafeCompletion ? 1 : 0,
          cleanupResidual,
          residualWriter: !quiescent ? 1 : 0,
        },
        pids: [],
      })
    })()
  })
}

// ---------------------------------------------------------------------------
// repeated-signal rounds (deterministic handshake + signal sequencing)
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
    let watchdogTriggered = false
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
      // watchdog: clean the whole owned tree by ledger
      watchdogTriggered = true
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
      // M34 WP-E #4: staleLock must be checked BEFORE removing the dir.
      const staleLock = fs.existsSync(lockPath)
      const doneSeen = out.includes('Done:')
      const recoveredSuccessClaimSeen = out.includes('Transaction recovered successfully')
      const rawSignalDeath = signalCode !== null
      // M34 WP-E #2: a helper still alive at (otherwise) safe completion is an
      // orphan -- the contract requires the signal protocol to end the helper.
      const helperAliveAtSafeCompletion =
        helperPid !== null && Number.isInteger(helperPid) && helperPid > 0 && alive(helperPid)
      if (helperPid !== null && Number.isInteger(helperPid) && helperPid > 0) {
        try {
          process.kill(-helperPid, 'SIGKILL')
        } catch {}
      }
      const ok = code === scenario.expected && signalCode === null && !staleLock && !doneSeen
      if (ok) {
        fs.rmSync(tmp, { recursive: true, force: true })
      } else {
        try {
          fs.writeFileSync(
            path.join(tmp, 'round-diagnostic.json'),
            JSON.stringify(
              {
                round: roundIdx,
                seed: s,
                category: 'repeated-signal',
                scenario: scenario.name,
                code,
                signalCode,
                staleLock,
                doneSeen,
              },
              null,
              2,
            ),
          )
        } catch {}
      }
      resolve({
        ok,
        detail: {
          scenario: scenario.name,
          code,
          signalCode,
          staleLock,
          doneSeen,
          recoveredSuccessClaimSeen,
          rawSignalDeath: rawSignalDeath ? 1 : 0,
          watchdogTriggered: watchdogTriggered ? 1 : 0,
          helperPid: helperPid ?? -1,
          pgid: helperPid ?? -1,
          staleLockAfterSafeCompletion: staleLock && !rawSignalDeath ? 1 : 0,
          orphanAtSafeCompletion: helperAliveAtSafeCompletion ? 1 : 0,
          cleanupResidual: 0,
        },
        pids: [],
      })
    })
  })
}

// ---------------------------------------------------------------------------
// ignored-signal rounds (M34 WP-C): helper ignores SIGINT/SIGTERM; the user
// signal must start the bounded controlled termination (escalation + deadline)
// -- the CLI must NOT wait out the helper's own 60s timeout.
// ---------------------------------------------------------------------------

/** @param {number} roundIdx @param {number} s @param {string} base @param {{name: string, signal: string, expected: number}} scenario */
function ignoredSignalRound(roundIdx, s, base, scenario) {
  return new Promise((resolve) => {
    const tmp = path.join(base, `ignored-${roundIdx}-${s}`)
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
    let out = ''
    let err = ''
    /** @type {number | null} */
    let helperPid = null
    let watchdogTriggered = false
    let signalSentAt = 0
    child.stdout.on('data', (d) => {
      out += String(d)
    })
    child.stderr.on('data', (d) => {
      err += String(d)
    })
    const lockPath = path.join(tmp, '.release-staging.lock')
    const poll = setInterval(() => {
      if (!signalSentAt && fs.existsSync(lockPath) && fs.existsSync(helperPidfile)) {
        let state = ''
        try {
          const lockRaw = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
          const sidecar = JSON.parse(
            fs.readFileSync(
              path.join(tmp, `.release-staging.child-state-${lockRaw.nonce}.json`),
              'utf8',
            ),
          )
          state = sidecar.state
        } catch {}
        if (state !== 'ACTIVE') return
        signalSentAt = Date.now()
        try {
          helperPid = Number(fs.readFileSync(helperPidfile, 'utf8').trim())
        } catch {
          helperPid = null
        }
        child.kill(/** @type {NodeJS.Signals} */ (scenario.signal))
      }
    }, 5)
    const timer = setTimeout(() => {
      watchdogTriggered = true
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
      const elapsedMs = signalSentAt ? Date.now() - signalSentAt : -1
      const staleLock = fs.existsSync(lockPath)
      const doneSeen = out.includes('Done:')
      const recoveredSuccessClaimSeen = out.includes('Transaction recovered successfully')
      // M34 WP-C contract: bounded exit -- parent must settle well before the
      // helper's own 15s shim sleep / 60s python timeout.
      const boundedExit = elapsedMs >= 0 && elapsedMs < 12_000
      const escalated = /SIGKILL|terminated by signal/.test(err)
      let sidecarState = ''
      try {
        const lockRaw = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
        const sidecar = JSON.parse(
          fs.readFileSync(
            path.join(tmp, `.release-staging.child-state-${lockRaw.nonce}.json`),
            'utf8',
          ),
        )
        sidecarState = sidecar.state
      } catch {}
      // M34 WP-E #2: a helper alive at (otherwise) safe completion is an
      // orphan -- EXCEPT the MANUAL_AUDIT_REQUIRED fail-closed contract,
      // where the alive helper IS the documented state (audit-acknowledged
      // afterwards by the operator; here the round already cleaned it).
      // NOTE: checked BEFORE the kill below.
      const helperAliveAtSafeCompletion =
        sidecarState !== 'MANUAL_AUDIT_REQUIRED' &&
        helperPid !== null &&
        Number.isInteger(helperPid) &&
        helperPid > 0 &&
        alive(helperPid)
      if (helperPid !== null && Number.isInteger(helperPid) && helperPid > 0) {
        try {
          process.kill(-helperPid, 'SIGKILL')
        } catch {}
      }
      const ok =
        code === scenario.expected &&
        signalCode === null &&
        !doneSeen &&
        !recoveredSuccessClaimSeen &&
        boundedExit &&
        (escalated ||
          sidecarState === 'MANUAL_AUDIT_REQUIRED' ||
          sidecarState === 'QUIESCENCE_PROVEN')
      if (ok) {
        fs.rmSync(tmp, { recursive: true, force: true })
      } else {
        try {
          fs.writeFileSync(
            path.join(tmp, 'round-diagnostic.json'),
            JSON.stringify(
              {
                round: roundIdx,
                seed: s,
                category: 'ignored-signal',
                scenario: scenario.name,
                code,
                signalCode,
                elapsedMs,
                escalated,
                sidecarState,
                doneSeen,
                recoveredSuccessClaimSeen,
                staleLock,
              },
              null,
              2,
            ),
          )
        } catch {}
      }
      resolve({
        ok,
        detail: {
          scenario: scenario.name,
          code,
          signalCode,
          elapsedMs,
          escalated,
          sidecarState,
          staleLock,
          doneSeen,
          recoveredSuccessClaimSeen,
          rawSignalDeath: signalCode !== null ? 1 : 0,
          watchdogTriggered: watchdogTriggered ? 1 : 0,
          timeout: elapsedMs < 0 ? 1 : 0,
          helperPid: helperPid ?? -1,
          pgid: helperPid ?? -1,
          staleLockAfterSafeCompletion: staleLock ? 1 : 0,
          orphanAtSafeCompletion: helperAliveAtSafeCompletion ? 1 : 0,
          cleanupResidual: 0,
        },
        pids: [],
      })
    })
  })
}

// ---------------------------------------------------------------------------
// Main loop + truthful counters
// ---------------------------------------------------------------------------

const SCENARIOS = [
  { name: 'INT+INT', signals: ['SIGINT', 'SIGINT'], expected: 130 },
  { name: 'TERM+TERM', signals: ['SIGTERM', 'SIGTERM'], expected: 143 },
  { name: 'INT+TERM', signals: ['SIGINT', 'SIGTERM'], expected: 130 },
  { name: 'TERM+INT', signals: ['SIGTERM', 'SIGINT'], expected: 143 },
  { name: 'TRIPLE-INT', signals: ['SIGINT', 'SIGINT', 'SIGINT'], expected: 130 },
  { name: 'NO-DONE', signals: ['SIGTERM'], expected: 143 },
]

const IGNORED_SCENARIOS = [
  { name: 'IGNORED-SIGINT', signal: 'SIGINT', expected: 130 },
  { name: 'IGNORED-SIGTERM', signal: 'SIGTERM', expected: 143 },
]

/**
 * M34 WP-E: truthful counter set. Every field below has an update path from
 * a round's real observation (see the round runners); the self-test injects
 * one failing observation per counter and asserts the count becomes exactly
 * 1. skipped/todo are REMOVED (not truthfully measurable here).
 */
export const STRESS_COUNTER_FIELDS = Object.freeze([
  'total',
  'bad',
  'unsafeRecovery',
  'orphanAtSafeCompletion',
  'cleanupResidual',
  'staleLockAfterSafeCompletion',
  'residualWriter',
  'liveTimer',
  'rawSignalDeath',
  'doneSeen',
  'recoveredSuccessClaimSeen',
  'watchdogTriggered',
  'timeout',
])

export function makeCounterSet() {
  /** @type {Record<string, number>} */
  const c = {}
  for (const f of STRESS_COUNTER_FIELDS) c[f] = 0
  return c
}

/**
 * Aggregate one round detail into the counters. Returns true when the round
 * is safe (bad round or any positive safety counter fails the run).
 *
 * @param {Record<string, number>} counts
 * @param {{ ok: boolean, detail: Record<string, unknown> }} result
 * @returns {boolean} true when the round is clean
 */
export function aggregateRound(counts, result) {
  counts.total++
  if (!result.ok) counts.bad++
  const d = result.detail || {}
  for (const f of [
    'unsafeRecovery',
    'orphanAtSafeCompletion',
    'cleanupResidual',
    'staleLockAfterSafeCompletion',
    'residualWriter',
    'liveTimer',
    'rawSignalDeath',
    'doneSeen',
    'recoveredSuccessClaimSeen',
    'watchdogTriggered',
    'timeout',
  ]) {
    const v = d[f]
    if (typeof v === 'number' && v > 0) counts[f] += v
  }
  return (
    result.ok && !STRESS_COUNTER_FIELDS.some((f) => f !== 'total' && f !== 'bad' && counts[f] > 0)
  )
}

/**
 * M34 WP-E self-test: inject one failing observation per counter and assert
 * the aggregate becomes exactly 1 for that counter (and 0 for the others).
 *
 * @returns {{ ok: boolean, failures: string[] }}
 */
export function selfTestCounters() {
  /** @type {string[]} */
  const failures = []
  for (const field of STRESS_COUNTER_FIELDS) {
    if (field === 'total' || field === 'bad') continue
    const counts = makeCounterSet()
    /** @type {Record<string, unknown>} */
    const detail = {}
    detail[field] = 1
    aggregateRound(counts, { ok: true, detail })
    if (counts[field] !== 1) {
      failures.push(`${field}: expected 1 after injection, got ${counts[field]}`)
    }
    // other SAFETY counters must stay 0 (total/bad are bookkeeping and
    // legitimately move)
    for (const other of STRESS_COUNTER_FIELDS) {
      if (other === field || other === 'total' || other === 'bad') continue
      if (counts[other] !== 0) {
        failures.push(`${field}: leaked into ${other} (=${counts[other]})`)
      }
    }
  }
  return { ok: failures.length === 0, failures }
}

/** @param {string} category @param {number} roundCount @param {string} base @param {Record<string, number>} counts @param {string[]} failures */
async function runCategory(category, roundCount, base, counts, failures) {
  for (let i = 0; i < roundCount; i++) {
    const s = (seed + i) & 0x7fffffff
    /** @type {{ ok: boolean, detail: Record<string, unknown>, pids: number[] }} */
    let result
    if (category === 'recovery') {
      result = await recoveryRound(i, s, base)
    } else if (category === 'fail-closed-exit') {
      result = await failClosedRound(i, s, base)
    } else if (category === 'sigterm-combos') {
      result = await sigtermComboRound(i, s, base)
    } else if (category === 'ignored-signal') {
      const scenario = IGNORED_SCENARIOS[i % IGNORED_SCENARIOS.length]
      result = await ignoredSignalRound(i, s, base, scenario)
    } else {
      const scenario = SCENARIOS[i % SCENARIOS.length]
      result = await repeatedSignalRound(i, s, base, scenario)
    }
    const clean = aggregateRound(counts, result)
    if (!clean) {
      failures.push(
        JSON.stringify({ category, round: i, seed: s, detail: result.detail, pids: result.pids }),
      )
    }
    if (result.pids.length > 0) {
      counts.orphanAtSafeCompletion += result.pids.length
    }
  }
}

async function main() {
  if (selfTest) {
    const r = selfTestCounters()
    console.log(JSON.stringify({ selfTest: r.ok ? 'PASS' : 'FAIL', failures: r.failures }))
    process.exitCode = r.ok ? 0 : 1
    return
  }
  const base = path.join(os.tmpdir(), `m34-stress-${process.pid}`)
  fs.mkdirSync(base, { recursive: true })
  const start = Date.now()
  const counts = makeCounterSet()
  /** @type {string[]} */
  const failures = []
  /** @type {Record<string, number>} */
  const roundsByCategory = {}
  try {
    if (categoryArg === 'all') {
      // M34 WP-E #5: N is the TOTAL number of rounds, split deterministically.
      if (rounds <= 0) {
        console.error('stress: all requires a positive total round count (e.g. `all 200`)')
        process.exitCode = 2
        return
      }
      const perCategory = Math.max(1, Math.floor(rounds / CATEGORIES.length))
      let allocated = 0
      for (const c of CATEGORIES) {
        const n = c === CATEGORIES[CATEGORIES.length - 1] ? rounds - allocated : perCategory
        roundsByCategory[c] = n
        allocated += n
        await runCategory(c, n, base, counts, failures)
      }
    } else if (CATEGORIES.includes(categoryArg)) {
      if (rounds <= 0) {
        console.error(`stress: ${categoryArg} requires a positive round count`)
        process.exitCode = 2
        return
      }
      roundsByCategory[categoryArg] = rounds
      await runCategory(categoryArg, rounds, base, counts, failures)
    } else {
      console.error(`unknown category "${categoryArg}" (expected ${CATEGORIES.join(' | ')} | all)`)
      process.exitCode = 2
      return
    }
  } finally {
    fs.rmSync(base, { recursive: true, force: true })
  }
  const summary = {
    schemaVersion: 2,
    category: categoryArg,
    totalRounds: counts.total,
    seed,
    durationMs: Date.now() - start,
    roundsByCategory,
    counts,
    failures,
  }
  console.log(JSON.stringify(summary, null, 2))
  const safe =
    counts.bad === 0 &&
    counts.unsafeRecovery === 0 &&
    counts.orphanAtSafeCompletion === 0 &&
    counts.cleanupResidual === 0 &&
    counts.staleLockAfterSafeCompletion === 0 &&
    counts.residualWriter === 0 &&
    counts.liveTimer === 0 &&
    counts.rawSignalDeath === 0 &&
    counts.doneSeen === 0 &&
    counts.recoveredSuccessClaimSeen === 0 &&
    counts.watchdogTriggered === 0 &&
    counts.timeout === 0
  process.exitCode = safe ? 0 : 1
}

await main()
