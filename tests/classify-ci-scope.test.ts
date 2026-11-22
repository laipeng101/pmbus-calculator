import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { isDocumentationOnly } from '../scripts/classify-ci-scope.mjs'

it('limits the lightweight PR check to repository documentation', () => {
  expect(
    isDocumentationOnly(['README.md', 'docs/adr/design.md', '.github/ISSUE_TEMPLATE/bug.yml']),
  ).toBe(true)

  for (const file of [
    'package-lock.json',
    '.github/workflows/release.yml',
    'src/styles/tokens.css',
    'src/README.md',
    'tests/e2e/visual.spec.ts',
    'docs/notes\n.md',
    'document/specifications.json',
  ]) {
    expect(isDocumentationOnly(['CONTRIBUTING.md', file]), file).toBe(false)
  }
  expect(isDocumentationOnly([])).toBe(false)
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
    expect(check()).toContain('Documentation only: true')

    git('mv', 'calculator.ts', 'CONTRIBUTING.md')
    commit()
    expect(check()).toContain('Documentation only: false')
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})
