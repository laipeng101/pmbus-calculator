import { execFileSync, spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const MiB = 1024 * 1024

function repoRootFromScript(importMetaUrl) {
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

function isDocumentSpecPdf(p) {
  return /^document\/[^/]+\.pdf$/.test(p)
}

function isSnapshotAllowlisted(p) {
  return /^tests\/e2e\/visual\.spec\.ts-snapshots\/[^/]+\.(png|webp)$/.test(p)
}

function isLegacyHtml(p) {
  return p === 'pmbus-calculator.html'
}

function isBinaryAllowlisted(p) {
  return isSnapshotAllowlisted(p) || isDocumentSpecPdf(p) || isLegacyHtml(p)
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
    description: 'tracked tests/e2e/output*/ output directory',
    match: (p) => matchesDirVariant(p, 'tests/e2e', 'output'),
    fix: 'Remove from tracking; e2e output dirs are temporary and ignored in .gitignore.',
  },
  {
    id: 'e2e-report',
    description: 'tracked tests/e2e/report*/ report directory',
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

function gitLsFiles(repoRoot) {
  const output = execFileSync('git', ['-C', repoRoot, 'ls-files', '-z'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  return output.split('\0').filter(Boolean)
}

function gitIndexSizes(repoRoot) {
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

  const sizes = new Map()
  const pathByObject = new Map(
    [...objectByPath.entries()].map(([filePath, object]) => [object, filePath]),
  )
  for (const line of batch.stdout.split('\n')) {
    const [object, , sizeText] = line.split(' ')
    if (object && sizeText !== undefined && pathByObject.has(object)) {
      const size = Number(sizeText)
      sizes.set(pathByObject.get(object), Number.isFinite(size) ? size : 0)
    }
  }
  return sizes
}

function checkRepoHygiene({ repoRoot, log = console.log, error = console.error } = {}) {
  const files = gitLsFiles(repoRoot)
  const sizes = gitIndexSizes(repoRoot)

  const rejected = []
  const binaryAllowlisted = []

  for (const file of files) {
    if (isBinaryAllowlisted(file)) binaryAllowlisted.push(file)

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

  if (rejected.length > 0) {
    error(`repo-hygiene: rejected ${rejected.length} tracked path(s)`)
    for (const item of rejected) {
      error(`REJECTED ${item.file}`)
      error(`  rule: ${item.ruleId} (${item.description})`)
      error(`  fix : ${item.fix}`)
    }
  }

  log(`repo-hygiene: scanned ${files.length} tracked file(s) via git ls-files`)
  log(`repo-hygiene: binary allowlisted ${binaryAllowlisted.length} tracked file(s)`)
  log(`repo-hygiene: total tracked size ${totalSize} bytes (${(totalSize / MiB).toFixed(2)} MiB)`)

  if (rejected.length > 0) {
    error(`repo-hygiene: FAILED with ${rejected.length} rejected path(s)`)
    process.exitCode = 1
  } else {
    log('repo-hygiene: OK')
  }

  return { files, rejected, binaryAllowlisted, totalSize }
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
  checkRepoHygiene({ repoRoot })
}

const isDirectRun =
  typeof process.argv[1] === 'string' &&
  process.argv[1].length > 0 &&
  import.meta.url === pathToFileURL(process.argv[1]).href

if (isDirectRun) {
  main()
}
