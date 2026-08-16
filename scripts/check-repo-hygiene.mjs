import { execFileSync, spawnSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const MiB = 1024 * 1024

export function repoRootFromScript(importMetaUrl) {
  return path.resolve(path.dirname(fileURLToPath(importMetaUrl)), '..')
}

function matchesDirOrUnder(p, dir) {
  return p === dir || p.startsWith(`${dir}/`)
}

function matchesDirVariant(p, parent, base) {
  const prefix = `${parent}/${base}`
  if (p === prefix || p.startsWith(`${prefix}/`)) return true
  return new RegExp(`^${parent}/${base}-[^/]+/`).test(p)
}

export function isDocumentSpecPdf(p) {
  return /^document\/[^/]+\.pdf$/.test(p)
}

export function isSnapshotAllowlisted(p) {
  return /^tests\/e2e\/visual\.spec\.ts-snapshots\/[^/]+\.(png|webp)$/.test(p)
}

export function isLegacyHtml(p) {
  return p === 'pmbus-calculator.html'
}

export function classifyPolicyAllowlist(files) {
  const snapshots = []
  const documentPdfs = []
  const legacyFallbacks = []
  for (const file of files) {
    if (isSnapshotAllowlisted(file)) snapshots.push(file)
    else if (isDocumentSpecPdf(file)) documentPdfs.push(file)
    else if (isLegacyHtml(file)) legacyFallbacks.push(file)
  }
  return { snapshots, documentPdfs, legacyFallbacks }
}

const REJECT_RULES = [
  {
    id: 'generated-dist',
    description: 'tracked build output dist/',
    match: (p) => matchesDirOrUnder(p, 'dist'),
    fix: 'Remove from tracking and keep dist/ ignored in .gitignore; use GitHub Releases for distributable ZIPs.',
  },
  {
    id: 'generated-build',
    description: 'tracked build output build/',
    match: (p) => matchesDirOrUnder(p, 'build'),
    fix: 'Remove from tracking and keep build/ ignored in .gitignore.',
  },
  {
    id: 'generated-out',
    description: 'tracked build output out/',
    match: (p) => matchesDirOrUnder(p, 'out'),
    fix: 'Remove from tracking and keep out/ ignored in .gitignore.',
  },
  {
    id: 'generated-coverage',
    description: 'tracked coverage output',
    match: (p) => matchesDirOrUnder(p, 'coverage'),
    fix: 'Remove from tracking; publish coverage as CI artifact/log, not Git.',
  },
  {
    id: 'generated-node_modules',
    description: 'tracked node_modules',
    match: (p) => matchesDirOrUnder(p, 'node_modules'),
    fix: 'Remove from tracking; install dependencies with npm ci in CI/local.',
  },
  {
    id: 'generated-playwright-report',
    description: 'tracked Playwright report',
    match: (p) => matchesDirOrUnder(p, 'playwright-report'),
    fix: 'Remove from tracking; upload as CI artifact with short retention.',
  },
  {
    id: 'generated-test-results',
    description: 'tracked Playwright test-results',
    match: (p) => matchesDirOrUnder(p, 'test-results'),
    fix: 'Remove from tracking; upload as CI artifact with short retention.',
  },
  {
    id: 'e2e-output',
    description: 'tracked tests/e2e/output/ or tests/e2e/output-*/ output directory',
    match: (p) => matchesDirVariant(p, 'tests/e2e', 'output'),
    fix: 'Remove from tracking; e2e output dirs are temporary and ignored in .gitignore.',
  },
  {
    id: 'e2e-report',
    description: 'tracked tests/e2e/report/ or tests/e2e/report-*/ report directory',
    match: (p) => matchesDirVariant(p, 'tests/e2e', 'report'),
    fix: 'Remove from tracking; e2e HTML reports are CI artifacts, not source.',
  },
  {
    id: 'os-ds-store',
    description: 'tracked macOS .DS_Store',
    match: (p) => p === '.DS_Store' || p.endsWith('/.DS_Store'),
    fix: 'Remove from tracking and keep .DS_Store ignored.',
  },
  {
    id: 'os-thumbs-db',
    description: 'tracked Windows Thumbs.db',
    match: (p) => p === 'Thumbs.db' || p.endsWith('/Thumbs.db'),
    fix: 'Remove from tracking and keep Thumbs.db ignored.',
  },
  {
    id: 'log-file',
    description: 'tracked *.log',
    match: (p) => /\.log$/.test(p),
    fix: 'Remove from tracking; logs are transient and ignored in .gitignore.',
  },
  {
    id: 'lcov-file',
    description: 'tracked *.lcov',
    match: (p) => /\.lcov$/.test(p),
    fix: 'Remove from tracking; LCOV belongs in CI artifacts.',
  },
  {
    id: 'zip-archive',
    description: 'tracked *.zip',
    match: (p) => /\.zip$/.test(p),
    fix: 'Remove from tracking; release ZIPs and DSH session ZIPs belong in GitHub Releases or temporary artifacts.',
  },
  {
    id: 'tgz-archive',
    description: 'tracked *.tgz',
    match: (p) => /\.tgz$/.test(p),
    fix: 'Remove from tracking; archives are generated artifacts.',
  },
  {
    id: 'tar-archive',
    description: 'tracked *.tar',
    match: (p) => /\.tar$/.test(p),
    fix: 'Remove from tracking; archives are generated artifacts.',
  },
  {
    id: 'tar-gz-archive',
    description: 'tracked *.tar.gz',
    match: (p) => /\.tar\.gz$/.test(p),
    fix: 'Remove from tracking; archives are generated artifacts.',
  },
  {
    id: 'source-map',
    description: 'tracked source map (*.map)',
    match: (p) => /\.map$/.test(p),
    fix: 'Remove from tracking; source maps are generated build output.',
  },
  {
    id: 'dsh-jsonl',
    description: 'tracked DSH/agent session JSONL',
    match: (p) => /\.jsonl$/.test(p),
    fix: 'Remove from tracking; agent session/compact logs live outside Git.',
  },
  {
    id: 'screenshot-actual',
    description: 'tracked Playwright *-actual.png',
    match: (p) => /-actual\.png$/.test(p),
    fix: 'Remove from tracking; actual screenshots are temporary test output.',
  },
  {
    id: 'screenshot-diff',
    description: 'tracked Playwright *-diff.png',
    match: (p) => /-diff\.png$/.test(p),
    fix: 'Remove from tracking; diff screenshots are temporary test output.',
  },
  {
    id: 'screenshot-failed',
    description: 'tracked Playwright *-failed.png',
    match: (p) => /-failed\.png$/.test(p),
    fix: 'Remove from tracking; failed screenshots are temporary test output.',
  },
  {
    id: 'release-evidence-png',
    description: 'tracked docs/archive/release-evidence/**/*.png process screenshot',
    match: (p) => /^docs\/archive\/release-evidence\/.*\.png$/.test(p),
    fix: 'Remove from tracking; historical release evidence remains available from the tag/commit history.',
  },
  {
    id: 'pdf-outside-document',
    description: 'tracked PDF outside document/*.pdf',
    match: (p) => /\.pdf$/.test(p) && !isDocumentSpecPdf(p),
    fix: 'Only document/*.pdf specification PDFs are allowlisted in the current policy.',
  },
]

export function gitLsFiles(repoRoot) {
  const output = execFileSync('git', ['-C', repoRoot, 'ls-files', '-z'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  return output.split('\0').filter(Boolean)
}

export function gitIndexSizes(repoRoot) {
  const staged = execFileSync('git', ['-C', repoRoot, 'ls-files', '-s', '-z'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  const objectByPath = new Map()
  for (const entry of staged.split('\0')) {
    if (entry.length === 0) continue
    const tab = entry.indexOf('\t')
    const meta = tab >= 0 ? entry.slice(0, tab) : entry
    const filePath = tab >= 0 ? entry.slice(tab + 1) : entry
    const fields = meta.trim().split(/\s+/)
    const object = fields[1]
    if (object) objectByPath.set(filePath, object)
  }

  if (objectByPath.size === 0) return new Map()

  const input = `${[...objectByPath.values()].join('\n')}\n`
  const batch = spawnSync('git', ['-C', repoRoot, 'cat-file', '--batch-check'], {
    input,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  if (batch.error) throw batch.error
  if (batch.status !== 0) {
    throw new Error(`git cat-file --batch-check failed: ${batch.stderr}`)
  }

  const objectSizes = new Map()
  for (const line of batch.stdout.split('\n')) {
    const [object, , sizeText] = line.split(' ')
    if (object && sizeText !== undefined) {
      const size = Number(sizeText)
      objectSizes.set(object, Number.isFinite(size) ? size : 0)
    }
  }

  const sizes = new Map()
  for (const [filePath, object] of objectByPath) {
    sizes.set(filePath, objectSizes.get(object) ?? 0)
  }
  return sizes
}

export function checkRepoHygiene({ repoRoot, log = console.log, error = console.error } = {}) {
  const files = gitLsFiles(repoRoot)
  const sizes = gitIndexSizes(repoRoot)

  const rejected = []
  const policyAllowlisted = classifyPolicyAllowlist(files)

  for (const file of files) {
    for (const rule of REJECT_RULES) {
      if (rule.match(file)) {
        rejected.push({ file, ruleId: rule.id, description: rule.description, fix: rule.fix })
        break
      }
    }

    const size = sizes.get(file) ?? 0
    if (size > MiB && !isDocumentSpecPdf(file)) {
      const sizeMiB = (size / MiB).toFixed(2)
      rejected.push({
        file,
        ruleId: 'large-file',
        description: `tracked file exceeds 1 MiB (${sizeMiB} MiB) without an allowlist entry`,
        fix: 'Move generated binary to GitHub Releases/CI artifacts, or add an explicit path allowlist and document the exception.',
      })
    }
  }

  const totalSize = [...sizes.values()].reduce((sum, size) => sum + size, 0)
  const policyAllowlistedCount =
    policyAllowlisted.snapshots.length +
    policyAllowlisted.documentPdfs.length +
    policyAllowlisted.legacyFallbacks.length

  if (rejected.length > 0) {
    error(`repo-hygiene: rejected ${rejected.length} tracked path(s)`)
    for (const item of rejected) {
      error(`REJECTED ${item.file}`)
      error(`  rule: ${item.ruleId} (${item.description})`)
      error(`  fix : ${item.fix}`)
    }
  }

  log(`repo-hygiene: scanned ${files.length} tracked path(s) via git ls-files`)
  log(
    `repo-hygiene: policy allowlisted: ${policyAllowlistedCount} ` +
      `(snapshots: ${policyAllowlisted.snapshots.length}, ` +
      `document PDFs: ${policyAllowlisted.documentPdfs.length}, ` +
      `legacy fallbacks: ${policyAllowlisted.legacyFallbacks.length})`,
  )
  log(
    `repo-hygiene: tracked tree size (sum of tracked path blob sizes, not Git pack size): ` +
      `${totalSize} bytes (${(totalSize / MiB).toFixed(2)} MiB)`,
  )

  if (rejected.length > 0) {
    error(`repo-hygiene: FAILED with ${rejected.length} rejected path(s)`)
  } else {
    log('repo-hygiene: OK')
  }

  return { files, rejected, policyAllowlisted, policyAllowlistedCount, totalSize }
}

function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(
      'check-repo-hygiene.mjs — gate tracked repository files\n\nUsage:\n  node scripts/check-repo-hygiene.mjs\n',
    )
    process.exit(0)
  }
  if (args.length > 0) {
    process.stderr.write(`unknown option(s): ${args.join(' ')}\n`)
    process.exit(2)
  }

  const repoRoot = repoRootFromScript(import.meta.url)
  const result = checkRepoHygiene({ repoRoot })
  process.exitCode = result.rejected.length > 0 ? 1 : 0
}

const isDirectRun =
  typeof process.argv[1] === 'string' &&
  process.argv[1].length > 0 &&
  realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])

if (isDirectRun) {
  main()
}
