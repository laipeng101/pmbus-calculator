// Gate: offline release contract consistency (M23, hardened M24).
//
// The single source of truth for the current version is package.json. Every
// other release surface is validated against it so a version bump can never
// land half-applied:
// - package-lock.json top-level AND root-package version (both required),
// - CHANGELOG.md with a real Gregorian calendar date,
// - docs/releases/vX.Y.Z.md whose first non-empty line is the exact title,
// - README.md and README_zh-CN.md Live Demo line, stable tag link, SHA256SUMS
//   download link, and deployed-version declaration,
// - docs/ROADMAP.md exactly one stable release declaration,
// - the immutable Release artifact names read from actual surfaces
//   (Pages workflow and RELEASING.md), never self-generated.
//
// Fully offline by design: no network, no GitHub login, no Pages, and no
// remote tag or GitHub Release needs to exist yet — safe to run in PR CI
// before anything is published. The version is never hardcoded; every
// expectation is derived from the package.json version passed in.

import { realpathSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const RELEASES_URL_VERSION_PATTERN = /\/releases\/(?:tag|download)\/v(\d+\.\d+\.\d+)/g
const CHANGELOG_SECTION_PATTERN = /^## \[(\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2})$/m
const ROADMAP_STABLE_PATTERN = /stable release v(\d+\.\d+\.\d+)/
const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/

// Live Demo line patterns (both English and Chinese README variants).
// Must match the line that declares the currently deployed version.
const LIVE_DEMO_PATTERNS = [
  /currently deploys `v(\d+\.\d+\.\d+)`/,
  /当前部署版本 `v(\d+\.\d+\.\d+)`/,
]

/**
 * @param {string} importMetaUrl
 * @returns {string}
 */
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
 * Validate a YYYY-MM-DD string is a real Gregorian calendar date.
 * @param {string} dateStr
 * @returns {boolean}
 */
export function isValidGregorianDate(dateStr) {
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12) return false
  if (day < 1) return false
  const daysInMonth = new Date(year, month, 0).getDate()
  return day <= daysInMonth
}

/**
 * Read the artifact naming template from the Pages workflow.
 * Returns the template for the zip name, e.g. "pmbus-calculator-${RELEASE_TAG}-web.zip".
 * The template is then applied with the current version to verify correctness.
 * @param {string} repoRoot
 * @returns {Promise<{ zipTemplate: string | null, hasSums: boolean }>}
 */
async function readPagesArtifactTemplate(repoRoot) {
  const pagesWorkflow = await fs.readFile(
    path.join(repoRoot, '.github/workflows/pages.yml'),
    'utf8',
  )
  const zipMatch = pagesWorkflow.match(/zip_name\s*=\s*"([^"]+)"/)
  const hasSums = /SHA256SUMS\.txt/.test(pagesWorkflow)
  return {
    zipTemplate: zipMatch ? zipMatch[1] : null,
    hasSums,
  }
}

/**
 * Check that RELEASING.md references the correct artifact zip name pattern.
 * RELEASING.md uses template placeholders like vX.Y.Z, so we check for both
 * the template form and the actual version-specific form.
 * @param {string} repoRoot
 * @param {string} version
 * @returns {Promise<string[]>}
 */
export async function checkReleasingArtifactNames(repoRoot, version) {
  const errors = []
  const releasing = await fs.readFile(path.join(repoRoot, 'docs', 'RELEASING.md'), 'utf8')
  const expectedZip = `pmbus-calculator-v${version}-web.zip`
  const expectedTemplate = 'pmbus-calculator-vX.Y.Z-web.zip'
  if (!releasing.includes(expectedZip) && !releasing.includes(expectedTemplate)) {
    errors.push(
      `docs/RELEASING.md does not reference the zip artifact name (expected ${expectedZip} or ${expectedTemplate})`,
    )
  }
  if (!releasing.includes('SHA256SUMS.txt')) {
    errors.push('docs/RELEASING.md does not reference SHA256SUMS.txt')
  }
  return errors
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
 *   pagesZipTemplate: string | null,
 *   pagesHasSums: boolean,
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

  // Lockfile: both top-level version and root package version must be present and match.
  if (contract.lockVersions.length < 2) {
    errors.push(
      `package-lock.json must have both top-level "version" and "packages[\"\"]" version (got ${contract.lockVersions.length} entries)`,
    )
  }
  for (const lockVersion of contract.lockVersions) {
    if (lockVersion !== version) {
      errors.push(`package-lock.json version ${lockVersion} does not match ${version}`)
    }
  }

  // CHANGELOG: version section with a real Gregorian date.
  const changelogMatch = contract.changelog.match(CHANGELOG_SECTION_PATTERN)
  if (changelogMatch === null || changelogMatch[1] !== version) {
    errors.push(`CHANGELOG.md has no "## [${version}] - YYYY-MM-DD" section`)
  } else if (!isValidGregorianDate(changelogMatch[2])) {
    errors.push(`CHANGELOG.md date ${changelogMatch[2]} is not a valid Gregorian date`)
  }

  // Release notes: first non-empty line must be exactly the title.
  if (!contract.releaseNotes.exists) {
    errors.push(`docs/releases/v${version}.md does not exist`)
  } else {
    const firstLine = contract.releaseNotes.content
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.length > 0)
    const expectedTitle = `# PMBus Calculator v${version}`
    if (firstLine !== expectedTitle) {
      errors.push(
        `docs/releases/v${version}.md first line must be "${expectedTitle}" (got: "${firstLine}")`,
      )
    }
  }

  for (const readme of contract.readmes) {
    validateReadme(readme.name, readme.content, version, errors)
  }

  // ROADMAP: exactly one stable release declaration matching the current version.
  const roadmapMatches = [
    ...contract.roadmap.matchAll(new RegExp(ROADMAP_STABLE_PATTERN.source, 'g')),
  ]
  if (roadmapMatches.length === 0) {
    errors.push('docs/ROADMAP.md stable release declaration is missing')
  } else if (roadmapMatches.length > 1) {
    const versions = roadmapMatches.map((m) => `v${m[1]}`)
    errors.push(
      `docs/ROADMAP.md has ${roadmapMatches.length} stable release declarations (${versions.join(', ')}), expected exactly 1 (v${version})`,
    )
  } else if (roadmapMatches[0][1] !== version) {
    errors.push(
      `docs/ROADMAP.md stable release declaration is v${roadmapMatches[0][1]}, expected v${version}`,
    )
  }

  // Artifact names: the Pages workflow template must produce the correct names.
  if (contract.pagesZipTemplate === null) {
    errors.push('.github/workflows/pages.yml is missing the zip_name template')
  } else {
    const applied = contract.pagesZipTemplate.replace('${RELEASE_TAG}', `v${version}`)
    const expectedZip = `pmbus-calculator-v${version}-web.zip`
    if (applied !== expectedZip) {
      errors.push(
        `Pages workflow zip template "${contract.pagesZipTemplate}" yields "${applied}" but expected "${expectedZip}"`,
      )
    }
  }
  if (!contract.pagesHasSums) {
    errors.push('.github/workflows/pages.yml does not reference SHA256SUMS.txt')
  }

  return { ok: errors.length === 0, errors }
}

/**
 * README rules:
 * 1. Live Demo line must declare the current version.
 * 2. Every GitHub releases URL (tag or download) must point at the current version.
 * 3. Stable tag link, SHA256SUMS download link, and backticked `vX.Y.Z` must each exist.
 * Links to repository docs like docs/releases/v1.0.0.md are not GitHub release URLs
 * and stay allowed.
 * @param {string} name
 * @param {string} content
 * @param {string} version
 * @param {string[]} errors
 */
function validateReadme(name, content, version, errors) {
  // 1. Live Demo line must declare the current version.
  let liveDemoOk = false
  for (const pattern of LIVE_DEMO_PATTERNS) {
    const match = content.match(pattern)
    if (match && match[1] === version) {
      liveDemoOk = true
      break
    }
  }
  if (!liveDemoOk) {
    errors.push(`${name} Live Demo line does not declare the current version v${version}`)
  }

  // 2. All GitHub release URLs must point at the current version.
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

/**
 * Read the full release contract from the real repository files.
 * @param {string} repoRoot
 * @returns {Promise<{
 *   version: string,
 *   lockVersions: string[],
 *   changelog: string,
 *   releaseNotes: { exists: boolean, content: string },
 *   readmes: Array<{ name: string, content: string }>,
 *   roadmap: string,
 *   pagesZipTemplate: string | null,
 *   pagesHasSums: boolean
 * }>}
 */
export async function readContract(repoRoot) {
  const pkg = JSON.parse(await fs.readFile(path.join(repoRoot, 'package.json'), 'utf8'))
  const lock = JSON.parse(await fs.readFile(path.join(repoRoot, 'package-lock.json'), 'utf8'))
  const releaseNotesPath = path.join(repoRoot, 'docs', 'releases', `v${pkg.version}.md`)
  const releaseNotesExists = await fs
    .access(releaseNotesPath)
    .then(() => true)
    .catch(() => false)

  const lockVersions = [lock.version, lock.packages?.['']?.version].filter(
    (value) => typeof value === 'string',
  )

  const { zipTemplate, hasSums } = await readPagesArtifactTemplate(repoRoot)

  return {
    version: pkg.version,
    lockVersions,
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
    pagesZipTemplate: zipTemplate,
    pagesHasSums: hasSums,
  }
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length > 0) {
    process.stderr.write(`unknown option(s): ${args.join(' ')}\n`)
    process.exit(2)
  }

  /** @type {Awaited<ReturnType<typeof readContract>>} */
  const contract = await readContract(repoRootFromScript(import.meta.url))
  const result = validateReleaseContract(/** @type {any} */ (contract))

  // Also check RELEASING.md artifact references
  const releasingErrors = await checkReleasingArtifactNames(
    repoRootFromScript(import.meta.url),
    /** @type {*} */ (contract).version,
  )
  result.errors.push(...releasingErrors)
  if (releasingErrors.length > 0) result.ok = false

  process.stdout.write(
    `release-contract: checking version ${/** @type {*} */ (contract).version}\n`,
  )
  for (const message of result.errors) {
    process.stderr.write(`release-contract: ${message}\n`)
  }
  if (result.ok) {
    process.stdout.write(
      `release-contract: pages zip template: ${/** @type {*} */ (contract).pagesZipTemplate}\n`,
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
