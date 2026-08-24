// M28 WP-A/WP-B/WP-D/WP-F tests -- Release recovery integrity, journal binding
// and durability, signal/lock lifecycle, CLI conflict rejection.
//
// Written BEFORE the implementation (test-first): every test here was red
// against the M27 baseline and green after the M28 fixes.

import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { buildReleasePlan } from '../scripts/release-artifact-contract.mjs'
import {
  acquireLock,
  generateAssets,
  handleFatalSignal,
  recoverTransaction,
  runCli,
  validateJournal,
  writeAllSync,
} from '../scripts/prepare-release-assets.mjs'

const MODULE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'scripts',
  'prepare-release-assets.mjs',
)

const tempDirs: string[] = []

function makeTempDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'm28-test-'))
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

function sha256File(filePath: string): string {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

const CSP_HTML =
  '<!DOCTYPE html><html><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'"><link rel="stylesheet" href="assets/app.css"><script src="assets/app.js"></script></html>'

/** Minimal dist tree whose generated zip passes verify_release_zip.py. */
function makeDist(dir: string): void {
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'index.html'), CSP_HTML)
  fs.writeFileSync(path.join(dir, 'assets', 'app.js'), 'console.log("m28")')
  fs.writeFileSync(path.join(dir, 'assets', 'app.css'), 'body{}')
}

function writePkg(tmp: string, version = '1.1.5'): void {
  fs.writeFileSync(
    path.join(tmp, 'package.json'),
    JSON.stringify({ name: 't', version, private: true }),
  )
}

function journalPath(tmp: string, version = '1.1.5'): string {
  return path.join(tmp, buildReleasePlan(version).journalFile)
}

function makeJournal(
  overrides: Record<string, unknown> = {},
  version = '1.1.5',
): Record<string, unknown> {
  return {
    schema: 1,
    nonce: randomUUID(),
    version,
    state: 'COMMITTED',
    outputPath: 'release-output',
    backupPath: null,
    oldSha256: null,
    newSha256: { zip: 'a'.repeat(64), sums: 'b'.repeat(64) },
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// WP-A: recovery state machine
// ---------------------------------------------------------------------------

describe('M28 WP-A recovery state machine', async () => {
  it('A1: COMMITTED + output + backup: fake ZIP with matching checksum is REJECTED and backup+journal preserved', async () => {
    const tmp = makeTempDir()
    writePkg(tmp)
    const plan = buildReleasePlan('1.1.5')
    const output = path.join(tmp, plan.outputDir)
    fs.mkdirSync(output, { recursive: true })

    // Self-consistent FAKE output (not a zip).
    const fakeZip = Buffer.from('THIS IS NOT A ZIP', 'utf8')
    fs.writeFileSync(path.join(output, plan.zipName), fakeZip)
    const fakeHash = sha256File(path.join(output, plan.zipName))
    fs.writeFileSync(path.join(output, plan.sumsName), fakeHash + '  ' + plan.zipName + '\n')

    // A genuinely valid backup (lossy if deleted).
    const dist = path.join(tmp, 'dist')
    makeDist(dist)
    const real = path.join(tmp, 'real-output')
    await generateAssets(dist, real, false)
    const backup = path.join(tmp, 'release-output.backup-old')
    fs.renameSync(real, backup)

    fs.writeFileSync(
      journalPath(tmp),
      JSON.stringify(
        makeJournal({
          backupPath: 'release-output.backup-old',
          newSha256: {
            zip: fakeHash,
            sums: sha256File(path.join(output, plan.sumsName)),
          },
        }),
      ),
    )

    const result = await recoverTransaction(tmp, output, plan.zipName, plan.sumsName)
    expect(result.recovered).toBe(false)
    expect(result.reason).toMatch(/manual audit|failed/i)
    // Backup, journal and (bad) output all preserved.
    expect(fs.existsSync(backup)).toBe(true)
    expect(fs.existsSync(journalPath(tmp))).toBe(true)
    expect(fs.readFileSync(path.join(output, plan.zipName), 'utf8')).toBe('THIS IS NOT A ZIP')
  })

  it('A1b: COMMITTED + output + backup: valid output passes full reverify incl. journal hash, then cleanup', async () => {
    const tmp = makeTempDir()
    writePkg(tmp)
    const plan = buildReleasePlan('1.1.5')
    const dist = path.join(tmp, 'dist')
    makeDist(dist)
    const output = path.join(tmp, plan.outputDir)
    await generateAssets(dist, output, false)
    const oldZip = sha256File(path.join(output, plan.zipName))

    // Simulate interrupted --force: throw AFTER the commit point so the
    // generator leaves COMMITTED journal + old backup + verified new output.
    fs.writeFileSync(path.join(dist, 'assets', 'extra.js'), 'extra')
    const deps = {
      trace: [] as string[],
      failpoint: (n: string) => {
        deps.trace.push(n)
        if (n === 'backup.remove.before') throw new Error('INJECTED-POSTCOMMIT')
      },
    }
    let thrown: unknown = null
    try {
      await generateAssets(dist, output, true, undefined, deps)
    } catch (e) {
      thrown = e
    }
    expect(thrown).not.toBeNull()
    const newZip = sha256File(path.join(output, plan.zipName))
    expect(newZip).not.toBe(oldZip)
    const backups = fs.readdirSync(tmp).filter((e) => e.startsWith('release-output.backup'))
    expect(backups.length).toBe(1)

    const result = await recoverTransaction(tmp, output, plan.zipName, plan.sumsName)
    expect(result.recovered).toBe(true)
    expect(result.action).toBe('committed-cleanup')
    expect(fs.existsSync(path.join(output, plan.zipName))).toBe(true)
    expect(sha256File(path.join(output, plan.zipName))).toBe(newZip)
    expect(fs.readdirSync(tmp).filter((e) => e.startsWith('release-output.backup'))).toEqual([])
    expect(fs.existsSync(journalPath(tmp))).toBe(false)
  })

  it('A1c: COMMITTED journal with new-hash mismatch refuses and preserves everything', async () => {
    const tmp = makeTempDir()
    writePkg(tmp)
    const plan = buildReleasePlan('1.1.5')
    const dist = path.join(tmp, 'dist')
    makeDist(dist)
    const output = path.join(tmp, plan.outputDir)
    await generateAssets(dist, output, false)

    const backup = path.join(tmp, 'release-output.backup-x')
    fs.renameSync(output, backup)
    fs.mkdirSync(output)
    fs.copyFileSync(path.join(backup, plan.zipName), path.join(output, plan.zipName))
    fs.copyFileSync(path.join(backup, plan.sumsName), path.join(output, plan.sumsName))

    const realHash = sha256File(path.join(output, plan.zipName))
    fs.writeFileSync(
      journalPath(tmp),
      JSON.stringify(
        makeJournal({
          backupPath: 'release-output.backup-x',
          newSha256: { zip: 'f'.repeat(64), sums: sha256File(path.join(output, plan.sumsName)) },
        }),
      ),
    )
    expect(realHash).not.toBe('f'.repeat(64))

    const result = await recoverTransaction(tmp, output, plan.zipName, plan.sumsName)
    expect(result.recovered).toBe(false)
    expect(result.reason).toMatch(/manual audit|newSha256|hash/i)
    expect(fs.existsSync(backup)).toBe(true)
    expect(fs.existsSync(journalPath(tmp))).toBe(true)
  })

  it('A2: COMMITTED/BACKUP_CLEANED + output + no backup (first-publish journal.delete failure) recovers', async () => {
    const tmp = makeTempDir()
    writePkg(tmp)
    const plan = buildReleasePlan('1.1.5')
    const dist = path.join(tmp, 'dist')
    makeDist(dist)
    const output = path.join(tmp, plan.outputDir)

    // First publish interrupted at journal.delete -> BACKUP_CLEANED journal, no backup.
    let thrown: unknown = null
    try {
      await generateAssets(dist, output, false, undefined, {
        failpoint(name) {
          if (name === 'journal.delete') throw new Error('INJECTED-JOURNAL-DELETE')
        },
      })
    } catch (e) {
      thrown = e
    }
    expect(thrown).not.toBeNull()
    const committedZip = sha256File(path.join(output, plan.zipName))
    expect(fs.existsSync(journalPath(tmp))).toBe(true)
    expect(fs.readdirSync(tmp).filter((e) => e.startsWith('release-output.backup'))).toEqual([])

    const result = await recoverTransaction(tmp, output, plan.zipName, plan.sumsName)
    expect(result.recovered).toBe(true)
    expect(result.action).toBe('committed-no-backup-cleanup')
    expect(fs.existsSync(path.join(output, plan.zipName))).toBe(true)
    expect(sha256File(path.join(output, plan.zipName))).toBe(committedZip)
    expect(fs.existsSync(journalPath(tmp))).toBe(false)
  })

  it('A2b: committed, no backup, INVALID output refuses and keeps journal', async () => {
    const tmp = makeTempDir()
    writePkg(tmp)
    const plan = buildReleasePlan('1.1.5')
    const dist = path.join(tmp, 'dist')
    makeDist(dist)
    const output = path.join(tmp, plan.outputDir)
    await generateAssets(dist, output, false)

    const newHash = {
      zip: sha256File(path.join(output, plan.zipName)),
      sums: sha256File(path.join(output, plan.sumsName)),
    }
    fs.writeFileSync(
      journalPath(tmp),
      JSON.stringify(makeJournal({ state: 'BACKUP_CLEANED', newSha256: newHash })),
    )
    // Tamper the committed output AFTER the journal was written.
    fs.writeFileSync(path.join(output, plan.zipName), 'TAMPERED')

    const result = await recoverTransaction(tmp, output, plan.zipName, plan.sumsName)
    expect(result.recovered).toBe(false)
    expect(result.reason).toMatch(/manual audit|failed/i)
    expect(fs.existsSync(journalPath(tmp))).toBe(true)
    expect(fs.readFileSync(path.join(output, plan.zipName), 'utf8')).toBe('TAMPERED')
  })

  it('A3: PRE_COMMIT + no backup: hash-proven first-publish output is finalized', async () => {
    const tmp = makeTempDir()
    writePkg(tmp)
    const plan = buildReleasePlan('1.1.5')
    const dist = path.join(tmp, 'dist')
    makeDist(dist)
    const output = path.join(tmp, plan.outputDir)
    await generateAssets(dist, output, false)

    const newHash = {
      zip: sha256File(path.join(output, plan.zipName)),
      sums: sha256File(path.join(output, plan.sumsName)),
    }
    fs.writeFileSync(
      journalPath(tmp),
      JSON.stringify(makeJournal({ state: 'NEW_OUTPUT_VERIFIED', newSha256: newHash })),
    )

    const result = await recoverTransaction(tmp, output, plan.zipName, plan.sumsName)
    expect(result.recovered).toBe(true)
    expect(result.action).toBe('pre-commit-first-publish-finalize')
    expect(fs.existsSync(journalPath(tmp))).toBe(false)
    expect(fs.existsSync(path.join(output, plan.zipName))).toBe(true)
  })

  it('A3b: PRE_COMMIT + no backup with unproven output refuses (manual audit)', async () => {
    const tmp = makeTempDir()
    writePkg(tmp)
    const plan = buildReleasePlan('1.1.5')
    const dist = path.join(tmp, 'dist')
    makeDist(dist)
    const output = path.join(tmp, plan.outputDir)
    await generateAssets(dist, output, false)
    // Journal claims hashes that do NOT match the on-disk output.
    fs.writeFileSync(
      journalPath(tmp),
      JSON.stringify(
        makeJournal({
          state: 'NEW_OUTPUT_VERIFIED',
          newSha256: { zip: 'e'.repeat(64), sums: 'e'.repeat(64) },
        }),
      ),
    )
    const result = await recoverTransaction(tmp, output, plan.zipName, plan.sumsName)
    expect(result.recovered).toBe(false)
    expect(result.reason).toMatch(/manual audit|failed/i)
    expect(fs.existsSync(journalPath(tmp))).toBe(true)
    expect(fs.existsSync(path.join(output, plan.zipName))).toBe(true)
  })

  it('A4: PRE_COMMIT + backup: deep-validates backup, restores, re-verifies against oldSha256', async () => {
    const tmp = makeTempDir()
    writePkg(tmp)
    const plan = buildReleasePlan('1.1.5')
    const dist = path.join(tmp, 'dist')
    makeDist(dist)
    const output = path.join(tmp, plan.outputDir)
    await generateAssets(dist, output, false)
    const oldZipHash = sha256File(path.join(output, plan.zipName))
    const oldSumsHash = sha256File(path.join(output, plan.sumsName))

    const backup = path.join(tmp, 'release-output.backup-pre')
    fs.renameSync(output, backup)
    fs.mkdirSync(output)
    fs.writeFileSync(path.join(output, plan.zipName), 'UNVERIFIED-JUNK')
    fs.writeFileSync(path.join(output, plan.sumsName), 'junk')
    fs.writeFileSync(
      journalPath(tmp),
      JSON.stringify(
        makeJournal({
          state: 'OLD_OUTPUT_BACKED_UP',
          backupPath: 'release-output.backup-pre',
          oldSha256: { zip: oldZipHash, sums: oldSumsHash },
          newSha256: { zip: '0'.repeat(64), sums: '0'.repeat(64) },
        }),
      ),
    )

    const result = await recoverTransaction(tmp, output, plan.zipName, plan.sumsName)
    expect(result.recovered).toBe(true)
    expect(result.action).toBe('pre-commit-restore')
    expect(sha256File(path.join(output, plan.zipName))).toBe(oldZipHash)
    expect(sha256File(path.join(output, plan.sumsName))).toBe(oldSumsHash)
    expect(fs.existsSync(journalPath(tmp))).toBe(false)
  })

  it('A4b: PRE_COMMIT + corrupt backup refuses and keeps the last valid copy', async () => {
    const tmp = makeTempDir()
    writePkg(tmp)
    const plan = buildReleasePlan('1.1.5')
    const output = path.join(tmp, plan.outputDir)
    fs.mkdirSync(output)
    fs.writeFileSync(path.join(output, plan.zipName), 'UNVERIFIED-JUNK')
    fs.writeFileSync(path.join(output, plan.sumsName), 'junk')
    const backup = path.join(tmp, 'release-output.backup-bad')
    fs.mkdirSync(backup)
    fs.writeFileSync(path.join(backup, plan.zipName), 'NOT-A-ZIP')
    fs.writeFileSync(path.join(backup, plan.sumsName), 'garbage')
    fs.writeFileSync(
      journalPath(tmp),
      JSON.stringify(
        makeJournal({
          state: 'OLD_OUTPUT_BACKED_UP',
          backupPath: 'release-output.backup-bad',
          oldSha256: { zip: 'a'.repeat(64), sums: 'b'.repeat(64) },
          newSha256: { zip: '0'.repeat(64), sums: '0'.repeat(64) },
        }),
      ),
    )

    const result = await recoverTransaction(tmp, output, plan.zipName, plan.sumsName)
    expect(result.recovered).toBe(false)
    expect(fs.existsSync(backup)).toBe(true)
    expect(fs.existsSync(journalPath(tmp))).toBe(true)
    expect(fs.readFileSync(path.join(output, plan.zipName), 'utf8')).toBe('UNVERIFIED-JUNK')
  })

  it('journal backupPath must match the single actual backup on disk', async () => {
    const tmp = makeTempDir()
    writePkg(tmp)
    const plan = buildReleasePlan('1.1.5')
    const output = path.join(tmp, plan.outputDir)
    fs.mkdirSync(output)
    fs.writeFileSync(path.join(output, plan.zipName), 'junk')
    fs.writeFileSync(path.join(output, plan.sumsName), 'junk')
    fs.mkdirSync(path.join(tmp, 'release-output.backup-aaa'))
    fs.writeFileSync(
      journalPath(tmp),
      JSON.stringify(
        makeJournal({
          backupPath: 'release-output.backup-zzz', // does not exist
        }),
      ),
    )
    const result = await recoverTransaction(tmp, output, plan.zipName, plan.sumsName)
    expect(result.recovered).toBe(false)
    expect(result.reason).toMatch(/manual audit|backup/i)
    expect(fs.existsSync(path.join(tmp, 'release-output.backup-aaa'))).toBe(true)
  })

  it('journal absent with only a backup -> manual audit (no ownership proof)', async () => {
    const tmp = makeTempDir()
    writePkg(tmp)
    const plan = buildReleasePlan('1.1.5')
    const backup = path.join(tmp, 'release-output.backup-x')
    fs.mkdirSync(backup)
    fs.writeFileSync(path.join(backup, plan.zipName), 'data')
    fs.writeFileSync(path.join(backup, plan.sumsName), 'data')
    const result = await recoverTransaction(
      tmp,
      path.join(tmp, plan.outputDir),
      plan.zipName,
      plan.sumsName,
    )
    expect(result.recovered).toBe(false)
    expect(result.reason).toMatch(/journal|manual audit/i)
  })
})

// ---------------------------------------------------------------------------
// WP-B: journal binding + durability
// ---------------------------------------------------------------------------

describe('M28 WP-B journal binding', async () => {
  it('version must equal package.json version', async () => {
    const raw = JSON.stringify(makeJournal())
    expect(validateJournal(raw, '1.1.5').ok).toBe(true)
    expect(validateJournal(raw, '1.1.9').ok).toBe(false)
  })

  it('outputPath must be exactly the normalized release-output', async () => {
    for (const bad of ['./release-output', '/abs/release-output', 'release-output/', 'foo']) {
      expect(validateJournal(JSON.stringify(makeJournal({ outputPath: bad })), '1.1.5').ok).toBe(
        false,
      )
    }
    expect(
      validateJournal(JSON.stringify(makeJournal({ outputPath: 'release-output' })), '1.1.5').ok,
    ).toBe(true)
  })

  it('backupPath must be null or a safe single-segment name', async () => {
    for (const bad of [
      '../escape',
      'a/b',
      'a\\b',
      '',
      '.',
      '/abs',
      'release-output.backup-a/..',
      'release-output.backup-..',
      'release-output/backup-x',
    ]) {
      expect(validateJournal(JSON.stringify(makeJournal({ backupPath: bad })), '1.1.5').ok).toBe(
        false,
      )
    }
    expect(
      validateJournal(
        JSON.stringify(
          makeJournal({
            backupPath: 'release-output.backup-abc123',
            oldSha256: { zip: 'c'.repeat(64), sums: 'd'.repeat(64) },
          }),
        ),
        '1.1.5',
      ).ok,
    ).toBe(true)
  })

  it('oldSha256/newSha256 must be lowercase 64-hex', async () => {
    for (const bad of ['A'.repeat(64), 'a'.repeat(63), 'a'.repeat(65), 'nothex', '', 42, null]) {
      expect(
        validateJournal(
          JSON.stringify(makeJournal({ newSha256: { zip: bad, sums: 'b'.repeat(64) } })),
          '1.1.5',
        ).ok,
      ).toBe(false)
      expect(
        validateJournal(
          JSON.stringify(makeJournal({ newSha256: { zip: 'a'.repeat(64), sums: bad } })),
          '1.1.5',
        ).ok,
      ).toBe(false)
    }
    expect(
      validateJournal(
        JSON.stringify(
          makeJournal({
            oldSha256: { zip: 'c'.repeat(64), sums: 'd'.repeat(64) },
            backupPath: 'release-output.backup-x',
          }),
        ),
        '1.1.5',
      ).ok,
    ).toBe(true)
  })

  it('state/backupPath/oldSha256 field combos are consistent', async () => {
    // INIT with a backupPath is impossible.
    expect(
      validateJournal(
        JSON.stringify(
          makeJournal({
            state: 'INIT',
            backupPath: 'release-output.backup-x',
            oldSha256: { zip: 'c'.repeat(64), sums: 'd'.repeat(64) },
          }),
        ),
        '1.1.5',
      ).ok,
    ).toBe(false)
    // STAGING_VERIFIED cannot carry old hashes.
    expect(
      validateJournal(
        JSON.stringify(
          makeJournal({
            state: 'STAGING_VERIFIED',
            oldSha256: { zip: 'c'.repeat(64), sums: 'd'.repeat(64) },
            backupPath: null,
          }),
        ),
        '1.1.5',
      ).ok,
    ).toBe(false)
    // backupPath without oldSha256 is inconsistent.
    expect(
      validateJournal(
        JSON.stringify(makeJournal({ backupPath: 'release-output.backup-x', oldSha256: null })),
        '1.1.5',
      ).ok,
    ).toBe(false)
  })

  it('updatedAt must be strict ISO (toISOString shape)', async () => {
    for (const bad of ['yesterday', '2026-08-24', '2026-08-24T02:00:00Z', 123, '']) {
      expect(validateJournal(JSON.stringify(makeJournal({ updatedAt: bad })), '1.1.5').ok).toBe(
        false,
      )
    }
    expect(validateJournal(JSON.stringify(makeJournal()), '1.1.5').ok).toBe(true)
  })

  it('writeAllSync fails fast on zero/negative/NaN/non-integer/oversized returns', async () => {
    const fd = fs.openSync(path.join(makeTempDir(), 'w.bin'), 'w')
    for (const bad of [0, -1, NaN, 1.5, 1e9]) {
      expect(() =>
        writeAllSync(fd, Buffer.from('hello'), {
          writeSync: () => bad as unknown as number,
        }),
      ).toThrow(/no progress|writeSync/i)
    }
    fs.closeSync(fd)
  })

  it('writeAllSync completes a valid payload with short writes', async () => {
    const tmp = makeTempDir()
    const fd = fs.openSync(path.join(tmp, 'w.bin'), 'w')
    const payload = Buffer.from('abcdefghij')
    const sizes = [3, 3, 4]
    let i = 0
    writeAllSync(fd, payload, {
      writeSync: (_fd: number, buf: Uint8Array, offset?: number | null, length?: number | null) => {
        const n = sizes[i++] ?? 1
        fs.writeSync(fd, buf, offset ?? 0, Math.min(n, length ?? buf.byteLength))
        return Math.min(n, length ?? buf.byteLength)
      },
    })
    fs.closeSync(fd)
    expect(fs.readFileSync(path.join(tmp, 'w.bin'), 'utf8')).toBe('abcdefghij')
  })

  it('journal write failure fails fast, never promotes a partial journal, leaves no tmp residue', async () => {
    const tmp = makeTempDir()
    writePkg(tmp)
    const dist = path.join(tmp, 'dist')
    makeDist(dist)

    // Run the generator in a REAL child process with a controlled timeout:
    // writeSync()=>0 must fail fast, never spin forever (probe F reversal).
    const childScript = path.join(tmp, 'child.mjs')
    fs.writeFileSync(
      childScript,
      'import fs from "node:fs";\n' +
        'const mod = await import(' +
        JSON.stringify(MODULE_PATH) +
        ');\n' +
        'mod.generateAssets(' +
        JSON.stringify(dist) +
        ', ' +
        JSON.stringify(path.join(tmp, 'release-output')) +
        ', false, undefined, { writeSync: () => 0 });\n',
    )
    const res = spawnSync(process.execPath, [childScript], {
      encoding: 'utf8',
      timeout: 6000,
    })
    // A timeout/signal means the OLD zero-progress loop is still present.
    const errno = res.error ? (res.error as NodeJS.ErrnoException).code : undefined
    expect(res.signal ?? errno ?? 'NONE').not.toMatch(/SIGTERM|ETIMEDOUT/)
    expect(res.status).toBe(1)
    expect(String(res.stderr)).toMatch(/no progress|writeSync/i)
    expect(fs.existsSync(journalPath(tmp))).toBe(false)
    expect(
      fs.readdirSync(tmp).filter((e) => e.includes('.tmp-') || e.includes('transaction')),
    ).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// WP-D: SIGINT/SIGTERM lock lifecycle
// ---------------------------------------------------------------------------

describe('M28 WP-D signal/lock lifecycle', async () => {
  it('handleFatalSignal records termination but does NOT release the lock', async () => {
    const tmp = makeTempDir()
    const lock = acquireLock(tmp)
    const lines: string[] = []
    const code = handleFatalSignal('SIGINT', lock, {
      stderr: { write: (s: string) => lines.push(s) },
      exit: () => {},
    })
    expect(code).toBe(130)
    expect(lines.join('')).toMatch(/termination requested/i)
    // Lock is NOT released by the handler -- the unified finally does that
    // only after all writes have stopped.
    expect(fs.existsSync(path.join(tmp, '.release-staging.lock'))).toBe(true)
    lock.release()
    expect(fs.existsSync(path.join(tmp, '.release-staging.lock'))).toBe(false)
  })

  it('SIGTERM returns 143', async () => {
    const tmp = makeTempDir()
    const lock = acquireLock(tmp)
    const code = handleFatalSignal('SIGTERM', lock, {
      stderr: { write: () => {} },
      exit: () => {},
    })
    expect(code).toBe(143)
    lock.release()
  })

  it.each(['SIGINT', 'SIGTERM'] as const)(
    'real child: %s mid-generation -> signal exit code, lock held until exit, no lock released while writing',
    async (signal) => {
      const tmp = makeTempDir()
      writePkg(tmp)
      const dist = path.join(tmp, 'dist')
      makeDist(dist)

      // Slow python shim: sleeps so the parent can signal mid-stage, then
      // delegates to the real python3 so the generation can COMPLETE.
      const shim = path.join(tmp, 'slow-python3')
      fs.writeFileSync(shim, '#!/bin/sh\nsleep 2\nexec /usr/bin/env python3 "$@"\n')
      fs.chmodSync(shim, 0o755)

      const scriptPath = path.join(tmp, 'child.mjs')
      fs.writeFileSync(
        scriptPath,
        '\n        const mod = await import("file://' +
          MODULE_PATH +
          '");\n        const rc = await mod.runCli(["node", "prepare-release-assets.mjs", "--force"], {\n          repoRoot: ' +
          JSON.stringify(tmp) +
          ',\n          env: { ...process.env, PYTHON3: ' +
          JSON.stringify(shim) +
          ' },\n          stdout: { write: (s) => process.stdout.write(String(s)) },\n          stderr: { write: (s) => process.stderr.write(String(s)) },\n        });\n        process.exit(rc);\n      ',
      )

      const child = spawn(process.execPath, [scriptPath], {
        env: { ...process.env, PYTHON3: shim },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let out = ''
      let err = ''
      child.stdout.on('data', (d) => (out += String(d)))
      child.stderr.on('data', (d) => (err += String(d)))

      // Wait until the lock exists and the slow python is running.
      const lockPath = path.join(tmp, '.release-staging.lock')
      const deadline = Date.now() + 10000
      while (!fs.existsSync(lockPath) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 20))
      }
      expect(fs.existsSync(lockPath)).toBe(true)

      // A second generator MUST NOT be able to acquire the lock while the
      // first process is still alive.
      let secondBlocked = false
      try {
        acquireLock(tmp)
      } catch (e) {
        secondBlocked = /another release|in progress/i.test((e as Error).message)
      }
      expect(secondBlocked).toBe(true)

      // Signal the first process; it must NOT exit before the atomic stage
      // completes (lock stays held the whole time).
      child.kill(signal)
      const exitCode = await new Promise<number | null>((resolve) => {
        const timer = setTimeout(() => {
          child.kill('SIGKILL')
          resolve(-999)
        }, 8000)
        child.on('close', (code) => {
          clearTimeout(timer)
          resolve(code)
        })
      })
      const expectedCode = signal === 'SIGINT' ? 130 : 143
      expect(exitCode).toBe(expectedCode)
      // Lock released only after the process fully stopped.
      expect(fs.existsSync(lockPath)).toBe(false)
      // No success claim from runCli for the signaled run.
      expect(err).toMatch(/termination requested/i)
      expect(out).not.toMatch(/Transaction recovered successfully/i)
      // M29 WP-B: after a signal the final disk state must be EITHER a
      // verified committed output OR an explicitly recoverable PRE_COMMIT
      // state (journal-driven) -- never an indeterminate topology.
      const plan = buildReleasePlan('1.1.5')
      const committedOutput =
        fs.existsSync(path.join(tmp, plan.outputDir, plan.zipName)) &&
        fs.existsSync(path.join(tmp, plan.outputDir, plan.sumsName))
      const journalPresent = fs.existsSync(path.join(tmp, plan.journalFile))
      expect(committedOutput || journalPresent).toBe(true)
      if (journalPresent) {
        // The leftover journal must actually be recoverable (idempotent).
        const rec = await recoverTransaction(
          tmp,
          path.join(tmp, plan.outputDir),
          plan.zipName,
          plan.sumsName,
        )
        expect(rec.recovered).toBe(true)
      }
      // The lock is immediately acquirable after the first process stops.
      const retry = acquireLock(tmp)
      retry.release()
    },
    30000,
  )
})

// ---------------------------------------------------------------------------
// WP-F: CLI conflict rejection
// ---------------------------------------------------------------------------

describe('M28 WP-F CLI conflicts', async () => {
  function makeIo(repoRoot: string) {
    const out: string[] = []
    const err: string[] = []
    return {
      io: {
        repoRoot,
        env: { ...process.env },
        stdout: { write: (s: string | Uint8Array) => (out.push(String(s)), true) },
        stderr: { write: (s: string | Uint8Array) => (err.push(String(s)), true) },
      },
      out: () => out.join(''),
      err: () => err.join(''),
    }
  }

  it.each([
    ['--force --recover', ['--force', '--recover']],
    ['--recover --recover-lock', ['--recover', '--recover-lock']],
    ['--force --recover-lock', ['--force', '--recover-lock']],
    ['--force --recover --recover-lock', ['--force', '--recover', '--recover-lock']],
  ] as const)('conflict combo %s exits 2 before creating any lock', async (_name, args) => {
    const tmp = makeTempDir()
    writePkg(tmp)
    const { io, err } = makeIo(tmp)
    const rc = await runCli(['node', 'prepare-release-assets.mjs', ...args], io)
    expect(rc).toBe(2)
    expect(err()).toMatch(/mutually exclusive/i)
    expect(fs.existsSync(path.join(tmp, '.release-staging.lock'))).toBe(false)
  })

  it('unknown argument exits 2 before creating any lock', async () => {
    const tmp = makeTempDir()
    writePkg(tmp)
    const { io, err } = makeIo(tmp)
    const rc = await runCli(['node', 'prepare-release-assets.mjs', '--mystery'], io)
    expect(rc).toBe(2)
    expect(err()).toMatch(/--mystery/)
    expect(fs.existsSync(path.join(tmp, '.release-staging.lock'))).toBe(false)
  })
})
