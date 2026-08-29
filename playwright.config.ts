import { defineConfig, devices } from '@playwright/test'

// v2.5.13: the default suite runs the semantic flows ONCE (single
// chromium-desktop project). It deliberately ignores the dedicated suites
// that own their configs: release/deployment smokes and the visual baselines
// (unchanged), plus the v2.5.13 explicit mobile-contract suite
// (playwright.mobile.config.ts, Pixel 7 emulation) — the former
// chromium-mobile project re-ran all 292 logical tests with no project-specific
// selection, doubling CI cost without dedicated coverage.
export default defineConfig({
  testDir: './tests/e2e',
  // Deployment smoke tests run exclusively via playwright.deployment.config.ts
  // against the live Pages URL; visual baselines via playwright.visual.config.ts;
  // the mobile contract via playwright.mobile.config.ts. None may inflate the
  // default suite.
  testIgnore: [
    '**/release.spec.ts',
    '**/visual.spec.ts',
    '**/deployment.spec.ts',
    '**/mobile-contract.spec.ts',
  ],
  outputDir: './tests/e2e/output',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['list'],
    ['html', { outputFolder: './tests/e2e/report', open: 'never' }],
    ['json', { outputFile: './tests/e2e/e2e-results.json' }],
  ],
  use: {
    baseURL: 'http://localhost:5173',
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
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 10_000,
  },
})
