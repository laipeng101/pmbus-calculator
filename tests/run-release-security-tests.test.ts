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
  fs.writeFileSync(path.join(tmp, 'tests', 'prepare-release-assets.test.ts'), '')
  fs.writeFileSync(path.join(tmp, 'tests', 'zip-helper-security.test.ts'), '')

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
    '  report.testResults = [{ assertionResults: [{ fullName: "suite::bad-test", status: "failed", failureMessages: ["boom"] }] }];',
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
    expect(String(res.stderr)).toMatch(/failing|failed/i)

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
