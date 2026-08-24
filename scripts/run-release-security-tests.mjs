// Zero-skip release-security runner (M27 WP-G #6, M28 WP-C, M29 WP-A/WP-F).
//
// M29 WP-A: the file list comes from scripts/release-security-test-contract.mjs
// (SECURITY_TEST_FILES) -- the same list the contract tests import. The gate
// fails closed when any expected file is missing, renamed, or silently not
// executed by vitest, and the report must contain exactly the expected
// suites. The four expected files and the zero-skip counters are printed to
// stdout so CI logs show the actual coverage.
//
// M29 WP-F: the JSON report lives inside a fresh private mkdtemp directory
// (mode 0o700) -- never a predictable /tmp/release-security-tests-<pid>.json.
// Cleanup (report + directory) runs on every path; a cleanup failure makes
// the gate NONZERO and is reported in stderr alongside any original test
// failure. The runner never calls process.exit() mid-stream; main() returns
// an exit code and sets process.exitCode exactly once.
//
// The vitest child timeout can be shortened via RELEASE_SECURITY_TIMEOUT_MS
// (default 10 minutes) so fixtures can exercise child timeout/signal paths.

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import {
  SECURITY_TEST_FILES,
  SECURITY_TESTS_MIN_TOTAL,
  validateSecurityReportFiles,
} from './release-security-test-contract.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * @param {string} message
 * @returns {1}
 */
function fail(message) {
  process.stderr.write('run-release-security-tests: ' + message + '\n')
  return 1
}

/**
 * Dump failing test names (status === 'failed') when available, but never
 * crash on a malformed assertionResults shape (M28 WP-C).
 *
 * @param {unknown} summary
 */
function dumpFailureNames(summary) {
  try {
    const results = /** @type {{ testResults?: unknown }} */ (summary).testResults
    if (!Array.isArray(results)) return
    const names = []
    for (const suite of results) {
      const assertions = /** @type {any} */ (suite).assertionResults
      if (!Array.isArray(assertions)) continue
      for (const assertion of assertions) {
        if (assertion && typeof assertion === 'object' && assertion.status === 'failed') {
          const name = String(/** @type {any} */ (assertion).fullName ?? '(unknown test)')
          const messages = Array.isArray(/** @type {any} */ (assertion).failureMessages)
            ? assertion /** @type {any} */.failureMessages
                .join(' | ')
                .slice(0, 2000)
            : ''
          names.push(name + (messages ? ' :: ' + messages : ''))
        }
      }
    }
    if (names.length > 0) {
      process.stderr.write('run-release-security-tests: failing tests:\n' + names.join('\n') + '\n')
    }
  } catch {
    // Malformed assertionResults must not crash the runner.
  }
}

/**
 * Dump failing/skipped test names when available, but never crash on a
 * malformed assertionResults shape (M28 WP-C).
 *
 * @param {unknown} summary
 * @returns {string[]} names of non-passed, non-failed assertions
 */
function collectProblemNames(summary) {
  /** @type {string[]} */
  const names = []
  try {
    const results = /** @type {{ testResults?: unknown }} */ (summary).testResults
    if (!Array.isArray(results)) return names
    for (const suite of results) {
      const assertions = /** @type {any} */ (suite).assertionResults
      if (!Array.isArray(assertions)) continue
      for (const assertion of assertions) {
        if (
          assertion &&
          typeof assertion === 'object' &&
          assertion.status !== 'passed' &&
          assertion.status !== 'failed'
        ) {
          const name = String(/** @type {any} */ (assertion).fullName ?? '(unknown test)')
          names.push(name + ' :: status=' + String(/** @type {any} */ (assertion).status))
        }
      }
    }
  } catch {
    // Malformed assertionResults must not crash the runner.
  }
  return names
}

/**
 * Run vitest and evaluate its JSON report. Returns an exit code; the caller
 * owns cleanup of the private work directory.
 *
 * @param {string} outputFile
 * @returns {number}
 */
function runOnce(outputFile) {
  try {
    fs.rmSync(outputFile, { force: true })

    const timeoutMs = Number(process.env.RELEASE_SECURITY_TIMEOUT_MS || 10 * 60_000)
    const result = spawnSync(
      process.execPath,
      [
        path.join(repoRoot, 'node_modules', 'vitest', 'vitest.mjs'),
        'run',
        ...SECURITY_TEST_FILES,
        '--reporter=json',
        '--outputFile=' + outputFile,
      ],
      {
        cwd: repoRoot,
        stdio: 'inherit',
        timeout: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 10 * 60_000,
      },
    )

    // spawn error / signal / timeout fail regardless of any report (M28 WP-C).
    if (result.error) {
      return fail('failed to start vitest: ' + result.error.message)
    }
    if (result.signal) {
      return fail('vitest was terminated by signal ' + result.signal)
    }

    // The report must exist, be non-empty, and parse as JSON -- even when
    // vitest exits nonzero, so failing test names can be surfaced.
    let raw
    try {
      raw = fs.readFileSync(outputFile, 'utf8')
    } catch (e) {
      return fail(
        'vitest JSON report is missing or unreadable: ' + /** @type {Error} */ (e).message,
      )
    }
    if (raw.trim() === '') {
      return fail('vitest JSON report is empty')
    }
    /** @type {any} */
    let summary
    try {
      summary = JSON.parse(raw)
    } catch {
      return fail('vitest JSON report is corrupt (not valid JSON)')
    }
    if (summary === null || typeof summary !== 'object' || Array.isArray(summary)) {
      return fail('vitest JSON report is not an object')
    }

    // M29 WP-A #4/#5: the report must contain exactly the expected suites.
    const fileCheck = validateSecurityReportFiles(summary)
    if (!fileCheck.ok) {
      return fail(fileCheck.reason)
    }
    // Extra suites beyond the contract are also a mismatch (file count != list).
    const extra = fileCheck.suites.filter(
      (s) =>
        !SECURITY_TEST_FILES.some((f) => s === f || s.endsWith('/' + f) || s.endsWith('\\' + f)),
    )
    if (extra.length > 0) {
      return fail(
        `report executed unexpected test files not in SECURITY_TEST_FILES: ${extra.join(', ')}`,
      )
    }

    // Counters present in vitest v4 JSON reports. numSkippedTests does NOT
    // exist in this reporter; skipped tests are reported as numPendingTests
    // (it.skip) and numTodoTests (it.todo). Missing/invalid counters fail.
    const counters = [
      ['numTotalTests', 'total'],
      ['numPassedTests', 'passed'],
      ['numFailedTests', 'failed'],
      ['numPendingTests', 'skipped'],
      ['numTodoTests', 'todo'],
    ]
    /** @type {Record<string, number>} */
    const values = {}
    for (const [field] of counters) {
      const v = summary[field]
      if (typeof v !== 'number' || !Number.isFinite(v) || !Number.isInteger(v) || v < 0) {
        return fail('report field ' + field + ' is not a finite non-negative integer: ' + String(v))
      }
      values[field] = v
    }

    const total = values.numTotalTests
    const passed = values.numPassedTests
    const failed = values.numFailedTests
    const skipped = values.numPendingTests + values.numTodoTests

    if (total <= 0) {
      return fail('no tests ran -- refusing to pass (total=' + String(total) + ')')
    }
    if (passed + failed + skipped !== total) {
      return fail(
        'report statistics are inconsistent: passed(' +
          String(passed) +
          ') + failed(' +
          String(failed) +
          ') + skipped(' +
          String(skipped) +
          ') != total(' +
          String(total) +
          ')',
      )
    }

    process.stdout.write(
      'release-security: security files:\n' +
        SECURITY_TEST_FILES.map((f) => '  - ' + f).join('\n') +
        '\n',
    )
    process.stdout.write(
      'release-security: total=' +
        total +
        ' passed=' +
        passed +
        ' failed=' +
        failed +
        ' skipped=' +
        skipped +
        ' (contract floor ' +
        SECURITY_TESTS_MIN_TOTAL +
        '; zero-skip policy: skipped+todo must be 0)\n',
    )

    // Assertion-level cross-check: a status other than passed/failed is a
    // skip that summary counters must not be able to hide (M28 WP-C).
    const problemNames = collectProblemNames(summary)
    if (problemNames.length > 0) {
      process.stderr.write(
        'run-release-security-tests: skipped/todo tests:\n' + problemNames.join('\n') + '\n',
      )
      return fail(
        String(problemNames.length) + ' skipped/todo test(s) -- zero-skip policy violated',
      )
    }

    // vitest status must be exactly 0 (M28 WP-C).
    if (result.status !== 0) {
      dumpFailureNames(summary)
      return fail('vitest exited with status ' + String(result.status))
    }

    if (failed > 0) {
      dumpFailureNames(summary)
      return fail(String(failed) + ' failed test(s) in security suites')
    }
    if (skipped !== 0) {
      return fail(
        String(skipped) + ' skipped test(s) in security suites -- zero-skip policy violated',
      )
    }

    return 0
  } catch (e) {
    return fail('unexpected runner error: ' + /** @type {Error} */ (e).message)
  }
}

/**
 * Run the gate. The private work directory is created here so a temp-dir
 * creation failure is itself fail-closed, and cleanup runs on EVERY path.
 *
 * @returns {number} exit code
 */
function run() {
  /** @type {string | null} */
  let workDir = null
  try {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-security-tests-'))
  } catch (e) {
    return fail(
      'temporary directory creation failed: ' +
        /** @type {Error} */ (e).message +
        ' -- refusing to run (M29 WP-F)',
    )
  }
  const outputFile = path.join(workDir, 'report.json')

  let code = runOnce(outputFile)

  // M29 WP-F cleanup contract: remove report + private directory. A cleanup
  // failure must surface in stderr and force a nonzero exit; it must never
  // be swallowed, and must not overwrite the original failure.
  try {
    fs.rmSync(workDir, { recursive: true, force: true })
  } catch (e) {
    process.stderr.write(
      'run-release-security-tests: CLEANUP FAILED: ' +
        /** @type {Error} */ (e).message +
        ' -- residue may remain at ' +
        workDir +
        '; treat the gate as FAILED\n',
    )
    if (code === 0) {
      code = 1
    }
  }
  return code
}

process.exitCode = run()
