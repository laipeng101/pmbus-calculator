// Type declarations for scripts/vitest-shared-config.mjs so the TS-checked
// Vite/Vitest configs (tsconfig.node.json) can import the shared test/
// coverage constants without copying them (M32 WP-C: single source).

export const BASE_TEST_EXCLUDE: readonly string[]

export const COVERAGE_SCOPE_INCLUDE: readonly string[]

export const COVERAGE_THRESHOLDS: Readonly<{
  lines: number
  functions: number
  branches: number
  statements: number
}>

export const COVERAGE_EXCLUDE: readonly string[]
