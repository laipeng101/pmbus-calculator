import { defineConfig, devices } from '@playwright/test'
import { browserDefaults, desktop } from './playwright.shared'

export default defineConfig(browserDefaults('deployment'), {
  testMatch: '**/deployment.spec.ts',
  workers: process.env.CI ? 1 : undefined,
  use: { ...devices['Desktop Chrome'], ...desktop, baseURL: process.env.DEPLOYMENT_URL },
})
