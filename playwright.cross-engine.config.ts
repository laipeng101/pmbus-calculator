import { defineConfig, devices } from '@playwright/test'

// Run the shared core flows against the existing build in Firefox and WebKit.
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
        browserName: 'firefox',
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
        ...devices['Desktop Safari'],
        browserName: 'webkit',
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
