import { describe, expect, it } from 'vitest'
import config from '../playwright.pages-overlay.config'
import defaultConfig from '../playwright.config'
import deploymentConfig from '../playwright.deployment.config'

describe('local Pages overlay browser boundary', () => {
  it('serves only the existing final _site at the official prefix without build or reuse', () => {
    const server = Array.isArray(config.webServer) ? config.webServer[0] : config.webServer
    expect(server?.command).toBe(
      'npm run preview -- --port 4176 --strictPort --outDir _site --base /pmbus-calculator/',
    )
    expect(server?.url).toBe('http://localhost:4176/pmbus-calculator/')
    expect(server?.reuseExistingServer).toBe(false)
  })

  it('isolates overlay acceptance and exercises real 390px touch plus desktop viewports', () => {
    expect(defaultConfig.testIgnore).toContain('**/pages-overlay.spec.ts')
    const projects = config.projects ?? []
    expect(projects).toHaveLength(3)
    expect(projects[0].use?.viewport).toEqual({ width: 1440, height: 900 })
    expect(projects[1].use?.viewport).toEqual({ width: 390, height: 844 })
    expect(projects[1].use?.hasTouch).toBe(true)
    expect(projects[2].testMatch).toBe('**/deployment.spec.ts')
    expect(projects[2].metadata).toEqual({ pagesOverlayLocal: true })
  })

  it('never opts the remote deployment config into local URL or server behavior', () => {
    expect(deploymentConfig.webServer).toBeUndefined()
    for (const project of deploymentConfig.projects ?? []) {
      expect(project.metadata?.pagesOverlayLocal).not.toBe(true)
    }
  })
})
