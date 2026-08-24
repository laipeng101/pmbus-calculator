// M31 WP-C: release asset generation must be POSIX-only and FAIL CLOSED on
// Windows BEFORE registering any transaction side effect, creating the lock,
// staging, or output.
//
// M30 documented "Windows has no process groups: only the direct child is
// killed -- a documented fail-closed boundary". Probe P3/P4 showed that claim
// is unsupported: activeChildren tracks only the DIRECT child and the
// Windows kill path is child.kill() only, so a grandchild survives and keeps
// writing after settle. The M31 contract therefore drops that claim and
// rejects Windows entirely before any side effect.
//
// Test-first (red against M30 main):
//   C1. a testable platform capability gate is exported (win32 rejected)
//   C2. on win32, runCli exits nonzero with a clear POSIX-only message and
//       leaves ZERO side effects in the repo (no lock/staging/journal/output)
//   C3. docs/RELEASING.md no longer claims the Windows direct-child-kill is
//       fail-closed, and documents the POSIX-only support

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { afterEach, describe, expect, it } from 'vitest'

const REPO_ROOT = path.resolve(process.cwd())

const tempDirs: string[] = []
function makeTempDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'm31-gate-'))
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

describe('M31 WP-C POSIX-only platform gate (true fail-closed)', () => {
  it('C1: a testable platform capability gate rejects win32 and accepts linux/darwin', async () => {
    const mod = await import('../scripts/prepare-release-assets.mjs')
    expect(typeof mod.isSupportedPlatform).toBe('function')
    expect(mod.isSupportedPlatform('win32')).toBe(false)
    expect(mod.isSupportedPlatform('linux')).toBe(true)
    expect(mod.isSupportedPlatform('darwin')).toBe(true)
  })

  it('C2: on win32 runCli exits nonzero BEFORE any side effect (lock/staging/journal/output all absent)', async () => {
    const mod = await import('../scripts/prepare-release-assets.mjs')
    const tmp = makeTempDir()
    const out: string[] = []
    const err: string[] = []
    const code = await mod.runCli(['node', 'x', '--force'], {
      stdout: { write: (s: string) => (out.push(s), true) },
      stderr: { write: (s: string) => (err.push(s), true) },
      repoRoot: tmp,
      platform: 'win32',
    })
    expect(code).not.toBe(0)
    expect(err.join('')).toMatch(/Linux|macOS|POSIX|supported/i)
    // Zero side effects: nothing may have been created in the repo root.
    const entries = fs.readdirSync(tmp)
    expect(entries).toEqual([])
  })

  it('C3: RELEASING.md no longer claims Windows direct-child kill is fail-closed, and documents POSIX-only support', () => {
    const releasing = fs.readFileSync(path.join(REPO_ROOT, 'docs', 'RELEASING.md'), 'utf8')
    expect(releasing).not.toMatch(/仅杀直接\s*子进程|fail-closed 边界|fail-closed boundary/i)
    expect(releasing).toMatch(/Linux|macOS|POSIX/i)
  })
})
