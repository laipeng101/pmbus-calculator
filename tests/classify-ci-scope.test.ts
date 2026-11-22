import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
    'package-lock.json',
    'tests/e2e/new-test.test.ts',
    'tests/fixtures/helpers.ts',
    'src/app/state.ts',
    '.github/workflows/release.yml',
    'src/styles/tokens.css',
    'src/README.md',
    'tests/e2e/visual.spec.ts',
    'docs/notes\n.md',
    'document/specifications.json',
  ]) {
    expect(classifyChanges(['CONTRIBUTING.md', file]), file).toBe('browser')
  }
  expect(classifyChanges(['README.md', 'src/app/state.test.ts', 'tests/pec.test.ts'])).toBe('unit')
  expect(classifyChanges([])).toBe('browser')
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
  const check = () =>
    execFileSync(process.execPath, [resolve('scripts/classify-ci-scope.mjs')], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, GITHUB_OUTPUT: '' },
    })
  try {
    git('init', '-qb', 'main')
    writeFileSync(join(cwd, 'calculator.ts'), 'export const raw = 0\n')
    commit()
    git('switch', '-qc', 'guide')
    writeFileSync(join(cwd, 'README.md'), '# Guide\n')
    commit()
    git('switch', '-q', 'main')
    writeFileSync(join(cwd, 'package.json'), '{}')
    commit()
    git('merge', '-q', '--no-ff', '--no-edit', 'guide')
    expect(check()).toContain('CI scope: docs')

    git('mv', 'calculator.ts', 'CONTRIBUTING.md')
    commit()
    expect(check()).toContain('CI scope: browser')
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})
