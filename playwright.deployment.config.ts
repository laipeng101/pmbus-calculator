import { defineConfig, devices } from '@playwright/test'

const deploymentUrl = process.env.DEPLOYMENT_URL

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/deployment.spec.ts',
  outputDir: './tests/e2e/output-deployment',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['list'],
    ['html', { outputFolder: './tests/e2e/report-deployment', open: 'never' }],
    ['json', { outputFile: './tests/e2e/e2e-results-deployment.json' }],
  ],
  use: {
    ...(deploymentUrl ? { baseURL: deploymentUrl } : {}),
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium-deployment',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
})
