import { defineConfig } from 'vitest/config'
import { SECURITY_TEST_FILES } from './scripts/release-security-test-contract.mjs'
// M32 WP-C: test/coverage shape comes from the SHARED constants module --
// never a hand-copied list; vite.config.ts and this config consume one
// source (asserted by tests/m32-verify-contract.test.ts V5).
import {
  BASE_TEST_EXCLUDE,
  COVERAGE_EXCLUDE,
  COVERAGE_SCOPE_INCLUDE,
  COVERAGE_THRESHOLDS,
} from './scripts/vitest-shared-config.mjs'

// M31 WP-A: dedicated coverage config.
//
// `test:coverage` (used by `npm run verify` and the CI full tier) must NOT
// re-execute the release-security suites -- they are run exactly once
// by the zero-skip runner (`npm run test:release-security`, which the verify
// chain and CI run right after coverage). Probe P2 measured 188 duplicate
// tests before this config existed (coverage ran all 813 tests including the
// nine security files, then the runner ran the same 188 again).
//
// The exclusion list comes from the SHARED SECURITY_TEST_FILES contract
// (scripts/release-security-test-contract.mjs) -- never a copied list, so a
// new security suite is excluded here automatically. The structural tests
// (m31-verify-gate A2, m32-verify-contract V6) assert this equality.

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    exclude: [...BASE_TEST_EXCLUDE, ...SECURITY_TEST_FILES],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: [...COVERAGE_SCOPE_INCLUDE],
      thresholds: { ...COVERAGE_THRESHOLDS },
      exclude: [...COVERAGE_EXCLUDE],
    },
  },
})
