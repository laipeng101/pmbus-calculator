// Regression tests for playwright.config.ts structure (the desktop semantic
// suite; the mobile/release/deployment/visual configs own their own specs).
import { describe, expect, it } from 'vitest'
import config from '../playwright.config'

describe('playwright.config', () => {
  it('runs the CI desktop suite with the two validated workers', () => {
    // v2.6.1: workers=2 adopted on measured no-retry evidence — full-suite
    // 1-worker vs 2-worker rounds and a repeat-each=10 stress run over the
    // timing-risk specs, all zero flake/zero retry with conserved test count.
    // Locally workers stay undefined (Playwright default) for fast feedback.
    expect(config.workers).toBe(process.env.CI ? 2 : undefined)
  })

  it('keeps the semantic suite fully parallel with per-test contexts', () => {
    expect(config.fullyParallel).toBe(true)
    expect((config.projects ?? []).map((project) => project.name)).toEqual(['chromium-desktop'])
  })

  it('verifies the production build without reusing an unknown server', () => {
    const webServer = Array.isArray(config.webServer) ? config.webServer[0] : config.webServer
    expect(webServer?.reuseExistingServer).toBe(false)
    expect(webServer?.command).toContain('npm run preview')
    expect(webServer?.command).toContain('--strictPort')
  })
})
