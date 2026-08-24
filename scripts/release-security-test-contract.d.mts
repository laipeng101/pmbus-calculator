// Type declarations for scripts/release-security-test-contract.mjs so the
// TS-checked Vite coverage config (tsconfig.node.json) can import the shared
// SECURITY_TEST_FILES list without copying it (M31 WP-A: no duplicated file
// list between the runner, the contract tests, and the coverage config).
// M34 WP-D: adds the phased split and the aggregation function.

export const SECURITY_TEST_FILES: readonly string[]

export const SECURITY_TEST_FILES_PARALLEL: readonly string[]

export const SECURITY_TEST_FILES_SERIAL: readonly string[]

export const SECURITY_TESTS_MIN_TOTAL: number

export function validateSecurityReportFiles(
  summary: unknown,
  opts?: { testFiles?: readonly string[] },
):
  | { ok: true; missing: string[]; suites: string[] }
  | { ok: false; reason: string; missing: string[] }

export function aggregateSecurityReports(
  batches: Array<{
    file?: string
    status: number | null
    signal: string | null
    error?: string | null
    report: any
  }>,
  opts?: { testFiles?: readonly string[]; minTotal?: number },
): {
  ok: boolean
  reason?: string
  total: number
  passed: number
  failed: number
  skipped: number
  todo: number
  suites: string[]
  missing: string[]
  extra: string[]
  duplicates: string[]
}
