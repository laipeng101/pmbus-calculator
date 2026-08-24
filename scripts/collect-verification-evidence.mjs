// M33 WP-E #5: collect-verification-evidence -- a small, testable evidence
// collection script. It ONLY collects facts (git SHAs/trees/stats, hygiene
// numbers, manifest lists, toolchain versions) and merges machine-readable
// test results that the caller passes in -- it never invokes tests and never
// fabricates results.
//
// Usage:
//   node scripts/collect-verification-evidence.mjs [--json] [--markdown]
//       [--base <sha>] [--results <file.json>] [--repo <dir>]
//
//   --json      print the evidence object as JSON (default)
//   --markdown  print a Markdown snippet
//   --base      base revision for diff stats (default: origin/main)
//   --results   path to a JSON summary of test results produced elsewhere;
//               its keys are embedded verbatim into the "results" field
//   --repo      repository root (default: this script's parent)
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = process.argv.includes('--repo')
  ? path.resolve(process.argv[process.argv.indexOf('--repo') + 1])
  : path.resolve(scriptDir, '..')

const git = (/** @type {string[]} */ args) =>
  execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim()

/** @param {string[]} args */
function gitStatus(args) {
  try {
    execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: 'pipe' })
    return 'clean'
  } catch {
    return 'non-clean'
  }
}

/**
 * Collect factual evidence from the repository.
 *
 * @param {string} base
 * @param {Record<string, unknown> | null} results
 * @returns {Promise<Record<string, unknown>>}
 */
export async function collectEvidence(base, results) {
  const head = git(['rev-parse', 'HEAD'])
  const tree = git(['rev-parse', 'HEAD^{tree}'])
  const baseSha = base === 'HEAD' ? head : git(['rev-parse', base])
  const baseTree = base === 'HEAD' ? tree : git(['rev-parse', base + '^{tree}'])

  // changed files / additions / deletions (base...HEAD)
  const numstat = git(['diff', '--numstat', baseSha + '...' + head])
    .split('\n')
    .filter((l) => l.length > 0)
  let additions = 0
  let deletions = 0
  /** @type {string[]} */
  const changedFiles = []
  for (const line of numstat) {
    const [add, del, file] = line.split('\t')
    if (add === '-' || del === '-') continue // binary
    additions += Number(add) || 0
    deletions += Number(del) || 0
    changedFiles.push(file)
  }

  // tracked paths + tree bytes (git ls-tree -r -l HEAD)
  const lsTree = git(['ls-tree', '-r', '-l', 'HEAD'])
    .split('\n')
    .filter((l) => l.length > 0)
  const trackedCount = lsTree.length
  let treeBytes = 0
  /** @type {{ png: number, pngBytes: number, webp: number, webpBytes: number }} */
  const snapshots = { png: 0, pngBytes: 0, webp: 0, webpBytes: 0 }
  for (const line of lsTree) {
    // <mode> <type> <sha> <size>\t<path>
    const tabIdx = line.indexOf('\t')
    const parts = line.slice(0, tabIdx).split(/\s+/)
    const filePath = line.slice(tabIdx + 1)
    const size = Number(parts[3] || 0)
    treeBytes += size
    if (filePath.startsWith('tests/e2e/visual.spec.ts-snapshots/')) {
      if (filePath.endsWith('.png')) {
        snapshots.png++
        snapshots.pngBytes += size
      } else if (filePath.endsWith('.webp')) {
        snapshots.webp++
        snapshots.webpBytes += size
      }
    }
  }

  // SECURITY_TEST_FILES
  const contract = await import('./release-security-test-contract.mjs')
  const securityFiles = [...contract.SECURITY_TEST_FILES]

  // toolchain
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
  /** @type {Record<string, string>} */
  const toolchain = {
    node: process.version,
    npm: execFileSync('npm', ['--version'], { cwd: repoRoot, encoding: 'utf8' }).trim(),
    packageVersion: pkg.version,
    enginesNode: pkg.engines && pkg.engines.node,
    enginesNpm: pkg.engines && pkg.engines.npm,
    packageManager: pkg.packageManager,
    typesNode: pkg.devDependencies && pkg.devDependencies['@types/node'],
  }

  // whitespace / hygiene status
  const whitespaceStatus = {
    diffCheck: gitStatus(['diff', '--check']),
    cachedCheck: gitStatus(['diff', '--cached', '--check']),
  }
  let fullWhitespace = 'clean'
  try {
    execFileSync('git', ['diff', '--check', baseSha + '...' + head], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: 'pipe',
    })
  } catch {
    fullWhitespace = 'non-clean'
  }

  return {
    base: baseSha,
    baseTree,
    head,
    tree,
    changed: {
      files: changedFiles.length,
      additions,
      deletions,
      fileList: changedFiles,
    },
    hygiene: {
      trackedCount,
      treeBytes,
      snapshots,
    },
    security: {
      files: securityFiles,
      count: securityFiles.length,
    },
    toolchain,
    whitespace: {
      workingTree: whitespaceStatus.diffCheck,
      cached: whitespaceStatus.cachedCheck,
      fullBaseToHead: fullWhitespace,
    },
    results: results || {},
    collectedAt: new Date().toISOString(),
  }
}

async function main() {
  const wantMarkdown = process.argv.includes('--markdown')
  const base =
    process.argv.indexOf('--base') >= 0
      ? process.argv[process.argv.indexOf('--base') + 1]
      : 'origin/main'
  /** @type {Record<string, unknown> | null} */
  let results = null
  if (process.argv.includes('--results')) {
    const p = process.argv[process.argv.indexOf('--results') + 1]
    results = JSON.parse(fs.readFileSync(p, 'utf8'))
  }
  const evidence = await collectEvidence(base, results)
  if (wantMarkdown) {
    const c = /** @type {any} */ (evidence)
    console.log(`- Base: \`${c.base}\` / tree \`${c.baseTree}\``)
    console.log(`- Final head: \`${c.head}\` / tree \`${c.tree}\``)
    console.log(
      `- Changed: ${c.changed.files} files, +${c.changed.additions}/−${c.changed.deletions}`,
    )
    console.log(
      `- Hygiene: ${c.hygiene.trackedCount} tracked paths, ${c.hygiene.treeBytes} bytes tree size; snapshots ${c.hygiene.snapshots.png} png (${c.hygiene.snapshots.pngBytes} B) / ${c.hygiene.snapshots.webp} webp`,
    )
    console.log(`- SECURITY_TEST_FILES (${c.security.count}): ${c.security.files.join(', ')}`)
    console.log(
      `- Toolchain: node ${c.toolchain.node}, npm ${c.toolchain.npm}, version ${c.toolchain.packageVersion}`,
    )
    console.log(
      `- Whitespace: working-tree ${c.whitespace.workingTree}, cached ${c.whitespace.cached}, full base→head ${c.whitespace.fullBaseToHead}`,
    )
  } else {
    console.log(JSON.stringify(evidence, null, 2))
  }
}

main()
