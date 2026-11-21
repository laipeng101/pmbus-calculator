import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { readContract, validateReleaseContract } from '../scripts/check-release-contract.mjs'
import { assetNames } from '../scripts/release-artifact-contract.mjs'

function makeContract(overrides = {}) {
  return {
    version: '1.1.4',
    lockVersions: ['1.1.4', '1.1.4'],
    releasing: '# RELEASING\n\nUpload `pmbus-calculator-vX.Y.Z-web.zip` and `SHA256SUMS.txt`.\n',
    pagesZipTemplate: 'pmbus-calculator-${RELEASE_TAG}-web.zip',
    pagesHasSums: true,
    pagesMatchesSharedContract: true,
    generatorImportsSharedContract: true,
    generatorBehavioralOk: true,
    generatorBehavioralErrors: [],
    ...overrides,
  }
}

describe('release contract validation', () => {
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

  it('rejects a lockfile with only one version entry', () => {
    const result = validateReleaseContract(makeContract({ lockVersions: ['1.1.4'] }))
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toMatch(/must have both top-level/)
  })

  it('rejects lockfile with 0 version entries', () => {
    const result = validateReleaseContract(makeContract({ lockVersions: [] }))
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toMatch(/must have both top-level/)
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
    expect(assetNames('1.1.4')).toEqual({
      zip: 'pmbus-calculator-v1.1.4-web.zip',
      sums: 'SHA256SUMS.txt',
    })
  })
})

describe('release contract integration', () => {
  const tmpDirs: string[] = []
  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
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
    fs.mkdirSync(path.join(tmp, '.github/workflows'), { recursive: true })
    fs.writeFileSync(
      path.join(tmp, '.github/workflows/pages.yml'),
      'name: Pages\non:\n  release:\n    types: [published]\njobs:\n  deploy:\n    runs-on: ubuntu-latest\n    steps:\n      - run: |\n          zip_name="pmbus-calculator-${RELEASE_TAG}-web.zip"\n          curl -fsSL -o SHA256SUMS.txt "${sums_url}"\n',
    )
    fs.mkdirSync(path.join(tmp, 'docs'))
    fs.writeFileSync(
      path.join(tmp, 'docs/RELEASING.md'),
      '# RELEASING\n\nUpload `pmbus-calculator-vX.Y.Z-web.zip` and `SHA256SUMS.txt`.\n',
    )
    // Use the real artifact-naming contract with a minimal generator.
    fs.mkdirSync(path.join(tmp, 'scripts'), { recursive: true })
    fs.copyFileSync(
      path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        '..',
        'scripts',
        'release-artifact-contract.mjs',
      ),
      path.join(tmp, 'scripts', 'release-artifact-contract.mjs'),
    )
    fs.writeFileSync(
      path.join(tmp, 'scripts/prepare-release-assets.mjs'),
      "import { buildReleasePlan } from './release-artifact-contract.mjs'\n" +
        'export function getReleasePlan(v) { return buildReleasePlan(v) }\n' +
        'function writeAssets(deps, plan) { deps.console(plan.zipName, plan.sumsName) }\n' +
        'export function generateAssets(distDir, outputDir, force, python3, deps) {\n' +
        '  const pkg = JSON.parse(deps.readFileSync("package.json"))\n' +
        '  const plan = buildReleasePlan(pkg.version)\n' +
        '  deps.console(plan.zipName, plan.sumsName)\n' +
        '}\n',
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
    const contract = await readContract(tmp)
    const result = validateReleaseContract(contract)
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toMatch(/does not reference the zip/)
  })

  it('validates the real package, release workflow, runbook, and generator together', async () => {
    const contract = await readContract(process.cwd())
    expect(validateReleaseContract(contract)).toEqual({ ok: true, errors: [] })
  })
})
