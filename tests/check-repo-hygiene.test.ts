import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { inspectIndex } from '../scripts/check-repo-hygiene.mjs'

// A caller's hook or alternate index must not affect the fixture repository.
beforeEach(() => {
  for (const name of Object.keys(process.env)) {
    if (name.startsWith('GIT_')) vi.stubEnv(name, undefined)
  }
})
afterEach(() => vi.unstubAllEnvs())

const roots: string[] = []

async function write(root: string, relative: string, content: string | Uint8Array) {
  const fullPath = path.join(root, relative)
  await fs.mkdir(path.dirname(fullPath), { recursive: true })
  await fs.writeFile(fullPath, content)
}

function git(root: string, ...args: string[]) {
  execFileSync('git', ['-C', root, ...args])
}

async function makeRepo() {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'pmbus-hygiene-'))
  roots.push(root)
  git(root, 'init', '--quiet')
  await fs.copyFile('.gitignore', path.join(root, '.gitignore'))
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

it('rejects force-added output, archives, and PDFs using the project ignore policy', async () => {
  const root = await makeRepo()
  const forbidden = [
    '.cache/specifications/reference.pdf',
    'dist/app.js',
    'build',
    '_site/index.html',
    'release-output/SHA256SUMS.txt',
    'playwright-report/browser/index.html',
    'node_modules',
    'test-results/browser/trace.zip',
    'tests/e2e/e2e-results-mobile.json',
    'tests/e2e/report',
    'tests/e2e/report-visual/index.html',
    'tests/e2e/output',
    'tests/e2e/output-visual/preview.png',
    'docs/archive/release-evidence/v1/evidence.png',
    'document/参考 规范.PDF',
    'docs/capability note-actual.png',
  ]
  for (const file of [
    ...forbidden,
    'tests/e2e/visual.spec.ts-snapshots/desktop.png',
    'tests/e2e/data.json',
    'pmbus-calculator.html',
  ]) {
    await write(root, file, 'fixture')
  }
  git(root, 'add', '--force', '.')

  expect(inspectIndex(root).ignored).toEqual([...forbidden].sort())
})

it('ignores local Git exclusions when deciding what can be tracked', async () => {
  const root = await makeRepo()
  await write(root, '.git/info/exclude', 'src/local.ts\n')
  await write(root, '.git/global-excludes', 'docs/guide.md\n')
  git(root, 'config', 'core.excludesFile', path.join(root, '.git/global-excludes'))
  await write(root, 'src/local.ts', 'export {}\n')
  await write(root, 'docs/guide.md', '# Guide\n')
  git(root, 'add', '--force', '.')

  expect(inspectIndex(root).ignored).toEqual([])
})

it('enforces the size limit on indexed blobs and counts a shared blob per path', async () => {
  const root = await makeRepo()
  const limit = 1024 * 1024
  const oversizedPath = 'src/大 文件.bin'
  for (const file of ['src/a.bin', 'src/b.bin']) {
    await write(root, file, Buffer.alloc(limit))
  }
  await write(root, oversizedPath, Buffer.alloc(limit + 1))
  git(root, 'add', 'src')
  await write(root, oversizedPath, 'smaller working copy')
  await write(root, 'src/a.bin', Buffer.alloc(limit + 2))

  expect(inspectIndex(root)).toMatchObject({
    oversized: [{ path: oversizedPath, size: limit + 1 }],
    totalSize: limit * 3 + 1,
  })
})

it('reports a bad indexed path and exits nonzero even when run outside the checkout', async () => {
  const root = await makeRepo()
  const script = path.join(root, 'scripts/check-repo-hygiene.mjs')
  await write(
    root,
    'scripts/check-repo-hygiene.mjs',
    await fs.readFile('scripts/check-repo-hygiene.mjs'),
  )
  const run = () => spawnSync(process.execPath, [script], { cwd: tmpdir(), encoding: 'utf8' })
  expect(run().status).toBe(0)
  await write(root, 'dist/app.js', 'dist')
  git(root, 'add', '--force', 'dist/app.js')

  const failure = run()
  expect(failure.status).toBe(1)
  expect(failure.stderr).toContain('REJECTED "dist/app.js"')
})
