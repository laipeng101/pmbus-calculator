import { defineConfig } from 'vitest/config'
// M32 WP-C: test/coverage shape comes from the SHARED constants module --
// never a hand-copied list; vite.config.ts and this config consume one
// source.
import {
  BASE_TEST_EXCLUDE,
  COVERAGE_EXCLUDE,
  COVERAGE_SCOPE_INCLUDE,
  COVERAGE_THRESHOLDS,
} from './scripts/vitest-shared-config.mjs'

// Dedicated coverage config for `npm run test:coverage` (used by
// `npm run verify` and the CI full tier). Release generator tests are plain
// unit tests now and run inside the normal Vitest suite.

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    exclude: [...BASE_TEST_EXCLUDE],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: [...COVERAGE_SCOPE_INCLUDE],
      thresholds: { ...COVERAGE_THRESHOLDS },
      exclude: [...COVERAGE_EXCLUDE],
    },
  },
})
