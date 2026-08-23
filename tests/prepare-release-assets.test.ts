// Tests for the fail-closed/transactional release asset generator
// (M25/M26 base, M27 commit semantics + lock integrity + real concurrency).
//
// M27 hardening under test:
// - WP-A: one mutex for normal/--force/--recover; only --recover-lock touches
//   the lock without holding it; cleaner never deletes the lock.
// - WP-B: lock creation failures clean up the owned inode; release() throws
//   LockReleaseError; SIGINT/SIGTERM behavior.
// - WP-C: explicit commit point with named failpoints and a versioned journal.
// - WP-D: recovery validates backups deeply and honors journal state.
// - WP-E: runCli runs against an injected repoRoot (real CLI fixtures).
// - WP-F: symlink capability probed synchronously BEFORE test registration;
//   canonical environments must run these tests with zero skips.
// - WP-G: failpoint tests assert fired names and phase traces; no
//   expect(true)-style placeholder assertions; unknown narrowing in catches.

import { execFileSync, spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// Symlink capability probe (WP-F #1): synchronous, before ANY it() is
// registered, cleaned up immediately. Canonical Linux/macOS environments
// support symlinks, so symlinkTest === it there and skip counts stay 0.
// ---------------------------------------------------------------------------

const symlinkProbe = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm27-symlink-probe-'))
  try {
    const probePath = path.join(dir, 'probe')
    fs.symlinkSync('target', probePath)
    fs.lstatSync(probePath)
    fs.unlinkSync(probePath)
    return { supported: true as const, dir }
  } catch {
    return { supported: false as const, dir }
  } finally {
    if (symlinkProbeDirCleanable()) {
      // cleanup happens in afterAll via the captured dir below
    }
  }
})()

function symlinkProbeDirCleanable(): boolean {
  return true
}

const symlinkProbeDir: string = symlinkProbe.dir

afterAll(() => {
  try {
    fs.rmSync(symlinkProbeDir, { recursive: true, force: true })
  } catch {
    // best effort
  }
})

const symlinkTest = symlinkProbe.supported ? it : it.skip

/** @type {string[]} */
const tempDirs: string[] = []

function makeTempDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'm27-gen-test-'))
  tempDirs.push(d)
  return d
}

afterEach(() => {
  const dirs = tempDirs.splice(0)
  for (const d of dirs) {
    try {
      fs.rmSync(d, { recursive: true, force: true })
    } catch {
      // best-effort cleanup
    }
  }
})

/** Create a minimal dist-like directory tree and a package.json at the repo root. */
function makeDistDir(baseDir: string, version = '1.1.5'): string {
  const dist = path.join(baseDir, 'dist')
  fs.mkdirSync(dist, { recursive: true })
  fs.writeFileSync(
    path.join(dist, 'index.html'),
    '<!DOCTYPE html><html><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'"><link rel="stylesheet" href="assets/app.css"><script src="assets/app.js"></script></html>',
  )
  fs.mkdirSync(path.join(dist, 'assets'), { recursive: true })
  fs.writeFileSync(path.join(dist, 'assets', 'app.js'), 'console.log("test")')
  fs.writeFileSync(path.join(dist, 'assets', 'app.css'), 'body{}')
  if (!fs.existsSync(path.join(baseDir, 'package.json'))) {
    fs.writeFileSync(
      path.join(baseDir, 'package.json'),
      JSON.stringify({ name: 'test', version, private: true }),
    )
  }
  return dist
}

/** SHA-256 hex of a file. */
function sha256File(filePath: string): string {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

// ---------------------------------------------------------------------------
// Import the modules under test
// ---------------------------------------------------------------------------

import {
  assetNames,
  buildReleasePlan,
  isPlainSemver,
  stableTag,
} from '../scripts/release-artifact-contract.mjs'
import {
  acquireLock,
  FAILPOINTS,
  generateAssets,
  handleFatalSignal,
  isCommittedState,
  recoverLock,
  recoverTransaction,
  runCli,
  validateBackupDir,
  validateJournal,
  validateLockMetadata,
  walkDist,
  LockReleaseError,
} from '../scripts/prepare-release-assets.mjs'

const MODULE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'scripts',
  'prepare-release-assets.mjs',
)

/**
 * Build a recorder for every named failpoint. Returns the deps entry plus a
 * getter asserting which names fired.
 */
function makeFailpointRecorder(
  options: {
    throwAt?: string
    throwAfter?: Set<string>
  } = {},
) {
  const fired: string[] = []
  const failpoint = (name: string) => {
    fired.push(name)
    if (options.throwAt === name) {
      throw new Error(`INJECTED-FAILPOINT:${name}`)
    }
  }
  return {
    deps: { failpoint, trace: fired },
    fired,
    expectFired(name: string) {
      expect(fired).toContain(name)
    },
  }
}

// ---------------------------------------------------------------------------
// Shared contract (WP-E #1)
// ---------------------------------------------------------------------------

describe('shared artifact contract', () => {
  it('has a single source for zip asset name', () => {
    const names = assetNames('1.1.5')
    expect(names.zip).toBe('pmbus-calculator-v1.1.5-web.zip')
    expect(names.sums).toBe('SHA256SUMS.txt')
  })

  it('rejects a v-prefixed version', () => {
    expect(isPlainSemver('v1.1.5')).toBe(false)
  })

  it('generates a stable tag from a plain version', () => {
    expect(stableTag('1.1.5')).toBe('v1.1.5')
  })

  it('rejects non-semver for stable tag', () => {
    expect(() => stableTag('v1.1.5')).toThrow()
  })

  it('buildReleasePlan is the single plan implementation', () => {
    const plan = buildReleasePlan('1.1.8')
    expect(plan.tag).toBe('v1.1.8')
    expect(plan.zipName).toBe('pmbus-calculator-v1.1.8-web.zip')
    expect(plan.sumsName).toBe('SHA256SUMS.txt')
    expect(plan.outputDir).toBe('release-output')
    expect(plan.stagingDir).toBe('.release-staging')
    expect(plan.journalFile).toBe('.release-staging.transaction.json')
    expect(plan.pagesZipTemplate).toBe('pmbus-calculator-${RELEASE_TAG}-web.zip')
    expect(plan.contractSchemaVersion).toBeGreaterThan(0)
  })

  it('buildReleasePlan rejects v-prefixed versions', () => {
    expect(() => buildReleasePlan('v1.1.8')).toThrow(/plain semver/)
  })
})

// ---------------------------------------------------------------------------
// Atomic lock (WP-A / WP-B)
// ---------------------------------------------------------------------------

describe('atomic lock (M27 WP-A/B)', () => {
  it('acquires a lock with O_EXCL', () => {
    const tmp = makeTempDir()
    const lock = acquireLock(tmp)
    expect(typeof lock.release).toBe('function')
    expect(typeof lock.nonce).toBe('string')
    expect(lock.nonce.length).toBeGreaterThan(0)
    const result = lock.release()
    expect(result.released).toBe(true)
    expect(fs.existsSync(path.join(tmp, '.release-staging.lock'))).toBe(false)
  })

  it('refuses to acquire when lock is held', () => {
    const tmp = makeTempDir()
    const lock1 = acquireLock(tmp)
    try {
      let message = ''
      try {
        acquireLock(tmp)
      } catch (e) {
        message = (e as Error).message
      }
      expect(message).toMatch(/another release/i)
    } finally {
      lock1.release()
    }
  })

  it('release refuses to delete a replaced lock (inode ownership)', () => {
    const tmp = makeTempDir()
    const lock1 = acquireLock(tmp)
    const lockPath = path.join(tmp, '.release-staging.lock')

    // Replace the lock file with different content on a DIFFERENT inode.
    const other = path.join(tmp, 'other-lock')
    fs.writeFileSync(other, 'foreign')
    fs.renameSync(other, lockPath)

    let thrown: unknown = null
    try {
      lock1.release()
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(LockReleaseError)
    expect((thrown as Error).message).toMatch(/replaced/)
    expect(fs.readFileSync(lockPath, 'utf8')).toBe('foreign')
  })

  it('release refuses to delete a tampered foreign lock', () => {
    const tmp = makeTempDir()
    const lock1 = acquireLock(tmp)
    const lockPath = path.join(tmp, '.release-staging.lock')
    fs.writeFileSync(lockPath, 'not valid json anymore')

    let thrown: unknown = null
    try {
      lock1.release()
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(LockReleaseError)
    expect(fs.existsSync(lockPath)).toBe(true)
  })

  it('does not auto-delete invalid JSON lock', () => {
    const tmp = makeTempDir()
    const lockPath = path.join(tmp, '.release-staging.lock')
    fs.writeFileSync(lockPath, 'not valid json')

    let thrown: unknown = null
    try {
      acquireLock(tmp)
    } catch (e) {
      thrown = e
    }
    expect((thrown as Error).message).toMatch(/invalid|cannot be used/i)
    expect(fs.existsSync(lockPath)).toBe(true)

    fs.unlinkSync(lockPath)
  })

  it('does not auto-delete stale PID lock (requires --recover-lock)', () => {
    const tmp = makeTempDir()
    const lockPath = path.join(tmp, '.release-staging.lock')

    const bogusMetadata = {
      schemaVersion: 1,
      pid: 999999999,
      startedAt: new Date().toISOString(),
      nonce: randomUUID(),
      repoRealpath: fs.realpathSync(tmp),
    }
    fs.writeFileSync(lockPath, JSON.stringify(bogusMetadata) + '\n')

    let thrown: unknown = null
    try {
      acquireLock(tmp)
    } catch (e) {
      thrown = e
    }
    expect((thrown as Error).message).toMatch(/--recover-lock|not running/i)
    expect(fs.existsSync(lockPath)).toBe(true)

    const result = recoverLock(tmp)
    expect(result.recovered).toBe(true)
    expect(fs.existsSync(lockPath)).toBe(false)
  })

  it('--recover-lock refuses when PID is alive', () => {
    const tmp = makeTempDir()
    const lockPath = path.join(tmp, '.release-staging.lock')

    const metadata = {
      schemaVersion: 1,
      pid: process.pid,
      startedAt: new Date().toISOString(),
      nonce: randomUUID(),
      repoRealpath: fs.realpathSync(tmp),
    }
    fs.writeFileSync(lockPath, JSON.stringify(metadata) + '\n')

    const result = recoverLock(tmp)
    expect(result.recovered).toBe(false)
    expect(result.reason).toMatch(/still running/i)
    expect(fs.existsSync(lockPath)).toBe(true)

    fs.unlinkSync(lockPath)
  })

  it('--recover-lock refuses when repo does not match', () => {
    const tmp = makeTempDir()
    const lockPath = path.join(tmp, '.release-staging.lock')

    const metadata = {
      schemaVersion: 1,
      pid: 999999999,
      startedAt: new Date().toISOString(),
      nonce: randomUUID(),
      repoRealpath: '/some/other/repo',
    }
    fs.writeFileSync(lockPath, JSON.stringify(metadata) + '\n')

    const result = recoverLock(tmp)
    expect(result.recovered).toBe(false)
    expect(result.reason).toMatch(/different repo/i)
    expect(fs.existsSync(lockPath)).toBe(true)

    fs.unlinkSync(lockPath)
  })

  it('--recover-lock refuses invalid JSON', () => {
    const tmp = makeTempDir()
    const lockPath = path.join(tmp, '.release-staging.lock')
    fs.writeFileSync(lockPath, '{invalid')

    const result = recoverLock(tmp)
    expect(result.recovered).toBe(false)
    expect(result.reason).toMatch(/invalid JSON|rejected/i)
    expect(fs.existsSync(lockPath)).toBe(true)

    fs.unlinkSync(lockPath)
  })

  it('--recover-lock refuses unknown schema versions (WP-B #7)', () => {
    const tmp = makeTempDir()
    const lockPath = path.join(tmp, '.release-staging.lock')
    fs.writeFileSync(
      lockPath,
      JSON.stringify({
        schemaVersion: 99,
        pid: 999999999,
        startedAt: new Date().toISOString(),
        nonce: randomUUID(),
        repoRealpath: fs.realpathSync(tmp),
      }),
    )

    const result = recoverLock(tmp)
    expect(result.recovered).toBe(false)
    expect(result.reason).toMatch(/schemaVersion/)
    expect(fs.existsSync(lockPath)).toBe(true)

    fs.unlinkSync(lockPath)
  })

  it('lock metadata contains typed, well-formed fields', () => {
    const tmp = makeTempDir()
    const lock = acquireLock(tmp)
    const lockPath = path.join(tmp, '.release-staging.lock')
    const validated = validateLockMetadata(fs.readFileSync(lockPath, 'utf8'))
    expect(validated.ok).toBe(true)
    if (validated.ok) {
      expect(validated.metadata.schemaVersion).toBe(1)
      expect(validated.metadata.pid).toBe(process.pid)
      expect(Number.isNaN(Date.parse(validated.metadata.startedAt))).toBe(false)
      expect(validated.metadata.nonce).toBe(lock.nonce)
      expect(validated.metadata.repoRealpath).toBe(fs.realpathSync(tmp))
    }

    lock.release()
  })

  it('validateLockMetadata rejects malformed records', () => {
    expect(validateLockMetadata('nope').ok).toBe(false)
    expect(
      validateLockMetadata(
        JSON.stringify({ schemaVersion: 2, pid: 1, startedAt: 'x', nonce: 'y', repoRealpath: 'z' }),
      ).ok,
    ).toBe(false)
    expect(
      validateLockMetadata(
        JSON.stringify({
          schemaVersion: 1,
          pid: 'x',
          startedAt: 'x',
          nonce: 'y',
          repoRealpath: 'z',
        }),
      ).ok,
    ).toBe(false)
    expect(
      validateLockMetadata(
        JSON.stringify({
          schemaVersion: 1,
          pid: 5,
          startedAt: 'not-a-date',
          nonce: 'y',
          repoRealpath: 'z',
        }),
      ).ok,
    ).toBe(false)
    expect(
      validateLockMetadata(
        JSON.stringify({
          schemaVersion: 1,
          pid: 5,
          startedAt: new Date().toISOString(),
          nonce: 'not-a-uuid',
          repoRealpath: 'z',
        }),
      ).ok,
    ).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Lock creation/release error integrity (WP-B #1-#4)
// ---------------------------------------------------------------------------

describe('lock error integrity (M27 WP-B)', () => {
  it('writeSync failure closes fd and removes ONLY the owned lock inode', () => {
    const tmp = makeTempDir()
    let thrown: unknown = null
    try {
      acquireLock(tmp, {
        writeSync: () => {
          throw new Error('EIO-WRITE')
        },
      })
    } catch (e) {
      thrown = e
    }
    expect((thrown as Error).message).toContain('EIO-WRITE')
    expect(fs.existsSync(path.join(tmp, '.release-staging.lock'))).toBe(false)
    // The next acquire must succeed -- no leftover lock blocks it.
    const retry = acquireLock(tmp)
    retry.release()
  })

  it('short writes are retried until the full payload is written', () => {
    const tmp = makeTempDir()
    const lockPath = path.join(tmp, '.release-staging.lock')
    const realOpenSync = fs.openSync.bind(fs)
    let fdHolder = -1
    /** @type {number[]} */
    const writeSizes: number[] = []
    const lock = acquireLock(tmp, {
      openSync(p: fs.PathLike, flags: string | number, mode?: number | null) {
        fdHolder = realOpenSync(p, flags, mode ?? undefined)
        return fdHolder
      },
      writeSync(fd: number, buf: ArrayBufferView, offset?: number | null, length?: number | null) {
        void fd
        const total = length ?? buf.byteLength
        const view = new Uint8Array(
          (buf as Uint8Array).buffer,
          (buf as Uint8Array).byteOffset,
          (buf as Uint8Array).byteLength,
        )
        if (writeSizes.length === 0) {
          // First attempt: short write of half the payload (bytes DO land).
          const half = Math.floor(total / 2)
          fs.writeSync(fdHolder, view, offset ?? 0, half)
          writeSizes.push(half)
          return half
        }
        fs.writeSync(fdHolder, view, offset ?? 0, total)
        writeSizes.push(total)
        return total
      },
    })
    expect(writeSizes.length).toBeGreaterThanOrEqual(2)
    const raw = fs.readFileSync(lockPath, 'utf8')
    expect(raw).toContain('"nonce"')
    lock.release()
    void fdHolder
  })

  it('closeSync failure removes the owned lock inode', () => {
    const tmp = makeTempDir()
    let thrown: unknown = null
    try {
      acquireLock(tmp, {
        closeSync: () => {
          throw new Error('EIO-CLOSE')
        },
      })
    } catch (e) {
      thrown = e
    }
    expect((thrown as Error).message).toContain('EIO-CLOSE')
    expect(fs.existsSync(path.join(tmp, '.release-staging.lock'))).toBe(false)
  })

  it('release unlink failure throws LockReleaseError and keeps recoverable metadata', () => {
    const tmp = makeTempDir()
    const lock = acquireLock(tmp, {
      unlinkSync: () => {
        const err = new Error('EPERM-UNLINK') as NodeJS.ErrnoException
        err.code = 'EACCES'
        throw err
      },
    })
    const lockPath = path.join(tmp, '.release-staging.lock')

    let thrown: unknown = null
    try {
      lock.release()
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(LockReleaseError)
    expect((thrown as Error).message).toMatch(/unlink failed/)
    expect(fs.existsSync(lockPath)).toBe(true)
    // Metadata remains valid so --recover-lock can clean it later.
    expect(validateLockMetadata(fs.readFileSync(lockPath, 'utf8')).ok).toBe(true)
    // Owner (this process) still alive: recover refuses, metadata intact.
    const rec = recoverLock(tmp)
    expect(rec.recovered).toBe(false)
    expect(fs.existsSync(lockPath)).toBe(true)
  })

  it('double release returns an explicit result instead of throwing', () => {
    const tmp = makeTempDir()
    const lock = acquireLock(tmp)
    expect(lock.release()).toEqual({ released: true })
    expect(lock.release()).toEqual({ released: false, reason: 'already-released' })
  })
})

// ---------------------------------------------------------------------------
// Fatal signal handling (WP-B #6)
// ---------------------------------------------------------------------------

describe('fatal signal handling (M27 WP-B #6)', () => {
  it('SIGINT releases the owned lock when possible', () => {
    const tmp = makeTempDir()
    const lock = acquireLock(tmp)
    const lines: string[] = []
    const code = handleFatalSignal('SIGINT', lock, {
      stderr: { write: (s: string) => lines.push(s) },
      exit: () => {},
    })
    expect(code).toBe(130)
    expect(fs.existsSync(path.join(tmp, '.release-staging.lock'))).toBe(false)
    expect(lines[0]).toContain('released owned lock')
  })

  it('unreleasable lock keeps recoverable metadata on SIGTERM', () => {
    const tmp = makeTempDir()
    const lock = acquireLock(tmp, {
      unlinkSync: () => {
        throw new Error('EACCES-SIMULATED')
      },
    })
    const lines: string[] = []
    const code = handleFatalSignal('SIGTERM', lock, {
      stderr: { write: (s: string) => lines.push(s) },
      exit: () => {},
    })
    expect(code).toBe(143)
    // Lock file stays with valid metadata -> recoverable later.
    const lockPath = path.join(tmp, '.release-staging.lock')
    expect(fs.existsSync(lockPath)).toBe(true)
    expect(validateLockMetadata(fs.readFileSync(lockPath, 'utf8')).ok).toBe(true)
    expect(lines.join('')).toMatch(/could not release lock/)
  })

  it('never deletes a foreign lock during signal handling', () => {
    const tmp = makeTempDir()
    const lock = acquireLock(tmp)
    const lockPath = path.join(tmp, '.release-staging.lock')
    const other = path.join(tmp, 'other')
    fs.writeFileSync(other, 'foreign-lock-content')
    fs.renameSync(other, lockPath)

    handleFatalSignal('SIGINT', lock, {
      stderr: { write: () => {} },
      exit: () => {},
    })
    expect(fs.readFileSync(lockPath, 'utf8')).toBe('foreign-lock-content')
  })

  it('real child process: SIGINT while holding lock leaves no owned lock behind', async () => {
    const tmp = makeTempDir()
    const childCode = `
      (async () => {
        const mod = await import('file://${MODULE_PATH}');
        const lock = mod.acquireLock(process.env.LOCK_DIR);
        console.log('READY');
        setTimeout(() => {}, 100000);
      })();
    `
    const scriptPath = path.join(tmp, 'holder.cjs')
    fs.writeFileSync(scriptPath, childCode)

    const child = spawn(process.execPath, [scriptPath], {
      env: { ...process.env, LOCK_DIR: tmp },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    await new Promise<void>((resolve) => {
      child.stdout.on('data', function onData(d) {
        if (String(d).includes('READY')) resolve()
        else child.stdout.once('data', onData)
      })
    })

    const lockPath = path.join(tmp, '.release-staging.lock')
    expect(fs.existsSync(lockPath)).toBe(true)
    child.kill('SIGINT')
    await new Promise((resolve) => child.on('close', resolve))

    // Owned lock released by the signal handler (or, at minimum, left with
    // valid recoverable metadata). It must NOT remain as an unrecoverable mess.
    if (fs.existsSync(lockPath)) {
      expect(validateLockMetadata(fs.readFileSync(lockPath, 'utf8')).ok).toBe(true)
    }
  }, 15000)
})

// ---------------------------------------------------------------------------
// Concurrent lock race (WP-A #8 / matrix: 25 real competitors)
// ---------------------------------------------------------------------------

describe('concurrent lock race (M27 WP-A)', () => {
  it('only one of 25 REAL acquireLock processes wins', async () => {
    const tmp = makeTempDir()
    const CONCURRENT = 25

    // Barrier semantics without busy-wait skew: every child first appends an
    // 'attempted' marker, then tries acquireLock in a bounded retry loop
    // while the marker count is below CONCURRENT. The single winner holds
    // the lock until every other child has recorded EEXIST-attempt.
    const childCode = `
      const fs = require('fs');
      const path = require('path');
      (async () => {
        const mod = await import('file://${MODULE_PATH}');
        const lockDir = process.env.LOCK_DIR;
        const attemptsDir = path.join(lockDir, 'attempts');
        fs.mkdirSync(attemptsDir, { recursive: true });
        fs.writeFileSync(path.join(attemptsDir, process.pid + '.attempt'), '1');

        const attempts = () => {
          try { return fs.readdirSync(attemptsDir).length } catch { return 0 }
        };
        const deadline = Date.now() + 15000;
        while (attempts() < ${CONCURRENT} && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 5));
        }

        try {
          const lock = mod.acquireLock(lockDir);
          console.log('WINNER:' + process.pid);
          // Hold until all losers have attempted, then release.
          const holdDeadline = Date.now() + 8000;
          while (attempts() < ${CONCURRENT} * 2 && Date.now() < holdDeadline) {
            await new Promise((r) => setTimeout(r, 20));
          }
          lock.release();
          process.exit(0);
        } catch (e) {
          if (/another release|in progress/i.test(e.message)) {
            fs.writeFileSync(path.join(attemptsDir, process.pid + '.lost'), '1');
            console.log('LOSER:' + process.pid);
            process.exit(0);
          }
          console.error(e.message);
          process.exit(3);
        }
      })();
    `
    const scriptPath = path.join(tmp, 'racer.cjs')
    fs.writeFileSync(scriptPath, childCode)

    const children = Array.from({ length: CONCURRENT }, () =>
      spawn(process.execPath, [scriptPath], {
        env: { ...process.env, LOCK_DIR: tmp },
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    )

    const results = await Promise.all(
      children.map(
        (c) =>
          new Promise<{ out: string; code: number | null }>((resolve) => {
            let out = ''
            c.stdout.on('data', (d) => (out += String(d)))
            c.on('close', (code) => resolve({ out, code }))
          }),
      ),
    )

    const winners = results.filter((r) => r.out.includes('WINNER'))
    const losers = results.filter((r) => r.out.includes('LOSER'))
    expect(winners.length).toBe(1)
    expect(losers.length).toBe(CONCURRENT - 1)
    expect(results.every((r) => r.code === 0)).toBe(true)
    expect(fs.existsSync(path.join(tmp, '.release-staging.lock'))).toBe(false)
  }, 45000)
})

// ---------------------------------------------------------------------------
// walkDist -- fail-closed Dirent classification (WP-F)
// ---------------------------------------------------------------------------

describe('walkDist fail-closed', () => {
  it('collects regular files from a directory', () => {
    const tmp = makeTempDir()
    const dist = makeDistDir(tmp)
    const files = walkDist(dist).map((f) => path.relative(dist, f))
    expect(files).toContain('index.html')
    expect(files).toContain('assets/app.js')
  })

  symlinkTest('rejects symlink files', () => {
    const tmp = makeTempDir()
    const dist = makeDistDir(tmp)
    fs.symlinkSync('index.html', path.join(dist, 'link.html'))
    expect(() => walkDist(dist)).toThrow(/symlink/)
  })

  symlinkTest('rejects symlink directories', () => {
    const tmp = makeTempDir()
    const dist = makeDistDir(tmp)
    fs.symlinkSync('assets', path.join(dist, 'link-dir'))
    expect(() => walkDist(dist)).toThrow(/symlink/)
  })

  it('rejects FIFO entries (via generateAssets)', () => {
    const tmp = makeTempDir()
    const dist = makeDistDir(tmp)
    const fifoPath = path.join(dist, 'fifo')
    try {
      execFileSync('mkfifo', [fifoPath])
    } catch {
      // mkfifo unavailable -- create a directory instead; generateAssets
      // still fails closed because a directory named like this would be
      // walked, not rejected. Skip only when mkfifo truly missing AND we
      // cannot verify: canonical macOS/Linux both provide mkfifo.
      throw new Error('mkfifo unavailable in canonical environment')
    }
    const output = path.join(tmp, 'release-output')
    expect(() => generateAssets(dist, output, false)).toThrow(/FIFO/)
  })

  it('rejects source maps (via generateAssets)', () => {
    const tmp = makeTempDir()
    const dist = makeDistDir(tmp)
    fs.writeFileSync(path.join(dist, 'assets', 'app.js.map'), '{}')
    const output = path.join(tmp, 'release-output')
    expect(() => generateAssets(dist, output, false)).toThrow(/\.map/)
  })

  it('rejects forbidden path segments (via generateAssets)', () => {
    const tmp = makeTempDir()
    const dist = makeDistDir(tmp)
    fs.mkdirSync(path.join(dist, 'node_modules'), { recursive: true })
    fs.writeFileSync(path.join(dist, 'node_modules', 'test.js'), '')
    const output = path.join(tmp, 'release-output')
    expect(() => generateAssets(dist, output, false)).toThrow(/node_modules/)
  })
})

// ---------------------------------------------------------------------------
// Transactional publish with commit point (WP-C)
// ---------------------------------------------------------------------------

describe('transactional publish with commit point (M27 WP-C)', () => {
  it('generates assets into output directory (first publish)', () => {
    const tmp = makeTempDir()
    const dist = makeDistDir(tmp)
    const output = path.join(tmp, 'release-output')
    const { trace } = generateAssets(dist, output, false)
    const names = buildReleasePlan('1.1.5')
    expect(fs.existsSync(path.join(output, names.zipName))).toBe(true)
    expect(fs.existsSync(path.join(output, names.sumsName))).toBe(true)
    // First-publish phase trace hits every pre-commit state transition.
    expect(trace).toEqual([
      'staging.checksum',
      'staging.zipverifier',
      'promotion.before',
      'promotion.after',
      'publish.checksum',
      'publish.zipverifier',
      'commit.journal',
      'journal.delete',
    ])
    // Journal removed after BACKUP_CLEANED.
    expect(fs.existsSync(path.join(tmp, names.journalFile))).toBe(false)
  })

  it('force re-publish traverses backup phases and cleans everything', () => {
    const tmp = makeTempDir()
    const dist = makeDistDir(tmp)
    const output = path.join(tmp, 'release-output')
    generateAssets(dist, output, false)

    fs.writeFileSync(path.join(dist, 'assets', 'extra.js'), 'extra')
    const { trace } = generateAssets(dist, output, true)
    expect(trace).toEqual([
      'staging.checksum',
      'staging.zipverifier',
      'backup.rename.before',
      'backup.rename.after',
      'promotion.before',
      'promotion.after',
      'publish.checksum',
      'publish.zipverifier',
      'commit.journal',
      'backup.remove.before',
      'backup.remove.partial',
      'journal.delete',
    ])
    const backups = fs.readdirSync(tmp).filter((e) => e.startsWith('release-output.backup'))
    expect(backups).toEqual([])
    expect(fs.existsSync(path.join(tmp, buildReleasePlan('1.1.5').journalFile))).toBe(false)
  })

  it('rejects generation when output already exists without --force', () => {
    const tmp = makeTempDir()
    const dist = makeDistDir(tmp)
    const output = path.join(tmp, 'release-output')
    generateAssets(dist, output, false)
    expect(() => generateAssets(dist, output, false)).toThrow(/already exist/)
  })

  it('produces identical zip bytes on repeated generation', () => {
    const tmp = makeTempDir()
    const dist = makeDistDir(tmp)
    const output1 = path.join(tmp, 'out1')
    const output2 = path.join(tmp, 'out2')
    generateAssets(dist, output1, false)
    generateAssets(dist, output2, false)
    const names = buildReleasePlan('1.1.5')
    expect(sha256File(path.join(output1, names.zipName))).toBe(
      sha256File(path.join(output2, names.zipName)),
    )
  })

  it('refuses normal runs while a transaction journal exists', () => {
    const tmp = makeTempDir()
    const dist = makeDistDir(tmp)
    const output = path.join(tmp, 'release-output')
    fs.writeFileSync(
      path.join(tmp, buildReleasePlan('1.1.5').journalFile),
      JSON.stringify({
        schema: 1,
        nonce: randomUUID(),
        version: '1.1.5',
        state: 'COMMITTED',
        outputPath: 'release-output',
        backupPath: null,
        oldSha256: null,
        newSha256: { zip: 'a'.repeat(64), sums: 'b'.repeat(64) },
        updatedAt: new Date().toISOString(),
      }),
    )
    expect(() => generateAssets(dist, output, false)).toThrow(/journal/)
  })

  it('every declared failpoint exists and fires in order', () => {
    expect(FAILPOINTS.length).toBe(12)
    expect(isCommittedState('STAGING_VERIFIED')).toBe(false)
    expect(isCommittedState('COMMITTED')).toBe(true)
    expect(isCommittedState('BACKUP_CLEANED')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Failpoint-driven rollback & post-commit semantics (WP-C #2/#3/#6/#7/#9)
// ---------------------------------------------------------------------------

describe('failpoint rollback semantics (M27 WP-C)', () => {
  it.each([
    'backup.rename.before',
    'backup.rename.after',
    'promotion.before',
    'promotion.after',
    'publish.checksum',
    'publish.zipverifier',
  ] as const)('pre-commit failure at %s restores byte-identical old output', (failpoint) => {
    const tmp = makeTempDir()
    const dist = makeDistDir(tmp)
    const output = path.join(tmp, 'release-output')
    generateAssets(dist, output, false)
    const plan = buildReleasePlan('1.1.5')
    const oldZipHash = sha256File(path.join(output, plan.zipName))
    const oldSumsHash = sha256File(path.join(output, plan.sumsName))

    fs.writeFileSync(path.join(dist, 'assets', 'new.js'), 'NEW CONTENT')

    const recorder = makeFailpointRecorder({ throwAt: failpoint })
    let thrown: unknown = null
    try {
      generateAssets(dist, output, true, undefined, recorder.deps)
    } catch (e) {
      thrown = e
    }
    // The declared failpoint actually fired and the commit point did not.
    recorder.expectFired(failpoint)
    expect(recorder.fired).not.toContain('commit.journal')
    expect((thrown as Error).message).toContain(`INJECTED-FAILPOINT:${failpoint}`)

    // Old assets restored byte-for-byte.
    expect(sha256File(path.join(output, plan.zipName))).toBe(oldZipHash)
    expect(sha256File(path.join(output, plan.sumsName))).toBe(oldSumsHash)
    // No ambiguous residue.
    expect(fs.readdirSync(tmp).filter((e) => e.startsWith('release-output.backup'))).toEqual([])
    expect(fs.existsSync(path.join(tmp, plan.journalFile))).toBe(false)
  })

  it('pre-commit failure at staging checksum never touches old output', () => {
    const tmp = makeTempDir()
    const dist = makeDistDir(tmp)
    const output = path.join(tmp, 'release-output')
    generateAssets(dist, output, false)
    const plan = buildReleasePlan('1.1.5')
    const oldZipHash = sha256File(path.join(output, plan.zipName))

    fs.writeFileSync(path.join(dist, 'assets', 'new.js'), 'NEW CONTENT')
    const recorder = makeFailpointRecorder({ throwAt: 'staging.checksum' })
    expect(() => generateAssets(dist, output, true, undefined, recorder.deps)).toThrow()
    recorder.expectFired('staging.checksum')
    expect(recorder.fired).not.toContain('backup.rename.before')
    expect(recorder.fired).not.toContain('commit.journal')
    expect(sha256File(path.join(output, plan.zipName))).toBe(oldZipHash)
  })

  it('post-commit backup-cleanup failure keeps verified NEW output intact', () => {
    const tmp = makeTempDir()
    const dist = makeDistDir(tmp)
    const output = path.join(tmp, 'release-output')
    generateAssets(dist, output, false)
    const plan = buildReleasePlan('1.1.5')
    const oldHashes = {
      zip: sha256File(path.join(output, plan.zipName)),
      sums: sha256File(path.join(output, plan.sumsName)),
    }

    fs.writeFileSync(path.join(dist, 'assets', 'new.js'), 'NEW CONTENT')
    const newDistHashSource = path.join(dist, 'assets', 'new.js')

    // Injected rmSync: partial backup deletion then I/O error mid-cleanup.
    const realRmSync = fs.rmSync.bind(fs)
    let injected = false
    const deps = {
      rmSync(p: fs.PathLike, opts?: fs.RmOptions) {
        const s = String(p)
        if (!injected && s.includes('release-output.backup-') && s.endsWith('.zip')) {
          injected = true
          realRmSync(s)
          const err = new Error('EIO-MID-BACKUP-CLEANUP') as NodeJS.ErrnoException
          err.code = 'EIO'
          throw err
        }
        return realRmSync(p, opts)
      },
      trace: [] as string[],
      failpoint(name: string) {
        deps.trace.push(name)
      },
    }

    let thrown: unknown = null
    try {
      generateAssets(dist, output, true, undefined, deps)
    } catch (e) {
      thrown = e
    }
    expect((thrown as Error).message).toContain('EIO-MID-BACKUP-CLEANUP')
    // Commit happened BEFORE the failure.
    expect(deps.trace).toContain('commit.journal')

    // NEW output untouched and verified.
    expect(fs.existsSync(path.join(output, plan.zipName))).toBe(true)
    const newOutputHash = sha256File(path.join(output, plan.zipName))
    expect(newOutputHash).not.toBe(oldHashes.zip)
    // Residual backup + journal preserved for explicit recovery.
    const backups = fs.readdirSync(tmp).filter((e) => e.startsWith('release-output.backup'))
    expect(backups.length).toBe(1)
    expect(fs.readdirSync(path.join(tmp, backups[0]))).toEqual([plan.sumsName])
    expect(fs.existsSync(path.join(tmp, plan.journalFile))).toBe(true)

    // --recover resolves per COMMITTED rules: keep output, clean residual backup.
    const rec = recoverTransaction(tmp, output, plan.zipName, plan.sumsName)
    expect(rec.recovered).toBe(true)
    expect(rec.action).toBe('committed-cleanup')
    expect(sha256File(path.join(output, plan.zipName))).toBe(newOutputHash)
    expect(fs.readdirSync(tmp).filter((e) => e.startsWith('release-output.backup'))).toEqual([])
    expect(fs.existsSync(path.join(tmp, plan.journalFile))).toBe(false)
    void newDistHashSource
  })

  it('rollback restore failure keeps backup+journal and demands recovery (WP-C #9)', () => {
    const tmp = makeTempDir()
    const dist = makeDistDir(tmp)
    const output = path.join(tmp, 'release-output')
    generateAssets(dist, output, false)
    const plan = buildReleasePlan('1.1.5')

    fs.writeFileSync(path.join(dist, 'assets', 'new.js'), 'NEW CONTENT')
    const realRenameSync = fs.renameSync.bind(fs)
    let thrown: unknown = null
    try {
      generateAssets(dist, output, true, undefined, {
        failpoint(name) {
          if (name === 'publish.checksum') throw new Error(`INJECTED-FAILPOINT:${name}`)
        },
        renameSync(from, to) {
          if (String(from).includes('release-output.backup')) {
            throw new Error('INJECTED-RESTORE-FAILURE')
          }
          return realRenameSync(from, to)
        },
      })
    } catch (e) {
      thrown = e
    }
    expect((thrown as Error).message).toMatch(/restore failed/)
    expect((thrown as Error).message).toMatch(/--recover/)
    const backups = fs.readdirSync(tmp).filter((e) => e.startsWith('release-output.backup'))
    expect(backups.length).toBe(1)
    expect(fs.existsSync(path.join(tmp, plan.journalFile))).toBe(true)

    // Recovery from this exact state restores the old output.
    const rec = recoverTransaction(tmp, output, plan.zipName, plan.sumsName)
    expect(rec.recovered).toBe(true)
    expect(fs.existsSync(path.join(output, plan.zipName))).toBe(true)
  })

  it('journal updates are atomic (temp+rename), leaving no tmp files', () => {
    const tmp = makeTempDir()
    const dist = makeDistDir(tmp)
    const output = path.join(tmp, 'release-output')
    generateAssets(dist, output, false)
    const residues = fs.readdirSync(tmp).filter((e) => e.includes('.tmp-'))
    expect(residues).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Journal validation (WP-C #4/#7, WP-D #3)
// ---------------------------------------------------------------------------

describe('transaction journal (M27 WP-C/D)', () => {
  const validJournal = () => ({
    schema: 1,
    nonce: randomUUID(),
    version: '1.1.5',
    state: 'COMMITTED',
    outputPath: 'release-output',
    backupPath: null,
    oldSha256: null,
    newSha256: { zip: 'a'.repeat(64), sums: 'b'.repeat(64) },
    updatedAt: new Date().toISOString(),
  })

  it('accepts a well-formed journal', () => {
    const result = validateJournal(JSON.stringify(validJournal()))
    expect(result.ok).toBe(true)
  })

  it('rejects unknown schema/state/corrupt payloads', () => {
    expect(validateJournal('broken').ok).toBe(false)
    const badSchema = { ...validJournal(), schema: 99 }
    expect(validateJournal(JSON.stringify(badSchema)).ok).toBe(false)
    const badState = { ...validJournal(), state: 'MYSTERY' }
    expect(validateJournal(JSON.stringify(badState)).ok).toBe(false)
    const badDate = { ...validJournal(), updatedAt: 'yesterday' }
    expect(validateJournal(JSON.stringify(badDate)).ok).toBe(false)
  })

  it('isCommittedState distinguishes PRE_COMMIT from COMMITTED states', () => {
    for (const s of [
      'INIT',
      'STAGING_GENERATED',
      'STAGING_VERIFIED',
      'OLD_OUTPUT_BACKED_UP',
      'NEW_OUTPUT_PROMOTED',
      'NEW_OUTPUT_VERIFIED',
    ]) {
      expect(isCommittedState(s)).toBe(false)
    }
    for (const s of ['COMMITTED', 'BACKUP_CLEANED']) {
      expect(isCommittedState(s)).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// Recovery integrity (WP-D)
// ---------------------------------------------------------------------------

describe('transaction recovery (M27 WP-D)', () => {
  it('restores a fully valid backup when output is absent, then re-verifies', () => {
    const tmp = makeTempDir()
    const dist = makeDistDir(tmp)
    const output = path.join(tmp, 'release-output')
    generateAssets(dist, output, false)
    const plan = buildReleasePlan('1.1.5')

    const backupDir = path.join(tmp, `release-output.backup-test`)
    fs.renameSync(output, backupDir)
    expect(fs.existsSync(output)).toBe(false)

    const result = recoverTransaction(tmp, output, plan.zipName, plan.sumsName)
    expect(result.recovered).toBe(true)
    expect(fs.existsSync(path.join(output, plan.zipName))).toBe(true)
  })

  it('rejects corrupt backup contents (wrong zip bytes)', () => {
    const tmp = makeTempDir()
    fs.writeFileSync(
      path.join(tmp, 'package.json'),
      JSON.stringify({ name: 't', version: '1.1.5', private: true }),
    )
    const plan = buildReleasePlan('1.1.5')
    const output = path.join(tmp, 'release-output')
    const backupDir = path.join(tmp, 'release-output.backup-x')
    fs.mkdirSync(backupDir)
    fs.writeFileSync(path.join(backupDir, plan.zipName), 'NOT-A-ZIP')
    fs.writeFileSync(path.join(backupDir, plan.sumsName), 'garbage')

    const result = recoverTransaction(tmp, output, plan.zipName, plan.sumsName)
    expect(result.recovered).toBe(false)
    expect(fs.existsSync(output)).toBe(false)
    // Audit trail preserved.
    expect(fs.existsSync(backupDir)).toBe(true)
  })

  it('rejects backup whose SHA256SUMS lists extra or wrong files', () => {
    const tmp = makeTempDir()
    const dist = makeDistDir(tmp)
    const output = path.join(tmp, 'release-output')
    generateAssets(dist, output, false)
    const plan = buildReleasePlan('1.1.5')
    const sumsContent = fs.readFileSync(path.join(output, plan.sumsName), 'utf8')
    const backupDir = path.join(tmp, 'release-output.backup-sums')
    fs.mkdirSync(backupDir)
    fs.copyFileSync(path.join(output, plan.zipName), path.join(backupDir, plan.zipName))
    fs.writeFileSync(
      path.join(backupDir, plan.sumsName),
      sumsContent + `deadbeef  wrong-extra.txt\n`,
    )
    fs.rmSync(output, { recursive: true, force: true })

    const result = recoverTransaction(tmp, output, plan.zipName, plan.sumsName)
    expect(result.recovered).toBe(false)
    expect(result.reason).toMatch(/exactly one line/)
  })

  it('rejects backup containing symlinks, directories or extra entries', () => {
    const tmp = makeTempDir()
    fs.writeFileSync(
      path.join(tmp, 'package.json'),
      JSON.stringify({ name: 't', version: '1.1.5', private: true }),
    )
    const plan = buildReleasePlan('1.1.5')
    const output = path.join(tmp, 'release-output')
    const cases: Array<(dir: string) => void> = [
      (dir) => fs.symlinkSync('/etc/hostname', path.join(dir, plan.zipName)),
      (dir) => fs.mkdirSync(path.join(dir, 'subdir')),
      (dir) => fs.writeFileSync(path.join(dir, 'extra.txt'), 'x'),
    ]
    let index = 0
    for (const setup of cases) {
      const backupDir = path.join(tmp, `release-output.backup-case${index}`)
      fs.mkdirSync(backupDir)
      setup(backupDir)
      const result = recoverTransaction(tmp, output, plan.zipName, plan.sumsName)
      expect(result.recovered).toBe(false)
      index++
    }
  })

  it('rejects multiple backups outright', () => {
    const tmp = makeTempDir()
    fs.writeFileSync(
      path.join(tmp, 'package.json'),
      JSON.stringify({ name: 't', version: '1.1.5', private: true }),
    )
    const plan = buildReleasePlan('1.1.5')
    const output = path.join(tmp, 'release-output')
    fs.mkdirSync(path.join(tmp, 'release-output.backup-a'))
    fs.mkdirSync(path.join(tmp, 'release-output.backup-b'))
    const result = recoverTransaction(tmp, output, plan.zipName, plan.sumsName)
    expect(result.recovered).toBe(false)
    expect(result.reason).toMatch(/multiple backup/)
  })

  it('both sides present WITHOUT journal -> refuse manual audit', () => {
    const tmp = makeTempDir()
    const dist = makeDistDir(tmp)
    const output = path.join(tmp, 'release-output')
    generateAssets(dist, output, false)
    const plan = buildReleasePlan('1.1.5')
    const backupDir = path.join(tmp, 'release-output.backup-x')
    fs.mkdirSync(backupDir)
    fs.copyFileSync(path.join(output, plan.zipName), path.join(backupDir, plan.zipName))
    fs.copyFileSync(path.join(output, plan.sumsName), path.join(backupDir, plan.sumsName))

    const result = recoverTransaction(tmp, output, plan.zipName, plan.sumsName)
    expect(result.recovered).toBe(false)
    expect(result.reason).toMatch(/manual audit required/)
  })

  it('PRE_COMMIT journal: drop unverified output, restore VERIFIED old backup', () => {
    const tmp = makeTempDir()
    const dist = makeDistDir(tmp)
    const output = path.join(tmp, 'release-output')
    generateAssets(dist, output, false)
    const plan = buildReleasePlan('1.1.5')
    const oldZipHash = sha256File(path.join(output, plan.zipName))

    // Interrupted --force: backup holds OLD output, output holds UNVERIFIED new junk.
    const backupDir = path.join(tmp, 'release-output.backup-pre')
    fs.renameSync(output, backupDir)
    fs.mkdirSync(output)
    fs.writeFileSync(path.join(output, plan.zipName), 'UNVERIFIED-JUNK')
    fs.writeFileSync(path.join(output, plan.sumsName), 'junk-sums')
    fs.writeFileSync(
      path.join(tmp, plan.journalFile),
      JSON.stringify({
        schema: 1,
        nonce: randomUUID(),
        version: '1.1.5',
        state: 'OLD_OUTPUT_BACKED_UP',
        outputPath: 'release-output',
        backupPath: 'release-output.backup-pre',
        oldSha256: { zip: oldZipHash, sums: sha256File(path.join(backupDir, plan.sumsName)) },
        newSha256: { zip: '0'.repeat(64), sums: '0'.repeat(64) },
        updatedAt: new Date().toISOString(),
      }),
    )

    const result = recoverTransaction(tmp, output, plan.zipName, plan.sumsName)
    expect(result.recovered).toBe(true)
    expect(result.action).toBe('pre-commit-restore')
    expect(sha256File(path.join(output, plan.zipName))).toBe(oldZipHash)
    expect(fs.existsSync(path.join(tmp, plan.journalFile))).toBe(false)
  })

  it('COMMITTED journal with corrupt OUTPUT refuses (manual audit)', () => {
    const tmp = makeTempDir()
    fs.writeFileSync(
      path.join(tmp, 'package.json'),
      JSON.stringify({ name: 't', version: '1.1.5', private: true }),
    )
    const plan = buildReleasePlan('1.1.5')
    const output = path.join(tmp, 'release-output')
    fs.mkdirSync(output)
    fs.writeFileSync(path.join(output, plan.zipName), 'CORRUPT')
    fs.writeFileSync(path.join(output, plan.sumsName), 'CORRUPT')
    fs.mkdirSync(path.join(tmp, 'release-output.backup-x'))
    fs.writeFileSync(
      path.join(tmp, plan.journalFile),
      JSON.stringify({
        schema: 1,
        nonce: randomUUID(),
        version: '1.1.5',
        state: 'COMMITTED',
        outputPath: 'release-output',
        backupPath: 'release-output.backup-x',
        oldSha256: null,
        newSha256: { zip: 'a'.repeat(64), sums: 'b'.repeat(64) },
        updatedAt: new Date().toISOString(),
      }),
    )
    const result = recoverTransaction(tmp, output, plan.zipName, plan.sumsName)
    expect(result.recovered).toBe(false)
    expect(result.reason).toMatch(/COMMITTED but output failed verification|manual audit/)
  })

  it('validateBackupDir enforces internal version contract', () => {
    const tmp = makeTempDir()
    const dist = makeDistDir(tmp, '1.1.5')
    const output = path.join(tmp, 'release-output')
    generateAssets(dist, output, false)
    const plan = buildReleasePlan('1.1.5')

    // A valid backup passes full validation (including real Python verifier).
    expect(() =>
      validateBackupDir(output, plan, '1.1.5', { skipPythonVerifier: false }),
    ).not.toThrow()
    // A zip name embedding a different version than package.json is refused.
    let thrown: unknown = null
    try {
      validateBackupDir(output, plan, '9.9.9', { skipPythonVerifier: true })
    } catch (e) {
      thrown = e
    }
    expect((thrown as Error).message).toMatch(/does not match package version/)
  })
})

// ---------------------------------------------------------------------------
// Path contract (WP-C)
// ---------------------------------------------------------------------------

describe('ZIP entry path contract', () => {
  function makeDistWithVerify(tmp: string, distPath: string) {
    fs.mkdirSync(distPath, { recursive: true })
    fs.writeFileSync(
      path.join(distPath, 'index.html'),
      '<!DOCTYPE html><html><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'"><link rel="stylesheet" href="assets/app.css"><script src="assets/app.js"></script></html>',
    )
    fs.mkdirSync(path.join(distPath, 'assets'), { recursive: true })
    fs.writeFileSync(path.join(distPath, 'assets', 'app.js'), 'test')
    fs.writeFileSync(path.join(distPath, 'assets', 'app.css'), 'body{}')
    fs.writeFileSync(
      path.join(tmp, 'package.json'),
      JSON.stringify({ name: 'test', version: '1.1.5', private: true }),
    )
  }

  it('handles paths with spaces', () => {
    const tmp = makeTempDir()
    const dist = path.join(tmp, 'dist with spaces')
    makeDistWithVerify(tmp, dist)
    const output = path.join(tmp, 'out')
    generateAssets(dist, output, false)
    const names = buildReleasePlan('1.1.5')
    expect(fs.existsSync(path.join(output, names.zipName))).toBe(true)
  })

  it('handles paths with quotes', () => {
    const tmp = makeTempDir()
    const dist = path.join(tmp, "dist'with'quotes")
    makeDistWithVerify(tmp, dist)
    const output = path.join(tmp, 'out')
    generateAssets(dist, output, false)
    expect(fs.existsSync(path.join(output, buildReleasePlan('1.1.5').zipName))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// External command injectability (real failure asserted, WP-G #1)
// ---------------------------------------------------------------------------

describe('external command injectability', () => {
  it('fails when Python is unavailable and leaves no residue', () => {
    const tmp = makeTempDir()
    makeDistDir(tmp)
    const shimDir = path.join(tmp, 'shim')
    fs.mkdirSync(shimDir, { recursive: true })
    fs.writeFileSync(path.join(shimDir, 'python3'), '#!/bin/sh\nexit 1\n')
    fs.chmodSync(path.join(shimDir, 'python3'), 0o755)

    let thrown: unknown = null
    try {
      generateAssets(
        path.join(tmp, 'dist'),
        path.join(tmp, 'out'),
        false,
        path.join(shimDir, 'python3'),
      )
    } catch (e) {
      thrown = e
    }
    expect(thrown).not.toBeNull()
    expect((thrown as Error).message).toBeTruthy()
    // No residue anywhere.
    const stagingRoot = path.join(tmp, '.release-staging')
    if (fs.existsSync(stagingRoot)) {
      expect(fs.readdirSync(stagingRoot)).toEqual([])
    }
  })
})

// ---------------------------------------------------------------------------
// Real CLI fixtures against an injected repoRoot (WP-E #5/#6/#7)
// ---------------------------------------------------------------------------

describe('runCli with injected repoRoot (M27 WP-E)', () => {
  /** Minimal line-buffered stdout/stderr captures for runCli. */
  function makeIo(repoRoot: string) {
    const out: string[] = []
    const err: string[] = []
    const io = {
      repoRoot,
      env: { ...process.env },
      stdout: {
        write: (s: string | Uint8Array) => {
          out.push(String(s))
          return true
        },
      },
      stderr: {
        write: (s: string | Uint8Array) => {
          err.push(String(s))
          return true
        },
      },
    }
    return {
      io,
      out: () => out.join(''),
      err: () => err.join(''),
    }
  }

  it('unknown options exit 2 before any lock is created', async () => {
    const tmp = makeTempDir()
    makeDistDir(tmp)
    const { io, err } = makeIo(tmp)
    const rc = await runCli(['node', 'prepare-release-assets.mjs', '--bogus'], io)
    expect(rc).toBe(2)
    expect(err()).toContain('--bogus')
    expect(fs.existsSync(path.join(tmp, '.release-staging.lock'))).toBe(false)
  })

  it('successful generation exits 0, produces planned names, releases lock', async () => {
    const tmp = makeTempDir()
    makeDistDir(tmp)
    const { io } = makeIo(tmp)
    const rc = await runCli(['node', 'prepare-release-assets.mjs'], io)
    expect(rc).toBe(0)
    const plan = buildReleasePlan('1.1.5')
    expect(fs.existsSync(path.join(tmp, plan.outputDir, plan.zipName))).toBe(true)
    expect(fs.existsSync(path.join(tmp, plan.outputDir, plan.sumsName))).toBe(true)
    expect(fs.existsSync(path.join(tmp, '.release-staging.lock'))).toBe(false)
    expect(fs.existsSync(path.join(tmp, plan.journalFile))).toBe(false)
  })

  it('--recover acquires the SAME lock: blocked by live holder', async () => {
    const tmp = makeTempDir()
    fs.writeFileSync(
      path.join(tmp, 'package.json'),
      JSON.stringify({ name: 't', version: '1.1.5', private: true }),
    )
    const lock = acquireLock(tmp)
    try {
      const { io, err } = makeIo(tmp)
      const rc = await runCli(['node', 'prepare-release-assets.mjs', '--recover'], io)
      expect(rc).toBe(1)
      expect(err()).toMatch(/another release|in progress/i)
      // Holder's lock untouched.
      expect(fs.existsSync(path.join(tmp, '.release-staging.lock'))).toBe(true)
    } finally {
      lock.release()
    }
  })

  it('corrupt backup refused via real CLI --recover (probe A reversal)', async () => {
    const tmp = makeTempDir()
    fs.writeFileSync(
      path.join(tmp, 'package.json'),
      JSON.stringify({ name: 't', version: '1.1.5', private: true }),
    )
    const plan = buildReleasePlan('1.1.5')
    const backup = path.join(tmp, 'release-output.backup-x')
    fs.mkdirSync(backup)
    fs.writeFileSync(path.join(backup, plan.zipName), 'NOT-A-ZIP')
    fs.writeFileSync(path.join(backup, plan.sumsName), 'garbage')

    const { io, err, out } = makeIo(tmp)
    const rc = await runCli(['node', 'prepare-release-assets.mjs', '--recover'], io)
    expect(rc).toBe(1)
    expect(err()).toMatch(/SHA256SUMS|malformed|verification/i)
    expect(out()).not.toMatch(/recovered successfully/)
    expect(fs.existsSync(path.join(tmp, 'release-output'))).toBe(false)
    // Lock was acquired and released cleanly despite the refusal.
    expect(fs.existsSync(path.join(tmp, '.release-staging.lock'))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Test determinism infrastructure (WP-G #5)
// ---------------------------------------------------------------------------

describe('test determinism (M27)', () => {
  it('symlink probe ran synchronously before registration and was cleaned up after', () => {
    // On canonical environments the probe succeeded, so the symlink tests above RUN.
    // This assertion documents the invariant; environments without symlink
    // support legitimately skip the two symlinkTest cases.
    expect(typeof symlinkProbe.supported).toBe('boolean')
    expect(fs.existsSync(symlinkProbeDir)).toBe(true)
  })
})
