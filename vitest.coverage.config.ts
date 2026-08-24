import { defineConfig } from 'vitest/config'
import { SECURITY_TEST_FILES } from './scripts/release-security-test-contract.mjs'

// M31 WP-A: dedicated coverage config.
//
// `test:coverage` (used by `npm run verify` and the CI full tier) must NOT
// re-execute the nine release-security suites -- they are run exactly once
// by the zero-skip runner (`npm run test:release-security`, which the verify
// chain and CI run right after coverage). Probe P2 measured 188 duplicate
// tests before this config existed (coverage ran all 813 tests including the
// nine security files, then the runner ran the same 188 again).
//
// The exclusion list comes from the SHARED SECURITY_TEST_FILES contract
// (scripts/release-security-test-contract.mjs) -- never a copied list, so a
// new security suite is excluded here automatically. The structural test
// tests/m31-verify-gate.test.ts asserts this equality.
//
// Coverage scope and thresholds stay identical to vite.config.ts
// (src/app + src/legacy; 80/80/70/80) -- asserted by the same test.

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    exclude: [
      'node_modules',
      'dist',
      '.claude',
      'everything-claude-code',
      'tests/e2e',
      ...SECURITY_TEST_FILES,
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/app/**/*.{ts,tsx}', 'src/legacy/**/*.{ts,tsx}'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
      exclude: [
        'node_modules/',
        'tests/',
        '**/*.test.ts',
        '**/*.test.tsx',
        'src/main.tsx',
        'src/App.tsx',
        'src/**/*.d.ts',
      ],
    },
  },
})
