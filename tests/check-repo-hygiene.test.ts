import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { checkRepoHygiene, gitIndexSizes, gitLsFiles, MiB } from '../scripts/check-repo-hygiene.mjs'

const roots: string[] = []

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
  it('accepts normal source, Markdown, snapshot, document PDF, and legacy HTML', async () => {
    const root = await makeRepo({
      'src/index.ts': 'export const answer = 42\n',
      'docs/README.md': '# docs\n',
      'tests/e2e/visual.spec.ts-snapshots/desktop-l11.png': 'png-bytes',
      'document/spec.pdf': '%PDF-1.4 test',
      'pmbus-calculator.html': '<html>legacy</html>',
    })

    const result = checkRepoHygiene({ repoRoot: root, ...silent() })

    expect(result.rejected).toEqual([])
    expect(result.files).toHaveLength(5)
    expect(result.policyAllowlisted.snapshots).toEqual([
      'tests/e2e/visual.spec.ts-snapshots/desktop-l11.png',
    ])
    expect(result.policyAllowlisted.documentPdfs).toEqual(['document/spec.pdf'])
    expect(result.policyAllowlisted.legacyFallbacks).toEqual(['pmbus-calculator.html'])
    expect(result.policyAllowlistedCount).toBe(3)
  })

  it('rejects generated directories, Playwright output/report variants, OS files, and transient exports', async () => {
    const root = await makeRepo({
      'dist/app.js': 'dist',
      'build/app.js': 'build',
      'out/app.js': 'out',
      'coverage/lcov.info': 'SF:src/app.ts',
      'node_modules/pkg/index.js': 'node_modules',
      'playwright-report/index.html': 'report',
      'test-results/results.xml': 'results',
      'tests/e2e/output/actual.png': 'output',
      'tests/e2e/output-visual/actual.png': 'output-visual',
      'tests/e2e/report/index.html': 'report-e2e',
      'tests/e2e/report-visual/index.html': 'report-visual',
      '.DS_Store': 'ds',
      'subdir/.DS_Store': 'ds',
      'Thumbs.db': 'thumbs',
      'debug.log': 'log',
      'coverage.lcov': 'lcov',
      'release.zip': 'zip',
      'archive.tgz': 'tgz',
      'archive.tar': 'tar',
      'archive.tar.gz': 'tar.gz',
      'app.js.map': 'map',
      'session.jsonl': 'jsonl',
      'test-actual.png': 'actual',
      'test-diff.png': 'diff',
      'test-failed.png': 'failed',
      'docs/archive/release-evidence/v1.1.1/evidence.png': 'evidence',
      'docs/spec.pdf': 'pdf-outside',
    })

    const result = checkRepoHygiene({ repoRoot: root, ...silent() })
    const ruleIds = new Set(result.rejected.map((item) => item.ruleId))

    expect(ruleIds).toContain('generated-dist')
    expect(ruleIds).toContain('generated-build')
    expect(ruleIds).toContain('generated-out')
    expect(ruleIds).toContain('generated-coverage')
    expect(ruleIds).toContain('generated-node_modules')
    expect(ruleIds).toContain('generated-playwright-report')
    expect(ruleIds).toContain('generated-test-results')
    expect(ruleIds).toContain('e2e-output')
    expect(ruleIds).toContain('e2e-report')
    expect(ruleIds).toContain('os-ds-store')
    expect(ruleIds).toContain('os-thumbs-db')
    expect(ruleIds).toContain('log-file')
    expect(ruleIds).toContain('lcov-file')
    expect(ruleIds).toContain('zip-archive')
    expect(ruleIds).toContain('tgz-archive')
    expect(ruleIds).toContain('tar-archive')
    expect(ruleIds).toContain('tar-gz-archive')
    expect(ruleIds).toContain('source-map')
    expect(ruleIds).toContain('dsh-jsonl')
    expect(ruleIds).toContain('screenshot-actual')
    expect(ruleIds).toContain('screenshot-diff')
    expect(ruleIds).toContain('screenshot-failed')
    expect(ruleIds).toContain('release-evidence-png')
    expect(ruleIds).toContain('pdf-outside-document')
  })

  it('rejects ordinary tracked files over 1 MiB and allows document/*.pdf specification PDFs', async () => {
    const root = await makeRepo({
      'big.bin': Buffer.alloc(MiB + 1, 0x61),
      'document/large-spec.pdf': Buffer.alloc(MiB + 2, 0x62),
    })

    const result = checkRepoHygiene({ repoRoot: root, ...silent() })

    expect(result.rejected.map((item) => item.file)).toEqual(['big.bin'])
    expect(result.rejected[0]?.ruleId).toBe('large-file')
    expect(result.policyAllowlisted.documentPdfs).toEqual(['document/large-spec.pdf'])
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
