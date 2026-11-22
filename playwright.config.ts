import { defineConfig, devices } from '@playwright/test'
import { browserDefaults, desktop, preview } from './playwright.shared'

const appPath = '/pmbus-calculator'
const server = preview(4173, `${appPath}/`)
const mobile = '**/mobile-contract.spec.ts'
const crossEngine = '**/cross-engine-core.spec.ts'
process.env.E2E_APP_BASE_PATH = appPath

export default defineConfig(browserDefaults('app'), {
  fullyParallel: true,
  workers: process.env.CI ? 2 : undefined,
  use: { baseURL: 'http://localhost:4173' },
  webServer: server,
  projects: [
    {
      name: 'chromium-desktop',
      testIgnore: [
        mobile,
        '**/release.spec.ts',
        '**/visual.spec.ts',
        '**/deployment.spec.ts',
        '**/pages-overlay.spec.ts',
      ],
      use: { ...devices['Desktop Chrome'], ...desktop },
    },
    {
      name: 'chromium-mobile-contract',
      testMatch: mobile,
      workers: process.env.CI ? 1 : undefined,
      use: devices['Pixel 7'],
    },
    {
      name: 'firefox-core',
      testMatch: crossEngine,
      workers: process.env.CI ? 1 : undefined,
      use: {
        ...devices['Desktop Firefox'],
        ...desktop,
        // Firefox's test preference enables async clipboard reads without grantPermissions.
        launchOptions: { firefoxUserPrefs: { 'dom.events.testing.asyncClipboard': true } },
      },
    },
    {
      name: 'webkit-core',
      testMatch: crossEngine,
      workers: process.env.CI ? 1 : undefined,
      use: { ...devices['Desktop Safari'], ...desktop },
    },
  ],
})
