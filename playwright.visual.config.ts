import { defineConfig, devices } from '@playwright/test'
import { browserDefaults } from './playwright.shared'

const url = 'http://localhost:5173'

export default defineConfig(browserDefaults('visual', process.env.PMBUS_VISUAL_ARTIFACTS), {
  testMatch: '**/visual.spec.ts',
  retries: 0,
  workers: 1,
  updateSnapshots: 'none',
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1280, height: 900 },
    baseURL: url,
  },
  // Keep the project name used by the existing snapshot filenames.
  projects: [{ name: 'chromium-visual' }],
  webServer: {
    command: 'npm run dev -- --strictPort',
    url,
    reuseExistingServer: false,
    timeout: 10_000,
  },
})
