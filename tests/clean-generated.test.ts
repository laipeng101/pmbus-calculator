import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  cleanGenerated,
  GENERATED_TARGETS,
  resolveCleanTargets,
} from '../scripts/clean-generated.mjs'

const roots: string[] = []

async function makeTempRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pmbus-clean-test-'))
  roots.push(root)
  return root
}

async function makeOutsideRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pmbus-clean-outside-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

const symlinkSupported = await (async () => {
  const probeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pmbus-clean-symlink-probe-'))
  const target = path.join(probeRoot, 'target')
  const link = path.join(probeRoot, 'link')
  try {
    await fs.mkdir(target)
    await fs.symlink(target, link, 'dir')
    await fs.lstat(link)
    return true
  } catch {
    return false
  } finally {
    await fs.rm(probeRoot, { recursive: true, force: true })
  }
})()

const symlinkTest = symlinkSupported ? it : it.skip

describe('cleanGenerated', () => {
  it('--dry-run does not delete allowed directories', async () => {
    const root = await makeTempRoot()
    await fs.mkdir(path.join(root, 'dist'), { recursive: true })
    await fs.writeFile(path.join(root, 'dist', 'app.js'), 'payload')

    const logs: string[] = []
    const cleaned = await cleanGenerated({
      repoRoot: root,
      targets: ['dist'],
      dryRun: true,
      log: (message) => logs.push(message),
    })

    expect(cleaned).toEqual(['dist'])
    expect(logs.some((message) => message.includes('[dry-run] would remove'))).toBe(true)
    await expect(fs.readFile(path.join(root, 'dist', 'app.js'), 'utf8')).resolves.toBe('payload')
  })

  it('normal run removes allowed directories and repeated runs are idempotent', async () => {
    const root = await makeTempRoot()
    await fs.mkdir(path.join(root, 'tests/e2e/output-visual'), { recursive: true })
    await fs.writeFile(path.join(root, 'tests/e2e/output-visual', 'actual.png'), 'shot')

    await expect(
      cleanGenerated({ repoRoot: root, targets: ['tests/e2e/output-visual'] }),
    ).resolves.toEqual(['tests/e2e/output-visual'])
    await expect(fs.stat(path.join(root, 'tests/e2e/output-visual'))).rejects.toThrow()

    const logs: string[] = []
    await expect(
      cleanGenerated({
        repoRoot: root,
        targets: ['tests/e2e/output-visual'],
        log: (message) => logs.push(message),
      }),
    ).resolves.toEqual([])
    expect(logs.some((message) => message.includes('skip (not present)'))).toBe(true)
  })

  it('never removes snapshots, specification provenance, archive markdown, node_modules, or source', async () => {
    const root = await makeTempRoot()

    const protectedPaths = [
      'tests/e2e/visual.spec.ts-snapshots/desktop-light-l11.png',
      'document/specifications.json',
      'document/README.md',
      'THIRD_PARTY_NOTICES.md',
      'docs/archive/release-evidence/v1.1.1/old.png',
      'node_modules/pkg/index.js',
      'src/index.ts',
      'package.json',
    ]
    for (const relative of protectedPaths) {
      await fs.mkdir(path.dirname(path.join(root, relative)), { recursive: true })
      await fs.writeFile(path.join(root, relative), 'protected')
    }
    await fs.mkdir(path.join(root, 'dist'), { recursive: true })
    await fs.writeFile(path.join(root, 'dist', 'app.js'), 'generated')

    await cleanGenerated({ repoRoot: root })

    for (const relative of protectedPaths) {
      await expect(fs.readFile(path.join(root, relative), 'utf8')).resolves.toBe('protected')
    }
    await expect(fs.stat(path.join(root, 'dist'))).rejects.toThrow()
  })

  it('removes the rebuildable specification download cache', async () => {
    const root = await makeTempRoot()
    await fs.mkdir(path.join(root, '.cache/specifications'), { recursive: true })
    await fs.writeFile(path.join(root, '.cache/specifications', 'spec.pdf'), 'pdf')

    const cleaned = await cleanGenerated({ repoRoot: root })

    expect(cleaned).toContain('.cache/specifications')
    await expect(fs.stat(path.join(root, '.cache/specifications'))).rejects.toThrow()
  })

  it('rejects illegal clean targets before deleting anything', async () => {
    const root = await makeTempRoot()
    await fs.mkdir(path.join(root, 'dist'), { recursive: true })
    await fs.writeFile(path.join(root, 'dist', 'app.js'), 'generated')

    expect(() => resolveCleanTargets(root, [''])).toThrow(/empty clean target/)
    expect(() => resolveCleanTargets(root, ['/'])).toThrow(/relative path/)
    expect(() => resolveCleanTargets(root, [os.homedir()])).toThrow(/relative path/)
    expect(() => resolveCleanTargets(root, ['.'])).toThrow(/repository root itself/)
    expect(() => resolveCleanTargets(root, ['dist/..'])).toThrow(/repository root itself/)
    expect(() => resolveCleanTargets(root, ['../outside'])).toThrow(/escapes repository root/)

    await expect(cleanGenerated({ repoRoot: root, targets: ['dist', '/'] })).rejects.toThrow(
      /relative path/,
    )
    await expect(fs.readFile(path.join(root, 'dist', 'app.js'), 'utf8')).resolves.toBe('generated')
  })

  it('fails on a regular file target and does not partially delete other targets', async () => {
    const root = await makeTempRoot()
    await fs.mkdir(path.join(root, 'coverage'), { recursive: true })
    await fs.writeFile(path.join(root, 'coverage', 'lcov.info'), 'coverage')
    await fs.writeFile(path.join(root, 'dist'), 'file content')

    await expect(cleanGenerated({ repoRoot: root, targets: ['dist', 'coverage'] })).rejects.toThrow(
      /non-directory clean target/,
    )

    await expect(fs.readFile(path.join(root, 'dist'), 'utf8')).resolves.toBe('file content')
    await expect(fs.readFile(path.join(root, 'coverage', 'lcov.info'), 'utf8')).resolves.toBe(
      'coverage',
    )
  })

  it('--dry-run also performs full preflight and fails on a regular file target', async () => {
    const root = await makeTempRoot()
    await fs.writeFile(path.join(root, 'dist'), 'file content')

    await expect(
      cleanGenerated({ repoRoot: root, targets: ['dist'], dryRun: true }),
    ).rejects.toThrow(/non-directory clean target/)
    await expect(fs.readFile(path.join(root, 'dist'), 'utf8')).resolves.toBe('file content')
  })

  symlinkTest('rejects a target symlink and leaves the external target untouched', async () => {
    const root = await makeTempRoot()
    const outside = await makeOutsideRoot()
    await fs.writeFile(path.join(outside, 'outside.txt'), 'outside-content')
    await fs.symlink(outside, path.join(root, 'dist'), 'dir')

    await expect(cleanGenerated({ repoRoot: root, targets: ['dist'] })).rejects.toThrow(/symlink/)

    const stat = await fs.lstat(path.join(root, 'dist'))
    expect(stat.isSymbolicLink()).toBe(true)
    await expect(fs.readFile(path.join(outside, 'outside.txt'), 'utf8')).resolves.toBe(
      'outside-content',
    )
  })

  symlinkTest('rejects an intermediate symlink segment', async () => {
    const root = await makeTempRoot()
    const outside = await makeOutsideRoot()
    await fs.mkdir(path.join(outside, 'e2e', 'output'), { recursive: true })
    await fs.writeFile(path.join(outside, 'e2e', 'output', 'actual.png'), 'shot')
    await fs.symlink(outside, path.join(root, 'tests'), 'dir')

    await expect(cleanGenerated({ repoRoot: root, targets: ['tests/e2e/output'] })).rejects.toThrow(
      /symlink/,
    )

    await expect(
      fs.readFile(path.join(outside, 'e2e', 'output', 'actual.png'), 'utf8'),
    ).resolves.toBe('shot')
  })

  it('exposes the current generated-target allowlist size', () => {
    expect(GENERATED_TARGETS.length).toBe(16)
  })
})
