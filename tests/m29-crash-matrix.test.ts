// M29 WP-D: crash matrix -- every transaction mutation boundary.
//
// For each named failpoint we simulate a PROCESS CRASH (child process calls
// process.exit inside the failpoint; no finally, no cleanup) and then check:
//   1. the on-disk journal is accepted by validateJournal (or the journal is
//      absent while the filesystem is a complete committed state);
//   2. --recover succeeds (or fails closed with a self-consistent topology);
//   3. a second recovery run is idempotent: it performs no further mutation;
//   4. no journal ever points at a non-existent backup after recovery.

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { buildReleasePlan } from '../scripts/release-artifact-contract.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MODULE_PATH = path.join(REPO_ROOT, 'scripts', 'prepare-release-assets.mjs')

const tempDirs: string[] = []
function makeTempDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'm29-crash-'))
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

const CSP_HTML =
  '<!DOCTYPE html><html><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'"><link rel="stylesheet" href="assets/app.css"><script src="assets/app.js"></script></html>'

function makeFixture(): string {
  const tmp = makeTempDir()
  fs.mkdirSync(path.join(tmp, 'dist', 'assets'), { recursive: true })
  fs.writeFileSync(path.join(tmp, 'dist', 'index.html'), CSP_HTML)
  fs.writeFileSync(path.join(tmp, 'dist', 'assets', 'app.js'), 'console.log("x")')
  fs.writeFileSync(path.join(tmp, 'dist', 'assets', 'app.css'), 'body{}')
  fs.writeFileSync(
    path.join(tmp, 'package.json'),
    JSON.stringify({ name: 't', version: '1.1.5', private: true }),
  )
  return tmp
}

/**
 * Run generateAssets in a child process that CRASHES (process.exit) when the
 * named failpoint fires. Returns the fixture tmp dir.
 */
function crashAt(tmp: string, failpointName: string, force: boolean): string {
  const childScript = path.join(tmp, 'crash-child.mjs')
  fs.writeFileSync(
    childScript,
    'const mod = await import(' +
      JSON.stringify('file://' + MODULE_PATH) +
      ');\n' +
      'mod.generateAssets(' +
      JSON.stringify(path.join(tmp, 'dist')) +
      ', ' +
      JSON.stringify(path.join(tmp, 'release-output')) +
      ', ' +
      String(force) +
      ', undefined, { failpoint: (n) => { if (n === ' +
      JSON.stringify(failpointName) +
      ') { process.exit(17); } } });\n',
  )
  const res = spawnSync(process.execPath, [childScript], {
    cwd: tmp,
    encoding: 'utf8',
    timeout: 30_000,
  })
  expect(res.status).toBe(17)
  return tmp
}

function diskSnapshot(tmp: string): string {
  const zipName = 'pmbus-calculator-v1.1.5-web.zip'
  const sumsName = 'SHA256SUMS.txt'
  const out = path.join(tmp, 'release-output')
  const journal = path.join(tmp, '.release-staging.transaction.json')
  const backups = fs.existsSync(tmp)
    ? fs.readdirSync(tmp).filter((e) => e.startsWith('release-output.backup'))
    : []
  return JSON.stringify({
    outZip: fs.existsSync(path.join(out, zipName)),
    outSums: fs.existsSync(path.join(out, sumsName)),
    journal: fs.existsSync(journal),
    backups,
    staging: fs.existsSync(path.join(tmp, '.release-staging')),
  })
}

describe('M29 WP-D crash matrix (force re-publish)', () => {
  const FORCE_FAILPOINTS = [
    'staging.checksum',
    'staging.zipverifier',
    'backup.intent.before',
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
  ]

  it.each(FORCE_FAILPOINTS)(
    'crash at %s -> journal valid or absent+committed, recover succeeds, second recover idempotent',
    async (failpointName) => {
      const tmp = makeFixture()
      // Seed a valid old output.
      const seed = path.join(tmp, 'seed.mjs')
      fs.writeFileSync(
        seed,
        'const mod = await import(' +
          JSON.stringify('file://' + MODULE_PATH) +
          ');\n' +
          'await mod.generateAssets(' +
          JSON.stringify(path.join(tmp, 'dist')) +
          ', ' +
          JSON.stringify(path.join(tmp, 'release-output')) +
          ', false);\n',
      )
      const seedRes = spawnSync(process.execPath, [seed], {
        cwd: tmp,
        encoding: 'utf8',
        timeout: 30_000,
      })
      expect(seedRes.status).toBe(0)

      fs.writeFileSync(path.join(tmp, 'dist', 'assets', 'extra.js'), 'extra')
      crashAt(tmp, failpointName, true)

      // 1. Journal must be parseable, OR absent while output is committed.
      const journalPath = path.join(tmp, '.release-staging.transaction.json')
      const mod = await import('../scripts/prepare-release-assets.mjs')
      if (fs.existsSync(journalPath)) {
        const v = mod.validateJournal(fs.readFileSync(journalPath, 'utf8'), '1.1.5')
        expect(
          v.ok,
          `journal after crash at ${failpointName} must be valid: ${v.ok ? '' : v.reason}`,
        ).toBe(true)
      } else {
        const committed =
          fs.existsSync(path.join(tmp, 'release-output', 'pmbus-calculator-v1.1.5-web.zip')) &&
          fs.existsSync(path.join(tmp, 'release-output', 'SHA256SUMS.txt'))
        expect(
          committed,
          `no journal after crash at ${failpointName} requires committed output`,
        ).toBe(true)
      }

      // 2. Recovery must succeed (crash points are all recoverable states).
      const plan = buildReleasePlan('1.1.5')
      const rec1 = await mod.recoverTransaction(
        tmp,
        path.join(tmp, 'release-output'),
        plan.zipName,
        plan.sumsName,
      )
      expect(rec1.recovered, `recover after crash at ${failpointName}: ${rec1.reason ?? ''}`).toBe(
        true,
      )

      // 3. Idempotent second recovery: no further disk mutation.
      const before2 = diskSnapshot(tmp)
      const rec2 = await mod.recoverTransaction(
        tmp,
        path.join(tmp, 'release-output'),
        plan.zipName,
        plan.sumsName,
      )
      expect(diskSnapshot(tmp)).toBe(before2)
      expect(rec2.recovered).toBe(false) // nothing left to do -> manual audit
      expect(rec2.reason).toMatch(/journal/i)

      // 4. No journal pointing at a non-existent backup.
      expect(fs.existsSync(journalPath)).toBe(false)
      const backups = fs.readdirSync(tmp).filter((e) => e.startsWith('release-output.backup'))
      expect(backups).toEqual([])
    },
    60_000,
  )
})

describe('M29 WP-D crash matrix (first publish)', () => {
  it('crash at staging.checksum (first publish) -> STAGING_GENERATED journal recoverable', async () => {
    const tmp = makeFixture()
    crashAt(tmp, 'staging.checksum', false)
    const mod = await import('../scripts/prepare-release-assets.mjs')
    const journalPath = path.join(tmp, '.release-staging.transaction.json')
    expect(fs.existsSync(journalPath)).toBe(true)
    const v = mod.validateJournal(fs.readFileSync(journalPath, 'utf8'), '1.1.5')
    expect(v.ok).toBe(true)
    if (v.ok) expect(v.journal.state).toBe('STAGING_GENERATED')
    const plan = buildReleasePlan('1.1.5')
    const rec1 = await mod.recoverTransaction(
      tmp,
      path.join(tmp, 'release-output'),
      plan.zipName,
      plan.sumsName,
    )
    expect(rec1.recovered).toBe(true)
    expect(rec1.action).toBe('pre-backup-abort')
    const before2 = diskSnapshot(tmp)
    const rec2 = await mod.recoverTransaction(
      tmp,
      path.join(tmp, 'release-output'),
      plan.zipName,
      plan.sumsName,
    )
    expect(diskSnapshot(tmp)).toBe(before2)
    expect(rec2.recovered).toBe(false)
  })
})
