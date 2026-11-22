import { defineConfig, devices } from '@playwright/test'
import { browserDefaults, desktop, preview } from './playwright.shared'

const server = preview(4176, '/pmbus-calculator/', '_site')

export default defineConfig(browserDefaults('pages-overlay'), {
  fullyParallel: true,
  workers: process.env.CI ? 1 : 2,
  use: { baseURL: server.url },
  projects: [
    {
      name: 'chromium-desktop-pages-overlay',
      testMatch: '**/pages-overlay.spec.ts',
      use: { ...devices['Desktop Chrome'], ...desktop },
    },
    {
      name: 'chromium-mobile-pages-overlay',
      grepInvert: /@desktop-overlay/,
      testMatch: '**/pages-overlay.spec.ts',
      use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } },
    },
    {
      name: 'chromium-local-deployment-contract',
      testMatch: '**/deployment.spec.ts',
      metadata: { pagesOverlayLocal: true },
      use: { ...devices['Desktop Chrome'], ...desktop },
    },
  ],
  webServer: server,
})
