import { defineConfig, devices } from '@playwright/test'
import { browserDefaults, desktop, preview } from './playwright.shared'

const server = preview(4173)

export default defineConfig(browserDefaults('release'), {
  testMatch: '**/release.spec.ts',
  fullyParallel: true,
  workers: process.env.CI ? 1 : undefined,
  use: { ...devices['Desktop Chrome'], ...desktop, baseURL: server.url },
  webServer: server,
})
