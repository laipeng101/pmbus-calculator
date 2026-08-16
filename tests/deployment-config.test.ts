import { describe, it, expect } from 'vitest'
import config from '../playwright.deployment.config'

describe('playwright.deployment.config', () => {
  it('does not start a local dev or preview server', () => {
    expect(config.webServer).toBeUndefined()
  })

  it('targets only the deployment smoke spec', () => {
    expect(config.testDir).toBe('./tests/e2e')
    expect(config.testMatch).toBe('**/deployment.spec.ts')
  })

  it('uses DEPLOYMENT_URL as the Playwright baseURL when provided', () => {
    expect(config.use?.baseURL).toBe(process.env.DEPLOYMENT_URL)
  })
})
