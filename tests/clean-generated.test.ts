import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  cleanGenerated,
  GENERATED_FILE_TARGETS,
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

  it('removes release-output and the disposable staging root as build outputs', async () => {
    const root = await makeTempRoot()
    await fs.mkdir(path.join(root, 'release-output'), { recursive: true })
    await fs.writeFile(path.join(root, 'release-output', 'a.zip'), 'zip')
    await fs.mkdir(path.join(root, '.release-staging', 'run-abc'), { recursive: true })
    await fs.writeFile(path.join(root, '.release-staging', 'run-abc', 'tmp.bin'), 'staging')

    const cleaned = await cleanGenerated({ repoRoot: root })
    expect(cleaned).toContain('release-output')
    expect(cleaned).toContain('.release-staging')
    await expect(fs.stat(path.join(root, 'release-output'))).rejects.toThrow()
    await expect(fs.stat(path.join(root, '.release-staging'))).rejects.toThrow()
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

  it('removes regular file targets and reports them', async () => {
    const root = await makeTempRoot()
    await fs.writeFile(path.join(root, 'notes.txt'), 'generated')

    const cleaned = await cleanGenerated({
      repoRoot: root,
      targets: ['notes.txt'],
    })
    expect(cleaned).toEqual(['notes.txt'])
    await expect(fs.stat(path.join(root, 'notes.txt'))).rejects.toThrow()
  })

  it('--dry-run performs full preflight and reports file targets', async () => {
    const root = await makeTempRoot()
    await fs.writeFile(path.join(root, 'notes.txt'), 'generated')

    const logs: string[] = []
    const cleaned = await cleanGenerated({
      repoRoot: root,
      targets: ['notes.txt'],
      dryRun: true,
      log: (message) => logs.push(message),
    })
    expect(cleaned).toEqual(['notes.txt'])
    expect(logs.some((message) => message.includes('[dry-run] would remove'))).toBe(true)
    await expect(fs.readFile(path.join(root, 'notes.txt'), 'utf8')).resolves.toBe('generated')
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

  it('exposes the current generated-target allowlist', () => {
    expect(GENERATED_TARGETS).toContain('release-output')
    expect(GENERATED_TARGETS).toContain('.release-staging')
    // No lock/journal/backup transaction artifacts remain as clean targets.
    expect(GENERATED_TARGETS).not.toContain('.release-staging.lock')
    expect(GENERATED_TARGETS).not.toContain('.release-staging.transaction.json')
    expect(GENERATED_TARGETS.some((t) => t.startsWith('release-output.backup-'))).toBe(false)
  })
})

describe('cleanGenerated — generated-artifact lifecycle (v2.5.14)', () => {
  it('removes mobile suite dirs and every Playwright JSON reporter file in a default run', async () => {
    const root = await makeTempRoot()
    const jsonTargets = [...GENERATED_FILE_TARGETS]
    for (const dir of ['tests/e2e/output-mobile', 'tests/e2e/report-mobile']) {
      await fs.mkdir(path.join(root, dir), { recursive: true })
      await fs.writeFile(path.join(root, dir, 'artifact.bin'), 'artifact')
    }
    for (const file of jsonTargets) {
      await fs.writeFile(path.join(root, file), '{"suites":[]}')
    }

    const cleaned = await cleanGenerated({ repoRoot: root })

    for (const dir of ['tests/e2e/output-mobile', 'tests/e2e/report-mobile']) {
      expect(cleaned).toContain(dir)
      await expect(fs.stat(path.join(root, dir))).rejects.toThrow()
    }
    for (const file of jsonTargets) {
      expect(cleaned).toContain(file)
      await expect(fs.stat(path.join(root, file))).rejects.toThrow()
    }
  })

  it('dry-run selects exactly the four audit artifacts, changes nothing, and stays idempotent', async () => {
    const root = await makeTempRoot()
    await fs.mkdir(path.join(root, 'tests/e2e/output-mobile'), { recursive: true })
    await fs.writeFile(path.join(root, 'tests/e2e/output-mobile', 'x.png'), 'x')
    await fs.mkdir(path.join(root, 'tests/e2e/report-mobile'), { recursive: true })
    await fs.writeFile(path.join(root, 'tests/e2e/report-mobile', 'index.html'), 'r')
    await fs.writeFile(path.join(root, 'tests/e2e/e2e-results.json'), '{}')
    await fs.writeFile(path.join(root, 'tests/e2e/e2e-results-mobile.json'), '{}')

    const logs: string[] = []
    const cleaned = await cleanGenerated({
      repoRoot: root,
      dryRun: true,
      log: (message) => logs.push(message),
    })

    expect([...cleaned].sort()).toEqual([
      'tests/e2e/e2e-results-mobile.json',
      'tests/e2e/e2e-results.json',
      'tests/e2e/output-mobile',
      'tests/e2e/report-mobile',
    ])
    expect(logs.filter((message) => message.includes('[dry-run] would remove'))).toHaveLength(4)
    await expect(fs.stat(path.join(root, 'tests/e2e/output-mobile'))).resolves.toBeTruthy()
    await expect(fs.readFile(path.join(root, 'tests/e2e/e2e-results.json'), 'utf8')).resolves.toBe(
      '{}',
    )

    const first = await cleanGenerated({ repoRoot: root })
    expect([...first].sort()).toEqual([...cleaned].sort())
    await expect(cleanGenerated({ repoRoot: root })).resolves.toEqual([])
  })

  it('refuses a directory masquerading as an expected reporter JSON file target', async () => {
    const root = await makeTempRoot()
    await fs.mkdir(path.join(root, 'tests/e2e/e2e-results-mobile.json'), { recursive: true })
    await fs.writeFile(path.join(root, 'tests/e2e/e2e-results-mobile.json', 'inside.txt'), 'data')

    await expect(cleanGenerated({ repoRoot: root })).rejects.toThrow(/expected file target/)
    await expect(
      fs.readFile(path.join(root, 'tests/e2e/e2e-results-mobile.json', 'inside.txt'), 'utf8'),
    ).resolves.toBe('data')
  })

  it('refuses a regular file masquerading as an expected directory target', async () => {
    const root = await makeTempRoot()
    await fs.writeFile(path.join(root, 'dist'), 'not a directory')

    await expect(cleanGenerated({ repoRoot: root })).rejects.toThrow(/expected directory target/)
    await expect(fs.readFile(path.join(root, 'dist'), 'utf8')).resolves.toBe('not a directory')
  })

  symlinkTest(
    'rejects a symlink masquerading as an expected reporter JSON file target',
    async () => {
      const root = await makeTempRoot()
      const outside = await makeOutsideRoot()
      await fs.writeFile(path.join(outside, 'results.json'), '{"suites":[]}')
      await fs.mkdir(path.join(root, 'tests/e2e'), { recursive: true })
      await fs.symlink(
        path.join(outside, 'results.json'),
        path.join(root, 'tests/e2e/e2e-results-mobile.json'),
      )

      await expect(cleanGenerated({ repoRoot: root })).rejects.toThrow(/symlink/)
      await expect(fs.readFile(path.join(outside, 'results.json'), 'utf8')).resolves.toBe(
        '{"suites":[]}',
      )
    },
  )

  it('keeps every generated target ignored in .gitignore (consistency contract)', () => {
    const repoRoot = path.resolve(process.cwd())
    for (const target of GENERATED_TARGETS) {
      // Trailing-slash patterns in .gitignore only match directory pathnames,
      // so directory targets are probed with a trailing slash; the JSON
      // reporter targets are plain file patterns.
      const probe = GENERATED_FILE_TARGETS.has(target) ? target : `${target}/`
      const run = spawnSync('git', ['check-ignore', '-q', probe], {
        encoding: 'utf8',
        cwd: repoRoot,
      })
      expect(run.status, `${target} must be covered by .gitignore`).toBe(0)
    }
  })
})
