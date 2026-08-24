// M32 WP-C: single source of truth for the Vitest test/coverage shape that
// is shared by vite.config.ts (base config, `npm run test`) and
// vitest.coverage.config.ts (the dedicated `test:coverage` config, M31).
//
// Before M32, vitest.coverage.config.ts hand-copied the coverage scope and
// thresholds from vite.config.ts and a structural test (m31-verify-gate A3)
// compared them after the fact -- drift-prone duplication. Both configs now
// consume these constants; no list is copied by hand. The security exclusion
// still comes from SECURITY_TEST_FILES (scripts/release-security-test-contract.mjs),
// spread into the coverage config -- never copied here.

export const BASE_TEST_EXCLUDE = Object.freeze([
  'node_modules',
  'dist',
  '.claude',
  'everything-claude-code',
  'tests/e2e',
])

export const COVERAGE_SCOPE_INCLUDE = Object.freeze([
  'src/app/**/*.{ts,tsx}',
  'src/legacy/**/*.{ts,tsx}',
])

export const COVERAGE_THRESHOLDS = Object.freeze({
  lines: 80,
  functions: 80,
  branches: 70,
  statements: 80,
})

export const COVERAGE_EXCLUDE = Object.freeze([
  'node_modules/',
  'tests/',
  '**/*.test.ts',
  '**/*.test.tsx',
  'src/main.tsx',
  'src/App.tsx',
  'src/**/*.d.ts',
])
