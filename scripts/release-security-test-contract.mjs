// M29 WP-A: single source of truth for the release-security zero-skip gate.
//
// The runner (scripts/run-release-security-tests.mjs) and the contract tests
// (tests/run-release-security-tests.test.ts, tests/m29-release-gates.test.ts)
// MUST import this list -- neither side may hardcode its own file list.
//
// The list is the fail-closed contract: if a file is missing, renamed, or
// silently not executed by vitest, the gate must fail even when the total
// test count happens to look healthy.

export const SECURITY_TEST_FILES = Object.freeze([
  'tests/prepare-release-assets.test.ts',
  'tests/zip-helper-security.test.ts',
  'tests/m28-recovery.test.ts',
  'tests/run-release-security-tests.test.ts',
])

/**
 * Advisory lower bound for the total executed test count. This is a
 * reporting hint (CI log) and a sanity floor, NOT the primary contract:
 * the primary contract is per-file presence in the report plus
 * zero skipped/todo/pending. Do not use a drifting total as the only gate.
 */
export const SECURITY_TESTS_MIN_TOTAL = 137

/**
 * Validate that a vitest JSON report actually executed every expected file.
 *
 * @param {unknown} summary -- parsed vitest JSON report
 * @param {{ testFiles?: readonly string[] }} [opts]
 * @returns {{ ok: true, missing: string[], suites: string[] } | { ok: false, reason: string, missing: string[] }}
 */
export function validateSecurityReportFiles(summary, opts = {}) {
  const expected = opts.testFiles || SECURITY_TEST_FILES
  if (summary === null || typeof summary !== 'object' || Array.isArray(summary)) {
    return { ok: false, reason: 'report is not an object', missing: [...expected] }
  }
  const results = /** @type {any} */ (summary).testResults
  if (!Array.isArray(results)) {
    return { ok: false, reason: 'report has no testResults array', missing: [...expected] }
  }
  /** @type {string[]} */
  const suites = []
  for (const suite of results) {
    const anySuite = /** @type {any} */ (suite)
    if (anySuite && typeof anySuite === 'object' && typeof anySuite.name === 'string') {
      suites.push(anySuite.name)
    }
  }
  const missing = expected.filter(
    (f) => !suites.some((s) => s === f || s.endsWith('/' + f) || s.endsWith('\\' + f)),
  )
  if (missing.length > 0) {
    return {
      ok: false,
      reason: `report did not execute expected security test files: ${missing.join(', ')}`,
      missing,
    }
  }
  return { ok: true, missing: [], suites }
}
