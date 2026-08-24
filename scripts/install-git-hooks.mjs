// M30 WP-F: worktree-aware git-hooks installer used by the `postinstall`
// npm script (replaces a bare `simple-git-hooks` invocation).
//
// Why: in a linked/detached worktree `.git` is a FILE (gitdir pointer), and
// simple-git-hooks tries to `mkdir <worktree>/.git/hooks` -> ENOTDIR
// (probe H; `npm ci` still exits 0, silently swallowing the error). This
// wrapper:
//   - primary checkout (.git is a directory): install simple-git-hooks
//   - linked/detached worktree (.git is a file): SKIP with a clear message
//   - CI environment (GITHUB_ACTIONS/CI): SKIP (hooks are a dev convenience;
//     CI runs the gates explicitly)
//   - non-Git directory (no .git): SKIP with a clear message
// Every skip exits 0 and prints a normal message -- never an ERROR line.
//
// The hooks CLI is injectable via HOOKS_BIN so tests can point at the real
// simple-git-hooks CLI without a full node_modules in the fixture.

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

// npm runs `postinstall` with the package directory as the working directory,
// so cwd() is the authoritative repo root here (a fixture/worktree checkout
// must be judged on ITS OWN .git, not the module's parent).
const repoRoot = process.cwd()

/**
 * @param {string} reason
 * @returns {0}
 */
function skip(reason) {
  process.stdout.write(`install-git-hooks: skip hook installation (${reason})\n`)
  return 0
}

/**
 * @returns {number}
 */
function main() {
  // CI: hooks are a local-dev convenience; the CI gates run explicitly.
  if (process.env.GITHUB_ACTIONS === 'true' || process.env.CI === 'true') {
    return skip('CI environment -- hooks are not installed in CI')
  }

  const gitPath = path.join(repoRoot, '.git')
  let stat
  try {
    stat = fs.lstatSync(gitPath)
  } catch {
    return skip('not a Git repository (no .git)')
  }

  if (stat.isFile()) {
    return skip(
      '.git is a file -- linked/detached worktree; hooks belong to the primary checkout and are not installed here',
    )
  }
  if (!stat.isDirectory()) {
    return skip('.git is not a directory')
  }

  // Primary checkout: install the hooks through the real simple-git-hooks CLI.
  const bin =
    process.env.HOOKS_BIN || path.join(repoRoot, 'node_modules', 'simple-git-hooks', 'cli.js')
  if (!fs.existsSync(bin)) {
    process.stderr.write(`install-git-hooks: ERROR: simple-git-hooks CLI not found at ${bin}\n`)
    return 1
  }
  const res = spawnSync(process.execPath, [bin], { stdio: 'inherit' })
  if (res.error) {
    process.stderr.write(`install-git-hooks: ERROR: failed to run ${bin}: ${res.error.message}\n`)
    return 1
  }
  if (res.status !== 0) {
    process.stderr.write(
      `install-git-hooks: ERROR: simple-git-hooks exited with status ${String(res.status)}\n`,
    )
    return res.status ?? 1
  }
  return 0
}

process.exitCode = main()
