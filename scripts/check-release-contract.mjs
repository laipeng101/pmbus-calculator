// Gate: offline release contract consistency (M23).
//
// The single source of truth for the current version is package.json. Every
// other release surface is validated against it so a version bump can never
// land half-applied:
// - package-lock.json top-level and root-package version,
// - CHANGELOG.md section with a real release date,
// - docs/releases/vX.Y.Z.md with a matching title,
// - README.md and README_zh-CN.md stable/live/release/checksum links,
// - docs/ROADMAP.md stable release declaration,
// - the expected immutable Release artifact names.
//
// Fully offline by design: no network, no GitHub login, no Pages, and no
// remote tag or GitHub Release needs to exist yet — safe to run in PR CI
// before anything is published. The version is never hardcoded here; every
// expectation is derived from the package.json version passed in.

import { realpathSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const RELEASES_URL_VERSION_PATTERN = /\/releases\/(?:tag|download)\/v(\d+\.\d+\.\d+)(?:\/|$)/g
const CHANGELOG_SECTION_PATTERN = /^## \[(\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2})$/m
const ROADMAP_STABLE_PATTERN = /stable release v(\d+\.\d+\.\d+)/
const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/

export function repoRootFromScript(importMetaUrl) {
  return path.resolve(path.dirname(fileURLToPath(importMetaUrl)), '..')
}

/**
 * Expected immutable GitHub Release artifact names for a version. Derived
 * from the version argument; never hardcoded per release.
 * @param {string} version
 * @returns {string[]}
 */
export function expectedArtifactNames(version) {
  return [`pmbus-calculator-v${version}-web.zip`, 'SHA256SUMS.txt']
}

/**
 * @param {string} version
 * @returns {boolean}
 */
export function isPlainSemver(version) {
  return SEMVER_PATTERN.test(version)
}

/**
 * Validate the cross-file release contract against one version.
 *
 * @param {{
 *   version: string,
 *   lockVersions: string[],
 *   changelog: string,
 *   releaseNotes: { exists: boolean, content: string },
 *   readmes: Array<{ name: string, content: string }>,
 *   roadmap: string,
 *   artifactNames: string[],
 * }} contract
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateReleaseContract(contract) {
  const errors = []
  const version = contract.version

  if (!isPlainSemver(version)) {
    errors.push(`package.json version must be plain semver without a v prefix (got: ${version})`)
    return { ok: false, errors }
  }

  for (const lockVersion of contract.lockVersions) {
    if (lockVersion !== version) {
      errors.push(`package-lock.json version ${lockVersion} does not match ${version}`)
    }
  }
  if (contract.lockVersions.length === 0) {
    errors.push('package-lock.json version fields could not be read')
  }

  const changelogMatch = contract.changelog.match(CHANGELOG_SECTION_PATTERN)
  if (changelogMatch === null || changelogMatch[1] !== version) {
    errors.push(`CHANGELOG.md has no "## [${version}] - YYYY-MM-DD" section`)
  }

  if (!contract.releaseNotes.exists) {
    errors.push(`docs/releases/v${version}.md does not exist`)
  } else if (!contract.releaseNotes.content.includes(`# PMBus Calculator v${version}`)) {
    errors.push(`docs/releases/v${version}.md title does not declare v${version}`)
  }

  for (const readme of contract.readmes) {
    validateReadme(readme.name, readme.content, version, errors)
  }

  const roadmapMatch = contract.roadmap.match(ROADMAP_STABLE_PATTERN)
  if (roadmapMatch === null || roadmapMatch[1] !== version) {
    errors.push(
      `docs/ROADMAP.md stable release declaration is ${
        roadmapMatch === null ? 'missing' : `v${roadmapMatch[1]}`
      }, expected v${version}`,
    )
  }

  const expected = expectedArtifactNames(version)
  const mismatched = contract.artifactNames.filter((name) => !expected.includes(name))
  const missing = expected.filter((name) => !contract.artifactNames.includes(name))
  for (const name of mismatched) {
    errors.push(`unexpected release artifact name: ${name}`)
  }
  for (const name of missing) {
    errors.push(`missing expected release artifact: ${name}`)
  }

  return { ok: errors.length === 0, errors }
}

/**
 * README rules: every GitHub releases URL (tag or download) must point at the
 * current version, and the stable tag link, the SHA256SUMS download link, and
 * a backticked `vX.Y.Z` live-deployment declaration must each exist. Links to
 * repository docs like docs/releases/v1.0.0.md are not GitHub release URLs
 * and stay allowed.
 * @param {string} name
 * @param {string} content
 * @param {string} version
 * @param {string[]} errors
 */
function validateReadme(name, content, version, errors) {
  const urlVersions = new Set()
  for (const match of content.matchAll(RELEASES_URL_VERSION_PATTERN)) {
    urlVersions.add(match[1])
  }
  for (const urlVersion of urlVersions) {
    if (urlVersion !== version) {
      errors.push(`${name} still links GitHub release v${urlVersion}, expected v${version}`)
    }
  }
  if (!content.includes(`/releases/tag/v${version}`)) {
    errors.push(`${name} is missing the stable tag link for v${version}`)
  }
  if (!content.includes(`/releases/download/v${version}/SHA256SUMS.txt`)) {
    errors.push(`${name} is missing the SHA256SUMS.txt download link for v${version}`)
  }
  if (!content.includes(`\`v${version}\``)) {
    errors.push(`${name} does not declare the deployed version \`v${version}\``)
  }
}

async function readContract(repoRoot) {
  const pkg = JSON.parse(await fs.readFile(path.join(repoRoot, 'package.json'), 'utf8'))
  const lock = JSON.parse(await fs.readFile(path.join(repoRoot, 'package-lock.json'), 'utf8'))
  const releaseNotesPath = path.join(repoRoot, 'docs', 'releases', `v${pkg.version}.md`)
  const releaseNotesExists = await fs
    .access(releaseNotesPath)
    .then(() => true)
    .catch(() => false)

  return {
    version: pkg.version,
    lockVersions: [lock.version, lock.packages?.['']?.version].filter(
      (value) => typeof value === 'string',
    ),
    changelog: await fs.readFile(path.join(repoRoot, 'CHANGELOG.md'), 'utf8'),
    releaseNotes: {
      exists: releaseNotesExists,
      content: releaseNotesExists ? await fs.readFile(releaseNotesPath, 'utf8') : '',
    },
    readmes: await Promise.all(
      ['README.md', 'README_zh-CN.md'].map(async (readmeName) => ({
        name: readmeName,
        content: await fs.readFile(path.join(repoRoot, readmeName), 'utf8'),
      })),
    ),
    roadmap: await fs.readFile(path.join(repoRoot, 'docs', 'ROADMAP.md'), 'utf8'),
    artifactNames: expectedArtifactNames(pkg.version),
  }
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length > 0) {
    process.stderr.write(`unknown option(s): ${args.join(' ')}\n`)
    process.exit(2)
  }

  const contract = await readContract(repoRootFromScript(import.meta.url))
  const result = validateReleaseContract(contract)
  process.stdout.write(`release-contract: checking version ${contract.version}\n`)
  for (const message of result.errors) {
    process.stderr.write(`release-contract: ${message}\n`)
  }
  if (result.ok) {
    process.stdout.write(
      `release-contract: expected artifacts: ${contract.artifactNames.join(', ')}\n`,
    )
    process.stdout.write('release-contract: OK\n')
  } else {
    process.stderr.write(`release-contract: FAILED with ${result.errors.length} error(s)\n`)
  }
  process.exitCode = result.ok ? 0 : 1
}

const isDirectRun =
  typeof process.argv[1] === 'string' &&
  process.argv[1].length > 0 &&
  realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])

if (isDirectRun) {
  main()
}
