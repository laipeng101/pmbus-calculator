import { defineConfig, devices } from '@playwright/test'

// Explicit mobile-contract suite (v2.5.13). The semantic desktop suite runs
// ONCE via playwright.config.ts; this config owns only the small, explicitly
// grouped set of real mobile risks (390/360 layout, touch taps, popover
// containment, error-text wrapping) under true device emulation (Pixel 7
// touch/UA/DPR). v2.5.15: it verifies the SAME production dist as the desktop
// suite — same preview mount under the official Pages prefix, same fail-closed
// server rules; it never rebuilds and never reuses an unknown server.
// Isolation follows the repo precedent: dedicated config + exact testMatch
// (see playwright.release/visual/deployment.config.ts); playwright.config.ts
// testIgnores this spec.
const APP_BASE_PATH = '/pmbus-calculator'
const PORT = 4173
process.env.E2E_APP_BASE_PATH = APP_BASE_PATH

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
    baseURL: `http://localhost:${PORT}`,
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
    command: `npm run preview -- --port ${PORT} --strictPort --base ${APP_BASE_PATH}/`,
    url: `http://localhost:${PORT}${APP_BASE_PATH}/`,
    reuseExistingServer: false,
    timeout: 10_000,
  },
})
