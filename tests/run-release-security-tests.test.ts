// M28 WP-C -- zero-skip runner must be fail-closed on its own output.
//
// These tests copy the REAL scripts/run-release-security-tests.mjs into a
// fixture repo and point it at a FAKE vitest binary, so every report shape
// (missing/empty/corrupt/inconsistent/signaled) can be exercised
// deterministically. The runner's repoRoot derives from its own module
// location, hence the copy.

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const RUNNER_SOURCE = path.join(REPO_ROOT, 'scripts', 'run-release-security-tests.mjs')

const tempDirs: string[] = []
function makeTempDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'm28-runner-'))
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

/**
 * Build a fixture repo whose node_modules/vitest/vitest.mjs is a fake
 * vitest controlled by env vars:
 *   FAKE_RC        -- exit code of the fake vitest (default 0)
 *   FAKE_MODE      -- missing | empty | corrupt | valid | inconsistent |
 *                     malformed | nonfinite | mismatch
 *   FAKE_TOTAL     -- report total (valid mode)
 */
function makeFixture(
  mode: string,
  rc: number,
  opts: { total?: number; passed?: number; failed?: number; skipped?: number } = {},
): string {
  const tmp = makeTempDir()
  fs.mkdirSync(path.join(tmp, 'scripts'), { recursive: true })
  fs.mkdirSync(path.join(tmp, 'node_modules', 'vitest'), { recursive: true })
  fs.mkdirSync(path.join(tmp, 'tests'), { recursive: true })
  fs.copyFileSync(RUNNER_SOURCE, path.join(tmp, 'scripts', 'run-release-security-tests.mjs'))
  fs.copyFileSync(
    path.join(REPO_ROOT, 'scripts', 'release-security-test-contract.mjs'),
    path.join(tmp, 'scripts', 'release-security-test-contract.mjs'),
  )
  // All nine contract files exist in the fixture repo (M30 WP-D).
  fs.writeFileSync(path.join(tmp, 'tests', 'prepare-release-assets.test.ts'), '')
  fs.writeFileSync(path.join(tmp, 'tests', 'zip-helper-security.test.ts'), '')
  fs.writeFileSync(path.join(tmp, 'tests', 'm28-recovery.test.ts'), '')
  fs.writeFileSync(path.join(tmp, 'tests', 'run-release-security-tests.test.ts'), '')
  fs.writeFileSync(path.join(tmp, 'tests', 'm29-crash-matrix.test.ts'), '')
  fs.writeFileSync(path.join(tmp, 'tests', 'm29-release-gates.test.ts'), '')
  fs.writeFileSync(path.join(tmp, 'tests', 'm29-signal-protocol.test.ts'), '')
  fs.writeFileSync(path.join(tmp, 'tests', 'm30-signal-lifecycle.test.ts'), '')
  fs.writeFileSync(path.join(tmp, 'tests', 'm30-child-lifecycle.test.ts'), '')

  const fakeVitest = [
    "import fs from 'node:fs'",
    'const args = process.argv.slice(2);',
    "const outIdx = args.findIndex((a) => a.startsWith('--outputFile='));",
    "const out = outIdx >= 0 ? args[outIdx].slice('--outputFile='.length) : 'report.json';",
    `const mode = process.env.FAKE_MODE || ${JSON.stringify(mode)};`,
    'if (mode === "missing") {',
    '  console.error("FAKE-VITEST: no report written");',
    `  process.exit(Number(process.env.FAKE_RC || ${JSON.stringify(rc)}));`,
    '}',
    'if (mode === "empty") {',
    '  fs.writeFileSync(out, "");',
    `  process.exit(Number(process.env.FAKE_RC || ${JSON.stringify(rc)}));`,
    '}',
    'if (mode === "corrupt") {',
    '  fs.writeFileSync(out, "{not json");',
    `  process.exit(Number(process.env.FAKE_RC || ${JSON.stringify(rc)}));`,
    '}',
    `const total = Number(process.env.FAKE_TOTAL || ${JSON.stringify(opts.total ?? 2)});`,
    `const passed = Number(process.env.FAKE_PASSED || ${JSON.stringify(opts.passed ?? 2)});`,
    `const failed = Number(process.env.FAKE_FAILED || ${JSON.stringify(opts.failed ?? 0)});`,
    `const skipped = Number(process.env.FAKE_SKIPPED || ${JSON.stringify(opts.skipped ?? 0)});`,
    'const report = { numTotalTests: total, numPassedTests: passed, numFailedTests: failed, numSkippedTests: skipped, numPendingTests: 0, numTodoTests: 0 };',
    // M30 WP-D: the report must carry all nine expected suites.
    "const suiteNames = ['tests/prepare-release-assets.test.ts', 'tests/zip-helper-security.test.ts', 'tests/m28-recovery.test.ts', 'tests/run-release-security-tests.test.ts', 'tests/m29-crash-matrix.test.ts', 'tests/m29-release-gates.test.ts', 'tests/m29-signal-protocol.test.ts', 'tests/m30-signal-lifecycle.test.ts', 'tests/m30-child-lifecycle.test.ts'];",
    "report.testResults = suiteNames.map((name) => ({ name, assertionResults: [{ fullName: name + '::t', status: 'passed' }] }));",
    'if (mode === "inconsistent") {',
    '  report.numPassedTests = passed + 1; // passed+failed+skipped != total',
    '}',
    'if (mode === "nonfinite") {',
    '  report.numTotalTests = "abc";',
    '}',
    'if (mode === "malformed") {',
    '  report.testResults = [{ assertionResults: "not-an-array" }];',
    '  report.numFailedTests = 1;',
    '}',
    'if (mode === "mismatch") {',
    '  // failed > 0 -> runner must dump names and fail',
    '  report.numFailedTests = 1;',
    '  report.numPassedTests = passed - 1;',
    '  report.testResults[0].assertionResults = [{ fullName: "suite::bad-test", status: "failed", failureMessages: ["boom"] }];',
    '}',
    'fs.writeFileSync(out, JSON.stringify(report));',
    `process.exit(Number(process.env.FAKE_RC || ${JSON.stringify(rc)}));`,
  ].join('\n')
  fs.writeFileSync(path.join(tmp, 'node_modules', 'vitest', 'vitest.mjs'), fakeVitest)

  fs.mkdirSync(path.join(tmp, 'tmp'), { recursive: true })
  return tmp
}

function runFixture(tmp: string): {
  status: number
  stdout: string
  stderr: string
  leftovers: string[]
} {
  const res = spawnSync(
    process.execPath,
    [path.join(tmp, 'scripts', 'run-release-security-tests.mjs')],
    {
      cwd: tmp,
      env: {
        ...process.env,
        FAKE_MODE: 'valid',
        FAKE_RC: '0',
        FAKE_TOTAL: '2',
        FAKE_PASSED: '2',
        FAKE_FAILED: '0',
        FAKE_SKIPPED: '0',
        TMPDIR: path.join(tmp, 'tmp'),
        TMP: path.join(tmp, 'tmp'),
      },
      encoding: 'utf8',
      timeout: 20_000,
    },
  )
  const tmpDir = path.join(tmp, 'tmp')
  const leftovers = fs.existsSync(tmpDir)
    ? fs.readdirSync(tmpDir).filter((f) => f.startsWith('release-security-tests-'))
    : []
  return { status: res.status ?? -1, stdout: res.stdout ?? '', stderr: res.stderr ?? '', leftovers }
}

describe('M28 WP-C zero-skip runner fail-closed', () => {
  it('missing report -> nonzero even when vitest exits 0', () => {
    const tmp = makeFixture('missing', 0)
    const r = runFixture(tmp)
    void r
    const res = spawnSync(
      process.execPath,
      [path.join(tmp, 'scripts', 'run-release-security-tests.mjs')],
      {
        cwd: tmp,
        env: {
          ...process.env,
          FAKE_MODE: 'missing',
          FAKE_RC: '0',
          TMPDIR: path.join(tmp, 'tmp'),
          TMP: path.join(tmp, 'tmp'),
        },
        encoding: 'utf8',
        timeout: 20_000,
      },
    )
    expect(res.status).not.toBe(0)
    expect(String(res.stderr)).toMatch(/report|JSON/i)
  })

  it('empty report -> nonzero', () => {
    const tmp = makeFixture('empty', 0)
    const res = spawnSync(
      process.execPath,
      [path.join(tmp, 'scripts', 'run-release-security-tests.mjs')],
      {
        cwd: tmp,
        env: {
          ...process.env,
          FAKE_MODE: 'empty',
          FAKE_RC: '0',
          TMPDIR: path.join(tmp, 'tmp'),
          TMP: path.join(tmp, 'tmp'),
        },
        encoding: 'utf8',
        timeout: 20_000,
      },
    )
    expect(res.status).not.toBe(0)
  })

  it('corrupt report -> nonzero even when vitest exits 0', () => {
    const tmp = makeFixture('corrupt', 0)
    const res = spawnSync(
      process.execPath,
      [path.join(tmp, 'scripts', 'run-release-security-tests.mjs')],
      {
        cwd: tmp,
        env: {
          ...process.env,
          FAKE_MODE: 'corrupt',
          FAKE_RC: '0',
          TMPDIR: path.join(tmp, 'tmp'),
          TMP: path.join(tmp, 'tmp'),
        },
        encoding: 'utf8',
        timeout: 20_000,
      },
    )
    expect(res.status).not.toBe(0)
  })

  it('vitest nonzero status -> nonzero even with a valid report', () => {
    const tmp = makeFixture('valid', 7)
    const res = spawnSync(
      process.execPath,
      [path.join(tmp, 'scripts', 'run-release-security-tests.mjs')],
      {
        cwd: tmp,
        env: {
          ...process.env,
          FAKE_MODE: 'valid',
          FAKE_RC: '7',
          TMPDIR: path.join(tmp, 'tmp'),
          TMP: path.join(tmp, 'tmp'),
        },
        encoding: 'utf8',
        timeout: 20_000,
      },
    )
    expect(res.status).not.toBe(0)
  })

  it('non-finite integer field -> nonzero', () => {
    const tmp = makeFixture('nonfinite', 0)
    const res = spawnSync(
      process.execPath,
      [path.join(tmp, 'scripts', 'run-release-security-tests.mjs')],
      {
        cwd: tmp,
        env: {
          ...process.env,
          FAKE_MODE: 'nonfinite',
          FAKE_RC: '0',
          TMPDIR: path.join(tmp, 'tmp'),
          TMP: path.join(tmp, 'tmp'),
        },
        encoding: 'utf8',
        timeout: 20_000,
      },
    )
    expect(res.status).not.toBe(0)
  })

  it('inconsistent statistics (passed+failed+skipped != total) -> nonzero', () => {
    const tmp = makeFixture('inconsistent', 0)
    const res = spawnSync(
      process.execPath,
      [path.join(tmp, 'scripts', 'run-release-security-tests.mjs')],
      {
        cwd: tmp,
        env: {
          ...process.env,
          FAKE_MODE: 'inconsistent',
          FAKE_RC: '0',
          TMPDIR: path.join(tmp, 'tmp'),
          TMP: path.join(tmp, 'tmp'),
        },
        encoding: 'utf8',
        timeout: 20_000,
      },
    )
    expect(res.status).not.toBe(0)
  })

  it('total === 0 -> nonzero', () => {
    const tmp = makeFixture('valid', 0, { total: 0, passed: 0 })
    const res = spawnSync(
      process.execPath,
      [path.join(tmp, 'scripts', 'run-release-security-tests.mjs')],
      {
        cwd: tmp,
        env: {
          ...process.env,
          FAKE_MODE: 'valid',
          FAKE_RC: '0',
          FAKE_TOTAL: '0',
          FAKE_PASSED: '0',
          TMPDIR: path.join(tmp, 'tmp'),
          TMP: path.join(tmp, 'tmp'),
        },
        encoding: 'utf8',
        timeout: 20_000,
      },
    )
    expect(res.status).not.toBe(0)
  })

  it('failed > 0 -> nonzero and dumps failing test names without crashing on malformed results', () => {
    const tmp = makeFixture('malformed', 0)
    const res = spawnSync(
      process.execPath,
      [path.join(tmp, 'scripts', 'run-release-security-tests.mjs')],
      {
        cwd: tmp,
        env: {
          ...process.env,
          FAKE_MODE: 'malformed',
          FAKE_RC: '0',
          TMPDIR: path.join(tmp, 'tmp'),
          TMP: path.join(tmp, 'tmp'),
        },
        encoding: 'utf8',
        timeout: 20_000,
      },
    )
    expect(res.status).not.toBe(0)
    // M29 WP-A: a malformed report with no suite names fails the per-file
    // contract check first (never crashes the runner).
    expect(String(res.stderr)).toMatch(/missing|not executed|report|failed/i)

    const tmp2 = makeFixture('mismatch', 0)
    const res2 = spawnSync(
      process.execPath,
      [path.join(tmp2, 'scripts', 'run-release-security-tests.mjs')],
      {
        cwd: tmp2,
        env: {
          ...process.env,
          FAKE_MODE: 'mismatch',
          FAKE_RC: '0',
          TMPDIR: path.join(tmp2, 'tmp'),
          TMP: path.join(tmp2, 'tmp'),
        },
        encoding: 'utf8',
        timeout: 20_000,
      },
    )
    expect(res2.status).not.toBe(0)
    expect(String(res2.stderr)).toMatch(/bad-test|boom/)
  })

  it('skipped > 0 -> nonzero', () => {
    const tmp = makeFixture('valid', 0, { total: 3, passed: 2, skipped: 1 })
    const res = spawnSync(
      process.execPath,
      [path.join(tmp, 'scripts', 'run-release-security-tests.mjs')],
      {
        cwd: tmp,
        env: {
          ...process.env,
          FAKE_MODE: 'valid',
          FAKE_RC: '0',
          FAKE_TOTAL: '3',
          FAKE_PASSED: '2',
          FAKE_SKIPPED: '1',
          TMPDIR: path.join(tmp, 'tmp'),
          TMP: path.join(tmp, 'tmp'),
        },
        encoding: 'utf8',
        timeout: 20_000,
      },
    )
    expect(res.status).not.toBe(0)
  })

  it('valid zero-skip report -> exit 0 with summary', () => {
    const tmp = makeFixture('valid', 0)
    const r = runFixture(tmp)
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/total=2 passed=2 failed=0 skipped=0/)
  })

  it('every result path leaves ZERO temp reports behind', () => {
    for (const mode of [
      'missing',
      'empty',
      'corrupt',
      'valid',
      'inconsistent',
      'nonfinite',
      'malformed',
    ]) {
      const tmp = makeFixture(mode, mode === 'valid' ? 0 : 1)
      const res = spawnSync(
        process.execPath,
        [path.join(tmp, 'scripts', 'run-release-security-tests.mjs')],
        {
          cwd: tmp,
          env: {
            ...process.env,
            FAKE_MODE: mode,
            FAKE_RC: mode === 'valid' ? '0' : '1',
            TMPDIR: path.join(tmp, 'tmp'),
            TMP: path.join(tmp, 'tmp'),
          },
          encoding: 'utf8',
          timeout: 20_000,
        },
      )
      void res
      const tmpDir = path.join(tmp, 'tmp')
      const leftovers = fs.existsSync(tmpDir)
        ? fs.readdirSync(tmpDir).filter((f) => f.startsWith('release-security-tests-'))
        : []
      expect(leftovers).toEqual([])
    }
  })

  it('spawn error (missing vitest binary) -> nonzero', () => {
    const tmp = makeTempDir()
    fs.mkdirSync(path.join(tmp, 'scripts'), { recursive: true })
    fs.copyFileSync(RUNNER_SOURCE, path.join(tmp, 'scripts', 'run-release-security-tests.mjs'))
    fs.copyFileSync(
      path.join(REPO_ROOT, 'scripts', 'release-security-test-contract.mjs'),
      path.join(tmp, 'scripts', 'release-security-test-contract.mjs'),
    )
    // No node_modules/vitest at all -> spawnSync error.
    const res = spawnSync(
      process.execPath,
      [path.join(tmp, 'scripts', 'run-release-security-tests.mjs')],
      {
        cwd: tmp,
        env: { ...process.env, TMPDIR: path.join(tmp, 'tmp'), TMP: path.join(tmp, 'tmp') },
        encoding: 'utf8',
        timeout: 20_000,
      },
    )
    expect(res.status).not.toBe(0)
  })
})

// ---------------------------------------------------------------------------
// M29 WP-F: private temp directory + cleanup failure handling (test-first)
// ---------------------------------------------------------------------------

describe('M29 WP-F runner private temp dir and cleanup contract', () => {
  /**
   * Fixture whose fake vitest records the --outputFile path into a marker
   * file so the test can assert WHERE the report lives and that the private
   * directory is gone afterwards.
   */
  function makeRecordedFixture(extra: string): { tmp: string; marker: string } {
    const tmp = makeTempDir()
    fs.mkdirSync(path.join(tmp, 'scripts'), { recursive: true })
    fs.mkdirSync(path.join(tmp, 'node_modules', 'vitest'), { recursive: true })
    fs.mkdirSync(path.join(tmp, 'tests'), { recursive: true })
    fs.mkdirSync(path.join(tmp, 'tmp'), { recursive: true })
    fs.copyFileSync(RUNNER_SOURCE, path.join(tmp, 'scripts', 'run-release-security-tests.mjs'))
    fs.copyFileSync(
      path.join(REPO_ROOT, 'scripts', 'release-security-test-contract.mjs'),
      path.join(tmp, 'scripts', 'release-security-test-contract.mjs'),
    )
    fs.writeFileSync(path.join(tmp, 'tests', 'prepare-release-assets.test.ts'), '')
    fs.writeFileSync(path.join(tmp, 'tests', 'zip-helper-security.test.ts'), '')
    fs.writeFileSync(path.join(tmp, 'tests', 'm28-recovery.test.ts'), '')
    fs.writeFileSync(path.join(tmp, 'tests', 'run-release-security-tests.test.ts'), '')
    fs.writeFileSync(path.join(tmp, 'tests', 'm29-crash-matrix.test.ts'), '')
    fs.writeFileSync(path.join(tmp, 'tests', 'm29-release-gates.test.ts'), '')
    fs.writeFileSync(path.join(tmp, 'tests', 'm29-signal-protocol.test.ts'), '')
    fs.writeFileSync(path.join(tmp, 'tests', 'm30-signal-lifecycle.test.ts'), '')
    fs.writeFileSync(path.join(tmp, 'tests', 'm30-child-lifecycle.test.ts'), '')
    const marker = path.join(tmp, 'tmp', 'marker.txt')
    const fakeVitest = [
      "import fs from 'node:fs'",
      'const args = process.argv.slice(2);',
      "const outIdx = args.findIndex((a) => a.startsWith('--outputFile='));",
      "const out = outIdx >= 0 ? args[outIdx].slice('--outputFile='.length) : 'report.json';",
      `fs.writeFileSync(${JSON.stringify(marker)}, out);`,
      "const suiteNames = ['tests/prepare-release-assets.test.ts', 'tests/zip-helper-security.test.ts', 'tests/m28-recovery.test.ts', 'tests/run-release-security-tests.test.ts', 'tests/m29-crash-matrix.test.ts', 'tests/m29-release-gates.test.ts', 'tests/m29-signal-protocol.test.ts', 'tests/m30-signal-lifecycle.test.ts', 'tests/m30-child-lifecycle.test.ts'];",
      'const report = { numTotalTests: 9, numPassedTests: 9, numFailedTests: 0, numSkippedTests: 0, numPendingTests: 0, numTodoTests: 0, testResults: suiteNames.map((name) => ({ name, assertionResults: [{ fullName: name + "::t", status: "passed" }] })) };',
      'fs.writeFileSync(out, JSON.stringify(report));',
      extra,
      'process.exit(0);',
    ].join('\n')
    fs.writeFileSync(path.join(tmp, 'node_modules', 'vitest', 'vitest.mjs'), fakeVitest)
    return { tmp, marker }
  }

  function spawnRunner(
    tmp: string,
    env?: Record<string, string>,
  ): { status: number; stdout: string; stderr: string } {
    const res = spawnSync(
      process.execPath,
      [path.join(tmp, 'scripts', 'run-release-security-tests.mjs')],
      {
        cwd: tmp,
        env: { ...process.env, TMPDIR: path.join(tmp, 'tmp'), TMP: path.join(tmp, 'tmp'), ...env },
        encoding: 'utf8',
        timeout: 20_000,
      },
    )
    return { status: res.status ?? -1, stdout: res.stdout ?? '', stderr: res.stderr ?? '' }
  }

  it('F1: report lives inside a private mkdtemp directory, not a predictable PID file', () => {
    const { tmp, marker } = makeRecordedFixture('')
    const r = spawnRunner(tmp)
    expect(r.status).toBe(0)
    const recorded = fs.readFileSync(marker, 'utf8')
    const parent = path.dirname(recorded)
    const base = path.basename(parent)
    expect(base).toMatch(/^release-security-tests-/)
    expect(path.basename(recorded)).not.toMatch(/^release-security-tests-\d+\.json$/)
    // The private directory must be fully removed on success (zero residue).
    expect(fs.existsSync(parent)).toBe(false)
    const leftovers = fs.existsSync(path.join(tmp, 'tmp'))
      ? fs.readdirSync(path.join(tmp, 'tmp')).filter((f) => f.startsWith('release-security-tests-'))
      : []
    expect(leftovers).toEqual([])
  })

  it('F2: cleanup failure (unlink EACCES) must make the gate NONZERO and report the cleanup error', () => {
    const { tmp } = makeRecordedFixture('fs.chmodSync(process.env.TMPDIR, 0o555);')
    const r = spawnRunner(tmp)
    try {
      fs.chmodSync(path.join(tmp, 'tmp'), 0o755)
    } catch {
      // best effort
    }
    expect(r.status).not.toBe(0)
    expect(r.stderr).toMatch(/cleanup|remove|temp/i)
  })

  it('F3: temp directory creation failure fails closed with an explicit message', () => {
    const { tmp } = makeRecordedFixture('')
    // TMPDIR points to a path whose parent is a regular FILE -> mkdtemp fails.
    const blocker = path.join(tmp, 'blocker')
    fs.writeFileSync(blocker, 'file')
    const r = spawnRunner(tmp, {
      TMPDIR: path.join(blocker, 'nested'),
      TMP: path.join(blocker, 'nested'),
    })
    expect(r.status).not.toBe(0)
    expect(r.stderr).toMatch(/temp|mkdtemp|temporary/i)
  })

  it('F4: report path replaced by a symlink is handled without crashes (read-through allowed)', () => {
    const { tmp } = makeRecordedFixture(
      "fs.rmSync(out, { force: true }); fs.symlinkSync(out + '.real', out); fs.writeFileSync(out + '.real', JSON.stringify({ numTotalTests: 9, numPassedTests: 9, numFailedTests: 0, numSkippedTests: 0, numPendingTests: 0, numTodoTests: 0, testResults: ['tests/prepare-release-assets.test.ts', 'tests/zip-helper-security.test.ts', 'tests/m28-recovery.test.ts', 'tests/run-release-security-tests.test.ts', 'tests/m29-crash-matrix.test.ts', 'tests/m29-release-gates.test.ts', 'tests/m29-signal-protocol.test.ts', 'tests/m30-signal-lifecycle.test.ts', 'tests/m30-child-lifecycle.test.ts'].map((name) => ({ name, assertionResults: [{ fullName: name + '::t', status: 'passed' }] })) }));",
    )
    const r = spawnRunner(tmp)
    expect(r.status).toBe(0)
    const leftovers = fs.existsSync(path.join(tmp, 'tmp'))
      ? fs.readdirSync(path.join(tmp, 'tmp')).filter((f) => f.startsWith('release-security-tests-'))
      : []
    expect(leftovers).toEqual([])
  })

  it('F5: report path replaced by a directory fails closed', () => {
    const { tmp } = makeRecordedFixture('fs.rmSync(out, { force: true }); fs.mkdirSync(out);')
    const r = spawnRunner(tmp)
    expect(r.status).not.toBe(0)
  })

  it('F6: original test failure AND cleanup failure are BOTH reported in stderr', () => {
    // Fake vitest reports 1 failed test AND leaves the temp dir read-only.
    const { tmp } = makeRecordedFixture(
      'fs.chmodSync(process.env.TMPDIR, 0o555); const p = JSON.parse(fs.readFileSync(out, "utf8")); p.numFailedTests = 1; p.numPassedTests = 1; p.testResults[0].assertionResults = [{ fullName: "suite::bad", status: "failed", failureMessages: ["boom"] }]; fs.writeFileSync(out, JSON.stringify(p));',
    )
    const r = spawnRunner(tmp)
    try {
      fs.chmodSync(path.join(tmp, 'tmp'), 0o755)
    } catch {
      // best effort
    }
    expect(r.status).not.toBe(0)
    expect(r.stderr).toMatch(/bad|boom|failed/i)
    expect(r.stderr).toMatch(/cleanup|remove|temp/i)
  })

  it('F7: vitest child timeout fails the gate via RELEASE_SECURITY_TIMEOUT_MS', () => {
    const { tmp } = makeRecordedFixture('')
    // Fake vitest that never exits; runner must fail via child timeout.
    fs.writeFileSync(
      path.join(tmp, 'node_modules', 'vitest', 'vitest.mjs'),
      "import fs from 'node:fs'\nconst args = process.argv.slice(2);\nconst outIdx = args.findIndex((a) => a.startsWith('--outputFile='));\nconst out = outIdx >= 0 ? args[outIdx].slice('--outputFile='.length) : 'report.json';\nsetTimeout(() => { fs.writeFileSync(out, JSON.stringify({ numTotalTests: 1, numPassedTests: 1, numFailedTests: 0, numSkippedTests: 0, numPendingTests: 0, numTodoTests: 0, testResults: [{ name: 'tests/prepare-release-assets.test.ts', assertionResults: [{ fullName: 'x', status: 'passed' }] }] })); process.exit(0); }, 15000);\n",
    )
    const res = spawnSync(
      process.execPath,
      [path.join(tmp, 'scripts', 'run-release-security-tests.mjs')],
      {
        cwd: tmp,
        env: {
          ...process.env,
          TMPDIR: path.join(tmp, 'tmp'),
          TMP: path.join(tmp, 'tmp'),
          RELEASE_SECURITY_TIMEOUT_MS: '1000',
        },
        encoding: 'utf8',
        timeout: 20_000,
      },
    )
    expect(res.status).not.toBe(0)
    expect(String(res.stderr)).toMatch(/timeout|timed out|ETIMEDOUT/i)
  })
})
