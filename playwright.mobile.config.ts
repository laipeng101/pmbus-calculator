import { defineConfig, devices } from '@playwright/test'

// Explicit mobile-contract suite (v2.5.13). The semantic desktop suite runs
// ONCE via playwright.config.ts (single chromium-desktop project); this
// config owns only the small, explicitly grouped set of real mobile risks
// (390/360 layout, touch taps, popover containment, error-text wrapping)
// under true device emulation (Pixel 7 touch/UA/DPR), so the old
// run-everything-twice duplication stays removed without losing the mobile
// contract. Isolation follows the repo precedent: dedicated config +
// exact testMatch (see playwright.release/visual/deployment.config.ts);
// playwright.config.ts testIgnores this spec.
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/mobile-contract.spec.ts',
  outputDir: './tests/e2e/output-mobile',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['list'],
    ['html', { outputFolder: './tests/e2e/report-mobile', open: 'never' }],
    ['json', { outputFile: './tests/e2e/e2e-results-mobile.json' }],
  ],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium-mobile-contract',
      use: {
        ...devices['Pixel 7'],
      },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: process.env.CI ? false : true,
    timeout: 10_000,
  },
})
