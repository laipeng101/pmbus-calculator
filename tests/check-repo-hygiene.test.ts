import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { checkRepoHygiene, gitIndexSizes, gitLsFiles, MiB } from '../scripts/check-repo-hygiene.mjs'

const roots: string[] = []

// Nested fixture repos and spawned scripts must be standalone: git exports
// GIT_DIR / GIT_WORK_TREE / GIT_INDEX_FILE (and friends) to child processes,
// so under `git commit` (simple-git-hooks pre-commit) they would otherwise
// address the OUTER repository's index and hooks instead of the fixture.
// Vitest runs each test file in its own worker, so this cleanup is scoped.
for (const key of Object.keys(process.env)) {
  if (key.startsWith('GIT_')) delete process.env[key]
}

async function makeTempRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pmbus-hygiene-test-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

function git(repoRoot: string, args: string[], input?: string) {
  return execFileSync('git', ['-C', repoRoot, ...args], {
    encoding: 'utf8',
    input,
    maxBuffer: 64 * 1024 * 1024,
  })
}

async function makeRepo(files: Record<string, string | Uint8Array>) {
  const root = await makeTempRoot()
  await execFileSync('git', ['init', '-q'], { cwd: root })
  await execFileSync('git', ['config', 'user.name', 'Hygiene Test'], { cwd: root })
  await execFileSync('git', ['config', 'user.email', 'hygiene@example.com'], { cwd: root })

  for (const [relative, content] of Object.entries(files)) {
    const fullPath = path.join(root, relative)
    await fs.mkdir(path.dirname(fullPath), { recursive: true })
    await fs.writeFile(fullPath, content)
  }

  await execFileSync('git', ['add', '-A'], { cwd: root })
  await execFileSync('git', ['commit', '-qm', 'init'], { cwd: root })
  return root
}

function silent() {
  return { log: () => {}, error: () => {} }
}

function gitTreeTotal(root: string) {
  const output = git(root, ['ls-tree', '-r', '-l', '-z', 'HEAD'])
  let total = 0
  for (const entry of output.split('\0')) {
    if (entry.length === 0) continue
    const tab = entry.indexOf('\t')
    const meta = tab >= 0 ? entry.slice(0, tab) : entry
    const fields = meta.trim().split(/\s+/)
    total += Number(fields[3] ?? '0')
  }
  return total
}

describe('checkRepoHygiene', () => {
  it('accepts normal source, Markdown, snapshot, and legacy HTML; rejects all tracked PDFs', async () => {
    const root = await makeRepo({
      'src/index.ts': 'export const answer = 42\n',
      'docs/README.md': '# docs\n',
      'tests/e2e/visual.spec.ts-snapshots/desktop-l11.png': 'png-bytes',
      'pmbus-calculator.html': '<html>legacy</html>',
      'document/spec.pdf': '%PDF-1.4 test',
    })

    const result = checkRepoHygiene({ repoRoot: root, ...silent() })

    expect(result.policyAllowlisted.snapshots).toEqual([
      'tests/e2e/visual.spec.ts-snapshots/desktop-l11.png',
    ])
    expect(result.policyAllowlisted.legacyFallbacks).toEqual(['pmbus-calculator.html'])
    expect(result.policyAllowlistedCount).toBe(2)
    expect(result.rejected).toEqual([
      expect.objectContaining({ file: 'document/spec.pdf', ruleId: 'tracked-pdf' }),
    ])
  })

  it('rejects each prohibited fixture path with its expected ruleId', async () => {
    const fixtures: Array<{ file: string; ruleId: string }> = [
      { file: 'dist/app.js', ruleId: 'generated-dist' },
      { file: 'build/app.js', ruleId: 'generated-build' },
      { file: 'out/app.js', ruleId: 'generated-out' },
      { file: 'coverage/lcov.info', ruleId: 'generated-coverage' },
      { file: 'node_modules/pkg/index.js', ruleId: 'generated-node_modules' },
      { file: 'playwright-report/index.html', ruleId: 'generated-playwright-report' },
      { file: 'test-results/results.xml', ruleId: 'generated-test-results' },
      { file: 'tests/e2e/output/actual.png', ruleId: 'e2e-output' },
      { file: 'tests/e2e/output-visual/actual.png', ruleId: 'e2e-output' },
      { file: 'tests/e2e/report/index.html', ruleId: 'e2e-report' },
      { file: 'tests/e2e/report-visual/index.html', ruleId: 'e2e-report' },
      { file: '.DS_Store', ruleId: 'os-ds-store' },
      { file: 'subdir/.DS_Store', ruleId: 'os-ds-store' },
      { file: 'Thumbs.db', ruleId: 'os-thumbs-db' },
      { file: 'debug.log', ruleId: 'log-file' },
      { file: 'coverage.lcov', ruleId: 'lcov-file' },
      { file: 'release.zip', ruleId: 'zip-archive' },
      { file: 'archive.tgz', ruleId: 'tgz-archive' },
      { file: 'archive.tar', ruleId: 'tar-archive' },
      { file: 'archive.tar.gz', ruleId: 'tar-gz-archive' },
      { file: 'app.js.map', ruleId: 'source-map' },
      { file: 'session.jsonl', ruleId: 'dsh-jsonl' },
      { file: 'test-actual.png', ruleId: 'screenshot-actual' },
      { file: 'test-diff.png', ruleId: 'screenshot-diff' },
      { file: 'test-failed.png', ruleId: 'screenshot-failed' },
      { file: 'docs/archive/release-evidence/v1.1.1/evidence.png', ruleId: 'release-evidence-png' },
      { file: 'docs/spec.pdf', ruleId: 'tracked-pdf' },
      { file: 'document/spec.pdf', ruleId: 'tracked-pdf' },
    ]

    const root = await makeRepo(
      Object.fromEntries(fixtures.map((fixture) => [fixture.file, 'fixture-content'])),
    )

    const result = checkRepoHygiene({ repoRoot: root, ...silent() })
    const rejectedByFile = new Map(result.rejected.map((item) => [item.file, item.ruleId]))

    for (const fixture of fixtures) {
      expect(rejectedByFile.get(fixture.file)).toBe(fixture.ruleId)
    }
    expect(result.rejected).toHaveLength(fixtures.length)
  })

  it('rejects all tracked files over 1 MiB, including document/*.pdf', async () => {
    const root = await makeRepo({
      'big.bin': Buffer.alloc(MiB + 1, 0x61),
      'document/large-spec.pdf': Buffer.alloc(MiB + 2, 0x62),
    })

    const result = checkRepoHygiene({ repoRoot: root, ...silent() })

    expect(result.rejected).toContainEqual(
      expect.objectContaining({ file: 'big.bin', ruleId: 'large-file' }),
    )
    expect(result.rejected).toContainEqual(
      expect.objectContaining({ file: 'document/large-spec.pdf', ruleId: 'tracked-pdf' }),
    )
    expect(result.rejected).toContainEqual(
      expect.objectContaining({ file: 'document/large-spec.pdf', ruleId: 'large-file' }),
    )
    // Policy allowlist categories are exactly snapshots + legacyFallbacks
    // (document PDFs stopped being allowlisted when tracked PDFs were banned).
    expect(Object.keys(result.policyAllowlisted).sort()).toEqual(['legacyFallbacks', 'snapshots'])
    // The >1 MiB gate is unconditional; the policy classification is a
    // statistic, not an exemption. The diagnosis must not pretend otherwise
    // (v2.5.14 clarification).
    const largeFile = result.rejected.find((item) => item.ruleId === 'large-file')
    expect(largeFile?.description).not.toContain('allowlist')
    expect(largeFile?.fix).toContain('no exceptions')
  })

  it('rejects forced-staged Playwright JSON reporter artifacts but not unrelated JSON (v2.5.14)', async () => {
    const root = await makeRepo({
      'tests/e2e/e2e-results.json': '{"suites":[]}',
      'tests/e2e/e2e-results-mobile.json': '{"suites":[]}',
      'tests/e2e/e2e-results-release.json': '{"suites":[]}',
      'tests/e2e/e2e-results-deployment.json': '{"suites":[]}',
      'tests/e2e/e2e-results-visual.json': '{"suites":[]}',
      'tests/e2e/unrelated.json': '{"not":"a reporter artifact"}',
      'src/index.ts': 'export {}\n',
    })

    const result = checkRepoHygiene({ repoRoot: root, ...silent() })
    const rejectedByFile = new Map(result.rejected.map((item) => [item.file, item.ruleId]))

    for (const reporter of [
      'tests/e2e/e2e-results.json',
      'tests/e2e/e2e-results-mobile.json',
      'tests/e2e/e2e-results-release.json',
      'tests/e2e/e2e-results-deployment.json',
      'tests/e2e/e2e-results-visual.json',
    ]) {
      expect(rejectedByFile.get(reporter)).toBe('e2e-results-json')
    }
    expect(rejectedByFile.has('tests/e2e/unrelated.json')).toBe(false)
    expect(result.rejected).toHaveLength(5)
  })

  it('parses paths with spaces and Unicode via NUL-delimited git output', async () => {
    const root = await makeRepo({
      'src/组件 测试/数据 α.ts': 'export const 组件 = 1\n',
      'docs/备注 文档.md': '# 备注\n',
    })

    const files = gitLsFiles(root)
    const result = checkRepoHygiene({ repoRoot: root, ...silent() })

    expect(files).toContain('src/组件 测试/数据 α.ts')
    expect(files).toContain('docs/备注 文档.md')
    expect(result.files).toEqual(files)
    expect(result.rejected).toEqual([])
  })

  it('counts shared-blob paths per tracked path and matches git ls-tree tree size', async () => {
    const shared = '22\n'
    const root = await makeRepo({
      '.node-version': shared,
      '.nvmrc': shared,
      'src/a.ts': 'export const a = 1\n',
    })

    const sizes = gitIndexSizes(root)
    const files = gitLsFiles(root)
    const result = checkRepoHygiene({ repoRoot: root, ...silent() })
    const treeTotal = gitTreeTotal(root)

    expect(sizes.get('.node-version')).toBe(Buffer.byteLength(shared))
    expect(sizes.get('.nvmrc')).toBe(Buffer.byteLength(shared))
    expect(sizes.get('.node-version')).toBe(sizes.get('.nvmrc'))
    expect([...sizes.values()].reduce((sum, size) => sum + size, 0)).toBe(treeTotal)
    expect(result.totalSize).toBe(treeTotal)
    expect(result.files).toHaveLength(files.length)
    expect(result.rejected).toEqual([])
  })

  it('CLI exits 0 on a clean temporary repository', async () => {
    const root = await makeRepo({ 'src/index.ts': 'export {}\n' })
    await installScriptCopy(root)

    const run = spawnSync(process.execPath, [path.join(root, 'scripts/check-repo-hygiene.mjs')], {
      encoding: 'utf8',
    })

    expect(run.status).toBe(0)
    expect(run.stdout).toContain('repo-hygiene: OK')
  })

  it('CLI exits non-zero when tracked paths are rejected', async () => {
    const root = await makeRepo({ 'dist/app.js': 'dist' })
    await installScriptCopy(root)

    const run = spawnSync(process.execPath, [path.join(root, 'scripts/check-repo-hygiene.mjs')], {
      encoding: 'utf8',
    })

    expect(run.status).not.toBe(0)
    expect(run.stderr).toContain('REJECTED dist/app.js')
  })

  it('CLI exits 2 for unknown arguments', async () => {
    const root = await makeRepo({ 'src/index.ts': 'export {}\n' })
    await installScriptCopy(root)

    const run = spawnSync(
      process.execPath,
      [path.join(root, 'scripts/check-repo-hygiene.mjs'), '--unknown'],
      { encoding: 'utf8' },
    )

    expect(run.status).toBe(2)
    expect(run.stderr).toContain('unknown option(s)')
  })
})

async function installScriptCopy(root: string) {
  const source = path.resolve('scripts/check-repo-hygiene.mjs')
  const targetDir = path.join(root, 'scripts')
  await fs.mkdir(targetDir, { recursive: true })
  await fs.copyFile(source, path.join(targetDir, 'check-repo-hygiene.mjs'))
}
