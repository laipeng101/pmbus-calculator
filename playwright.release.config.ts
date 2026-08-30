import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/release.spec.ts',
  outputDir: './tests/e2e/output-release',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['list'],
    ['html', { outputFolder: './tests/e2e/report-release', open: 'never' }],
    ['json', { outputFile: './tests/e2e/e2e-results-release.json' }],
  ],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium-desktop-release',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
  webServer: {
    command: 'npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    // v2.5.15: root-mounted preview of the same dist the semantic suites use
    // (this suite provides the root-deployment live evidence). Never reuse an
    // unknown server on the port — a stale dist would fake a green release
    // smoke.
    reuseExistingServer: false,
    timeout: 10_000,
  },
})
