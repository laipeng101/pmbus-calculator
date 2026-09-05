import { describe, expect, it } from 'vitest'
import crossEngineConfig from '../playwright.cross-engine.config'

// Regression pin for the cross-engine acceptance floor's browser identity.
//
// Playwright's device registry has no 'Desktop WebKit' entry — the desktop
// WebKit descriptor is 'Desktop Safari'. Indexing `devices` with a wrong key
// yields undefined, which silently strips browserName from the project and
// falls back to chromium: locally (chromium installed) such a run passes
// while testing the WRONG engine, and in CI (only firefox+webkit installed)
// every webkit project test dies at browserType.launch. This pin freezes the
// engine identity of both cross-engine projects so the fallback cannot
// silently return.

interface ProjectLike {
  name?: string
  use?: { defaultBrowserType?: string }
}

describe('cross-engine config browser identity', () => {
  it('runs exactly the firefox-core and webkit-core projects on their real engines', () => {
    const projects = (crossEngineConfig.projects ?? []) as ProjectLike[]
    expect(projects.map((project) => project.name)).toEqual(['firefox-core', 'webkit-core'])
    // Device descriptors carry defaultBrowserType (not browserName); this is
    // the field the missing 'Desktop WebKit' key would have silently dropped.
    expect(projects[0]?.use?.defaultBrowserType).toBe('firefox')
    expect(projects[1]?.use?.defaultBrowserType).toBe('webkit')
  })

  it('keeps the production-dist webServer contract fail closed', () => {
    const config = crossEngineConfig as Record<string, unknown>
    const webServer = config.webServer as Record<string, unknown>
    expect(webServer.reuseExistingServer).toBe(false)
    expect(String(webServer.url)).toContain('/pmbus-calculator/')
    expect(process.env.E2E_APP_BASE_PATH).toBe('/pmbus-calculator')
  })
})
