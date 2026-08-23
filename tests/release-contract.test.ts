// Unit and integration tests for the offline release contract gate (M23, hardened M24, M25).
//
// M25 adds: CHANGELOG structural validation, fenced-code-block awareness,
// [Unreleased] presence check, generator/shared-contract wiring check,
// and RELEASING.md integration into readContract.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { afterEach, describe, expect, it } from 'vitest'
import {
  checkReleasingArtifactNames,
  expectedArtifactNames,
  isPlainSemver,
  isValidGregorianDate,
  readContract,
  validateChangelog,
  validateReleaseContract,
} from '../scripts/check-release-contract.mjs'

function TAG_LINK(v: string): string {
  return `https://github.com/laipeng101/pmbus-calculator/releases/tag/${v}`
}
function SUMS_LINK(v: string): string {
  return `https://github.com/laipeng101/pmbus-calculator/releases/download/${v}/SHA256SUMS.txt`
}

function readmeContent(version: string): string {
  return [
    `> **Live Demo:** https://laipeng101.github.io/pmbus-calculator/ (currently deploys \`${version}\`)`,
    `> **Stable version:** [\`${version}\`](${TAG_LINK(version)}) · [SHA256SUMS.txt](${SUMS_LINK(version)})`,
    `Deploys the immutable \`${version}\` Release asset.`,
  ].join('\n')
}

function makeContract(overrides = {}) {
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
    releasing: '# RELEASING\n\nUpload `pmbus-calculator-vX.Y.Z-web.zip` and `SHA256SUMS.txt`.\n',
    pagesZipTemplate: 'pmbus-calculator-${RELEASE_TAG}-web.zip',
    pagesHasSums: true,
    pagesMatchesSharedContract: true,
    generatorImportsSharedContract: true,
    ...overrides,
  }
}

describe('release contract validation (M23/M24)', () => {
  it('accepts a fully consistent contract', () => {
    const result = validateReleaseContract(makeContract())
    expect(result.errors).toEqual([])
    expect(result.ok).toBe(true)
  })

  it('rejects a v-prefixed version', () => {
    const result = validateReleaseContract(makeContract({ version: 'v1.1.4' }))
    expect(result.ok).toBe(false)
    expect(result.errors[0]).toMatch(/plain semver without a v prefix/)
  })

  it('rejects package-lock.json version drift', () => {
    const result = validateReleaseContract(makeContract({ lockVersions: ['1.1.4', '1.1.3'] }))
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toMatch(/package-lock\.json version 1\.1\.3/)
  })

  it('rejects lockfile with fewer than 2 version entries (M24)', () => {
    const result = validateReleaseContract(makeContract({ lockVersions: ['1.1.4'] }))
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toMatch(/must have both top-level/)
  })

  it('rejects lockfile with 0 version entries', () => {
    const result = validateReleaseContract(makeContract({ lockVersions: [] }))
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toMatch(/must have both top-level/)
  })

  it('rejects a missing CHANGELOG section', () => {
    const result = validateReleaseContract(makeContract({ changelog: '# Changelog\n' }))
    expect(result.errors.join('\n')).toMatch(/CHANGELOG\.md has no/)
  })

  it('rejects a CHANGELOG section without a real date', () => {
    const result = validateReleaseContract(
      makeContract({ changelog: '# Changelog\n\n## [1.1.4] - TBD\n' }),
    )
    expect(result.errors.join('\n')).toMatch(/CHANGELOG\.md has no/)
  })

  it('rejects an invalid Gregorian date like 2026-99-99 (M24)', () => {
    const result = validateReleaseContract(
      makeContract({ changelog: '# Changelog\n\n## [1.1.4] - 2026-99-99\n' }),
    )
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toMatch(/not a valid Gregorian date/)
  })

  it('rejects February 30 (M24)', () => {
    const result = validateReleaseContract(
      makeContract({ changelog: '# Changelog\n\n## [1.1.4] - 2026-02-30\n' }),
    )
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toMatch(/not a valid Gregorian date/)
  })

  it('rejects missing release notes', () => {
    const result = validateReleaseContract(
      makeContract({ releaseNotes: { exists: false, content: '' } }),
    )
    expect(result.errors.join('\n')).toMatch(/docs\/releases\/v1\.1\.4\.md does not exist/)
  })

  it('rejects release notes whose first line is not the exact title (M24)', () => {
    const result = validateReleaseContract(
      makeContract({
        releaseNotes: { exists: true, content: '# Wrong Title\n\n# PMBus Calculator v1.1.4\n' },
      }),
    )
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toMatch(/first line must be/)
  })

  it('rejects release notes with title in body but not first line (M24)', () => {
    const result = validateReleaseContract(
      makeContract({
        releaseNotes: { exists: true, content: '# PMBus Calculator v1.1.3\n\nFixed in v1.1.4.\n' },
      }),
    )
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toMatch(/first line must be/)
  })

  it('rejects stale GitHub release links in a README', () => {
    const result = validateReleaseContract(
      makeContract({
        readmes: [
          { name: 'README.md', content: readmeContent('v1.1.4') },
          { name: 'README_zh-CN.md', content: readmeContent('v1.1.3') },
        ],
      }),
    )
    expect(result.errors.join('\n')).toMatch(/README_zh-CN\.md still links/)
  })

  it('rejects a README missing the SHA256SUMS link', () => {
    const content = readmeContent('v1.1.4').replace(SUMS_LINK('v1.1.4'), TAG_LINK('v1.1.4'))
    const result = validateReleaseContract(
      makeContract({ readmes: [{ name: 'README.md', content }, makeContract().readmes[1]] }),
    )
    expect(result.errors.join('\n')).toMatch(/missing the SHA256SUMS/)
  })

  it('rejects a README that never declares the deployed version', () => {
    const content = readmeContent('v1.1.4').replaceAll('`v1.1.4`', 'the latest release')
    const result = validateReleaseContract(
      makeContract({ readmes: [{ name: 'README.md', content }, makeContract().readmes[1]] }),
    )
    expect(result.errors.join('\n')).toMatch(/does not declare the deployed version/)
  })

  it('rejects README Live Demo line declaring a stale version (M24)', () => {
    const content = `> **Live Demo:** https://laipeng101.github.io/pmbus-calculator/ (currently deploys \`v1.1.3\`)\n> **Stable version:** [\`v1.1.4\`](${TAG_LINK('v1.1.4')}) · [SHA256SUMS.txt](${SUMS_LINK('v1.1.4')})`
    const result = validateReleaseContract(
      makeContract({ readmes: [{ name: 'README.md', content }, makeContract().readmes[1]] }),
    )
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toMatch(/Live Demo line does not declare/)
  })

  it('allows README links to repository docs of older versions', () => {
    const result = validateReleaseContract(
      makeContract({
        readmes: [
          {
            name: 'README.md',
            content: `${readmeContent('v1.1.4')}\nSee docs/releases/v1.0.0.md.`,
          },
          makeContract().readmes[1],
        ],
      }),
    )
    expect(result.errors).toEqual([])
  })

  it('rejects a ROADMAP stable declaration for a different version', () => {
    const result = validateReleaseContract(
      makeContract({ roadmap: 'M0–M23 complete；stable release v1.1.3；' }),
    )
    expect(result.errors.join('\n')).toMatch(/stable release declaration is v1\.1\.3/)
  })

  it('rejects ROADMAP with multiple stable declarations (M24)', () => {
    const result = validateReleaseContract(
      makeContract({ roadmap: 'M0–M23 complete；stable release v1.1.4；stable release v1.1.3；' }),
    )
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toMatch(/has 2 stable release/)
  })

  it('rejects ROADMAP with no stable declaration (M24)', () => {
    const result = validateReleaseContract(makeContract({ roadmap: 'M0–M23 complete；' }))
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toMatch(/stable release declaration is missing/)
  })

  it('rejects missing Pages workflow zip template', () => {
    const result = validateReleaseContract(makeContract({ pagesZipTemplate: null }))
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toMatch(/missing the zip_name/)
  })

  it('rejects wrong Pages workflow zip template', () => {
    const result = validateReleaseContract(
      makeContract({
        pagesZipTemplate: 'pmbus-calculator-${RELEASE_TAG}.zip',
        pagesMatchesSharedContract: false,
      }),
    )
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toMatch(/zip template/)
  })

  it('rejects missing SHA256SUMS in Pages workflow', () => {
    const result = validateReleaseContract(makeContract({ pagesHasSums: false }))
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toMatch(/does not reference SHA256SUMS/)
  })

  it('derives artifact names from the version', () => {
    expect(expectedArtifactNames('1.1.4')).toEqual([
      'pmbus-calculator-v1.1.4-web.zip',
      'SHA256SUMS.txt',
    ])
    expect(isPlainSemver('1.1.4')).toBe(true)
    expect(isPlainSemver('1.1.4-rc.1')).toBe(false)
  })

  it('validates Gregorian dates correctly', () => {
    expect(isValidGregorianDate('2026-08-23')).toBe(true)
    expect(isValidGregorianDate('2024-02-29')).toBe(true)
    expect(isValidGregorianDate('2026-02-29')).toBe(false)
    expect(isValidGregorianDate('2026-99-99')).toBe(false)
    expect(isValidGregorianDate('not-a-date')).toBe(false)
  })
})

describe('release contract integration (M24)', () => {
  /** @type {string[]} */
  const tmpDirs = /** @type {string[]} */ /** @type {unknown} */ ['']
  tmpDirs.length = 0
  afterEach(() => {
    const dirs = /** @type {string[]} */ tmpDirs.splice(0)
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true })
  })

  function createFixtureRepo() {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pmbus-rc-test-'))
    tmpDirs.push(tmp)
    fs.writeFileSync(
      path.join(tmp, 'package.json'),
      JSON.stringify({ name: 'test', version: '1.1.5', private: true }, null, 2),
    )
    fs.writeFileSync(
      path.join(tmp, 'package-lock.json'),
      JSON.stringify(
        {
          name: 'test',
          version: '1.1.5',
          lockfileVersion: 3,
          packages: { '': { name: 'test', version: '1.1.5' } },
        },
        null,
        2,
      ),
    )
    fs.writeFileSync(
      path.join(tmp, 'CHANGELOG.md'),
      '# Changelog\n\n## [Unreleased]\n\n## [1.1.5] - 2026-08-23\n\n### Fixed\n\n- foo\n',
    )
    fs.mkdirSync(path.join(tmp, 'docs/releases'), { recursive: true })
    fs.writeFileSync(
      path.join(tmp, 'docs/releases/v1.1.5.md'),
      '# PMBus Calculator v1.1.5\n\nPATCH release.\n',
    )
    fs.writeFileSync(path.join(tmp, 'README.md'), readmeContent('v1.1.5'))
    fs.writeFileSync(path.join(tmp, 'README_zh-CN.md'), readmeContent('v1.1.5'))
    fs.writeFileSync(path.join(tmp, 'docs/ROADMAP.md'), 'M0–M24 complete；stable release v1.1.5；')
    fs.mkdirSync(path.join(tmp, '.github/workflows'), { recursive: true })
    fs.writeFileSync(
      path.join(tmp, '.github/workflows/pages.yml'),
      'name: Pages\non:\n  release:\n    types: [published]\njobs:\n  deploy:\n    runs-on: ubuntu-latest\n    steps:\n      - run: |\n          zip_name="pmbus-calculator-${RELEASE_TAG}-web.zip"\n          curl -fsSL -o SHA256SUMS.txt "${sums_url}"\n',
    )
    fs.writeFileSync(
      path.join(tmp, 'docs/RELEASING.md'),
      '# RELEASING\n\nUpload `pmbus-calculator-vX.Y.Z-web.zip` and `SHA256SUMS.txt`.\n',
    )
    // M25: generator must import from shared contract
    fs.mkdirSync(path.join(tmp, 'scripts'), { recursive: true })
    fs.writeFileSync(
      path.join(tmp, 'scripts/release-artifact-contract.mjs'),
      'export const PAGES_ZIP_TEMPLATE = "pmbus-calculator-${RELEASE_TAG}-web.zip"\n' +
        'export function assetZipName(v) { return `pmbus-calculator-v${v}-web.zip` }\n' +
        'export function assetSumsName() { return "SHA256SUMS.txt" }\n',
    )
    fs.writeFileSync(
      path.join(tmp, 'scripts/prepare-release-assets.mjs'),
      "import { assetZipName, assetSumsName } from './release-artifact-contract.mjs'\n" +
        'export function assetNames(v) { return { zip: assetZipName(v), sums: assetSumsName() } }\n',
    )
    return tmp
  }

  it('passes the full read+validate chain on a consistent fixture', async () => {
    const tmp = createFixtureRepo()
    const contract = await readContract(tmp)
    const result = validateReleaseContract(contract)
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('fails when lockfile top-level version drifts', async () => {
    const tmp = createFixtureRepo()
    const lock = JSON.parse(fs.readFileSync(path.join(tmp, 'package-lock.json'), 'utf8'))
    lock.version = '1.1.4'
    fs.writeFileSync(path.join(tmp, 'package-lock.json'), JSON.stringify(lock, null, 2))
    const contract = await readContract(tmp)
    const result = validateReleaseContract(contract)
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toMatch(/version 1\.1\.4 does not match/)
  })

  it('fails when lockfile root package version is missing', async () => {
    const tmp = createFixtureRepo()
    const lock = JSON.parse(fs.readFileSync(path.join(tmp, 'package-lock.json'), 'utf8'))
    delete lock.packages[''].version
    fs.writeFileSync(path.join(tmp, 'package-lock.json'), JSON.stringify(lock, null, 2))
    const contract = await readContract(tmp)
    const result = validateReleaseContract(contract)
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toMatch(/must have both top-level/)
  })

  it('fails when CHANGELOG has no version section', async () => {
    const tmp = createFixtureRepo()
    fs.writeFileSync(path.join(tmp, 'CHANGELOG.md'), '# Changelog\n\n## [1.1.4] - 2026-08-16\n')
    const contract = await readContract(tmp)
    const result = validateReleaseContract(contract)
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toMatch(/CHANGELOG\.md has no/)
  })

  it('fails when CHANGELOG date is invalid', async () => {
    const tmp = createFixtureRepo()
    fs.writeFileSync(
      path.join(tmp, 'CHANGELOG.md'),
      '# Changelog\n\n## [Unreleased]\n\n## [1.1.5] - 2026-99-99\n\n### Fixed\n\n- foo\n',
    )
    const contract = await readContract(tmp)
    const result = validateReleaseContract(contract)
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toMatch(/not a valid Gregorian date/)
  })

  it('fails when release notes first title is wrong', async () => {
    const tmp = createFixtureRepo()
    fs.writeFileSync(
      path.join(tmp, 'docs/releases/v1.1.5.md'),
      '# Wrong Title\n\n# PMBus Calculator v1.1.5\n',
    )
    const contract = await readContract(tmp)
    const result = validateReleaseContract(contract)
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toMatch(/first line must be/)
  })

  it('fails when README Live Demo line is stale', async () => {
    const tmp = createFixtureRepo()
    fs.writeFileSync(path.join(tmp, 'README.md'), readmeContent('v1.1.4'))
    const contract = await readContract(tmp)
    const result = validateReleaseContract(contract)
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toMatch(/Live Demo line/)
  })

  it('fails when README stable link is stale', async () => {
    const tmp = createFixtureRepo()
    fs.writeFileSync(
      path.join(tmp, 'README.md'),
      `> **Live Demo:** https://laipeng101.github.io/pmbus-calculator/ (currently deploys \`v1.1.5\`)\n> **Stable version:** [\`v1.1.4\`](${TAG_LINK('v1.1.4')}) · [SHA256SUMS.txt](${SUMS_LINK('v1.1.5')})\nDeploys the immutable \`v1.1.5\` Release asset.`,
    )
    const contract = await readContract(tmp)
    const result = validateReleaseContract(contract)
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toMatch(/missing the stable tag link/)
    expect(result.errors.join('\n')).toMatch(/links GitHub release v1\.1\.4/)
  })

  it('fails when README checksum link is stale', async () => {
    const tmp = createFixtureRepo()
    fs.writeFileSync(
      path.join(tmp, 'README.md'),
      `> **Live Demo:** https://laipeng101.github.io/pmbus-calculator/ (currently deploys \`v1.1.5\`)\n> **Stable version:** [\`v1.1.5\`](${TAG_LINK('v1.1.5')}) · [SHA256SUMS.txt](${SUMS_LINK('v1.1.4')})`,
    )
    const contract = await readContract(tmp)
    const result = validateReleaseContract(contract)
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toMatch(/links GitHub release v1\.1\.4/)
  })

  it('fails when ROADMAP has a stale stable version', async () => {
    const tmp = createFixtureRepo()
    fs.writeFileSync(path.join(tmp, 'docs/ROADMAP.md'), 'M0–M23 complete；stable release v1.1.4；')
    const contract = await readContract(tmp)
    const result = validateReleaseContract(contract)
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toMatch(/stable release declaration is v1\.1\.4/)
  })

  it('fails when ROADMAP has duplicate stable declarations', async () => {
    const tmp = createFixtureRepo()
    fs.writeFileSync(
      path.join(tmp, 'docs/ROADMAP.md'),
      'M0–M24 complete；stable release v1.1.5；stable release v1.1.4；',
    )
    const contract = await readContract(tmp)
    const result = validateReleaseContract(contract)
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toMatch(/has 2 stable/)
  })

  it('fails when Pages workflow zip template is wrong', async () => {
    const tmp = createFixtureRepo()
    fs.writeFileSync(
      path.join(tmp, '.github/workflows/pages.yml'),
      'name: Pages\non:\n  release:\n    types: [published]\njobs:\n  deploy:\n    runs-on: ubuntu-latest\n    steps:\n      - run: |\n          zip_name="pmbus-calculator-${RELEASE_TAG}-web.tar.gz"\n          curl -fsSL -o SHA256SUMS.txt "${sums_url}"\n',
    )
    const contract = await readContract(tmp)
    const result = validateReleaseContract(contract)
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toMatch(/zip template/)
  })

  it('fails when RELEASING.md does not reference the zip name', async () => {
    const tmp = createFixtureRepo()
    fs.writeFileSync(
      path.join(tmp, 'docs/RELEASING.md'),
      '# RELEASING\n\nUpload `wrong-name.zip` and `SHA256SUMS.txt`.\n',
    )
    const errors = await checkReleasingArtifactNames(tmp, '1.1.5')
    expect(errors.length).toBeGreaterThan(0)
    expect(errors.join('\n')).toMatch(/does not reference the zip/)
  })
})

describe('CHANGELOG structural validation (M25)', () => {
  it('accepts a valid CHANGELOG with [Unreleased] first', () => {
    const result = validateChangelog(
      '# Changelog\n\n## [Unreleased]\n\n## [1.1.5] - 2026-08-23\n\n### Fixed\n\n- foo\n',
      '1.1.5',
    )
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('rejects missing [Unreleased]', () => {
    const result = validateChangelog(
      '# Changelog\n\n## [1.1.5] - 2026-08-23\n\n### Fixed\n\n- foo\n',
      '1.1.5',
    )
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toMatch(/Unreleased/)
  })

  it('rejects duplicate [Unreleased]', () => {
    const result = validateChangelog(
      '# Changelog\n\n## [Unreleased]\n\n## [Unreleased]\n\n## [1.1.5] - 2026-08-23\n',
      '1.1.5',
    )
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toMatch(/duplicate/)
  })

  it('rejects [Unreleased] after a dated version', () => {
    const result = validateChangelog(
      '# Changelog\n\n## [1.1.5] - 2026-08-23\n\n## [Unreleased]\n',
      '1.1.5',
    )
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toMatch(/must be the first/)
  })

  it('rejects current version not being the first dated section', () => {
    const result = validateChangelog(
      '# Changelog\n\n## [Unreleased]\n\n## [1.1.4] - 2026-08-23\n\n## [1.1.5] - 2026-08-23\n',
      '1.1.5',
    )
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toMatch(/first dated/)
  })

  it('rejects duplicate current version', () => {
    const result = validateChangelog(
      '# Changelog\n\n## [Unreleased]\n\n## [1.1.5] - 2026-08-23\n\n## [1.1.5] - 2026-08-24\n',
      '1.1.5',
    )
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toMatch(/duplicate/)
  })

  it('rejects invalid Gregorian date', () => {
    const result = validateChangelog(
      '# Changelog\n\n## [Unreleased]\n\n## [1.1.5] - 2026-99-99\n\n### Fixed\n\n- foo\n',
      '1.1.5',
    )
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toMatch(/Gregorian/)
  })

  it('ignores headings inside fenced code blocks', () => {
    const result = validateChangelog(
      '# Changelog\n\n## [Unreleased]\n\n```\n## [1.1.5] - 2026-08-23\n```\n\n## [1.1.5] - 2026-08-23\n\n### Fixed\n\n- foo\n',
      '1.1.5',
    )
    expect(result.ok).toBe(true)
  })
})

describe('readContract completeness (M25)', () => {
  it('readContract includes RELEASING.md content', async () => {
    const contract = await readContract(process.cwd())
    expect(contract.releasing).toBeTruthy()
    expect(contract.releasing).toMatch(/pmbus-calculator/)
  })

  it('readContract includes generator contract wiring check', async () => {
    const contract = await readContract(process.cwd())
    expect(contract.generatorImportsSharedContract).toBe(true)
  })
})

describe('release contract integration (M25)', () => {
  /** @type {string[]} */
  const tmpDirs2 = /** @type {string[]} */ /** @type {unknown} */ ['']
  tmpDirs2.length = 0
  afterEach(() => {
    const dirs = /** @type {string[]} */ tmpDirs2.splice(0)
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true })
  })

  function createM25FixtureRepo() {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pmbus-rc-m25-'))
    tmpDirs2.push(tmp)
    fs.writeFileSync(
      path.join(tmp, 'package.json'),
      JSON.stringify({ name: 'test', version: '1.1.5', private: true }, null, 2),
    )
    fs.writeFileSync(
      path.join(tmp, 'package-lock.json'),
      JSON.stringify(
        {
          name: 'test',
          version: '1.1.5',
          lockfileVersion: 3,
          packages: { '': { name: 'test', version: '1.1.5' } },
        },
        null,
        2,
      ),
    )
    fs.writeFileSync(
      path.join(tmp, 'CHANGELOG.md'),
      '# Changelog\n\n## [Unreleased]\n\n## [1.1.5] - 2026-08-23\n\n### Fixed\n\n- foo\n',
    )
    fs.mkdirSync(path.join(tmp, 'docs/releases'), { recursive: true })
    fs.writeFileSync(
      path.join(tmp, 'docs/releases/v1.1.5.md'),
      '# PMBus Calculator v1.1.5\n\nPATCH release.\n',
    )
    fs.writeFileSync(
      path.join(tmp, 'README.md'),
      '> **Live Demo:** https://laipeng101.github.io/pmbus-calculator/ (currently deploys `v1.1.5`)\n' +
        '> **Stable version:** [`v1.1.5`](https://github.com/laipeng101/pmbus-calculator/releases/tag/v1.1.5) · [SHA256SUMS.txt](https://github.com/laipeng101/pmbus-calculator/releases/download/v1.1.5/SHA256SUMS.txt)\n',
    )
    fs.writeFileSync(path.join(tmp, 'README_zh-CN.md'), 'README_zh-CN placeholder v1.1.5')
    fs.writeFileSync(path.join(tmp, 'docs/ROADMAP.md'), 'M0–M24 complete；stable release v1.1.5；')
    fs.mkdirSync(path.join(tmp, '.github/workflows'), { recursive: true })
    fs.writeFileSync(
      path.join(tmp, '.github/workflows/pages.yml'),
      'name: Pages\non:\n  release:\n    types: [published]\njobs:\n  deploy:\n    runs-on: ubuntu-latest\n    steps:\n      - run: |\n          zip_name="pmbus-calculator-${RELEASE_TAG}-web.zip"\n          curl -fsSL -o SHA256SUMS.txt "${sums_url}"\n',
    )
    fs.writeFileSync(
      path.join(tmp, 'docs/RELEASING.md'),
      '# RELEASING\n\nUpload `pmbus-calculator-vX.Y.Z-web.zip` and `SHA256SUMS.txt`.\n',
    )
    // Create a minimal generator that imports from a shared contract
    fs.mkdirSync(path.join(tmp, 'scripts'), { recursive: true })
    fs.writeFileSync(
      path.join(tmp, 'scripts/release-artifact-contract.mjs'),
      'export const PAGES_ZIP_TEMPLATE = "pmbus-calculator-${RELEASE_TAG}-web.zip"\n' +
        'export function assetZipName(v) { return `pmbus-calculator-v${v}-web.zip` }\n' +
        'export function assetSumsName() { return "SHA256SUMS.txt" }\n',
    )
    fs.writeFileSync(
      path.join(tmp, 'scripts/prepare-release-assets.mjs'),
      "import { assetZipName, assetSumsName } from './release-artifact-contract.mjs'\n" +
        'export function assetNames(v) { return { zip: assetZipName(v), sums: assetSumsName() } }\n',
    )
    return tmp
  }

  it('fails when [Unreleased] is missing', async () => {
    const tmp = createM25FixtureRepo()
    fs.writeFileSync(
      path.join(tmp, 'CHANGELOG.md'),
      '# Changelog\n\n## [1.1.5] - 2026-08-23\n\n### Fixed\n\n- foo\n',
    )
    const contract = await readContract(tmp)
    const changelogResult = validateChangelog(contract.changelog, contract.version)
    expect(changelogResult.ok).toBe(false)
    expect(changelogResult.errors.join('\n')).toMatch(/Unreleased/)
  })

  it('fails when [Unreleased] is duplicated', async () => {
    const tmp = createM25FixtureRepo()
    fs.writeFileSync(
      path.join(tmp, 'CHANGELOG.md'),
      '# Changelog\n\n## [Unreleased]\n\n## [Unreleased]\n\n## [1.1.5] - 2026-08-23\n',
    )
    const contract = await readContract(tmp)
    const changelogResult = validateChangelog(contract.changelog, contract.version)
    expect(changelogResult.ok).toBe(false)
    expect(changelogResult.errors.join('\n')).toMatch(/duplicate/)
  })

  it('fails when [Unreleased] is placed after a dated section', async () => {
    const tmp = createM25FixtureRepo()
    fs.writeFileSync(
      path.join(tmp, 'CHANGELOG.md'),
      '# Changelog\n\n## [1.1.4] - 2026-08-16\n\n## [Unreleased]\n\n## [1.1.5] - 2026-08-23\n',
    )
    const contract = await readContract(tmp)
    const changelogResult = validateChangelog(contract.changelog, contract.version)
    expect(changelogResult.ok).toBe(false)
    expect(changelogResult.errors.join('\n')).toMatch(/must be the first/)
  })

  it('fails when current version is not the first dated section', async () => {
    const tmp = createM25FixtureRepo()
    fs.writeFileSync(
      path.join(tmp, 'CHANGELOG.md'),
      '# Changelog\n\n## [Unreleased]\n\n## [1.1.4] - 2026-08-16\n\n## [1.1.5] - 2026-08-23\n',
    )
    const contract = await readContract(tmp)
    const changelogResult = validateChangelog(contract.changelog, contract.version)
    expect(changelogResult.ok).toBe(false)
    expect(changelogResult.errors.join('\n')).toMatch(/first dated/)
  })

  it('fails when current version is duplicated', async () => {
    const tmp = createM25FixtureRepo()
    fs.writeFileSync(
      path.join(tmp, 'CHANGELOG.md'),
      '# Changelog\n\n## [Unreleased]\n\n## [1.1.5] - 2026-08-23\n\n## [1.1.5] - 2026-08-24\n',
    )
    const contract = await readContract(tmp)
    const changelogResult = validateChangelog(contract.changelog, contract.version)
    expect(changelogResult.ok).toBe(false)
    expect(changelogResult.errors.join('\n')).toMatch(/duplicate/)
  })

  it('ignores fenced code block headings', async () => {
    const tmp = createM25FixtureRepo()
    fs.writeFileSync(
      path.join(tmp, 'CHANGELOG.md'),
      '# Changelog\n\n## [Unreleased]\n\n```\n## [1.1.5] - 2026-08-23\n```\n\n## [1.1.5] - 2026-08-23\n\n### Fixed\n\n- foo\n',
    )
    const contract = await readContract(tmp)
    const changelogResult = validateChangelog(contract.changelog, contract.version)
    expect(changelogResult.ok).toBe(true)
  })

  it('fails via real CLI when [Unreleased] is missing', () => {
    const tmp = createM25FixtureRepo()
    fs.writeFileSync(
      path.join(tmp, 'CHANGELOG.md'),
      '# Changelog\n\n## [1.1.5] - 2026-08-23\n\n### Fixed\n\n- foo\n',
    )
    try {
      execFileSync(
        process.execPath,
        [path.join(process.cwd(), 'scripts', 'check-release-contract.mjs')],
        { cwd: tmp, stdio: 'pipe', timeout: 10_000 },
      )
      // Should have thrown
      expect(true).toBe(false)
    } catch (e) {
      // @ts-expect-error — catch variable is unknown in strict mode
      expect(e.status).not.toBe(0)
    }
  })
})

describe('release contract gate wiring (M23)', () => {
  it('runs inside npm run verify and full CI', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'))
    expect(pkg.scripts['check:release-contract']).toBe('node scripts/check-release-contract.mjs')
    expect(pkg.scripts.verify).toContain('npm run check:release-contract')
    const workflow = fs.readFileSync(path.join(process.cwd(), '.github/workflows/ci.yml'), 'utf8')
    expect(workflow).toMatch(/^ {8}run: npm run check:release-contract\s*$/m)
  })
})
