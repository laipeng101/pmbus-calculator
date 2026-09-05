import { describe, expect, it } from 'vitest'
import { GENERATED_FILE_TARGETS, GENERATED_TARGETS } from '../scripts/clean-generated.mjs'
import defaultConfig from '../playwright.config'
import mobileConfig from '../playwright.mobile.config'
import releaseConfig from '../playwright.release.config'
import deploymentConfig from '../playwright.deployment.config'
import visualConfig from '../playwright.visual.config'
import crossEngineConfig from '../playwright.cross-engine.config'

// v2.5.15: docs used to hardcode a partial copy of the cleaner's target list
// and drift (the mobile suite dirs and the five reporter JSONs were missing).
// Instead of another hand-copied list, this test derives the artifact set from
// the REAL Playwright configs and cross-checks it against the production
// cleaner constants, so a new/renamed suite output cannot pass one gate while
// silently failing the others.

interface ConfigLike {
  outputDir?: string
  reporter?: Array<unknown>
}

function artifactPaths(name: string, config: ConfigLike): string[] {
  const paths: string[] = []
  if (typeof config.outputDir === 'string') paths.push(normalize(config.outputDir))
  for (const entry of config.reporter ?? []) {
    if (!Array.isArray(entry)) continue
    const [, options] = entry as [string, Record<string, unknown> | undefined]
    if (options === undefined || options === null) continue
    if (typeof options.outputFile === 'string') paths.push(normalize(options.outputFile))
    if (typeof options.outputFolder === 'string') paths.push(normalize(options.outputFolder))
  }
  expect(paths.length, `${name} declares outputDir + reporter artifacts`).toBeGreaterThan(0)
  return paths
}

function normalize(value: string): string {
  return value.replace(/^\.\//, '').replace(/\/+$/, '')
}

const suites: Array<[string, ConfigLike]> = [
  ['default', defaultConfig as ConfigLike],
  ['mobile', mobileConfig as ConfigLike],
  ['release', releaseConfig as ConfigLike],
  ['deployment', deploymentConfig as ConfigLike],
  ['visual', visualConfig as ConfigLike],
  ['cross-engine', crossEngineConfig as ConfigLike],
]

describe('Playwright artifacts vs cleaner targets (v2.5.15 consistency)', () => {
  it('every suite-declared artifact is a GENERATED_TARGET the cleaner may remove', () => {
    for (const [name, config] of suites) {
      for (const artifact of artifactPaths(name, config)) {
        expect(
          GENERATED_TARGETS,
          `${name} suite artifact ${artifact} must be listed in scripts/clean-generated.mjs GENERATED_TARGETS`,
        ).toContain(artifact)
      }
    }
  })

  it('every tests/e2e cleaner target is declared by some suite or is a reporter JSON', () => {
    for (const target of GENERATED_TARGETS) {
      if (!target.startsWith('tests/e2e/')) continue
      if (GENERATED_FILE_TARGETS.has(target)) continue
      const declared = suites.some(([, config]) => artifactPaths('', config).includes(target))
      expect(declared, `cleaner target ${target} must come from a real Playwright config`).toBe(
        true,
      )
    }
  })

  it('every suite has exactly one JSON reporter file target and the cleaner deletes it', () => {
    for (const [name, config] of suites) {
      const json = artifactPaths(name, config).filter((p) => p.endsWith('.json'))
      expect(json, `${name} suite declares one JSON reporter`).toHaveLength(1)
      expect(GENERATED_FILE_TARGETS.has(json[0])).toBe(true)
    }
    expect(GENERATED_FILE_TARGETS.size).toBe(suites.length)
  })
})
