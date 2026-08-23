// Gate: offline release contract consistency (M23, hardened M24, M25).
//
// The single source of truth for the current version is package.json. Every
// other release surface is validated against it so a version bump can never
// land half-applied:
// - package-lock.json top-level AND root-package version (both required),
// - CHANGELOG.md with structured validation: exactly one [Unreleased] first,
//   current version as the first dated section, real Gregorian date,
// - docs/releases/vX.Y.Z.md whose first non-empty line is the exact title,
// - README.md and README_zh-CN.md Live Demo line, stable tag link, SHA256SUMS
//   download link, and deployed-version declaration,
// - docs/ROADMAP.md exactly one stable release declaration,
// - RELEASING.md artifact naming consistency with shared contract,
// - Generator imports from shared artifact contract (M25).
//
// Fully offline by design: no network, no GitHub login, no Pages, and no
// remote tag or GitHub Release needs to exist yet — safe to run in PR CI
// before anything is published. The version is never hardcoded; every
// expectation is derived from the package.json version passed in.

import { realpathSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  assetZipName,
  assetSumsName,
  buildReleasePlan,
  PAGES_ZIP_TEMPLATE,
} from './release-artifact-contract.mjs'

const RELEASES_URL_VERSION_PATTERN = /\/releases\/(?:tag|download)\/v(\d+\.\d+\.\d+)/g
const CHANGELOG_RELEASE_HEADING = /^## \[(\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2})$/
const UNRELEASED_HEADING = /^## \[Unreleased\]$/
const ROADMAP_STABLE_PATTERN = /stable release v(\d+\.\d+\.\d+)/
const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/

// Live Demo line patterns (both English and Chinese README variants).
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

// ---------------------------------------------------------------------------
// Structured CHANGELOG validation (M25)
// ---------------------------------------------------------------------------

/**
 * Parse a CHANGELOG body and return structured heading information.
 * Fenced code blocks are ignored — headings inside them are not matched.
 *
 * @param {string} changelog
 * @returns {{ unreleased: number, releases: Array<{ version: string, date: string, line: number }> }}
 */
function parseChangelogStructure(changelog) {
  const lines = changelog.split('\n')
  /** @type {Array<{ version: string, date: string, line: number }>} */
  const releases = []
  let unreleasedCount = 0
  let inFence = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Track fenced code blocks
    if (line.startsWith('```') || line.startsWith('~~~')) {
      inFence = !inFence
      continue
    }
    if (inFence) continue

    if (UNRELEASED_HEADING.test(line)) {
      unreleasedCount++
    }

    const releaseMatch = line.match(CHANGELOG_RELEASE_HEADING)
    if (releaseMatch) {
      releases.push({
        version: releaseMatch[1],
        date: releaseMatch[2],
        line: i + 1,
      })
    }
  }

  return { unreleased: unreleasedCount, releases }
}

/**
 * Validate the CHANGELOG.md structure.
 *
 * Rules:
 * - Exactly one `## [Unreleased]` heading.
 * - [Unreleased] must be the first release-level heading.
 * - Current package version must be the first dated release heading after
 *   [Unreleased].
 * - Exactly one heading for the current package version.
 * - Date must be a real Gregorian date.
 * - Headings inside fenced code blocks are ignored.
 *
 * @param {string} changelog
 * @param {string} version — current package version
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateChangelog(changelog, version) {
  const errors = []
  const { unreleased, releases } = parseChangelogStructure(changelog)

  if (unreleased === 0) {
    errors.push('CHANGELOG.md is missing the ## [Unreleased] section')
  } else if (unreleased > 1) {
    errors.push(
      `CHANGELOG.md has ${unreleased} duplicate ## [Unreleased] sections (expected exactly 1)`,
    )
  }

  if (releases.length === 0) {
    errors.push(`CHANGELOG.md has no dated release sections`)
    return { ok: false, errors }
  }

  // [Unreleased] must be the first release-level heading
  if (unreleased >= 1 && releases.length > 0) {
    // Find the line numbers of unreleased and first release
    const lines = changelog.split('\n')
    let unreleasedLine = -1
    let inFence = false
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('```') || lines[i].startsWith('~~~')) {
        inFence = !inFence
        continue
      }
      if (inFence) continue
      if (UNRELEASED_HEADING.test(lines[i]) && unreleasedLine === -1) {
        unreleasedLine = i + 1
        break
      }
    }
    if (unreleasedLine > 0 && releases[0].line < unreleasedLine) {
      errors.push(
        `CHANGELOG.md ## [Unreleased] must be the first release-level heading ` +
          `(found dated release at line ${releases[0].line} before [Unreleased])`,
      )
    }
  }

  // Current version must be the first dated release
  if (releases[0].version !== version) {
    errors.push(
      `CHANGELOG.md first dated release is v${releases[0].version} but ` +
        `expected v${version} to be the first dated section after [Unreleased]`,
    )
  }

  // Current version must appear exactly once
  const currentVersionReleases = releases.filter((r) => r.version === version)
  if (currentVersionReleases.length === 0) {
    errors.push(`CHANGELOG.md has no "## [${version}] - YYYY-MM-DD" section`)
  } else if (currentVersionReleases.length > 1) {
    errors.push(
      `CHANGELOG.md has ${currentVersionReleases.length} duplicate ` +
        `## [${version}] sections (expected exactly 1)`,
    )
  } else if (!isValidGregorianDate(currentVersionReleases[0].date)) {
    errors.push(`CHANGELOG.md date ${currentVersionReleases[0].date} is not a valid Gregorian date`)
  }

  return { ok: errors.length === 0, errors }
}

// ---------------------------------------------------------------------------
// Artifact naming from shared contract
// ---------------------------------------------------------------------------

/**
 * Expected immutable GitHub Release artifact names for a version.
 * Delegates to the shared contract module.
 * @param {string} version
 * @returns {string[]}
 */
export function expectedArtifactNames(version) {
  return [assetZipName(version), assetSumsName()]
}

// ---------------------------------------------------------------------------
// Pages workflow check
// ---------------------------------------------------------------------------

/**
 * Read the artifact naming template from the Pages workflow and verify
 * it matches the shared contract.
 * @param {string} repoRoot
 * @returns {Promise<{ zipTemplate: string | null, hasSums: boolean, matchesSharedContract: boolean }>}
 */
async function readPagesArtifactTemplate(repoRoot) {
  const pagesWorkflow = await fs.readFile(
    path.join(repoRoot, '.github/workflows/pages.yml'),
    'utf8',
  )
  const zipMatch = pagesWorkflow.match(/zip_name\s*=\s*"([^"]+)"/)
  const hasSums = /SHA256SUMS\.txt/.test(pagesWorkflow)
  const zipTemplate = zipMatch ? zipMatch[1] : null
  return {
    zipTemplate,
    hasSums,
    matchesSharedContract: zipTemplate === PAGES_ZIP_TEMPLATE,
  }
}

// ---------------------------------------------------------------------------
// RELEASING.md check
// ---------------------------------------------------------------------------

/**
 * Check that RELEASING.md references the correct artifact names.
 * @param {string} releasingContent
 * @param {string} version
 * @returns {string[]}
 */
function checkReleasingContent(releasingContent, version) {
  const errors = []
  const expectedZip = assetZipName(version)
  const expectedTemplate = 'pmbus-calculator-vX.Y.Z-web.zip'
  if (!releasingContent.includes(expectedZip) && !releasingContent.includes(expectedTemplate)) {
    errors.push(
      `docs/RELEASING.md does not reference the zip artifact name (expected ${expectedZip} or ${expectedTemplate})`,
    )
  }
  if (!releasingContent.includes('SHA256SUMS.txt')) {
    errors.push('docs/RELEASING.md does not reference SHA256SUMS.txt')
  }
  return errors
}

/**
 * @param {string} repoRoot
 * @param {string} version
 * @returns {Promise<string[]>}
 */
export async function checkReleasingArtifactNames(repoRoot, version) {
  const releasing = await fs.readFile(path.join(repoRoot, 'docs', 'RELEASING.md'), 'utf8')
  return checkReleasingContent(releasing, version)
}

// ---------------------------------------------------------------------------
// Generator behavioral contract check (M26 WP-E)
// ---------------------------------------------------------------------------

/**
 * Structural anti-patterns that indicate a generator deriving artifact
 * names locally instead of consuming buildReleasePlan (M27 WP-E #4/#8).
 * The real generator imports buildReleasePlan and consumes plan.* only.
 */
const GENERATOR_LOCAL_NAMING_PATTERNS = [
  // direct assetNames() calls bypass the plan
  /assetNames\s*\(/,
  // literal template/concatenation building pmbus names inside the generator
  /`pmbus-calculator-/,
  /['"]pmbus-calculator-[^'"]*['"]\s*\+/,
  /\+\s*['"]-web\.zip['"]/,
  /['"]\.zip['"]/,
]

/**
 * Check generator wiring for the release artifact contract (M27 WP-E):
 * 1. The module must LOAD. Any import/parse failure fails closed — there is
 *    no "module not found" fallback anymore.
 * 2. The shared buildReleasePlan(version) result must equal the full
 *    expected plan shape derived here from package.json + Pages workflow.
 * 3. The generator source must consume the plan and must not contain local
 *    naming templates or assetNames() calls.
 *
 * @param {string} repoRoot
 * @param {string} version -- current package version
 * @returns {Promise<{ ok: boolean, errors: string[] }>}
 */
async function checkGeneratorBehavioralContract(repoRoot, version) {
  const errors = []
  const genPath = path.join(repoRoot, 'scripts', 'prepare-release-assets.mjs')
  const relGenPath = 'scripts/prepare-release-assets.mjs'

  try {
    await fs.access(genPath)
  } catch {
    errors.push(`${relGenPath} not found at ${genPath}`)
    return { ok: false, errors }
  }

  // 1. The module must load cleanly; ANY failure is fatal (fail closed).
  // The load check runs in a fresh child process so the result does not
  // depend on the caller's module loader (e.g. Vitest transforms dynamic
  // imports of freshly created fixture files and would report spurious
  // ERR_MODULE_NOT_FOUND for modules that exist on disk.
  const loadCheck = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      'import "' + pathToFileURL(genPath).href + '"; process.stdout.write("LOAD-OK")',
    ],
    { encoding: 'utf8', timeout: 30_000 },
  )
  if (loadCheck.error || loadCheck.status !== 0 || !(loadCheck.stdout ?? '').includes('LOAD-OK')) {
    const stderrTail =
      loadCheck.stderr && loadCheck.stderr.trim().length > 0
        ? loadCheck.stderr.trim().split('\n').pop()
        : null
    const msg = stderrTail || (loadCheck.error && loadCheck.error.message) || 'unknown load failure'
    errors.push(
      `${relGenPath} failed to load (behavioral contract requires a loadable module): ${msg}`,
    )
    return { ok: false, errors }
  }

  // 2. The single implementation must produce the exact expected plan.
  let plan
  try {
    plan = buildReleasePlan(version)
  } catch (e) {
    errors.push(
      `buildReleasePlan rejected version v${version}: ${/** @type {Error} */ (e).message}`,
    )
    return { ok: false, errors }
  }
  const expectedZip = assetZipName(version)
  const expectedSums = assetSumsName()
  const expectedTag = `v${version}`
  if (plan.zipName !== expectedZip) {
    errors.push(`shared contract zipName "${plan.zipName}" != "${expectedZip}"`)
  }
  if (plan.sumsName !== expectedSums) {
    errors.push(`shared contract sumsName "${plan.sumsName}" != "${expectedSums}"`)
  }
  if (plan.tag !== expectedTag) {
    errors.push(`shared contract tag "${plan.tag}" != "${expectedTag}"`)
  }
  if (plan.pagesZipTemplate !== PAGES_ZIP_TEMPLATE) {
    errors.push(
      `shared contract pagesZipTemplate "${plan.pagesZipTemplate}" != "${PAGES_ZIP_TEMPLATE}"`,
    )
  }

  // 3. Structural checks on the generator source.
  const genSource = await fs.readFile(genPath, 'utf8')
  if (!genSource.includes("from './release-artifact-contract.mjs'")) {
    errors.push(`${relGenPath} does not import from the shared artifact contract `)
  }
  if (!genSource.includes('buildReleasePlan')) {
    errors.push(`${relGenPath} does not consume buildReleasePlan (the single plan implementation) `)
  }
  if (!/plan\.(zipName|sumsName)/.test(genSource)) {
    errors.push(
      `${relGenPath} never reads plan.zipName/plan.sumsName (generator must consume the plan) `,
    )
  }
  for (const pattern of GENERATOR_LOCAL_NAMING_PATTERNS) {
    if (pattern.test(genSource)) {
      errors.push(
        `${relGenPath} contains a local artifact-naming pattern (${pattern}) instead of consuming buildReleasePlan`,
      )
      break
    }
  }

  return { ok: errors.length === 0, errors }
}

/**
 * Check that the generator imports from the shared artifact contract.
 * Kept as a supplementary check alongside the behavioral check.
 * @param {string} repoRoot
 * @returns {Promise<boolean>}
 */
async function checkGeneratorImportsSharedContract(repoRoot) {
  try {
    const genSource = await fs.readFile(
      path.join(repoRoot, 'scripts', 'prepare-release-assets.mjs'),
      'utf8',
    )
    return genSource.includes("from './release-artifact-contract.mjs'")
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Full contract validation
// ---------------------------------------------------------------------------

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
 *   releasing: string,
 *   pagesZipTemplate: string | null,
 *   pagesHasSums: boolean,
 *   pagesMatchesSharedContract: boolean,
 *   generatorImportsSharedContract: boolean,
 *   generatorBehavioralOk: boolean,
 *   generatorBehavioralErrors: string[],
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

  // CHANGELOG: structured validation (M25 -- includes [Unreleased] check).
  const changelogResult = validateChangelog(contract.changelog, version)
  errors.push(...changelogResult.errors)

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

  // Artifact names: the Pages workflow template must match the shared contract.
  if (contract.pagesZipTemplate === null) {
    errors.push('.github/workflows/pages.yml is missing the zip_name template')
  } else if (!contract.pagesMatchesSharedContract) {
    errors.push(
      `Pages workflow zip template "${contract.pagesZipTemplate}" ` +
        `does not match shared contract "${PAGES_ZIP_TEMPLATE}"`,
    )
  }
  if (!contract.pagesHasSums) {
    errors.push('.github/workflows/pages.yml does not reference SHA256SUMS.txt')
  }

  // RELEASING.md artifact consistency (M25 -- now part of the contract, not a side check).
  const releasingErrors = checkReleasingContent(contract.releasing, version)
  errors.push(...releasingErrors)

  // Generator shared-contract wiring (M25 -- source check is supplementary).
  if (!contract.generatorImportsSharedContract) {
    errors.push(
      'scripts/prepare-release-assets.mjs does not import from the shared artifact contract ' +
        '(scripts/release-artifact-contract.mjs)',
    )
  }

  // Generator behavioral contract (M26 WP-E -- must produce correct names).
  if (!contract.generatorBehavioralOk) {
    errors.push(...contract.generatorBehavioralErrors)
  }

  return { ok: errors.length === 0, errors }
}

/**
 * README rules:
 * 1. Live Demo line must declare the current version.
 * 2. Every GitHub releases URL (tag or download) must point at the current version.
 * 3. Stable tag link, SHA256SUMS download link, and backticked `vX.Y.Z` must each exist.
 * @param {string} name
 * @param {string} content
 * @param {string} version
 * @param {string[]} errors
 */
function validateReadme(name, content, version, errors) {
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

// ---------------------------------------------------------------------------
// readContract — reads all real surfaces (M25)
// ---------------------------------------------------------------------------

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
 *   releasing: string,
 *   pagesZipTemplate: string | null,
 *   pagesHasSums: boolean,
 *   pagesMatchesSharedContract: boolean,
 *   generatorImportsSharedContract: boolean,
 *   generatorBehavioralOk: boolean,
 *   generatorBehavioralErrors: string[],
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

  const { zipTemplate, hasSums, matchesSharedContract } = await readPagesArtifactTemplate(repoRoot)
  const releasing = await fs.readFile(path.join(repoRoot, 'docs', 'RELEASING.md'), 'utf8')
  const generatorImportsSharedContract = await checkGeneratorImportsSharedContract(repoRoot)
  const behavioralResult = await checkGeneratorBehavioralContract(repoRoot, pkg.version)

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
    releasing,
    pagesZipTemplate: zipTemplate,
    pagesHasSums: hasSums,
    pagesMatchesSharedContract: matchesSharedContract,
    generatorImportsSharedContract,
    generatorBehavioralOk: behavioralResult.ok,
    generatorBehavioralErrors: behavioralResult.errors,
  }
}

// ---------------------------------------------------------------------------
// CLI — single read→validate path (M25: no side-channel RELEASING check)
// ---------------------------------------------------------------------------

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
    process.stdout.write(`release-contract: pages zip template: ${contract.pagesZipTemplate}\n`)
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
