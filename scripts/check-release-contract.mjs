import { realpathSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { isStableReleaseVersion } from './release-artifact-contract.mjs'

/** @param {string} repoRoot */
export async function checkReleaseVersion(repoRoot) {
  const [pkg, lock] = await Promise.all(
    ['package.json', 'package-lock.json'].map(async (name) =>
      JSON.parse(await readFile(path.join(repoRoot, name), 'utf8')),
    ),
  )
  const { version } = pkg
  if (!isStableReleaseVersion(version)) {
    return [
      `package.json version must be a stable SemVer starting at 1.0.0 (got ${JSON.stringify(version) ?? 'missing'})`,
    ]
  }

  const lockVersions = [
    ['version', lock.version],
    ['packages[""].version', lock.packages?.['']?.version],
  ]
  return lockVersions.flatMap(([field, lockVersion]) =>
    lockVersion === version
      ? []
      : [
          `package-lock.json ${field} must match package.json version "${version}" (got ${JSON.stringify(lockVersion) ?? 'missing'})`,
        ],
  )
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  if (process.argv.length > 2) {
    console.error(`unknown option(s): ${process.argv.slice(2).join(' ')}`)
    process.exitCode = 2
  } else {
    const errors = await checkReleaseVersion(fileURLToPath(new URL('..', import.meta.url)))
    for (const error of errors) console.error(`release-contract: ${error}`)
    if (errors.length === 0) console.log('release-contract: package and lockfile versions match')
    process.exitCode = errors.length ? 1 : 0
  }
}
