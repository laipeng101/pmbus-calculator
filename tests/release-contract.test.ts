// Unit tests for the offline release contract gate (M23).
//
// validateReleaseContract is exercised with synthetic contracts for the
// success case and every failure family: lockfile version drift, missing or
// mistitled CHANGELOG/release notes, stale README links, wrong ROADMAP
// version, and wrong artifact names. These pin the cross-file invariants the
// CLI enforces against the real repository files.

import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import {
  expectedArtifactNames,
  isPlainSemver,
  validateReleaseContract,
} from '../scripts/check-release-contract.mjs'

const TAG_LINK = (version: string) =>
  `https://github.com/laipeng101/pmbus-calculator/releases/tag/${version}`
const SUMS_LINK = (version: string) =>
  `https://github.com/laipeng101/pmbus-calculator/releases/download/${version}/SHA256SUMS.txt`

function readmeContent(version: string): string {
  return [
    `> **Live Demo:** https://laipeng101.github.io/pmbus-calculator/ (currently deploys \`${version}\`)`,
    `> **Stable version:** [\`${version}\`](${TAG_LINK(version)}) · [SHA256SUMS.txt](${SUMS_LINK(version)})`,
    `Deploys the immutable \`${version}\` Release asset.`,
  ].join('\n')
}

interface Contract {
  version: string
  lockVersions: string[]
  changelog: string
  releaseNotes: { exists: boolean; content: string }
  readmes: Array<{ name: string; content: string }>
  roadmap: string
  artifactNames: string[]
}

function makeContract(overrides: Partial<Contract> = {}): Contract {
  return {
    version: '1.1.4',
    lockVersions: ['1.1.4', '1.1.4'],
    changelog: `# Changelog\n\n## [Unreleased]\n\n## [1.1.4] - 2026-08-23\n\n### Fixed\n\n- example\n`,
    releaseNotes: { exists: true, content: '# PMBus Calculator v1.1.4\n\nPATCH release.\n' },
    readmes: [
      { name: 'README.md', content: readmeContent('v1.1.4') },
      { name: 'README_zh-CN.md', content: readmeContent('v1.1.4') },
    ],
    roadmap: 'M0–M23 complete；stable release v1.1.4；production distribution: GitHub Pages。',
    artifactNames: expectedArtifactNames('1.1.4'),
    ...overrides,
  }
}

describe('release contract validation (M23)', () => {
  it('accepts a fully consistent contract', () => {
    const result = validateReleaseContract(makeContract())
    expect(result.errors).toEqual([])
    expect(result.ok).toBe(true)
  })

  it('rejects a v-prefixed or malformed version before any other check', () => {
    const result = validateReleaseContract(makeContract({ version: 'v1.1.4' }))
    expect(result.ok).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toMatch(/plain semver without a v prefix/)
  })

  it('rejects package-lock.json version drift', () => {
    const result = validateReleaseContract(makeContract({ lockVersions: ['1.1.4', '1.1.3'] }))
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toMatch(/package-lock\.json version 1\.1\.3/)
  })

  it('rejects a missing CHANGELOG section for the version', () => {
    const changelog = `# Changelog\n\n## [Unreleased]\n\n## [1.1.3] - 2026-08-16\n`
    const result = validateReleaseContract(makeContract({ changelog }))
    expect(result.errors.join('\n')).toMatch(/CHANGELOG\.md has no "## \[1\.1\.4\] - YYYY-MM-DD"/)
  })

  it('rejects a CHANGELOG section without a real date', () => {
    const changelog = `# Changelog\n\n## [1.1.4] - TBD\n`
    const result = validateReleaseContract(makeContract({ changelog }))
    expect(result.errors.join('\n')).toMatch(/CHANGELOG\.md has no/)
  })

  it('rejects missing release notes', () => {
    const result = validateReleaseContract(
      makeContract({ releaseNotes: { exists: false, content: '' } }),
    )
    expect(result.errors.join('\n')).toMatch(/docs\/releases\/v1\.1\.4\.md does not exist/)
  })

  it('rejects release notes whose title does not declare the version', () => {
    const result = validateReleaseContract(
      makeContract({ releaseNotes: { exists: true, content: '# PMBus Calculator v1.1.3\n' } }),
    )
    expect(result.errors.join('\n')).toMatch(/title does not declare v1\.1\.4/)
  })

  it('rejects stale GitHub release links in a README', () => {
    const readmes = [
      { name: 'README.md', content: readmeContent('v1.1.4') },
      { name: 'README_zh-CN.md', content: readmeContent('v1.1.3') },
    ]
    const result = validateReleaseContract(makeContract({ readmes }))
    expect(result.errors.join('\n')).toMatch(/README_zh-CN\.md still links GitHub release v1\.1\.3/)
    // The stale README is also missing its current-version links.
    expect(result.errors.join('\n')).toMatch(/README_zh-CN\.md is missing the stable tag link/)
  })

  it('rejects a README missing the SHA256SUMS download link', () => {
    const content = readmeContent('v1.1.4').replace(SUMS_LINK('v1.1.4'), TAG_LINK('v1.1.4'))
    const result = validateReleaseContract(
      makeContract({ readmes: [{ name: 'README.md', content }, makeContract().readmes[1]] }),
    )
    expect(result.errors.join('\n')).toMatch(/missing the SHA256SUMS\.txt download link/)
  })

  it('rejects a README that never declares the deployed version', () => {
    const content = readmeContent('v1.1.4').replaceAll('`v1.1.4`', 'the latest release')
    const result = validateReleaseContract(
      makeContract({ readmes: [{ name: 'README.md', content }, makeContract().readmes[1]] }),
    )
    expect(result.errors.join('\n')).toMatch(/does not declare the deployed version/)
  })

  it('allows README links to repository release-note docs of older versions', () => {
    const readmes = [
      {
        name: 'README.md',
        content: `${readmeContent('v1.1.4')}\nSee [docs/releases/v1.0.0.md](docs/releases/v1.0.0.md#known-limitations).`,
      },
      makeContract().readmes[1],
    ]
    const result = validateReleaseContract(makeContract({ readmes }))
    expect(result.errors).toEqual([])
  })

  it('rejects a ROADMAP stable declaration for a different version', () => {
    const result = validateReleaseContract(
      makeContract({ roadmap: 'M0–M23 complete；stable release v1.1.3；' }),
    )
    expect(result.errors.join('\n')).toMatch(
      /docs\/ROADMAP\.md stable release declaration is v1\.1\.3, expected v1\.1\.4/,
    )
  })

  it('rejects wrong release artifact names', () => {
    const result = validateReleaseContract(
      makeContract({ artifactNames: ['pmbus-calculator-1.1.4-web.zip', 'SHA256.txt'] }),
    )
    const joined = result.errors.join('\n')
    expect(joined).toMatch(/unexpected release artifact name: pmbus-calculator-1\.1\.4-web\.zip/)
    expect(joined).toMatch(/missing expected release artifact: pmbus-calculator-v1\.1\.4-web\.zip/)
    expect(joined).toMatch(/missing expected release artifact: SHA256SUMS\.txt/)
  })

  it('derives artifact names from the version, never hardcoding one', () => {
    expect(expectedArtifactNames('1.1.4')).toEqual([
      'pmbus-calculator-v1.1.4-web.zip',
      'SHA256SUMS.txt',
    ])
    expect(expectedArtifactNames('2.0.0')).toEqual([
      'pmbus-calculator-v2.0.0-web.zip',
      'SHA256SUMS.txt',
    ])
    expect(isPlainSemver('1.1.4')).toBe(true)
    expect(isPlainSemver('1.1.4-rc.1')).toBe(false)
  })
})

describe('release contract gate wiring (M23)', () => {
  it('runs inside npm run verify and full CI', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }
    expect(pkg.scripts['check:release-contract']).toBe('node scripts/check-release-contract.mjs')
    expect(pkg.scripts.verify).toContain('npm run check:release-contract')

    const workflow = fs.readFileSync(path.join(process.cwd(), '.github/workflows/ci.yml'), 'utf8')
    expect(workflow).toMatch(/^ {8}run: npm run check:release-contract\s*$/m)
  })
})
