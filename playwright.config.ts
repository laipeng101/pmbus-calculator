import { defineConfig, devices } from '@playwright/test'

// v2.5.15: the default semantic suite is the PRIMARY acceptance target and
// runs against the PRODUCTION build: the exact dist/ served by `vite preview`,
// mounted under the official GitHub Pages path prefix so the whole suite
// doubles as the prefixed-URL contract evidence. The single build happens
// before the suite in `npm run verify` and in the CI e2e job; this config
// never rebuilds and never reuses an unknown server on the port (fail closed
// against testing a stale dist). Dev-server smoke/debug entries stay
// dedicated to playwright.visual.config.ts (canonical darwin visual world);
// the mobile contract (playwright.mobile.config.ts) checks the same dist;
// the release smoke (playwright.release.config.ts) owns its CSP/font checks
// on a root-mounted preview of the same dist.
const APP_BASE_PATH = '/pmbus-calculator'
const PORT = 4173
process.env.E2E_APP_BASE_PATH = APP_BASE_PATH

export default defineConfig({
  testDir: './tests/e2e',
  // Dedicated suites own their configs: release/deployment smokes, the visual
  // baselines and the mobile contract may not inflate the default suite.
  testIgnore: [
    '**/release.spec.ts',
    '**/visual.spec.ts',
    '**/deployment.spec.ts',
    '**/mobile-contract.spec.ts',
    '**/cross-engine-core.spec.ts',
  ],
  outputDir: './tests/e2e/output',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // v2.6.1: two CI workers adopted on measured no-retry evidence (zero
  // flake/retry across full-suite and repeat-each=10 stress runs, ≥20%
  // wall-clock gain, per-test contexts keep suites isolated).
  workers: process.env.CI ? 2 : undefined,
  reporter: [
    ['list'],
    ['html', { outputFolder: './tests/e2e/report', open: 'never' }],
    ['json', { outputFile: './tests/e2e/e2e-results.json' }],
  ],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium-desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
  webServer: {
    command: `npm run preview -- --port ${PORT} --strictPort --base ${APP_BASE_PATH}/`,
    url: `http://localhost:${PORT}${APP_BASE_PATH}/`,
    reuseExistingServer: false,
    timeout: 10_000,
  },
})
