// M30 WP-A / WP-C: repeated-signal safety, full listener lifecycle, and
// success claims only after the final protocol completes (test-first).
//
// Written BEFORE the implementation: every assertion here is red against the
// M29/v1.1.10 baseline (process.once removes the fired signal's listener, so
// a repeated SAME signal hits default raw death and leaves the lock behind;
// generateAssets prints "Done:" itself with a TOCTOU window after the final
// checkStop) and must be green after the M30 fixes.
//
// These tests run the REAL CLI via runCli(repoRoot) in child processes with
// a slow python shim, exactly like the M29 signal tests but with REPEATED
// signals:
//   - signal 1 defines the final exit code (130 for SIGINT, 143 for SIGTERM)
//   - later same/different signals only log "termination already in progress"
//   - no raw signal death (code===null) ever
//   - listeners stay installed until lock.release completes
//   - a signal-observed run prints NO "Done:" and NO success claim

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MODULE_PATH = path.join(REPO_ROOT, 'scripts', 'prepare-release-assets.mjs')

const tempDirs: string[] = []
function makeTempDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'm30-signal-'))
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

const CSP_HTML =
  '<!DOCTYPE html><html><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'"><link rel="stylesheet" href="assets/app.css"><script src="assets/app.js"></script></html>'

interface RunOutcome {
  label: string
  code: number | null
  signalCode: string | null
  out: string
  err: string
  lockLeft: boolean
  doneSeen: boolean
  recoveredClaimSeen: boolean
  alreadyInProgressSeen: boolean
}

/**
 * Run the real CLI in a child process and deliver the given signals:
 * signal[0] as soon as the lock appears, then each further signal 300ms
 * after the previous "termination requested" line is observed. The slow
 * python shim keeps the transaction in flight long enough for all signals.
 */
function runOnce(
  label: string,
  signals: Array<'SIGINT' | 'SIGTERM'>,
  slowSeconds = 3,
): Promise<RunOutcome> {
  return new Promise((resolve) => {
    const tmp = makeTempDir()
    fs.mkdirSync(path.join(tmp, 'dist', 'assets'), { recursive: true })
    fs.writeFileSync(path.join(tmp, 'dist', 'index.html'), CSP_HTML)
    fs.writeFileSync(path.join(tmp, 'dist', 'assets', 'app.js'), 'console.log("x")')
    fs.writeFileSync(path.join(tmp, 'dist', 'assets', 'app.css'), 'body{}')
    fs.writeFileSync(
      path.join(tmp, 'package.json'),
      JSON.stringify({ name: 't', version: '1.1.5', private: true }),
    )
    const shim = path.join(tmp, 'slow-python3')
    fs.writeFileSync(shim, '#!/bin/sh\nsleep ' + slowSeconds + '\nexec /usr/bin/env python3 "$@"\n')
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
    let lockSeen = false

    child.stdout.on('data', (d) => {
      out += String(d)
    })
    child.stderr.on('data', (d) => {
      const s = String(d)
      err += s
      if (s.includes('termination requested')) {
        // Deliver the next signal 300ms after the previous one was observed.
        if (sigIdx < signals.length) {
          const next = signals[sigIdx]
          sigIdx++
          setTimeout(() => child.kill(next), 300)
        }
      }
    })

    const lockPath = path.join(tmp, '.release-staging.lock')
    const deadline = Date.now() + 20_000
    const poll = setInterval(() => {
      if (!lockSeen && fs.existsSync(lockPath)) {
        lockSeen = true
        if (sigIdx < signals.length) {
          const first = signals[sigIdx]
          sigIdx++
          child.kill(first)
        }
      } else if (Date.now() > deadline) {
        clearInterval(poll)
        child.kill('SIGKILL')
      }
    }, 5)

    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolve({
        label,
        code: -999,
        signalCode: 'KILLED',
        out,
        err,
        lockLeft: fs.existsSync(lockPath),
        doneSeen: out.includes('Done:'),
        recoveredClaimSeen: /Transaction recovered successfully/.test(out),
        alreadyInProgressSeen: /termination already in progress/i.test(err),
      })
    }, 30_000)
    child.on('close', (code, signalCode) => {
      clearTimeout(timer)
      clearInterval(poll)
      resolve({
        label,
        code,
        signalCode,
        out,
        err,
        lockLeft: fs.existsSync(lockPath),
        doneSeen: out.includes('Done:'),
        recoveredClaimSeen: /Transaction recovered successfully/.test(out),
        alreadyInProgressSeen: /termination already in progress/i.test(err),
      })
    })
  })
}

describe('M30 WP-A repeated-signal safety and listener lifecycle', () => {
  it.each([
    ['INT+INT', ['SIGINT', 'SIGINT'], 130],
    ['TERM+TERM', ['SIGTERM', 'SIGTERM'], 143],
    ['INT+TERM', ['SIGINT', 'SIGTERM'], 130],
    ['TERM+INT', ['SIGTERM', 'SIGINT'], 143],
  ] as const)(
    '%s: first-signal exit code, no raw death, no lock residue (4 rounds each)',
    async (label, signals, expected) => {
      for (let i = 0; i < 4; i++) {
        const r = await runOnce(`${label}#${i}`, [...signals] as Array<'SIGINT' | 'SIGTERM'>)
        expect(
          r.code,
          `${r.label}: expected exit ${expected}, got code=${String(r.code)} signal=${String(r.signalCode)} (raw signal death = protocol bypass); stderr: ${r.err.slice(-600)}`,
        ).toBe(expected)
        expect(r.signalCode, `${r.label}: must not die by signal`).toBeNull()
        expect(r.lockLeft, `${r.label}: lock must be released on every path`).toBe(false)
      }
    },
    180_000,
  )

  it('TRIPLE-INT: three signals -> still exactly 130, no raw death, no lock residue', async () => {
    for (let i = 0; i < 2; i++) {
      const r = await runOnce('TRIPLE-INT#' + i, ['SIGINT', 'SIGINT', 'SIGINT'])
      expect(r.code).toBe(130)
      expect(r.signalCode).toBeNull()
      expect(r.lockLeft).toBe(false)
    }
  }, 90_000)

  it('TRIPLE-TERM: three signals -> still exactly 143, no raw death, no lock residue', async () => {
    for (let i = 0; i < 2; i++) {
      const r = await runOnce('TRIPLE-TERM#' + i, ['SIGTERM', 'SIGTERM', 'SIGTERM'])
      expect(r.code).toBe(143)
      expect(r.signalCode).toBeNull()
      expect(r.lockLeft).toBe(false)
    }
  }, 90_000)

  it('every repeated signal logs "termination already in progress" (same and cross signal)', async () => {
    const r = await runOnce('ALREADY#INT+TERM+INT', ['SIGINT', 'SIGTERM', 'SIGINT'])
    expect(r.code).toBe(130)
    expect(r.signalCode).toBeNull()
    // At least the second and third signals must be recorded as duplicates.
    expect(r.alreadyInProgressSeen, `stderr: ${r.err.slice(-800)}`).toBe(true)
    expect(r.err).toMatch(/termination already in progress/i)
  }, 45_000)
})

describe('M30 WP-C success claims only after the final protocol completes', () => {
  it('a signal-observed run prints NO "Done:" and NO success claim', async () => {
    for (let i = 0; i < 4; i++) {
      const r = await runOnce('NO-DONE#' + i, ['SIGTERM'])
      expect(r.code).toBe(143)
      expect(
        r.doneSeen,
        `${r.label}: signal-observed run must never print Done:; stdout: ${r.out.slice(-400)}`,
      ).toBe(false)
      expect(r.recoveredClaimSeen).toBe(false)
    }
  }, 120_000)
})
