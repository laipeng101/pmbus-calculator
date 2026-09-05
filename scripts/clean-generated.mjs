import fs from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Generated targets the cleaner may remove. release-output/ and the
 * disposable .release-staging/ staging root are build outputs: they can be
 * deleted and regenerated at any time (no lock, no journal, no recovery).
 *
 * Every Playwright config (default, mobile, release, deployment, visual)
 * writes an outputDir, an HTML report folder and a JSON reporter file under
 * tests/e2e/ — all listed here so local artifacts and the tracked tree stay
 * in sync (v2.5.14; the mobile suite and the reporter JSONs used to be
 * missing, so a dry run left them behind). JSON entries are single regular
 * files; the preflight still refuses anything that is not a file or a
 * directory.
 */
export const GENERATED_TARGETS = [
  'dist',
  'build',
  'out',
  'coverage',
  'playwright-report',
  'test-results',
  'tests/e2e/output',
  'tests/e2e/report',
  'tests/e2e/output-mobile',
  'tests/e2e/report-mobile',
  'tests/e2e/output-release',
  'tests/e2e/report-release',
  'tests/e2e/output-deployment',
  'tests/e2e/report-deployment',
  'tests/e2e/output-visual',
  'tests/e2e/report-visual',
  'tests/e2e/output-cross-engine',
  'tests/e2e/report-cross-engine',
  'tests/e2e/e2e-results.json',
  'tests/e2e/e2e-results-mobile.json',
  'tests/e2e/e2e-results-release.json',
  'tests/e2e/e2e-results-deployment.json',
  'tests/e2e/e2e-results-visual.json',
  'tests/e2e/e2e-results-cross-engine.json',
  '.cache/specifications',
  'release-output',
  '.release-staging',
]

// Playwright JSON reporter artifacts are expected to be single regular files.
// A directory at one of these paths is refused instead of recursively removed
// (v2.5.14 masquerade guard). Targets of the default allowlist that are not
// file targets are expected to be directories; a regular file at one of those
// paths is refused as well. Custom target lists passed via options keep the
// historical permissive behavior for both kinds.
export const GENERATED_FILE_TARGETS = new Set([
  'tests/e2e/e2e-results.json',
  'tests/e2e/e2e-results-mobile.json',
  'tests/e2e/e2e-results-release.json',
  'tests/e2e/e2e-results-deployment.json',
  'tests/e2e/e2e-results-visual.json',
  'tests/e2e/e2e-results-cross-engine.json',
])
const GENERATED_DIRECTORY_TARGETS = new Set(
  GENERATED_TARGETS.filter((target) => !GENERATED_FILE_TARGETS.has(target)),
)

const HELP = `clean-generated.mjs — remove generated build/test/report directories and reporter files

Usage:
  node scripts/clean-generated.mjs [--dry-run]

Options:
  --dry-run  Print what would be removed without deleting anything.
  --help     Show this help.

This script only removes a hardcoded allowlist of generated directories and
Playwright JSON reporter files inside this repository. It refuses filesystem
roots, home directories, the repository root itself, empty paths, targets
that are neither regular files nor directories, type-masqueraded targets,
and symlink escapes.
`

/**
 * @param {string} importMetaUrl
 * @returns {string}
 */
export function repoRootFromScript(importMetaUrl) {
  return path.resolve(path.dirname(fileURLToPath(importMetaUrl)), '..')
}

/**
 * @param {string} repoRoot
 * @param {string[]} targets
 * @returns {{ target: string, absolute: string, expectedType: 'file' | 'directory' | null }[]}
 */
export function resolveCleanTargets(repoRoot, targets) {
  if (typeof repoRoot !== 'string' || repoRoot.length === 0) {
    throw new Error(`refusing empty repository root`)
  }
  if (!path.isAbsolute(repoRoot)) {
    throw new Error(`repository root must be an absolute path: ${repoRoot}`)
  }
  if (repoRoot === path.parse(repoRoot).root) {
    throw new Error(`refusing filesystem root as repository root: ${repoRoot}`)
  }
  if (repoRoot === os.homedir()) {
    throw new Error(`refusing home directory as repository root: ${repoRoot}`)
  }

  return targets.map((/** @type {string} */ target) => {
    if (typeof target !== 'string' || target.length === 0) {
      throw new Error('refusing empty clean target path')
    }
    if (path.isAbsolute(target)) {
      throw new Error(`clean target must be a relative path: ${target}`)
    }
    const absolute = path.resolve(repoRoot, target)
    if (absolute === repoRoot) {
      throw new Error(`refusing to clean the repository root itself: ${target}`)
    }
    if (absolute === os.homedir()) {
      throw new Error(`refusing to clean home directory: ${target}`)
    }
    if (absolute === path.parse(absolute).root) {
      throw new Error(`refusing to clean filesystem root: ${target}`)
    }
    const relative = path.relative(repoRoot, absolute)
    if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`clean target escapes repository root: ${target}`)
    }
    return {
      target,
      absolute,
      expectedType: GENERATED_FILE_TARGETS.has(target)
        ? 'file'
        : GENERATED_DIRECTORY_TARGETS.has(target)
          ? 'directory'
          : null,
    }
  })
}

/**
 * @param {string} repoRoot
 * @param {string} absoluteTarget
 * @returns {Promise<void>}
 */
async function rejectSymlinkEscape(repoRoot, absoluteTarget) {
  const realRepo = await fs.realpath(repoRoot)
  let realTarget = null
  try {
    realTarget = await fs.realpath(absoluteTarget)
  } catch {
    realTarget = null
  }

  if (realTarget !== null) {
    const relativeReal = path.relative(realRepo, realTarget)
    if (relativeReal === '' || relativeReal.startsWith('..') || path.isAbsolute(relativeReal)) {
      throw new Error(`symlink escape detected for clean target: ${absoluteTarget}`)
    }
  }

  // Walk each path segment from repoRoot to target. Any existing symlink
  // segment means the path is not a plain directory tree inside the repo.
  const segments = path.relative(repoRoot, absoluteTarget).split(path.sep)
  let current = repoRoot
  for (const segment of segments) {
    if (segment.length === 0) continue
    current = path.join(current, segment)
    let stat = null
    try {
      stat = await fs.lstat(current)
    } catch {
      stat = null
    }
    if (stat !== null && stat.isSymbolicLink()) {
      throw new Error(`refusing symlink clean target: ${current}`)
    }
  }
}

/**
 * @param {string} repoRoot
 * @param {string} absoluteTarget
 * @param {'file' | 'directory' | null} expectedType
 * @returns {Promise<{ exists: boolean }>}
 */
async function preflightCleanTarget(repoRoot, absoluteTarget, expectedType) {
  await rejectSymlinkEscape(repoRoot, absoluteTarget)

  let stat = null
  try {
    stat = await fs.lstat(absoluteTarget)
  } catch {
    stat = null
  }

  if (stat === null) {
    return { exists: false }
  }

  if (stat.isFile()) {
    if (expectedType === 'directory') {
      throw new Error(`refusing regular file at expected directory target: ${absoluteTarget}`)
    }
    // Regular files are allowed as clean targets; rm() below handles both
    // files and directories.
    return { exists: true }
  }

  if (stat.isDirectory()) {
    if (expectedType === 'file') {
      throw new Error(`refusing directory at expected file target: ${absoluteTarget}`)
    }
    return { exists: true }
  }

  throw new Error(`refusing non-directory clean target: ${absoluteTarget}`)
}

/**
 * @param {{ repoRoot: string, targets?: string[], dryRun?: boolean, log?: (...data: any[]) => void }} [options]
 */
export async function cleanGenerated(
  { repoRoot, targets, dryRun = false, log = console.log } = /** @type {any} */ ({}),
) {
  const resolvedBase = resolveCleanTargets(repoRoot, targets ?? GENERATED_TARGETS)

  const resolved = [...resolvedBase]

  // Full preflight before any deletion: lexical checks, symlink checks, and
  // target type checks all happen first so a failing target cannot leave a
  // partial cleanup behind.
  const preflighted = []
  for (const { target, absolute, expectedType } of resolved) {
    const result = await preflightCleanTarget(repoRoot, absolute, expectedType)
    preflighted.push({ target, absolute, ...result })
  }

  const cleaned = []
  for (const item of preflighted) {
    if (!item.exists) {
      log(`skip (not present): ${item.absolute}`)
      continue
    }

    if (dryRun) {
      log(`[dry-run] would remove: ${item.absolute}`)
      cleaned.push(item.target)
      continue
    }

    await fs.rm(item.absolute, { recursive: true, force: false })
    log(`removed: ${item.absolute}`)
    cleaned.push(item.target)
  }

  return cleaned
}

function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(HELP)
    process.exit(0)
  }

  const unknown = args.filter((arg) => arg !== '--dry-run')
  if (unknown.length > 0) {
    process.stderr.write(`unknown option(s): ${unknown.join(' ')}\n\n${HELP}`)
    process.exit(2)
  }

  const dryRun = args.includes('--dry-run')
  const repoRoot = repoRootFromScript(import.meta.url)

  cleanGenerated({ repoRoot, dryRun }).catch((error) => {
    process.stderr.write(`clean-generated failed: ${error.message ?? error}\n`)
    process.exit(1)
  })
}

const isDirectRun =
  typeof process.argv[1] === 'string' &&
  process.argv[1].length > 0 &&
  realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])

if (isDirectRun) {
  main()
}
