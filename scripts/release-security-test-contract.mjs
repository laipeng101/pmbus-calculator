// M29 WP-A / M30 WP-D: single source of truth for the release-security
// zero-skip gate.
//
// The runner (scripts/run-release-security-tests.mjs) and the contract tests
// (tests/run-release-security-tests.test.ts, tests/m29-release-gates.test.ts)
// MUST import this list -- neither side may hardcode its own file list.
//
// The list is the fail-closed contract: if a file is missing, renamed, or
// silently not executed by vitest, the gate must fail even when the total
// test count happens to look healthy.
//
// M30 WP-D: the seven M29-era security suites are joined by the two new M30
// release-security suites (repeated-signal lifecycle and controlled
// child/process-tree lifecycle). M32 adds the tenth suite: process-group
// lifecycle (direct-child close != process-group gone; post-spawn error
// contract). M33 adds the eleventh suite: crash-consistent child ownership,
// bounded fail-closed exit and lock-recovery safety. None of these files
// invoke the runner itself, so the gate cannot recurse.

export const SECURITY_TEST_FILES = Object.freeze([
  'tests/prepare-release-assets.test.ts',
  'tests/zip-helper-security.test.ts',
  'tests/m28-recovery.test.ts',
  'tests/run-release-security-tests.test.ts',
  'tests/m29-crash-matrix.test.ts',
  'tests/m29-release-gates.test.ts',
  'tests/m29-signal-protocol.test.ts',
  'tests/m30-signal-lifecycle.test.ts',
  'tests/m30-child-lifecycle.test.ts',
  'tests/m32-child-group-lifecycle.test.ts',
  'tests/m33-child-ownership-recovery.test.ts',
  'tests/m34-child-state-signal-gate.test.ts',
])

/**
 * M34 WP-D: phased scheduling split. Files that only exercise structure /
 * parsing / fixture-driven disk states may run with limited parallelism.
 * Files that own REAL process-group lifecycles / signals / child registries /
 * lock races must run one file at a time with fileParallelism=false so
 * cross-file process interference is structurally impossible.
 *
 * The split must be exhaustive and disjoint (both are asserted by contract
 * tests): every SECURITY_TEST_FILES entry is in exactly one bucket.
 */
export const SECURITY_TEST_FILES_PARALLEL = Object.freeze([
  'tests/m29-crash-matrix.test.ts',
  'tests/m29-release-gates.test.ts',
])

export const SECURITY_TEST_FILES_SERIAL = Object.freeze(
  SECURITY_TEST_FILES.filter((f) => !SECURITY_TEST_FILES_PARALLEL.includes(f)),
)

/**
 * Advisory lower bound for the total executed test count. This is a
 * reporting hint (CI log) and a sanity floor, NOT the primary contract:
 * the primary contract is per-file presence in the report plus
 * zero skipped/todo/pending. Do not use a drifting total as the only gate.
 */
export const SECURITY_TESTS_MIN_TOTAL = 213

/**
 * M34 WP-D: aggregate the per-batch vitest JSON reports produced by the
 * phased runner and validate the union. Pure function -- independently
 * negative-tested (missing / extra / duplicate / skip / todo / failed /
 * corrupt / inconsistent counters / child status / signal / error).
 *
 * @param {Array<{
 *   file?: string,
 *   status: number | null,
 *   signal: string | null,
 *   error?: string | null,
 *   report: any,
 * }>} batches
 * @param {{ testFiles?: readonly string[], minTotal?: number }} [opts]
 * @returns {{
 *   ok: boolean,
 *   reason?: string,
 *   total: number,
 *   passed: number,
 *   failed: number,
 *   skipped: number,
 *   todo: number,
 *   suites: string[],
 *   missing: string[],
 *   extra: string[],
 *   duplicates: string[],
 * }}
 */
export function aggregateSecurityReports(batches, opts = {}) {
  const expected = opts.testFiles || SECURITY_TEST_FILES
  const minTotal = opts.minTotal ?? SECURITY_TESTS_MIN_TOTAL

  /** @type {Record<string, number>} */
  const seen = {}
  /** @type {string[]} */
  const suites = []
  /** @type {string[]} */
  const duplicates = []
  let total = 0
  let passed = 0
  let failed = 0
  let skipped = 0
  let todo = 0

  /** @param {string} reason @param {{ missing?: string[], extra?: string[], duplicates?: string[] }} [detail] */
  const fail = (reason, detail = {}) => ({
    ok: false,
    reason,
    total,
    passed,
    failed,
    skipped,
    todo,
    suites,
    missing: (detail && detail.missing) ?? [...expected],
    extra: (detail && detail.extra) ?? [],
    duplicates: (detail && detail.duplicates) ?? [],
  })

  if (!Array.isArray(batches)) return fail('batches is not an array')
  for (const batch of batches) {
    if (batch === null || typeof batch !== 'object') return fail('a batch is not an object')
    // child status / signal / error fail regardless of any report (M28 WP-C).
    if (batch.signal) {
      const errDetail = batch.error ? ` (${batch.error})` : ''
      return fail(
        `vitest was terminated by signal ${batch.signal}${errDetail}${batch.file ? ` (${batch.file})` : ''}`,
      )
    }
    if (batch.error)
      return fail(`failed to start vitest: ${batch.error}${batch.file ? ` (${batch.file})` : ''}`)
    if (typeof batch.status !== 'number' || !Number.isInteger(batch.status)) {
      return fail(`batch status missing/invalid${batch.file ? ` (${batch.file})` : ''}`)
    }
    if (batch.status !== 0) {
      return fail(
        `vitest exited with status ${batch.status}${batch.file ? ` (${batch.file})` : ''}`,
      )
    }
    const report = batch.report
    if (report === null || typeof report !== 'object' || Array.isArray(report)) {
      return fail(`a vitest report is not an object${batch.file ? ` (${batch.file})` : ''}`)
    }
    // counters must be finite non-negative integers
    for (const field of [
      'numTotalTests',
      'numPassedTests',
      'numFailedTests',
      'numPendingTests',
      'numTodoTests',
    ]) {
      const v = report[field]
      if (typeof v !== 'number' || !Number.isFinite(v) || !Number.isInteger(v) || v < 0) {
        return fail(`report field ${field} is not a finite non-negative integer: ${String(v)}`)
      }
    }
    total += report.numTotalTests
    passed += report.numPassedTests
    failed += report.numFailedTests
    skipped += report.numPendingTests
    todo += report.numTodoTests
    const results = Array.isArray(report.testResults) ? report.testResults : []
    for (const suite of results) {
      const name =
        suite && typeof suite === 'object' && typeof suite.name === 'string' ? suite.name : null
      if (name === null) continue
      suites.push(name)
      seen[name] = (seen[name] || 0) + 1
    }
  }

  if (total <= 0) return fail('no tests ran -- refusing to pass (total=0)')
  if (passed + failed + skipped + todo !== total) {
    return fail(
      `report statistics are inconsistent: passed(${passed}) + failed(${failed}) + skipped(${skipped}) + todo(${todo}) != total(${total})`,
    )
  }
  const missing = expected.filter(
    (f) => !suites.some((s) => s === f || s.endsWith('/' + f) || s.endsWith('\\' + f)),
  )
  if (missing.length > 0) {
    return fail(`report did not execute expected security test files: ${missing.join(', ')}`, {
      missing,
    })
  }
  const extra = suites.filter(
    (s) => !expected.some((f) => s === f || s.endsWith('/' + f) || s.endsWith('\\' + f)),
  )
  if (extra.length > 0) {
    return fail(
      `report executed unexpected test files not in SECURITY_TEST_FILES: ${extra.join(', ')}`,
      { missing, extra },
    )
  }
  for (const [name, count] of Object.entries(seen)) {
    if (count > 1) duplicates.push(name)
  }
  if (duplicates.length > 0) {
    return fail(`security test files executed more than once: ${duplicates.join(', ')}`, {
      missing,
      extra,
      duplicates,
    })
  }
  if (total < minTotal) {
    return fail(`total (${total}) below the contract floor (${minTotal})`)
  }
  if (skipped + todo > 0) {
    return fail(
      `${skipped + todo} skipped/todo test(s) in security suites -- zero-skip policy violated`,
    )
  }
  if (failed > 0) {
    return fail(`${failed} failed test(s) in security suites`)
  }
  return { ok: true, total, passed, failed, skipped, todo, suites, missing, extra, duplicates }
}

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
