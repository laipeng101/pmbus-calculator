// M30 WP-F: worktree-aware git-hooks installer (test-first).
//
// The M29 postinstall is `simple-git-hooks` directly; in a linked/detached
// worktree `.git` is a FILE and simple-git-hooks tries to mkdir
// `<worktree>/.git/hooks` -> ENOTDIR (probe H; npm ci still exits 0, silently
// swallowing the error). The M30 wrapper must:
//   - primary checkout (.git directory): install simple-git-hooks normally
//   - linked/detached worktree (.git file): skip, no .git/hooks attempt
//   - CI environment: skip
//   - non-Git directory: skip
//   - every skip prints a clear message (not an ERROR) and exits 0

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WRAPPER = path.join(REPO_ROOT, 'scripts', 'install-git-hooks.mjs')
const REAL_CLI = path.join(REPO_ROOT, 'node_modules', 'simple-git-hooks', 'cli.js')

const tempDirs: string[] = []
function makeTempDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'm30-hooks-'))
  tempDirs.push(d)
  return d
}
afterEach(() => {
  for (const d of tempDirs.splice(0)) {
    try {
      fs.rmSync(d, { recursive: true, force: true })
    } catch {
      // best effort
    }
  }
})

function runWrapper(
  tmp: string,
  env: Record<string, string> = {},
): { status: number; stdout: string; stderr: string } {
  const res = spawnSync(process.execPath, [WRAPPER], {
    cwd: tmp,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 20_000,
  })
  return { status: res.status ?? -1, stdout: String(res.stdout), stderr: String(res.stderr) }
}

describe('M30 WP-F worktree-aware git hooks', () => {
  it('F1: primary checkout (.git directory) installs the hooks and exits 0', () => {
    const tmp = makeTempDir()
    fs.mkdirSync(path.join(tmp, '.git'))
    fs.mkdirSync(path.join(tmp, 'node_modules'), { recursive: true })
    fs.writeFileSync(
      path.join(tmp, 'package.json'),
      JSON.stringify({
        name: 't',
        version: '1.0.0',
        'simple-git-hooks': { 'pre-commit': 'echo hi' },
      }),
    )
    // Clear CI markers: GitHub Actions sets CI=true in the test process env,
    // which must NOT turn this primary-checkout test into a CI-skip test.
    const r = runWrapper(tmp, { CI: 'false', GITHUB_ACTIONS: 'false', HOOKS_BIN: REAL_CLI })
    expect(r.status).toBe(0)
    expect(r.stderr).not.toMatch(/ENOTDIR/i)
    expect(fs.existsSync(path.join(tmp, '.git', 'hooks', 'pre-commit'))).toBe(true)
  })

  it('F2: linked/detached worktree (.git is a FILE) skips with a clear message, exit 0, NO ENOTDIR, no .git/hooks', () => {
    const tmp = makeTempDir()
    fs.writeFileSync(path.join(tmp, '.git'), 'gitdir: /some/other/repo/.git\n')
    // Clear CI markers so this test exercises the worktree branch, not the
    // CI-skip branch, on CI runners too.
    const r = runWrapper(tmp, { CI: 'false', GITHUB_ACTIONS: 'false', HOOKS_BIN: REAL_CLI })
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/skip/i)
    expect(r.stderr).not.toMatch(/ENOTDIR|ERROR/i)
    expect(fs.existsSync(path.join(tmp, '.git', 'hooks'))).toBe(false)
  })

  it('F3: CI environment skips hook installation even in a primary checkout', () => {
    const tmp = makeTempDir()
    fs.mkdirSync(path.join(tmp, '.git'))
    const r = runWrapper(tmp, { GITHUB_ACTIONS: 'true', HOOKS_BIN: REAL_CLI })
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/skip/i)
    expect(r.stderr).not.toMatch(/ENOTDIR|ERROR/i)
    expect(fs.existsSync(path.join(tmp, '.git', 'hooks'))).toBe(false)
  })

  it('F4: non-Git directory (no .git at all) skips with a clear message, exit 0', () => {
    const tmp = makeTempDir()
    const r = runWrapper(tmp, { HOOKS_BIN: REAL_CLI })
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/skip/i)
    expect(r.stderr).not.toMatch(/ENOTDIR|ERROR/i)
  })
})
