import { spawnSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const TIERS = /** @type {const} */ (['light', 'checks', 'product', 'full'])

const LIGHT_PATHS = new Set([
  'AGENTS.md',
  'CLAUDE.md',
  'CONTRIBUTING.md',
  'LICENSE',
  'README.md',
  'README_zh-CN.md',
  'THIRD_PARTY_NOTICES.md',
  'document/README.md',
  '.github/pull_request_template.md',
])

/**
 * @param {string} file
 * @returns {typeof TIERS[number]}
 */
function pathTier(file) {
  if (/[\u0000-\u001f\u007f]/.test(file)) return 'full'
  if (
    LIGHT_PATHS.has(file) ||
    /^docs\/.+\.md$/.test(file) ||
    /^\.github\/ISSUE_TEMPLATE\/[^/]+\.(?:md|ya?ml)$/.test(file)
  ) {
    return 'light'
  }
  if (
    /^(?:src\/(?:app|legacy|components)\/.+|tests\/[^/]+)\.test\.tsx?$/.test(file) ||
    file === 'document/specifications.json'
  ) {
    return 'checks'
  }
  if (
    /^src\/(?:app|legacy|components|styles)\/.+\.(?:tsx?|css)$/.test(file) ||
    /^src\/(?:App\.tsx|main\.tsx|vite-env\.d\.ts)$/.test(file) ||
    /^tests\/e2e\/.+\.(?:ts|png|webp)$/.test(file) ||
    file === 'index.html' ||
    file === '.gitignore'
  ) {
    return 'product'
  }
  // Shared toolchain, dependencies, release/Pages tooling, and unknown paths
  // can affect every verification layer.
  return 'full'
}

/** @param {string[]} paths */
export function classifyPaths(paths) {
  if (!paths.length) return 'full'
  const highest = paths.reduce((rank, file) => Math.max(rank, TIERS.indexOf(pathTier(file))), 0)
  return TIERS[highest]
}

/** @param {{event?: string, cwd?: string}} options */
export function classifyCiScope({ event, cwd }) {
  if (event !== 'pull_request') return { tier: 'full', count: 0 }

  // The first parent of GitHub's PR merge commit is the target branch.
  // Include both paths of a rename so the old path retains its checks.
  const diff = spawnSync(
    'git',
    ['diff', '--name-only', '--no-renames', '-z', 'HEAD^1', 'HEAD', '--'],
    {
      cwd,
      encoding: 'utf8',
    },
  )
  if (diff.status !== 0) return { tier: 'full', count: 0 }
  const paths = diff.stdout.split('\0').filter(Boolean)
  return { tier: classifyPaths(paths), count: paths.length }
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      event: { type: 'string' },
    },
  })
  const { tier, count } = classifyCiScope({
    event: values.event,
    cwd: fileURLToPath(new URL('..', import.meta.url)),
  })
  console.log(`ci-scope: tier=${tier} changed_paths=${count}`)
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `tier=${tier}\n`)
  }
}
