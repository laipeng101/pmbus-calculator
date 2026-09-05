import { defineConfig, devices } from '@playwright/test'

// Cross-engine core acceptance floor (Firefox + WebKit).
//
// The desktop semantic suite (playwright.config.ts, chromium-desktop) and the
// mobile contract (playwright.mobile.config.ts) stay the deep, primary
// acceptance targets; this config owns only the small cross-engine core smoke
// (tests/e2e/cross-engine-core.spec.ts) so core user flows gain Firefox +
// WebKit evidence without rerunning the full semantic suite on every engine.
// Isolation follows the repo precedent (v2.5.13 dedicated-config pattern):
// exact testMatch here, testIgnore in the default config.
//
// Same production-dist contract as the other acceptance suites: `vite preview`
// of the exact dist/ mounted under the official GitHub Pages path prefix, no
// rebuild in the config, and fail-closed server rules (never reuse an unknown
// server on the port — a stale dist would fake a green cross-engine run).
const APP_BASE_PATH = '/pmbus-calculator'
const PORT = 4173
process.env.E2E_APP_BASE_PATH = APP_BASE_PATH

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/cross-engine-core.spec.ts',
  outputDir: './tests/e2e/output-cross-engine',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['list'],
    ['html', { outputFolder: './tests/e2e/report-cross-engine', open: 'never' }],
    ['json', { outputFile: './tests/e2e/e2e-results-cross-engine.json' }],
  ],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'firefox-core',
      use: {
        ...devices['Desktop Firefox'],
        viewport: { width: 1440, height: 900 },
        // Firefox does not support context.grantPermissions for clipboard;
        // this official testing pref enables navigator.clipboard read/write
        // without user activation, so the copy-path contract stays testable
        // on Firefox (WebKit keeps the grantPermissions route in the spec).
        launchOptions: {
          firefoxUserPrefs: {
            'dom.events.testing.asyncClipboard': true,
          },
        },
      },
    },
    {
      name: 'webkit-core',
      use: {
        // The desktop WebKit descriptor is registered as 'Desktop Safari' in
        // Playwright's device registry — there is NO 'Desktop WebKit' key, and
        // indexing a Record<string, DeviceDescriptor> with a wrong key returns
        // undefined, which silently drops browserName and falls back to
        // chromium (invisible where chromium is installed, fatal in CI where
        // only firefox+webkit are installed; pinned by
        // tests/cross-engine-config.test.ts).
        ...devices['Desktop Safari'],
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
