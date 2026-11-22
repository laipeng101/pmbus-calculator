import type { PlaywrightTestConfig } from '@playwright/test'

export const desktop = { viewport: { width: 1440, height: 900 } }

export function browserDefaults(suite: string, artifacts = '.'): PlaywrightTestConfig {
  return {
    testDir: './tests/e2e',
    outputDir: `${artifacts}/test-results/${suite}`,
    forbidOnly: Boolean(process.env.CI),
    retries: process.env.CI ? 2 : 0,
    reporter: [
      ['list'],
      ['html', { outputFolder: `${artifacts}/playwright-report/${suite}`, open: 'never' }],
    ],
    use: {
      trace: 'retain-on-failure',
      screenshot: 'only-on-failure',
    },
  }
}

export function preview(port: number, basePath = '/', outputDir = 'dist') {
  const url = `http://localhost:${port}${basePath}`
  return {
    command: `npm run preview -- --port ${port} --strictPort --outDir ${outputDir} --base ${basePath}`,
    url,
    reuseExistingServer: false,
    timeout: 10_000,
  }
}
