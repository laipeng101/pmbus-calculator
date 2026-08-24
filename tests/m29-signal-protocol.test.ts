// M29 WP-B: deterministic signal/lock protocol (test-first).
//
// Contract (behavioral, child-process level):
// 1. SIGINT exits exactly 130, SIGTERM exactly 143 -- never a raw signal
//    death (code null) and never 0.
// 2. "Done:" (full success claim) must never be printed BEFORE the signal
//    handler observed the termination request (stderr "termination requested").
// 3. The lock stays held until the process fully stops, so a second
//    generator cannot acquire it while the first is alive.
//
// These tests run the REAL CLI via runCli(repoRoot) in child processes with
// injected tiny fixture repos. Signals are sent as soon as the lock appears,
// which is the window where the M28 10x-setImmediate heuristic can print
// Done before the handler runs (probe C: 15/20 SIGINT, 8/20 SIGTERM).

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
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'm29-signal-'))
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
  index: number
  signal: string
  code: number | null
  signalCode: string | null
  events: Array<[string, number]>
  err: string
}

function runOnce(signal: 'SIGINT' | 'SIGTERM', index: number): Promise<RunOutcome> {
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
        '  env: { ...process.env, PYTHON3: "python3" },\n' +
        '  stdout: { write: (s) => process.stdout.write(String(s)) },\n' +
        '  stderr: { write: (s) => process.stderr.write(String(s)) },\n' +
        '});\n' +
        'process.exit(rc);\n',
    )

    const child = spawn(process.execPath, [childScript], {
      cwd: tmp,
      env: { ...process.env, PYTHON3: 'python3' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const events: Array<[string, number]> = []
    const t0 = Date.now()
    let err = ''
    child.stdout.on('data', (d) => {
      const s = String(d)
      if (s.includes('Done:')) events.push(['stdout-Done', Date.now() - t0])
    })
    child.stderr.on('data', (d) => {
      const s = String(d)
      err += s
      if (s.includes('termination requested'))
        events.push(['stderr-termination-requested', Date.now() - t0])
      if (s.includes('lock released')) events.push(['stderr-lock-released', Date.now() - t0])
    })

    const lockPath = path.join(tmp, '.release-staging.lock')
    const deadline = Date.now() + 15_000
    const poll = setInterval(() => {
      if (fs.existsSync(lockPath) || Date.now() > deadline) {
        clearInterval(poll)
        child.kill(signal)
        events.push(['signal-sent', Date.now() - t0])
      }
    }, 1)

    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolve({ index, signal, code: -999, signalCode: 'KILLED', events, err })
    }, 20_000)
    child.on('close', (code, signalCode) => {
      clearTimeout(timer)
      resolve({ index, signal, code, signalCode, events, err })
    })
  })
}

describe('M29 WP-B deterministic signal/lock protocol', () => {
  it.each(['SIGINT', 'SIGTERM'] as const)(
    '%s: exact exit code, no Done before handler observation, lock held until stop (8 rounds)',
    async (signal) => {
      const expected = signal === 'SIGINT' ? 130 : 143
      for (let i = 0; i < 8; i++) {
        const r = await runOnce(signal, i)
        expect(
          r.code,
          `round ${i}: ${signal} must exit exactly ${expected}, got code=${String(r.code)} signalCode=${String(r.signalCode)} (raw signal death = protocol bypass)`,
        ).toBe(expected)
        const done = r.events.find((e) => e[0] === 'stdout-Done')
        const term = r.events.find((e) => e[0] === 'stderr-termination-requested')
        if (done) {
          expect(
            term,
            `round ${i}: Done printed but handler never observed the signal`,
          ).toBeDefined()
          expect(
            done[1] >= (term as [string, number])[1],
            `round ${i}: Done printed ${(term as [string, number])[1] - done[1]}ms BEFORE the handler observed the signal`,
          ).toBe(true)
        }
        expect(r.err).toMatch(/termination requested/i)
      }
    },
    120_000,
  )
})
