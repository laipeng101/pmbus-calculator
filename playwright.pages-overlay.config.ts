import { defineConfig, devices } from '@playwright/test'

const APP_BASE_PATH = '/pmbus-calculator/'
const PORT = 4176
const localUrl = `http://localhost:${PORT}${APP_BASE_PATH}`

// The staging tree must already have passed the independent overlay verifier.
// Serving it never builds, mutates or overlays either dist/ or _site/.
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: ['**/pages-overlay.spec.ts', '**/deployment.spec.ts'],
  outputDir: './tests/e2e/output-pages-overlay',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 2,
  reporter: [
    ['list'],
    ['html', { outputFolder: './tests/e2e/report-pages-overlay', open: 'never' }],
    ['json', { outputFile: './tests/e2e/e2e-results-pages-overlay.json' }],
  ],
  use: {
    baseURL: localUrl,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium-desktop-pages-overlay',
      testMatch: '**/pages-overlay.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: 'chromium-mobile-pages-overlay',
      testMatch: '**/pages-overlay.spec.ts',
      use: {
        ...devices['Pixel 7'],
        viewport: { width: 390, height: 844 },
      },
    },
    {
      name: 'chromium-local-deployment-contract',
      testMatch: '**/deployment.spec.ts',
      // The remote config never sets this opt-in. It retains its mandatory
      // DEPLOYMENT_URL/HTTPS check and never starts a local server.
      metadata: { pagesOverlayLocal: true },
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
  webServer: {
    command: `npm run preview -- --port ${PORT} --strictPort --outDir _site --base ${APP_BASE_PATH}`,
    url: localUrl,
    reuseExistingServer: false,
    timeout: 10_000,
  },
})
