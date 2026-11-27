import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { classifyChanges } from '../scripts/classify-ci-scope.mjs'

// A caller's hook or alternate index must not affect the fixture repository.
beforeEach(() => {
  for (const name of Object.keys(process.env)) {
    if (name.startsWith('GIT_')) vi.stubEnv(name, undefined)
  }
})
afterEach(() => vi.unstubAllEnvs())

it('limits the lightweight PR check to repository documentation', () => {
  expect(
    classifyChanges(['README.md', 'docs/adr/design.md', '.github/ISSUE_TEMPLATE/bug.yml']),
  ).toBe('docs')

  for (const file of [
    'tests/e2e/new-test.test.ts',
    'tests/fixtures/helpers.ts',
    'src/app/state.ts',
    'src/README.md',
    'tests/e2e/visual.spec.ts',
    'docs/notes\n.md',
    'document/specifications.json',
  ]) {
    expect(classifyChanges(['CONTRIBUTING.md', file]), file).toBe('browser')
  }
  expect(classifyChanges(['README.md', 'src/app/state.test.ts', 'tests/pec.test.ts'])).toBe('unit')
})

it('runs the full Pages check for direct deployment and layout inputs', () => {
  for (const file of [
    'package-lock.json',
    '.github/workflows/release.yml',
    'scripts/verify-pages-asset-references.mjs',
    'src/App.tsx',
    'src/components/layout/AppHeader.tsx',
    'src/components/feedback/ThemeToggle.tsx',
    'src/styles/tokens.css',
    'tests/e2e/helpers/browser-resources.ts',
  ]) {
    expect(classifyChanges(['README.md', 'tests/pec.test.ts', file]), file).toBe('pages')
  }
  expect(classifyChanges([])).toBe('pages')
})

it('checks the merged diff and keeps both sides of a rename in scope', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'pmbus-ci-'))
  const git = (...args: string[]) =>
    execFileSync(
      'git',
      [
        '-c',
        'user.name=CI Test',
        '-c',
        'user.email=ci@example.test',
        '-c',
        'commit.gpgsign=false',
        ...args,
      ],
      { cwd },
    )
  const commit = () => {
    git('add', '.')
    git('commit', '-qm', 'test')
  }
  const check = (event: 'pull_request' | 'workflow_dispatch' = 'pull_request') => {
    const output = join(cwd, '.git', 'ci-output')
    writeFileSync(output, '')
    execFileSync(process.execPath, [resolve('scripts/classify-ci-scope.mjs')], {
      cwd,
      env: { ...process.env, GITHUB_EVENT_NAME: event, GITHUB_OUTPUT: output },
    })
    return readFileSync(output, 'utf8')
  }
  try {
    git('init', '-qb', 'main')
    expect(check('workflow_dispatch')).toBe('scope=pages\n')
    writeFileSync(join(cwd, 'calculator.ts'), 'export const raw = 0\n')
    commit()
    git('switch', '-qc', 'guide')
    writeFileSync(join(cwd, 'README.md'), '# Guide\n')
    commit()
    git('switch', '-q', 'main')
    writeFileSync(join(cwd, 'package.json'), '{}')
    commit()
    git('merge', '-q', '--no-ff', '--no-edit', 'guide')
    expect(check()).toBe('scope=docs\n')

    git('mv', 'calculator.ts', 'CONTRIBUTING.md')
    commit()
    expect(check()).toBe('scope=browser\n')

    git('mv', 'package.json', 'defaults.json')
    commit()
    expect(check()).toBe('scope=pages\n')
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})
