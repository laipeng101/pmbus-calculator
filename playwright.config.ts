import { defineConfig, devices } from '@playwright/test'

// 用项目站点的路径前缀测试已构建的 dist。
const APP_BASE_PATH = '/pmbus-calculator'
const PORT = 4173
process.env.E2E_APP_BASE_PATH = APP_BASE_PATH

export default defineConfig({
  testDir: './tests/e2e',
  testIgnore: [
    '**/release.spec.ts',
    '**/visual.spec.ts',
    '**/deployment.spec.ts',
    '**/pages-overlay.spec.ts',
    '**/mobile-contract.spec.ts',
  ],
  outputDir: './tests/e2e/output',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
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
