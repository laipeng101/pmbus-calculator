// Single source of truth for the Vitest test/coverage shape that is shared
// by vite.config.ts (base config, `npm run test`) and
// vitest.coverage.config.ts (the dedicated `test:coverage` config).
//
// Both configs consume these constants; no list is copied by hand.

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
  lines: 90,
  functions: 90,
  branches: 85,
  statements: 90,
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
