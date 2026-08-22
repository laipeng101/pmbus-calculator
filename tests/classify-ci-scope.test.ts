import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildDiffArgs,
  classifyCiScope,
  classifyPaths,
  formatGithubOutput,
  isLightPath,
  isValidSha,
} from '../scripts/classify-ci-scope.mjs'

const VALID_BASE = 'a1b2c3d4e5a1b2c3d4e5a1b2c3d4e5a1b2c3d4e5'
const VALID_HEAD = 'f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3b2a1f6e5'
const ZERO_SHA = '0'.repeat(40)

// Every exact allowlist entry, plus representative subtree paths.
const ALL_LIGHT_EXACT_PATHS = [
  'AGENTS.md',
  'CHANGELOG.md',
  'CLAUDE.md',
  'CONTRIBUTING.md',
  'LICENSE',
  'README.md',
  'README_zh-CN.md',
  'THIRD_PARTY_NOTICES.md',
  '.gitignore',
  'document/README.md',
  '.github/pull_request_template.md',
]

const FULL_PATHS = [
  'document/specifications.json',
  'src/App.tsx',
  'tests/example.test.ts',
  'tests/e2e/calculator.spec.ts',
  'scripts/classify-ci-scope.mjs',
  'package.json',
  'package-lock.json',
  'vite.config.ts',
  'tsconfig.json',
  'tsconfig.app.json',
  'playwright.config.ts',
  'eslint.config.js',
  'index.html',
  'pmbus-calculator.html',
  'public/favicon.svg',
  '.github/workflows/ci.yml',
  '.github/CODEOWNERS',
  'some/unknown/future/path.txt',
]

describe('isLightPath / isValidSha', () => {
  it('accepts only 40-character hex SHAs', () => {
    expect(isValidSha(VALID_BASE)).toBe(true)
    expect(isValidSha(VALID_BASE.toUpperCase())).toBe(true)
    expect(isValidSha('not-a-sha')).toBe(false)
    expect(isValidSha('')).toBe(false)
    expect(isValidSha(undefined)).toBe(false)
    expect(isValidSha(ZERO_SHA)).toBe(true)
  })

  it('rejects control characters even inside docs paths', () => {
    expect(isLightPath('docs/plain.md')).toBe(true)
    expect(isLightPath('docs/e\nvil.md')).toBe(false)
    expect(isLightPath('docs/e\tvil.md')).toBe(false)
    expect(isLightPath('')).toBe(false)
  })
})

describe('classifyPaths', () => {
  it('classifies a single docs/ROADMAP.md change as light', () => {
    const result = classifyPaths(['docs/ROADMAP.md'])
    expect(result.tier).toBe('light')
    expect(result.runFull).toBe(false)
    expect(result.changedCount).toBe(1)
  })

  it('classifies multiple docs files as light', () => {
    const result = classifyPaths([
      'docs/ROADMAP.md',
      'docs/UI_CONVENTIONS.md',
      'docs/adr/adr-001-single-source.md',
    ])
    expect(result.tier).toBe('light')
    expect(result.changedCount).toBe(3)
  })

  it('classifies .gitignore as light', () => {
    expect(classifyPaths(['.gitignore']).tier).toBe('light')
  })

  it('classifies the pull request template as light', () => {
    expect(classifyPaths(['.github/pull_request_template.md']).tier).toBe('light')
  })

  it('classifies issue templates as light', () => {
    expect(classifyPaths(['.github/ISSUE_TEMPLATE/bug.yml']).tier).toBe('light')
    expect(classifyPaths(['.github/ISSUE_TEMPLATE/feature.yml']).tier).toBe('light')
  })

  it('classifies document/README.md as light', () => {
    expect(classifyPaths(['document/README.md']).tier).toBe('light')
  })

  it('classifies every exact allowlist path as light together', () => {
    const result = classifyPaths(ALL_LIGHT_EXACT_PATHS)
    expect(result.tier).toBe('light')
    expect(result.fullCount).toBe(0)
  })

  it.each(FULL_PATHS.map((changedPath) => [changedPath]))(
    'classifies %s as full',
    (changedPath) => {
      const result = classifyPaths([changedPath])
      expect(result.tier).toBe('full')
      expect(result.runFull).toBe(true)
    },
  )

  it('classifies mixed docs and src changes as full', () => {
    const result = classifyPaths(['docs/ROADMAP.md', 'src/App.tsx'])
    expect(result.tier).toBe('full')
    expect(result.fullCount).toBe(1)
    expect(result.lightCount).toBe(1)
  })

  it('fails closed to full on an empty change set', () => {
    const result = classifyPaths([])
    expect(result.tier).toBe('full')
    expect(result.runFull).toBe(true)
    expect(result.changedCount).toBe(0)
  })
})

describe('classifyCiScope input validation', () => {
  it('classifies workflow_dispatch as full without any base/head SHA', () => {
    const result = classifyCiScope({ event: 'workflow_dispatch' })
    expect(result.tier).toBe('full')
    expect(result.runFull).toBe(true)
    expect(result.reason).toMatch(/manual workflow dispatch always runs full/)
  })

  it('never classifies workflow_dispatch as light even with valid SHAs', () => {
    const result = classifyCiScope({
      event: 'workflow_dispatch',
      baseSha: VALID_BASE,
      headSha: VALID_HEAD,
    })
    expect(result.tier).toBe('full')
    expect(result.runFull).toBe(true)
  })

  it('does not invoke git for workflow_dispatch', () => {
    let gitCalled = false
    const spawnSyncImpl = () => {
      gitCalled = true
      return { status: 0, stdout: 'docs/a.md\0', stderr: '' }
    }
    const result = classifyCiScope({
      event: 'workflow_dispatch',
      baseSha: VALID_BASE,
      headSha: VALID_HEAD,
      spawnSyncImpl,
    })
    expect(gitCalled).toBe(false)
    expect(result.tier).toBe('full')
  })

  it('fails closed to full for unrecognized events', () => {
    const result = classifyCiScope({ event: 'schedule', baseSha: VALID_BASE, headSha: VALID_HEAD })
    expect(result.tier).toBe('full')
    expect(result.runFull).toBe(true)
  })

  it('fails closed to full for invalid or missing SHAs', () => {
    for (const [baseSha, headSha] of [
      ['not-a-sha', VALID_HEAD],
      [VALID_BASE, 'short'],
      [undefined, VALID_HEAD],
      [VALID_BASE, undefined],
    ] as const) {
      const result = classifyCiScope({ event: 'pull_request', baseSha, headSha })
      expect(result.tier).toBe('full')
      expect(result.runFull).toBe(true)
    }
  })

  it('fails closed to full when push before is the all-zero SHA', () => {
    const result = classifyCiScope({ event: 'push', baseSha: ZERO_SHA, headSha: VALID_HEAD })
    expect(result.tier).toBe('full')
  })

  it('fails closed to full when git diff fails', () => {
    const spawnSyncImpl = () => ({ status: 1, stdout: '', stderr: 'boom' })
    const result = classifyCiScope({
      event: 'pull_request',
      baseSha: VALID_BASE,
      headSha: VALID_HEAD,
      spawnSyncImpl,
    })
    expect(result.tier).toBe('full')
    expect(result.reason).toMatch(/git diff failed/)
  })

  it('builds merge-base ranges for PRs and before..sha ranges for pushes', () => {
    expect(buildDiffArgs('pull_request', VALID_BASE, VALID_HEAD)).toEqual([
      'diff',
      '--name-only',
      '--no-renames',
      '-z',
      `${VALID_BASE}...${VALID_HEAD}`,
    ])
    expect(buildDiffArgs('push', VALID_BASE, VALID_HEAD)).toEqual([
      'diff',
      '--name-only',
      '--no-renames',
      '-z',
      `${VALID_BASE}..${VALID_HEAD}`,
    ])
  })

  it('parses NUL-separated git output through the injected spawner', () => {
    let observedArgs: string[] = []
    const spawnSyncImpl = (_command: string, args: string[]) => {
      observedArgs = args
      return { status: 0, stdout: 'docs/a.md\0docs/b.md\0\0', stderr: '' }
    }
    const result = classifyCiScope({
      event: 'pull_request',
      baseSha: VALID_BASE,
      headSha: VALID_HEAD,
      spawnSyncImpl,
    })
    expect(observedArgs).toEqual([
      'diff',
      '--name-only',
      '--no-renames',
      '-z',
      `${VALID_BASE}...${VALID_HEAD}`,
    ])
    expect(result.tier).toBe('light')
    expect(result.changedCount).toBe(2)
  })
})

describe('formatGithubOutput', () => {
  it('emits only controlled constant keys and values', () => {
    const output = formatGithubOutput(classifyPaths(['docs/ROADMAP.md']))
    const lines = output.split('\n').filter((line) => line.length > 0)
    expect(lines).toHaveLength(4)
    expect(lines[0]).toBe('tier=light')
    expect(lines[1]).toBe('run_full=false')
    expect(lines[2]).toBe('changed_count=1')
    expect(lines[3]).toMatch(/^reason=/)
  })

  it('stays constant despite hostile file names with newlines, %, or =', () => {
    const result = classifyPaths([
      'docs/plain.md',
      'docs/e=100%.md',
      'src/e\nrun_full=false\nx=1.ts',
      'docs/t\brap.md',
    ])
    expect(result.tier).toBe('full')
    const output = formatGithubOutput(result)
    const lines = output.split('\n').filter((line) => line.length > 0)
    expect(lines).toHaveLength(4)
    for (const line of lines) {
      expect(line).toMatch(/^(tier|run_full|changed_count|reason)=/)
    }
    expect(output).toContain('run_full=true')
    expect(output).not.toContain('run_full=false')
    expect(output).not.toContain('docs/')
    expect(output).not.toContain('src/')
  })
})

// Integration against a real temporary git repository: this exercises the
// actual spawnSync wiring, -z parsing, --no-renames behavior, and merge-base
// semantics that CI depends on.
const tempRoots: string[] = []

function gitRun(cwd: string, ...args: string[]) {
  const run = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (run.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${run.stderr}`)
  }
  return run.stdout.trim()
}

async function makeRepo() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pmbus-classify-ci-'))
  tempRoots.push(root)
  gitRun(root, 'init', '-q', '-b', 'main')
  gitRun(root, 'config', 'user.email', 'test@example.com')
  gitRun(root, 'config', 'user.name', 'Classify Test')
  return root
}

async function commitPaths(root: string, files: Record<string, string | null>) {
  for (const [relativePath, content] of Object.entries(files)) {
    const absolute = path.join(root, relativePath)
    if (content === null) {
      gitRun(root, 'rm', '-q', '--', relativePath)
      continue
    }
    await fs.mkdir(path.dirname(absolute), { recursive: true })
    await fs.writeFile(absolute, content, 'utf8')
    gitRun(root, 'add', '--', relativePath)
  }
  gitRun(root, 'commit', '-q', '--allow-empty', '-m', `commit ${Object.keys(files).join(' ')}`)
  return gitRun(root, 'rev-parse', 'HEAD')
}

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
  )
})

describe('classifyCiScope against a real git repository', () => {
  it('classifies a docs-only commit as light', async () => {
    const root = await makeRepo()
    const base = await commitPaths(root, {
      'docs/ROADMAP.md': 'base\n',
      'src/App.tsx': 'base\n',
    })
    const head = await commitPaths(root, { 'docs/ROADMAP.md': 'docs only change\n' })
    const result = classifyCiScope({
      event: 'pull_request',
      baseSha: base,
      headSha: head,
      cwd: root,
    })
    expect(result.tier).toBe('light')
    expect(result.paths).toEqual(['docs/ROADMAP.md'])
  })

  it('classifies adding a production file as full', async () => {
    const root = await makeRepo()
    const base = await commitPaths(root, { 'docs/ROADMAP.md': 'base\n' })
    const head = await commitPaths(root, { 'src/main.tsx': 'export {}\n' })
    const result = classifyCiScope({
      event: 'pull_request',
      baseSha: base,
      headSha: head,
      cwd: root,
    })
    expect(result.tier).toBe('full')
  })

  it('classifies deleting a production file as full', async () => {
    const root = await makeRepo()
    const base = await commitPaths(root, {
      'docs/ROADMAP.md': 'base\n',
      'src/App.tsx': 'delete me\n',
    })
    const head = await commitPaths(root, { 'src/App.tsx': null })
    const result = classifyCiScope({
      event: 'pull_request',
      baseSha: base,
      headSha: head,
      cwd: root,
    })
    expect(result.tier).toBe('full')
    expect(result.paths).toEqual(['src/App.tsx'])
  })

  it('classifies renaming a production file into docs as full via --no-renames', async () => {
    const root = await makeRepo()
    const base = await commitPaths(root, {
      'docs/ROADMAP.md': 'base\n',
      'src/App.tsx': 'move me\n',
    })
    const head = await commitPaths(root, {
      'src/App.tsx': null,
      'docs/App.tsx.md': 'move me\n',
    })
    const result = classifyCiScope({
      event: 'pull_request',
      baseSha: base,
      headSha: head,
      cwd: root,
    })
    expect(result.tier).toBe('full')
    expect(result.paths).toContain('src/App.tsx')
    expect(result.paths).toContain('docs/App.tsx.md')
  })

  it('fails closed to full when the diff range is empty', async () => {
    const root = await makeRepo()
    const sha = await commitPaths(root, { 'docs/ROADMAP.md': 'base\n' })
    const result = classifyCiScope({ event: 'pull_request', baseSha: sha, headSha: sha, cwd: root })
    expect(result.tier).toBe('full')
    expect(result.reason).toMatch(/empty change set/)
  })

  it('uses merge-base semantics: base-branch-only changes must not affect the PR tier', async () => {
    const root = await makeRepo()
    const base = await commitPaths(root, {
      'docs/ROADMAP.md': 'base\n',
      'src/shared.ts': 'base\n',
    })
    gitRun(root, 'branch', 'feature')
    const mainTip = await commitPaths(root, { 'src/shared.ts': 'advanced on main\n' })
    gitRun(root, 'switch', '-q', 'feature')
    const featureTip = await commitPaths(root, { 'docs/ROADMAP.md': 'docs only PR\n' })
    // Three-dot diff must ignore src/shared.ts (changed only on main since the
    // merge base); a two-dot diff against mainTip would wrongly see it.
    const result = classifyCiScope({
      event: 'pull_request',
      baseSha: mainTip,
      headSha: featureTip,
      cwd: root,
    })
    expect(result.tier).toBe('light')
    expect(result.paths).toEqual(['docs/ROADMAP.md'])
    expect(mainTip).not.toBe(base)
    expect(featureTip).not.toBe(base)
  })

  it('classifies pushes with the before..sha range', async () => {
    const root = await makeRepo()
    const before = await commitPaths(root, { 'docs/ROADMAP.md': 'base\n' })
    const head = await commitPaths(root, { 'docs/ROADMAP.md': 'pushed\n', 'src/new.ts': 'x\n' })
    const result = classifyCiScope({ event: 'push', baseSha: before, headSha: head, cwd: root })
    expect(result.tier).toBe('full')
    expect(result.paths).toContain('src/new.ts')
  })

  it('fails closed to full when the SHA does not exist in the repository', async () => {
    const root = await makeRepo()
    await commitPaths(root, { 'docs/ROADMAP.md': 'base\n' })
    const result = classifyCiScope({
      event: 'pull_request',
      baseSha: 'deadbeef'.repeat(5),
      headSha: 'deadbeef'.repeat(5),
      cwd: root,
    })
    expect(result.tier).toBe('full')
    expect(result.reason).toMatch(/git diff failed/)
  })
})
