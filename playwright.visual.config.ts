import { defineConfig, devices } from '@playwright/test'

const artifactDir = process.env.PMBUS_VISUAL_ARTIFACTS ?? './tests/e2e'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/visual.spec.ts',
  outputDir: `${artifactDir}/output-visual`,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  updateSnapshots: 'none',
  reporter: [
    ['list'],
    ['html', { outputFolder: `${artifactDir}/report-visual`, open: 'never' }],
    ['json', { outputFile: `${artifactDir}/e2e-results-visual.json` }],
  ],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium-visual',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 900 },
      },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: false,
    timeout: 10_000,
  },
})
