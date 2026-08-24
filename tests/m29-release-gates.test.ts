// M29 release-durability gate tests (test-first).
//
// Written BEFORE the implementation: every test here is red against the
// M28/v1.1.9 baseline and must be green after the M29 fixes (WP-A..WP-G).
//
// Behavior tests only -- no source-string matching substitutes for the
// on-disk/child-process behavior being asserted.

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  SECURITY_TEST_FILES,
  validateSecurityReportFiles,
} from '../scripts/release-security-test-contract.mjs'
import { validateZipEntry } from '../scripts/release-artifact-contract.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const RUNNER_SOURCE = path.join(REPO_ROOT, 'scripts', 'run-release-security-tests.mjs')
const CONTRACT_FIXTURE = path.join(REPO_ROOT, 'tests', 'fixtures', 'zip-entry-contract.json')
const HELPER = path.join(REPO_ROOT, 'scripts', '_zip_helper.py')
const VERIFIER = path.join(REPO_ROOT, '.github', 'workflows', 'scripts', 'verify_release_zip.py')

const tempDirs: string[] = []
function makeTempDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'm29-gate-'))
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

function makeDist(dir: string): void {
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'index.html'), CSP_HTML)
  fs.writeFileSync(path.join(dir, 'assets', 'app.js'), 'console.log("m29")')
  fs.writeFileSync(path.join(dir, 'assets', 'app.css'), 'body{}')
}

function writePkg(tmp: string, version = '1.1.5'): void {
  fs.writeFileSync(
    path.join(tmp, 'package.json'),
    JSON.stringify({ name: 't', version, private: true }),
  )
}

// ---------------------------------------------------------------------------
// WP-A: complete zero-skip security gate (shared manifest + fail-closed)
// ---------------------------------------------------------------------------

describe('M29 WP-A security gate completeness', () => {
  it('A1: SECURITY_TEST_FILES lists all ten expected files and they exist on disk', () => {
    expect(SECURITY_TEST_FILES).toEqual([
      'tests/prepare-release-assets.test.ts',
      'tests/zip-helper-security.test.ts',
      'tests/m28-recovery.test.ts',
      'tests/run-release-security-tests.test.ts',
      'tests/m29-crash-matrix.test.ts',
      'tests/m29-release-gates.test.ts',
      'tests/m29-signal-protocol.test.ts',
      'tests/m30-signal-lifecycle.test.ts',
      'tests/m30-child-lifecycle.test.ts',
      'tests/m32-child-group-lifecycle.test.ts',
    ])
    for (const f of SECURITY_TEST_FILES) {
      expect(fs.existsSync(path.join(REPO_ROOT, f)), `missing contract file ${f}`).toBe(true)
    }
  })

  it('A2: validateSecurityReportFiles fails when a file is missing from the report', () => {
    const report = {
      testResults: [
        { name: 'tests/prepare-release-assets.test.ts' },
        { name: 'tests/zip-helper-security.test.ts' },
        { name: 'tests/m28-recovery.test.ts' },
        // run-release-security-tests.test.ts MISSING
      ],
    }
    const r = validateSecurityReportFiles(report)
    expect(r.ok).toBe(false)
    expect(r.missing).toContain('tests/run-release-security-tests.test.ts')
  })

  it('A3 (behavior): a fake vitest that did NOT run all four files must make the real runner exit nonzero', () => {
    const tmp = makeTempDir()
    fs.mkdirSync(path.join(tmp, 'scripts'), { recursive: true })
    fs.mkdirSync(path.join(tmp, 'node_modules', 'vitest'), { recursive: true })
    fs.mkdirSync(path.join(tmp, 'tests'), { recursive: true })
    fs.mkdirSync(path.join(tmp, 'tmp'), { recursive: true })
    fs.copyFileSync(RUNNER_SOURCE, path.join(tmp, 'scripts', 'run-release-security-tests.mjs'))
    fs.copyFileSync(
      path.join(REPO_ROOT, 'scripts', 'release-security-test-contract.mjs'),
      path.join(tmp, 'scripts', 'release-security-test-contract.mjs'),
    )
    // Only two of the four files exist in this fixture repo.
    fs.writeFileSync(path.join(tmp, 'tests', 'prepare-release-assets.test.ts'), '')
    fs.writeFileSync(path.join(tmp, 'tests', 'zip-helper-security.test.ts'), '')

    const fakeVitest = [
      "import fs from 'node:fs'",
      'const args = process.argv.slice(2);',
      "const outIdx = args.findIndex((a) => a.startsWith('--outputFile='));",
      "const out = outIdx >= 0 ? args[outIdx].slice('--outputFile='.length) : 'report.json';",
      'const report = { numTotalTests: 2, numPassedTests: 2, numFailedTests: 0, numSkippedTests: 0, numPendingTests: 0, numTodoTests: 0, testResults: [{ name: "tests/prepare-release-assets.test.ts", assertionResults: [{ fullName: "a", status: "passed" }] }, { name: "tests/zip-helper-security.test.ts", assertionResults: [{ fullName: "b", status: "passed" }] }] };',
      'fs.writeFileSync(out, JSON.stringify(report));',
      'process.exit(0);',
    ].join('\n')
    fs.writeFileSync(path.join(tmp, 'node_modules', 'vitest', 'vitest.mjs'), fakeVitest)

    const res = spawnSync(
      process.execPath,
      [path.join(tmp, 'scripts', 'run-release-security-tests.mjs')],
      {
        cwd: tmp,
        env: { ...process.env, TMPDIR: path.join(tmp, 'tmp'), TMP: path.join(tmp, 'tmp') },
        encoding: 'utf8',
        timeout: 20_000,
      },
    )
    // Gate MUST fail closed when the report lacks one of the four files.
    expect(res.status).not.toBe(0)
    expect(String(res.stderr)).toMatch(
      /m28-recovery|run-release-security-tests|missing|not executed/i,
    )
  })
})

// ---------------------------------------------------------------------------
// WP-C: directory durability fail-closed
// ---------------------------------------------------------------------------

describe('M29 WP-C directory durability', () => {
  it('C1: fsyncParentDirectorySync is exported', async () => {
    const mod = await import('../scripts/prepare-release-assets.mjs')
    expect(typeof mod.fsyncParentDirectorySync).toBe('function')
  })

  it('C2: EIO on parent-directory fsync must FAIL the generation and keep the journal', async () => {
    const tmp = makeTempDir()
    writePkg(tmp)
    makeDist(path.join(tmp, 'dist'))
    const mod = await import('../scripts/prepare-release-assets.mjs')
    const eio = new Error('INJECTED-EIO') as NodeJS.ErrnoException
    eio.code = 'EIO'
    let threw: unknown = null
    try {
      await mod.generateAssets(
        path.join(tmp, 'dist'),
        path.join(tmp, 'release-output'),
        false,
        undefined,
        {
          fsyncSync: (fd: number) => {
            const st = fs.fstatSync(fd)
            if (st.isDirectory()) throw eio
            return fs.fsyncSync(fd)
          },
        },
      )
    } catch (e) {
      threw = e
    }
    expect(threw).not.toBeNull()
    // The journal must be retained for recovery when durability is uncertain.
    expect(fs.existsSync(path.join(tmp, '.release-staging.transaction.json'))).toBe(true)
  })

  it('C3: ENOTSUP/EINVAL/EOPNOTSUPP are tolerated as platform-unsupported (documented note)', async () => {
    for (const code of ['EINVAL', 'ENOTSUP', 'EOPNOTSUPP']) {
      const tmp = makeTempDir()
      writePkg(tmp)
      makeDist(path.join(tmp, 'dist'))
      const mod = await import('../scripts/prepare-release-assets.mjs')
      const err = new Error('INJECTED-' + code) as NodeJS.ErrnoException
      err.code = code
      let result: unknown = null
      try {
        result = await mod.generateAssets(
          path.join(tmp, 'dist'),
          path.join(tmp, 'release-output'),
          false,
          undefined,
          {
            fsyncSync: (fd: number) => {
              const st = fs.fstatSync(fd)
              if (st.isDirectory()) throw err
              return fs.fsyncSync(fd)
            },
          },
        )
      } catch (e) {
        result = e
      }
      expect(result).not.toBeInstanceOf(Error)
      expect(
        fs.existsSync(path.join(tmp, 'release-output', 'pmbus-calculator-v1.1.5-web.zip')),
      ).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// WP-D: recovery validates hashes BEFORE any destructive mutation
// ---------------------------------------------------------------------------

describe('M29 WP-D recovery ordering and crash-consistent journal', () => {
  it('D1: PRE_COMMIT + backup whose hash mismatches journal.oldSha256 -> ZERO disk mutation', async () => {
    const tmp = makeTempDir()
    writePkg(tmp)
    makeDist(path.join(tmp, 'dist'))
    const mod = await import('../scripts/prepare-release-assets.mjs')
    // Real, valid old output -> becomes the backup.
    await mod.generateAssets(path.join(tmp, 'dist'), path.join(tmp, 'release-output'), false)
    const zipName = 'pmbus-calculator-v1.1.5-web.zip'
    const sumsName = 'SHA256SUMS.txt'
    const backup = path.join(tmp, 'release-output.backup-pre')
    fs.renameSync(path.join(tmp, 'release-output'), backup)
    // Unverified output exists (interrupted transaction).
    fs.mkdirSync(path.join(tmp, 'release-output'))
    fs.writeFileSync(path.join(tmp, 'release-output', zipName), 'UNVERIFIED-JUNK')
    fs.writeFileSync(path.join(tmp, 'release-output', sumsName), 'junk')

    const journal = {
      schema: 1,
      nonce: '11111111-2222-3333-4444-555555555555',
      version: '1.1.5',
      state: 'OLD_OUTPUT_BACKED_UP',
      outputPath: 'release-output',
      backupPath: 'release-output.backup-pre',
      oldSha256: { zip: 'f'.repeat(64), sums: 'e'.repeat(64) }, // MISMATCH
      newSha256: { zip: '0'.repeat(64), sums: '0'.repeat(64) },
      updatedAt: new Date().toISOString(),
    }
    fs.writeFileSync(
      path.join(tmp, '.release-staging.transaction.json'),
      JSON.stringify(journal, null, 2) + '\n',
    )

    let rmCalls = 0
    let renameCalls = 0
    let result: { recovered: boolean; reason?: string } | null = null
    try {
      result = await mod.recoverTransaction(
        tmp,
        path.join(tmp, 'release-output'),
        zipName,
        sumsName,
        {
          skipPythonVerifier: true,
          rmSync: (..._args: unknown[]) => {
            rmCalls++
            return fs.rmSync(...(_args as Parameters<typeof fs.rmSync>))
          },
          renameSync: (..._args: unknown[]) => {
            renameCalls++
            return fs.renameSync(...(_args as Parameters<typeof fs.renameSync>))
          },
        },
      )
    } catch {
      // recovery is expected to return a failure result, not throw
    }
    expect(result?.recovered).toBe(false)
    expect(result?.reason).toMatch(/hash|oldSha256|mismatch/i)
    expect(rmCalls).toBe(0)
    expect(renameCalls).toBe(0)
    expect(fs.existsSync(backup)).toBe(true)
    expect(fs.existsSync(path.join(tmp, 'release-output', zipName))).toBe(true)
    expect(fs.existsSync(path.join(tmp, '.release-staging.transaction.json'))).toBe(true)
    expect(fs.readFileSync(path.join(tmp, 'release-output', zipName), 'utf8')).toBe(
      'UNVERIFIED-JUNK',
    )
  })

  it('D2: OLD_OUTPUT_BACKUP_INTENT is a known journal state accepted by validateJournal', async () => {
    const mod = await import('../scripts/prepare-release-assets.mjs')
    const journal = {
      schema: 1,
      nonce: '11111111-2222-3333-4444-555555555555',
      version: '1.1.5',
      state: 'OLD_OUTPUT_BACKUP_INTENT',
      outputPath: 'release-output',
      backupPath: 'release-output.backup-x',
      oldSha256: { zip: 'c'.repeat(64), sums: 'd'.repeat(64) },
      newSha256: { zip: 'a'.repeat(64), sums: 'b'.repeat(64) },
      updatedAt: new Date().toISOString(),
    }
    const r = mod.validateJournal(JSON.stringify(journal), '1.1.5')
    expect(r.ok).toBe(true)
  })

  it('D3: STAGING_GENERATED journal with empty hashes is still valid (state-dependent)', async () => {
    const mod = await import('../scripts/prepare-release-assets.mjs')
    const journal = {
      schema: 1,
      nonce: '11111111-2222-3333-4444-555555555555',
      version: '1.1.5',
      state: 'STAGING_GENERATED',
      outputPath: 'release-output',
      backupPath: null,
      oldSha256: null,
      newSha256: { zip: '', sums: '' },
      updatedAt: new Date().toISOString(),
    }
    const r = mod.validateJournal(JSON.stringify(journal), '1.1.5')
    expect(r.ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// WP-E: unified ZIP entry contract
// ---------------------------------------------------------------------------

describe('M29 WP-E unified ZIP entry contract', () => {
  function helperVerdict(entry: string, dist: string): { allow: boolean; leftover: boolean } {
    const manifest = JSON.stringify({ entry, path: path.join(dist, 'index.html') }) + '\n'
    const out = path.join(makeTempDir(), 'out.zip')
    const res = spawnSync('python3', [HELPER, dist, out], {
      input: manifest,
      encoding: 'utf8',
      timeout: 15_000,
    })
    return { allow: res.status === 0, leftover: fs.existsSync(out) }
  }

  function verifierVerdict(entry: string): { allow: boolean } {
    const tmp = makeTempDir()
    const zipPath = path.join(tmp, 'v.zip')
    const py = [
      'import zipfile',
      `zip_path = ${JSON.stringify(zipPath)}`,
      `entry = ${JSON.stringify(entry)}`,
      `html = ${JSON.stringify(CSP_HTML)}`,
      'with zipfile.ZipFile(zip_path, "w") as zf:',
      '  zf.writestr("index.html", html)',
      '  zf.writestr("assets/app.js", "console.log(1)")',
      '  zf.writestr("assets/app.css", "body{}")',
      '  if entry != "index.html":',
      '    zf.writestr(entry, "x")',
      'with zipfile.ZipFile(zip_path) as zfr:',
      '  names = zfr.namelist()',
      '  if entry and entry != "index.html" and entry not in names:',
      '    raise SystemExit(1)  # zipfile could not faithfully represent the entry',
    ].join('\n')
    const build = path.join(tmp, 'build.py')
    fs.writeFileSync(build, py)
    const b = spawnSync('python3', [build], { encoding: 'utf8', timeout: 15_000 })
    if (b.status !== 0) {
      // zipfile refuses to represent the entry (e.g. empty name) -> reject
      return { allow: false }
    }
    const res = spawnSync('python3', [VERIFIER, zipPath], { encoding: 'utf8', timeout: 15_000 })
    return { allow: res.status === 0 }
  }

  it('E1: fixture file exists and declares the contract', () => {
    const fx = JSON.parse(fs.readFileSync(CONTRACT_FIXTURE, 'utf8'))
    expect(fx.legal.length).toBeGreaterThanOrEqual(4)
    expect(fx.illegal.length).toBeGreaterThanOrEqual(14)
  })

  it('E2: all three layers agree on every fixture entry', () => {
    const fx = JSON.parse(fs.readFileSync(CONTRACT_FIXTURE, 'utf8')) as {
      legal: string[]
      illegal: { entry: string }[]
    }
    const dist = makeTempDir()
    makeDist(dist)
    const rows: string[] = []
    for (const entry of fx.legal) {
      const js = validateZipEntry(entry)
      const h = helperVerdict(entry, dist)
      const v = verifierVerdict(entry)
      rows.push(`LEGAL ${JSON.stringify(entry)} js=${js.ok} helper=${h.allow} verifier=${v.allow}`)
      expect(js.ok, `JS must allow legal ${JSON.stringify(entry)}`).toBe(true)
      expect(h.allow, `helper must allow legal ${JSON.stringify(entry)}`).toBe(true)
      expect(v.allow, `verifier must allow legal ${JSON.stringify(entry)}`).toBe(true)
    }
    for (const { entry } of fx.illegal) {
      const js = validateZipEntry(entry)
      const h = helperVerdict(entry, dist)
      const v = verifierVerdict(entry)
      rows.push(
        `ILLEGAL ${JSON.stringify(entry)} js=${js.ok} helper=${h.allow} verifier=${v.allow}`,
      )
      expect(js.ok, `JS must reject ${JSON.stringify(entry)}`).toBe(false)
      expect(h.allow, `helper must reject ${JSON.stringify(entry)}`).toBe(false)
      expect(v.allow, `verifier must reject ${JSON.stringify(entry)}`).toBe(false)
    }
  }, 60_000)

  it('E3: Windows drive absolute/drive-relative and UNC are rejected by all three layers', () => {
    const dist = makeTempDir()
    makeDist(dist)
    for (const entry of [
      'C:/escape.txt',
      'C:\\escape.txt',
      'C:escape.txt',
      '//server/share/file.txt',
      '\\\\server\\share\\file.txt',
    ]) {
      expect(validateZipEntry(entry).ok, `JS must reject ${JSON.stringify(entry)}`).toBe(false)
      const h = helperVerdict(entry, dist)
      expect(h.allow, `helper must reject ${JSON.stringify(entry)}`).toBe(false)
      const v = verifierVerdict(entry)
      expect(v.allow, `verifier must reject ${JSON.stringify(entry)}`).toBe(false)
    }
  })

  it('E4: helper direct invocation leaves NO partial ZIP on rejection', () => {
    const dist = makeTempDir()
    makeDist(dist)
    for (const entry of ['../escape', 'C:/escape.txt', 'a\\b']) {
      const h = helperVerdict(entry, dist)
      expect(h.allow).toBe(false)
      expect(h.leftover).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// WP-G: documentation audit contract
// ---------------------------------------------------------------------------

describe('M29 WP-G documentation audit contract', () => {
  it('G1: ROADMAP M28 section marks the four over-claiming statements as M29 superseded', () => {
    const roadmap = fs.readFileSync(path.join(REPO_ROOT, 'docs', 'ROADMAP.md'), 'utf8')
    const m28Section = roadmap.slice(roadmap.indexOf('### M28 done'))
    expect(m28Section).toMatch(/M29/i)
    expect(m28Section).toMatch(/superseded|strengthened|strengthening/i)
    for (const claim of [
      '不得输出完整成功声明',
      'zero-skip',
      'journal durability',
      '完整自动恢复',
    ]) {
      expect(m28Section).toMatch(new RegExp(claim.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    }
  })

  it('G2: PR template records the M29 audit fields', () => {
    const tpl = fs.readFileSync(path.join(REPO_ROOT, '.github', 'pull_request_template.md'), 'utf8')
    for (const field of [
      'Base SHA',
      'Final head SHA',
      'push',
      'head_sha',
      'checked_tree',
      'merge SHA',
      'merge tree',
      'tree equality',
      'skipped',
      'todo',
      'residue',
      'signal',
      'crash matrix',
    ]) {
      expect(tpl, `PR template must mention ${field}`).toMatch(
        new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
      )
    }
  })
})
