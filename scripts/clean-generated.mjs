import fs from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const GENERATED_TARGETS = [
  'dist',
  'build',
  'out',
  'coverage',
  'playwright-report',
  'test-results',
  'tests/e2e/output',
  'tests/e2e/report',
  'tests/e2e/output-release',
  'tests/e2e/report-release',
  'tests/e2e/output-deployment',
  'tests/e2e/report-deployment',
  'tests/e2e/output-visual',
  'tests/e2e/report-visual',
  '.cache/specifications',
  'release-output',
  '.release-staging',
  '.release-staging.lock',
]

const HELP = `clean-generated.mjs — remove generated build/test/report directories

Usage:
  node scripts/clean-generated.mjs [--dry-run]

Options:
  --dry-run  Print what would be removed without deleting anything.
  --help     Show this help.

This script only removes a hardcoded allowlist of generated directories
inside this repository. It refuses filesystem roots, home directories, the
repository root itself, empty paths, non-directory targets, and symlink escapes.
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
 * @returns {{ target: string, absolute: string }[]}
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
    return { target, absolute }
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
 * @returns {Promise<{ exists: boolean }>}
 */
async function preflightCleanTarget(repoRoot, absoluteTarget) {
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

  if (!stat.isDirectory()) {
    throw new Error(`refusing non-directory clean target: ${absoluteTarget}`)
  }

  return { exists: true }
}

/**
 * @param {{ repoRoot: string, targets?: string[], dryRun?: boolean, log?: (...data: any[]) => void }} [options]
 */
export async function cleanGenerated(
  {
    repoRoot,
    targets = GENERATED_TARGETS,
    dryRun = false,
    log = console.log,
  } = /** @type {any} */ ({}),
) {
  const resolved = resolveCleanTargets(repoRoot, targets)

  // Full preflight before any deletion: lexical checks, symlink checks, and
  // target type checks all happen first so a failing target cannot leave a
  // partial cleanup behind.
  const preflighted = []
  for (const { target, absolute } of resolved) {
    const result = await preflightCleanTarget(repoRoot, absolute)
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
