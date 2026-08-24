// Zero-skip release-security runner (M27 WP-G #6, M28 WP-C, M29 WP-A/WP-F,
// M34 WP-D phased scheduling + aggregation).
//
// M29 WP-A: the file list comes from scripts/release-security-test-contract.mjs
// (SECURITY_TEST_FILES) -- the same list the contract tests import. The gate
// fails closed when any expected file is missing, renamed, or silently not
// executed by vitest, and the report must contain exactly the expected
// suites. The expected files and the zero-skip counters are printed to
// stdout so CI logs show the actual coverage.
//
// M34 WP-D: the suite is NOT run as one big parallel batch any more. Files
// that own REAL process-group lifecycles / signals / child registries / lock
// races run ONE FILE at a time with --fileParallelism=false --maxWorkers=1
// (SECURITY_TEST_FILES_SERIAL); structure/parsing/fixture files run in one
// limited-parallelism batch (SECURITY_TEST_FILES_PARALLEL). Each file is
// executed EXACTLY ONCE (the aggregation rejects duplicates). The per-batch
// JSON reports are merged by aggregateSecurityReports (independent negative
// tests in tests/run-release-security-tests.test.ts).
//
// Failure diagnostics: when RELEASE_SECURITY_REPORT_DIR is set, the runner
// copies every JSON report + a merged summary there (CI uploads this as a
// short-retention artifact); otherwise the private temp dir path is printed
// so a local failure keeps a clear path. A cleanup failure makes the gate
// NONZERO and is reported in stderr alongside the original failure. The
// runner never calls process.exit() mid-stream; main() returns an exit code
// and sets process.exitCode exactly once.
//
// The vitest child timeout can be shortened via RELEASE_SECURITY_TIMEOUT_MS
// (default 10 minutes per batch) so fixtures can exercise child
// timeout/signal paths.

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import {
  SECURITY_TEST_FILES,
  SECURITY_TEST_FILES_PARALLEL,
  SECURITY_TEST_FILES_SERIAL,
  SECURITY_TESTS_MIN_TOTAL,
  aggregateSecurityReports,
} from './release-security-test-contract.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const VITEST = path.join(repoRoot, 'node_modules', 'vitest', 'vitest.mjs')

/**
 * @param {string} message
 * @returns {1}
 */
function fail(message) {
  process.stderr.write('run-release-security-tests: ' + message + '\n')
  return 1
}

/**
 * Dump failing test names (status === 'failed') across all batch reports,
 * but never crash on a malformed assertionResults shape (M28 WP-C).
 *
 * @param {Array<{ report?: any }>} batches
 */
function dumpFailureNames(batches) {
  try {
    const names = []
    for (const batch of batches) {
      const summary = batch && batch.report
      if (!summary || typeof summary !== 'object') continue
      const results = /** @type {{ testResults?: unknown }} */ (summary).testResults
      if (!Array.isArray(results)) continue
      for (const suite of results) {
        const assertions = /** @type {any} */ (suite).assertionResults
        if (!Array.isArray(assertions)) continue
        for (const assertion of assertions) {
          if (assertion && typeof assertion === 'object' && assertion.status === 'failed') {
            const name = String(/** @type {any} */ (assertion).fullName ?? '(unknown test)')
            const messages = Array.isArray(/** @type {any} */ (assertion).failureMessages)
              ? /** @type {any} */ (assertion).failureMessages.join(' | ').slice(0, 2000)
              : ''
            names.push(name + (messages ? ' :: ' + messages : ''))
          }
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
 * Dump failing/skipped test names when available across all batch reports.
 *
 * @param {Array<{ report?: any }>} batches
 * @returns {string[]} names of non-passed, non-failed assertions
 */
function collectProblemNames(batches) {
  /** @type {string[]} */
  const names = []
  try {
    for (const batch of batches) {
      const summary = batch && batch.report
      if (!summary || typeof summary !== 'object') continue
      const results = /** @type {{ testResults?: unknown }} */ (summary).testResults
      if (!Array.isArray(results)) continue
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
    }
  } catch {
    // Malformed assertionResults must not crash the runner.
  }
  return names
}

/**
 * Run one vitest batch (either the parallel batch or a single serial file).
 *
 * @param {string[]} files
 * @param {{ serial: boolean, outputFile: string, timeoutMs: number }} opts
 * @returns {{ file?: string, status: number | null, signal: string | null, error: string | null, report: any, outputFile: string }}
 */
function runVitestBatch(files, opts) {
  const args = [
    'run',
    ...files,
    '--reporter=default',
    '--reporter=json',
    '--outputFile=' + opts.outputFile,
  ]
  if (opts.serial) {
    // M34 WP-D: one file at a time, no cross-file worker interference.
    args.push('--fileParallelism=false', '--maxWorkers=1')
  }
  const result = spawnSync(process.execPath, [VITEST, ...args], {
    cwd: repoRoot,
    stdio: 'inherit',
    timeout: opts.timeoutMs,
  })
  /** @type {any} */
  let report = null
  try {
    report = JSON.parse(fs.readFileSync(opts.outputFile, 'utf8'))
  } catch {
    report = null
  }
  return {
    file: files.length === 1 ? files[0] : undefined,
    status: result.status,
    signal: result.signal,
    error: result.error ? result.error.message : null,
    report,
    outputFile: opts.outputFile,
  }
}

/**
 * Run the phased gate and aggregate the reports. Returns an exit code; the
 * caller owns cleanup of the private work directory (unless diagnostics were
 * preserved to RELEASE_SECURITY_REPORT_DIR).
 *
 * @returns {number}
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

  const timeoutMs = Number(process.env.RELEASE_SECURITY_TIMEOUT_MS || 10 * 60_000)
  const childTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 10 * 60_000

  /** @type {Array<ReturnType<typeof runVitestBatch>>} */
  const batches = []

  // Phase 1: structure/parsing/fixture files -- one limited-parallelism batch.
  const parallelFile = path.join(workDir, 'parallel.json')
  batches.push(
    runVitestBatch([...SECURITY_TEST_FILES_PARALLEL], {
      serial: false,
      outputFile: parallelFile,
      timeoutMs: childTimeout,
    }),
  )

  // Phase 2: real signal/process-group/recovery files -- one file at a time.
  SECURITY_TEST_FILES_SERIAL.forEach((f, i) => {
    batches.push(
      runVitestBatch([f], {
        serial: true,
        outputFile: path.join(workDir, `serial-${i}.json`),
        timeoutMs: childTimeout,
      }),
    )
  })

  // Aggregation (M34 WP-D): the union must be exact.
  const agg = aggregateSecurityReports(batches)

  process.stdout.write(
    'release-security: security files:\n' +
      SECURITY_TEST_FILES.map((f) => '  - ' + f).join('\n') +
      '\n',
  )
  process.stdout.write(
    'release-security: phased batches: parallel=' +
      SECURITY_TEST_FILES_PARALLEL.length +
      ', serial=' +
      SECURITY_TEST_FILES_SERIAL.length +
      ' (fileParallelism=false)\n',
  )
  process.stdout.write(
    'release-security: total=' +
      agg.total +
      ' passed=' +
      agg.passed +
      ' failed=' +
      agg.failed +
      ' skipped=' +
      agg.skipped +
      ' todo=' +
      agg.todo +
      ' (contract floor ' +
      SECURITY_TESTS_MIN_TOTAL +
      '; zero-skip policy: skipped+todo must be 0)\n',
  )

  let code = 0
  if (!agg.ok) {
    code = 1
    dumpFailureNames(batches)
    process.stderr.write('run-release-security-tests: ' + agg.reason + '\n')
  }
  const problemNames = collectProblemNames(batches)
  if (problemNames.length > 0) {
    process.stderr.write(
      'run-release-security-tests: skipped/todo tests:\n' + problemNames.join('\n') + '\n',
    )
    if (code === 0) {
      code = 1
    }
  }

  // Machine-readable merged summary (M34 WP-D: JSON out alongside the
  // default reporter already inherited from vitest).
  const summary = {
    ok: agg.ok,
    reason: agg.ok ? null : agg.reason,
    total: agg.total,
    passed: agg.passed,
    failed: agg.failed,
    skipped: agg.skipped,
    todo: agg.todo,
    suites: agg.suites,
    missing: agg.missing,
    extra: agg.extra,
    duplicates: agg.duplicates,
    phases: {
      parallel: SECURITY_TEST_FILES_PARALLEL.length,
      serial: SECURITY_TEST_FILES_SERIAL.length,
    },
    batches: batches.map((b) => ({
      file: b.file || '(parallel batch)',
      status: b.status,
      signal: b.signal,
      error: b.error,
      reportOk: b.report !== null,
    })),
  }
  process.stdout.write('release-security: merged summary: ' + JSON.stringify(summary) + '\n')

  // Failure diagnostics (M34 WP-D #3): preserve explicit paths.
  if (code !== 0) {
    const reportDir = process.env.RELEASE_SECURITY_REPORT_DIR
    if (reportDir) {
      try {
        fs.mkdirSync(reportDir, { recursive: true })
        fs.writeFileSync(
          path.join(reportDir, 'merged-summary.json'),
          JSON.stringify(summary, null, 2) + '\n',
        )
        for (const b of batches) {
          const dest = path.join(reportDir, path.basename(b.outputFile))
          try {
            fs.copyFileSync(b.outputFile, dest)
          } catch {
            // batch had no report file (vitest failed early)
            fs.writeFileSync(
              dest,
              JSON.stringify({
                missing: true,
                status: b.status,
                signal: b.signal,
                error: b.error,
              }) + '\n',
            )
          }
        }
        process.stderr.write(
          'run-release-security-tests: diagnostics preserved at ' + reportDir + '\n',
        )
      } catch (e) {
        process.stderr.write(
          'run-release-security-tests: failed to preserve diagnostics to ' +
            reportDir +
            ': ' +
            /** @type {Error} */ (e).message +
            '\n',
        )
      }
    } else {
      // M34 WP-D #3 / M28 WP-F: without RELEASE_SECURITY_REPORT_DIR the
      // private work directory is REMOVED on exit (zero-residue contract);
      // the explicit path is still printed so a local failure stays
      // traceable, and setting RELEASE_SECURITY_REPORT_DIR keeps the
      // diagnostics (CI uploads them as a short-retention artifact).
      process.stderr.write(
        'run-release-security-tests: JSON reports were at ' +
          workDir +
          ' (removed on exit; set RELEASE_SECURITY_REPORT_DIR to keep the diagnostics)\n',
      )
    }
  }

  // M29 WP-F cleanup contract: the private work directory is ALWAYS removed
  // on exit -- RELEASE_SECURITY_REPORT_DIR is the persistent diagnostics
  // location (the CI artifact upload step consumes it), so no copy stays in
  // the OS temp dir. A cleanup failure must surface in stderr and force a
  // nonzero exit; it must never be swallowed, and must not overwrite the
  // original failure.
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
