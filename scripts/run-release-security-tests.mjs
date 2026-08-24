// Zero-skip test runner (M27 WP-G #6, fail-closed M28 WP-C).
//
// Runs the generator/security vitest suites and FAILS if any test is
// skipped, if the JSON report is missing/empty/corrupt/inconsistent, or if
// vitest itself exits nonzero / is signaled / times out / fails to spawn.
//
// The runner never calls process.exit() in the middle; run() returns an exit
// code, process.exitCode is set exactly once at the top level, and the
// temporary JSON report is removed in a finally block that runs on every
// result path (success, test failure, parse failure, signal, exception).

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const testFiles = ['tests/prepare-release-assets.test.ts', 'tests/zip-helper-security.test.ts']

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

/** @returns {number} exit code */
function run() {
  const outputFile = path.join(os.tmpdir(), 'release-security-tests-' + process.pid + '.json')
  try {
    fs.rmSync(outputFile, { force: true })

    const result = spawnSync(
      process.execPath,
      [
        path.join(repoRoot, 'node_modules', 'vitest', 'vitest.mjs'),
        'run',
        ...testFiles,
        '--reporter=json',
        '--outputFile=' + outputFile,
      ],
      {
        cwd: repoRoot,
        stdio: 'inherit',
        timeout: 10 * 60_000,
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
      'release-security: total=' +
        total +
        ' passed=' +
        passed +
        ' failed=' +
        failed +
        ' skipped=' +
        skipped +
        '\n',
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
  } finally {
    // Every path -- success, test failure, parse failure, signal, exception --
    // removes the temp report (M28 WP-C).
    try {
      fs.rmSync(outputFile, { force: true })
    } catch {
      // best effort
    }
  }
}

process.exitCode = run()
