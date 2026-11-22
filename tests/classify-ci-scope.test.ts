// @vitest-environment node
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { classifyCiScope, classifyPaths } from '../scripts/classify-ci-scope.mjs'

describe('CI scope', () => {
  it.each([
    [['AGENTS.md', 'docs/DOMAIN_MODEL.md', '.github/ISSUE_TEMPLATE/bug.yml'], 'light'],
    [['docs/RELEASING.md', 'document/specifications.json'], 'checks'],
    [['tests/direct.test.ts', 'src/components/Example.test.tsx'], 'checks'],
    [['.gitignore'], 'product'],
    [['README.md', 'src/app/reducer.ts', 'src/app/reducer.test.ts'], 'product'],
    [['index.html', 'src/styles/tokens.css', 'src/components/result/ResultSummary.tsx'], 'product'],
    [['tests/e2e/calculator.spec.ts', 'tests/e2e/visual.spec.ts-snapshots/desktop.png'], 'product'],
    [['src/main.tsx', 'package-lock.json'], 'full'],
    [['playwright.config.ts'], 'full'],
    [['.github/workflows/pages.yml'], 'full'],
    [['scripts/apply-pages-overlay.mjs'], 'full'],
    [['src/app/example.test.mts'], 'full'],
    [['docs/new-fixture.json'], 'full'],
    [['docs/line\nbreak.md'], 'full'],
    [[], 'full'],
  ] as const)('classifies %j as %s', (files, tier) => {
    expect(classifyPaths([...files])).toBe(tier)
  })

  it('uses the checked-out PR merge against main and counts both ends of a rename', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pmbus-ci-scope-'))
    const git = (...args: string[]) =>
      execFileSync(
        'git',
        ['-c', 'user.name=Scope Test', '-c', 'user.email=scope@example.test', ...args],
        { cwd, encoding: 'utf8' },
      ).trim()
    const commit = () => {
      git('add', '-A')
      git('commit', '--no-gpg-sign', '-qm', 'test')
      return git('rev-parse', 'HEAD')
    }

    try {
      const classify = (event = 'pull_request') => classifyCiScope({ event, cwd })
      git('init', '-q', '-b', 'main')
      fs.mkdirSync(path.join(cwd, 'docs'))
      fs.mkdirSync(path.join(cwd, 'src/app'), { recursive: true })
      fs.writeFileSync(path.join(cwd, 'src/app/calculator.ts'), 'export const value = 0\n')
      const ancestor = commit()
      expect(classify()).toEqual({ tier: 'full', count: 0 })

      fs.writeFileSync(path.join(cwd, 'package.json'), '{}')
      const baseSha = commit()
      git('checkout', '-q', '--detach', ancestor)

      fs.writeFileSync(path.join(cwd, 'docs/guide.md'), '# Guide\n')
      const docsSha = commit()
      fs.renameSync(path.join(cwd, 'src/app/calculator.ts'), path.join(cwd, 'docs/calculator.md'))
      const renameSha = commit()

      const checkoutMerge = (headSha: string) => {
        git('checkout', '-q', '--detach', baseSha)
        git('merge', '-q', '--no-ff', '--no-edit', '--no-gpg-sign', headSha)
      }
      checkoutMerge(docsSha)
      expect(classify()).toEqual({ tier: 'light', count: 1 })
      expect(classify('workflow_dispatch')).toEqual({ tier: 'full', count: 0 })

      checkoutMerge(renameSha)
      expect(classify()).toEqual({ tier: 'product', count: 3 })
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true })
    }
  })
})
