// Zero-skip test runner (M27 WP-G #6).
//
// Runs the generator/security vitest suites and FAILS if any test is
// skipped. A skip in these suites means a canonical environment silently
// dropped symlink/FIFO/concurrency/rollback/recovery coverage -- the exact
// M26 failure mode this milestone removes.
//
// Usage: node scripts/run-release-security-tests.mjs

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// Keep the JSON report out of the repo tree: .release-staging is a release
// transaction directory that the generator refuses to find non-empty.
const outputFile = path.join(os.tmpdir(), 'release-security-tests-' + process.pid + '.json')

const testFiles = ['tests/prepare-release-assets.test.ts', 'tests/zip-helper-security.test.ts']

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

if (result.error) {
  process.stderr.write(
    'run-release-security-tests: failed to start vitest: ' + result.error.message + '\n',
  )
  process.exit(1)
}

let summary = null
try {
  summary = JSON.parse(fs.readFileSync(outputFile, 'utf8'))
} catch {
  process.stderr.write('run-release-security-tests: could not read vitest JSON output\n')
  // Fall through: the vitest exit code still gates the run.
}

if (summary) {
  const skipped = Number(summary.numSkippedTests ?? 0)
  const failed = Number(summary.numFailedTests ?? 0)
  const total = Number(summary.numTotalTests ?? 0)
  process.stdout.write(
    'release-security: total=' +
      total +
      ' passed=' +
      (summary.numPassedTests ?? '?') +
      ' failed=' +
      failed +
      ' skipped=' +
      skipped +
      '\n',
  )
  if (!Number.isFinite(total) || total === 0) {
    process.stderr.write('run-release-security-tests: no tests ran -- refusing to pass\n')
    process.exit(1)
  }
  if (failed > 0) {
    process.stderr.write('run-release-security-tests: failing tests present\n')
    process.exit(1)
  }
  if (skipped !== 0) {
    process.stderr.write(
      'run-release-security-tests: ' +
        skipped +
        ' skipped test(s) in security suites -- zero-skip policy violated\n',
    )
    process.exit(1)
  }
}

process.exit(result.status === 0 ? 0 : 1)

// Remove the temp report so the file never accumulates.
process.on('exit', () => {
  try {
    fs.rmSync(outputFile, { force: true })
  } catch {
    // best effort
  }
})
