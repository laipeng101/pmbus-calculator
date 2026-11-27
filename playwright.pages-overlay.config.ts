import { defineConfig, devices } from '@playwright/test'
import { browserDefaults, desktop, preview } from './playwright.shared'
import { PAGES_BASE_PATH } from './scripts/pages-network-policy.mjs'
import { PAGES_OVERLAY_TEST_SITE } from './scripts/prepare-pages-overlay-test.mjs'

const server = preview(4176, PAGES_BASE_PATH, PAGES_OVERLAY_TEST_SITE)

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
