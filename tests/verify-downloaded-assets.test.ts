import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseSha256Sums, verifyDownloadedAssets } from '../scripts/verify-downloaded-assets.mjs'

/**
 * Offline fixtures for the v2.5.12 downloaded-asset byte gate: release
 * metadata + locally written assets in a temp dir. The zip-safety contract
 * is exercised against the REAL shared python verifier on real zip fixtures
 * (valid, traversal, source-map), matching the §8.2 requirement that the
 * existing ZIP safety contracts stay pinned by this gate's tests.
 */

const TAG = 'v1.2.3'
const REPO = 'owner/repo'
const ZIP_NAME = `pmbus-calculator-${TAG}-web.zip`
const SUMS_NAME = 'SHA256SUMS.txt'
const SCRIPT = path.resolve(process.cwd(), 'scripts', 'verify-downloaded-assets.mjs')
const VERIFY_ZIP_PY = path.resolve(
  process.cwd(),
  '.github',
  'workflows',
  'scripts',
  'verify_release_zip.py',
)

const INDEX_HTML = [
  '<!doctype html>',
  '<html><head>',
  "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'self'; script-src 'self'; style-src 'self'\">",
  '<link rel="stylesheet" href="assets/app.css">',
  '</head><body>',
  '<script type="module" src="assets/app.js"></script>',
  '</body></html>',
].join('\n')

/** Build a real zip via python zipfile with a Pages-like payload. */
function buildZip(zipPath: string, entryNames: string[] = ['assets/app.js', 'assets/app.css']) {
  const py = [
    'import sys, zipfile',
    'zip_path, index = sys.argv[1], sys.argv[2]',
    'entries = sys.argv[3:]',
    'with zipfile.ZipFile(zip_path, "w") as zf:',
    '    zf.writestr("index.html", index)',
    '    for name in entries:',
    '        zf.writestr(name, b"payload")',
  ].join('\n')
  execFileSync('python3', ['-c', py, zipPath, INDEX_HTML, ...entryNames])
}

function sha256File(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function writeSums(dir: string, zipDigest: string): void {
  fs.writeFileSync(path.join(dir, SUMS_NAME), `${zipDigest}  ${ZIP_NAME}\n`)
}

/** Published release metadata for the two expected local assets. */
function metadata(
  dir: string,
  overrides: {
    zip?: Partial<{ name: string; size: number; state: string; url: string }> | null
    sums?: Partial<{ name: string; size: number; state: string; url: string }> | null
    draft?: boolean
    extra?: unknown[]
  } = {},
): Record<string, unknown> {
  const urlFor = (name: string) =>
    `https://github.com/${REPO}/releases/download/${TAG}/${encodeURIComponent(name)}`
  const zip = {
    name: ZIP_NAME,
    size: fs.statSync(path.join(dir, ZIP_NAME)).size,
    state: 'uploaded',
    browser_download_url: urlFor(ZIP_NAME),
    ...overrides?.zip,
  }
  const sums = {
    name: SUMS_NAME,
    size: fs.statSync(path.join(dir, SUMS_NAME)).size,
    state: 'uploaded',
    browser_download_url: urlFor(SUMS_NAME),
    ...overrides?.sums,
  }
  const assets: unknown[] = []
  if (overrides?.zip !== null) assets.push(zip)
  if (overrides?.sums !== null) assets.push(sums)
  if (overrides?.extra) assets.push(...overrides.extra)
  return { tag_name: TAG, draft: overrides?.draft ?? false, prerelease: false, assets }
}

/** Fix metadata sizes after touching local files (size gate must pass). */
function refreshMetadataSizes(meta: Record<string, unknown>, dir: string): void {
  for (const asset of meta.assets as Array<{ name: string; size: number }>) {
    asset.size = fs.statSync(path.join(dir, asset.name)).size
  }
}

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function newDirWithValidAssets(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vda-'))
  dirs.push(dir)
  buildZip(path.join(dir, ZIP_NAME))
  writeSums(dir, sha256File(path.join(dir, ZIP_NAME)))
  return dir
}

const noopZipVerifier = (): void => {}
const realZipVerifier = (dir: string, zipName: string): void => {
  execFileSync('python3', [VERIFY_ZIP_PY, zipName], {
    cwd: dir,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

const verify = (
  dir: string,
  meta: Record<string, unknown>,
  mode: 'published' | 'draft' = 'published',
  zipVerifier: (dir: string, zipName: string) => void = noopZipVerifier,
): unknown =>
  verifyDownloadedAssets(meta, {
    metadataDir: dir,
    tag: TAG,
    repo: REPO,
    mode,
    zipVerifier,
  })

describe('verifyDownloadedAssets: happy paths (draft + published)', () => {
  it('accepts a complete published release with real zip-safety verification', () => {
    const dir = newDirWithValidAssets()
    const result = verify(dir, metadata(dir), 'published', realZipVerifier) as {
      zip: { sha256: string }
      sums: { sha256: string }
    }
    expect(result.zip.sha256).toBe(sha256File(path.join(dir, ZIP_NAME)))
    expect(result.sums.sha256).toBe(sha256File(path.join(dir, SUMS_NAME)))
  })

  it('accepts draft metadata with untagged placeholder URLs (operator gate)', () => {
    const dir = newDirWithValidAssets()
    const draft = metadata(dir, { draft: true })
    for (const asset of draft.assets as Array<{ browser_download_url: string }>) {
      asset.browser_download_url = asset.browser_download_url.replace(
        `download/${TAG}/`,
        'download/untagged-6e806fc504a5d9d879ec/',
      )
    }
    const result = verify(dir, draft, 'draft') as { mode: string }
    expect(result.mode).toBe('draft')
  })

  it('rejects untagged placeholder URLs in published mode (no relaxation)', () => {
    // Fabricated published metadata with placeholder URLs must fail the URL
    // contract — the draft tolerance never leaks into the published gate.
    const dir = newDirWithValidAssets()
    const fake = metadata(dir)
    for (const asset of fake.assets as Array<{ browser_download_url: string }>) {
      asset.browser_download_url = asset.browser_download_url.replace(
        `download/${TAG}/`,
        'download/untagged-6e806fc504a5d9d879ec/',
      )
    }
    expect(() => verify(dir, fake, 'published')).toThrowError(/untagged/)
  })
})

describe('verifyDownloadedAssets: local byte failure classes', () => {
  it('exit 10: a missing local asset fails with its own error class', () => {
    const dir = newDirWithValidAssets()
    const meta = metadata(dir) // snapshot sizes BEFORE removing the file
    fs.rmSync(path.join(dir, ZIP_NAME))
    expect(() => verify(dir, meta)).toThrowError(
      expect.objectContaining({ code: 10, message: expect.stringMatching(/is missing from/) }),
    )
  })

  it('exit 10: a symlink instead of a regular file is rejected', () => {
    const dir = newDirWithValidAssets()
    const meta = metadata(dir)
    const zipPath = path.join(dir, ZIP_NAME)
    fs.rmSync(zipPath)
    fs.symlinkSync(path.join(dir, SUMS_NAME), zipPath)
    expect(() => verify(dir, meta)).toThrowError(
      expect.objectContaining({ code: 10, message: expect.stringMatching(/not a regular file/) }),
    )
  })

  it('exit 11: a truncated local zip fails the size check', () => {
    const dir = newDirWithValidAssets()
    const meta = metadata(dir) // original size, so the SIZE gate rejects
    const zipPath = path.join(dir, ZIP_NAME)
    fs.writeFileSync(zipPath, fs.readFileSync(zipPath).subarray(0, 10))
    expect(() => verify(dir, meta)).toThrowError(
      expect.objectContaining({
        code: 11,
        message: expect.stringMatching(/local bytes but metadata says/),
      }),
    )
  })

  it('exit 13: tampered zip bytes fail the checksum against SHA256SUMS.txt', () => {
    const dir = newDirWithValidAssets()
    const zipPath = path.join(dir, ZIP_NAME)
    const bytes = fs.readFileSync(zipPath)
    bytes[bytes.length - 1] ^= 0xff
    fs.writeFileSync(zipPath, bytes)
    writeSums(dir, 'f'.repeat(64))
    const meta = metadata(dir)
    refreshMetadataSizes(meta, dir)
    ;(meta.assets as Array<{ name: string; size: number }>)[0].size = fs.statSync(zipPath).size
    expect(() => verify(dir, meta)).toThrowError(
      expect.objectContaining({ code: 13, message: expect.stringMatching(/sha256 mismatch/) }),
    )
  })

  it('exit 14: a zip with a ../ traversal entry fails the real python verifier', () => {
    const dir = newDirWithValidAssets()
    buildZip(path.join(dir, ZIP_NAME), ['assets/app.js', 'assets/app.css', '../evil.js'])
    writeSums(dir, sha256File(path.join(dir, ZIP_NAME)))
    const meta = metadata(dir)
    refreshMetadataSizes(meta, dir)
    expect(() => verify(dir, meta, 'published', realZipVerifier)).toThrowError(
      expect.objectContaining({
        code: 14,
        message: expect.stringMatching(/zip safety contract failed/),
      }),
    )
  })

  it('exit 14: a zip containing a source map entry fails the real python verifier', () => {
    const dir = newDirWithValidAssets()
    buildZip(path.join(dir, ZIP_NAME), ['assets/app.js', 'assets/app.css', 'assets/app.js.map'])
    writeSums(dir, sha256File(path.join(dir, ZIP_NAME)))
    const meta = metadata(dir)
    refreshMetadataSizes(meta, dir)
    expect(() => verify(dir, meta, 'published', realZipVerifier)).toThrowError(
      expect.objectContaining({ code: 14 }),
    )
  })
})

describe('verifyDownloadedAssets: metadata classes stay owned by the shared resolver', () => {
  it('exit 5: duplicate asset names in metadata keep the shared exit code', () => {
    const dir = newDirWithValidAssets()
    const meta = metadata(dir, { extra: [{ name: ZIP_NAME, size: 5, state: 'uploaded' }] })
    expect(() => verify(dir, meta)).toThrowError(expect.objectContaining({ code: 5 }))
  })

  it('exit 7: an upload still in progress (state starter) fails before local checks', () => {
    const dir = newDirWithValidAssets()
    const meta = metadata(dir, { sums: { state: 'starter' } })
    expect(() => verify(dir, meta)).toThrowError(
      expect.objectContaining({ code: 7, message: expect.stringMatching(/not "uploaded"/) }),
    )
  })

  it('exit 8: zero-size metadata fails the readiness contract', () => {
    const dir = newDirWithValidAssets()
    const meta = metadata(dir, { zip: { size: 0 } })
    expect(() => verify(dir, meta)).toThrowError(expect.objectContaining({ code: 8 }))
  })

  it('exit 3: a published-mode gate rejects draft metadata', () => {
    const dir = newDirWithValidAssets()
    const meta = metadata(dir, { draft: true })
    expect(() => verify(dir, meta, 'published')).toThrowError(
      expect.objectContaining({ code: 3, message: expect.stringMatching(/is a draft/) }),
    )
  })
})

describe('parseSha256Sums: strict sums contract', () => {
  const expected = { zipName: ZIP_NAME, sumsName: SUMS_NAME }

  it('accepts exactly one well-formed entry for the zip', () => {
    expect(parseSha256Sums(`${'a'.repeat(64)}  ${ZIP_NAME}\n`, expected)).toBe('a'.repeat(64))
  })

  it('exit 12: uppercase digests, bad separators, duplicates and unexpected names fail', () => {
    expect(() => parseSha256Sums(`${'A'.repeat(64)}  ${ZIP_NAME}\n`, expected)).toThrowError(
      expect.objectContaining({ code: 12 }),
    )
    expect(() => parseSha256Sums(`${'a'.repeat(64)} ${ZIP_NAME}\n`, expected)).toThrowError(
      expect.objectContaining({ code: 12 }),
    )
    expect(() =>
      parseSha256Sums(`${'a'.repeat(64)}  other.zip\n${'a'.repeat(64)}  ${ZIP_NAME}\n`, expected),
    ).toThrowError(
      expect.objectContaining({ code: 12, message: expect.stringMatching(/unexpected asset/) }),
    )
    expect(() =>
      parseSha256Sums(`${'a'.repeat(64)}  ${ZIP_NAME}\n${'b'.repeat(64)}  ${ZIP_NAME}\n`, expected),
    ).toThrowError(
      expect.objectContaining({ code: 12, message: expect.stringMatching(/more than once/) }),
    )
    expect(() => parseSha256Sums(`${'a'.repeat(64)}  ${SUMS_NAME}\n`, expected)).toThrowError(
      expect.objectContaining({ code: 12, message: expect.stringMatching(/lists itself/) }),
    )
    expect(() => parseSha256Sums('', expected)).toThrowError(
      expect.objectContaining({ code: 12, message: expect.stringMatching(/empty/) }),
    )
    // Defensive branch note: with the strict unknown-name rejection above,
    // a sums file that lists only foreign names hits "unexpected asset";
    // the "no entry for" throw stays as a defense-in-depth backstop.
  })
})

describe('verify-downloaded-assets CLI (spawned: real process.exit IO contract)', () => {
  function spawnCli(
    args: string[],
    env?: NodeJS.ProcessEnv,
  ): {
    status: number
    stdout: Buffer
    stderr: Buffer
  } {
    const result = spawnSync(process.execPath, [SCRIPT, ...args], {
      encoding: 'buffer',
      timeout: 20_000,
      env: env ? { ...process.env, ...env } : process.env,
    })
    return {
      status: result.status ?? -1,
      stdout: result.stdout ?? Buffer.alloc(0),
      stderr: result.stderr ?? Buffer.alloc(0),
    }
  }

  it('prints ONE JSON object on stdout and exits 0 on a verified download', () => {
    const dir = newDirWithValidAssets()
    const metaPath = path.join(dir, 'release.json')
    fs.writeFileSync(metaPath, JSON.stringify(metadata(dir)))
    const result = spawnCli([
      '--metadata',
      metaPath,
      '--dir',
      dir,
      '--tag',
      TAG,
      '--repo',
      REPO,
      '--mode',
      'published',
    ])
    expect(result.status, result.stderr.toString()).toBe(0)
    const parsed = JSON.parse(result.stdout.toString('utf8')) as {
      tag: string
      mode: string
      zip: { name: string; size: number; sha256: string }
      sums: { name: string; sha256: string }
    }
    expect(parsed.tag).toBe(TAG)
    expect(parsed.mode).toBe('published')
    expect(parsed.zip.name).toBe(ZIP_NAME)
    expect(parsed.zip.sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('maps a missing --dir to exit 2 without touching the metadata', () => {
    const dir = newDirWithValidAssets()
    const metaPath = path.join(dir, 'release.json')
    fs.writeFileSync(metaPath, JSON.stringify(metadata(dir)))
    const result = spawnCli(['--metadata', metaPath, '--tag', TAG, '--repo', REPO])
    expect(result.status).toBe(2)
    expect(result.stderr.toString()).toContain('--dir is required')
  })

  it('maps unreadable metadata JSON to exit 2', () => {
    const dir = newDirWithValidAssets()
    const metaPath = path.join(dir, 'broken.json')
    fs.writeFileSync(metaPath, '{ nope')
    const result = spawnCli(['--metadata', metaPath, '--dir', dir, '--tag', TAG, '--repo', REPO])
    expect(result.status).toBe(2)
    expect(result.stderr.toString()).toContain('cannot read/parse')
  })

  it('exits 14 with empty stdout when the zip-safety verifier fails (fail before deploy)', () => {
    const dir = newDirWithValidAssets()
    const metaPath = path.join(dir, 'release.json')
    fs.writeFileSync(metaPath, JSON.stringify(metadata(dir)))
    // A python3 stub that always fails simulates a zip-safety violation.
    const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'vda-py-'))
    dirs.push(fakeBin)
    const fakePython = path.join(fakeBin, 'python3')
    fs.writeFileSync(fakePython, '#!/bin/sh\necho "::error::simulated zip failure" >&2\nexit 1\n')
    fs.chmodSync(fakePython, 0o755)
    const result = spawnCli(['--metadata', metaPath, '--dir', dir, '--tag', TAG, '--repo', REPO], {
      PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
    })
    expect(result.status).toBe(14)
    expect(result.stdout).toEqual(Buffer.alloc(0))
    expect(result.stderr.toString()).toContain('zip safety contract failed')
  })
})
