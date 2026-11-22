import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { afterEach, describe, expect, it } from 'vitest'
import { checkReleaseVersion } from '../scripts/check-release-contract.mjs'

describe('release version check', () => {
  const tempDirs: string[] = []
  const version = '1.2.0'

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
  })

  async function makeRepo(packageVersion: unknown, lockVersion: unknown, rootVersion: unknown) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pmbus-release-version-'))
    tempDirs.push(dir)
    await Promise.all([
      fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ version: packageVersion })),
      fs.writeFile(
        path.join(dir, 'package-lock.json'),
        JSON.stringify({ version: lockVersion, packages: { '': { version: rootVersion } } }),
      ),
    ])
    return dir
  }

  it('accepts the current repository version', async () => {
    expect(await checkReleaseVersion(process.cwd())).toEqual([])
  })

  it.each([undefined, 'v1.2.0', '0.1.0', '01.2.0', '1.02.0', '1.2.00', '1.2.0-rc.1'])(
    'rejects unsupported package version %s even when the lockfile matches',
    async (invalid) => {
      const dir = await makeRepo(invalid, invalid, invalid)
      expect(await checkReleaseVersion(dir)).toEqual([
        expect.stringContaining('package.json version must be a stable SemVer'),
      ])
    },
  )

  it.each([
    ['version', '1.1.4', version],
    ['version', undefined, version],
    ['packages[""].version', version, '1.1.4'],
    ['packages[""].version', version, undefined],
  ])('identifies a mismatching or missing lockfile %s', async (field, lockVersion, rootVersion) => {
    const dir = await makeRepo(version, lockVersion, rootVersion)
    expect(await checkReleaseVersion(dir)).toEqual([
      expect.stringContaining(`package-lock.json ${field} must match package.json version`),
    ])
  })
})
