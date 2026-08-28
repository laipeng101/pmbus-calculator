// Offline tests for scripts/release-assets-verify.mjs (v2.5.8).
//
// The v2.5.7 release race published a Release before its assets existed, so
// the release-published Pages run failed inside "Download release assets"
// (the jq asset selection exited 4 with no proof of which contract broke).
// The verifier is now the single readiness gate consumed by BOTH the real
// Pages workflow (before any download/deploy) and the release operator
// (against the draft, before publishing) — this file pins its exit codes,
// diagnostics and the workflow wiring so the script can never become a
// test-only implementation.
//
// Fixture matrix (per the v2.5.8 plan): empty assets; only SHA256SUMS; zip
// uploading / zero-byte; duplicate / wrong asset names; valid complete;
// draft / prerelease / tag mismatch. Checksum and zip-content failures are
// pinned by tests/zip-helper-security.test.ts and tests/release-assets.test.ts.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { afterEach, describe, expect, it } from 'vitest'

const SCRIPT = path.resolve(process.cwd(), 'scripts', 'release-assets-verify.mjs')
const TAG = 'v1.2.3'
const ZIP_NAME = `pmbus-calculator-${TAG}-web.zip`

const tmpDirs: string[] = []
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function writeFixture(release: unknown): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-assets-verify-'))
  tmpDirs.push(dir)
  const file = path.join(dir, 'release.json')
  fs.writeFileSync(file, typeof release === 'string' ? release : JSON.stringify(release))
  return file
}

function asset(name: string, overrides: Record<string, unknown> = {}) {
  return {
    name,
    state: 'uploaded',
    size: 1070107,
    browser_download_url: `https://github.com/owner/repo/releases/download/${TAG}/${name}`,
    ...overrides,
  }
}

function validRelease(overrides: Record<string, unknown> = {}) {
  return {
    tag_name: TAG,
    draft: false,
    prerelease: false,
    assets: [asset(ZIP_NAME), asset('SHA256SUMS.txt', { size: 165 })],
    ...overrides,
  }
}

interface RunResult {
  status: number
  stdout: string
  stderr: string
}

function runScript(file: string, extraArgs: string[] = []): RunResult {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, file, '--tag', TAG, ...extraArgs], {
      stdio: 'pipe',
      timeout: 10_000,
      encoding: 'utf8',
    })
    return { status: 0, stdout, stderr: '' }
  } catch (error) {
    const err = error as { status?: number; stdout?: string; stderr?: string }
    return {
      status: err.status ?? -1,
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? '',
    }
  }
}

describe('release-assets-verify: asset readiness matrix', () => {
  it('accepts a valid complete published release and resolves both assets', () => {
    const result = runScript(writeFixture(validRelease()))
    expect(result.status).toBe(0)
    expect(result.stdout).toContain(`zip_name=${ZIP_NAME}`)
    expect(result.stdout).toContain('zip_size=1070107')
    expect(result.stdout).toContain(
      `zip_url=https://github.com/owner/repo/releases/download/${TAG}/${ZIP_NAME}`,
    )
    expect(result.stdout).toContain('sums_name=SHA256SUMS.txt')
    expect(result.stdout).toContain('sums_size=165')
  })

  it('rejects an empty asset list with the dedicated code', () => {
    const result = runScript(writeFixture(validRelease({ assets: [] })))
    expect(result.status).toBe(4)
    expect(result.stderr).toContain('no assets at all')
  })

  it('rejects a release that only has SHA256SUMS (zip missing)', () => {
    const result = runScript(writeFixture(validRelease({ assets: [asset('SHA256SUMS.txt')] })))
    expect(result.status).toBe(6)
    expect(result.stderr).toContain(`"${ZIP_NAME}" is missing`)
  })

  it('rejects a zip that is still uploading (state != uploaded)', () => {
    const result = runScript(
      writeFixture(
        validRelease({ assets: [asset(ZIP_NAME, { state: 'starter' }), asset('SHA256SUMS.txt')] }),
      ),
    )
    expect(result.status).toBe(7)
    expect(result.stderr).toContain('state "starter", not "uploaded"')
  })

  it('rejects a zero-byte zip', () => {
    const result = runScript(
      writeFixture(
        validRelease({ assets: [asset(ZIP_NAME, { size: 0 }), asset('SHA256SUMS.txt')] }),
      ),
    )
    expect(result.status).toBe(8)
    expect(result.stderr).toContain('positive size')
  })

  it('rejects an asset with unknown (non-integer) size', () => {
    const result = runScript(
      writeFixture(
        validRelease({ assets: [asset(ZIP_NAME, { size: null }), asset('SHA256SUMS.txt')] }),
      ),
    )
    expect(result.status).toBe(8)
  })

  it('rejects duplicate asset names', () => {
    const result = runScript(
      writeFixture(
        validRelease({
          assets: [asset(ZIP_NAME), asset(ZIP_NAME, { size: 42 }), asset('SHA256SUMS.txt')],
        }),
      ),
    )
    expect(result.status).toBe(5)
    expect(result.stderr).toContain('appears 2 times')
  })

  it('rejects wrong asset names (only an unrelated zip is present)', () => {
    const result = runScript(
      writeFixture(
        validRelease({
          assets: [asset('pmbus-calculator-v9.9.9-web.zip'), asset('SHA256SUMS.txt')],
        }),
      ),
    )
    expect(result.status).toBe(6)
  })

  it('rejects an asset without a valid https download URL', () => {
    const result = runScript(
      writeFixture(
        validRelease({
          assets: [
            asset(ZIP_NAME, { browser_download_url: 'http://insecure.example/x' }),
            asset('SHA256SUMS.txt'),
          ],
        }),
      ),
    )
    expect(result.status).toBe(8)
  })
})

describe('release-assets-verify: release metadata contract', () => {
  it('rejects a draft release in published mode (the v2.5.7 race inverse)', () => {
    const result = runScript(writeFixture(validRelease({ draft: true })), ['--mode', 'published'])
    expect(result.status).toBe(3)
    expect(result.stderr).toContain('draft')
  })

  it('rejects a prerelease', () => {
    const result = runScript(writeFixture(validRelease({ prerelease: true })))
    expect(result.status).toBe(3)
    expect(result.stderr).toContain('prerelease')
  })

  it('rejects a tag mismatch', () => {
    const file = writeFixture(validRelease({ tag_name: 'v9.9.9' }))
    const result = runScript(file)
    expect(result.status).toBe(3)
    expect(result.stderr).toContain('tag mismatch')
  })

  it('draft mode accepts the draft and verifies the same asset contract', () => {
    const draft = validRelease({ draft: true })
    const ok = runScript(writeFixture(draft), ['--mode', 'draft'])
    expect(ok.status).toBe(0)

    const missingZip = runScript(writeFixture({ ...draft, assets: [asset('SHA256SUMS.txt')] }), [
      '--mode',
      'draft',
    ])
    expect(missingZip.status).toBe(6)
  })

  it('draft mode refuses a published release', () => {
    const result = runScript(writeFixture(validRelease()), ['--mode', 'draft'])
    expect(result.status).toBe(3)
    expect(result.stderr).toContain('not a draft')
  })
})

describe('release-assets-verify: usage and shape errors', () => {
  it('rejects invalid JSON with exit 2', () => {
    const result = runScript(writeFixture('{ not json'))
    expect(result.status).toBe(2)
  })

  it('rejects a release object without an assets array', () => {
    const result = runScript(writeFixture({ tag_name: TAG, draft: false, prerelease: false }))
    expect(result.status).toBe(2)
  })

  it('rejects a missing --tag or a non-stable tag', () => {
    const file = writeFixture(validRelease())
    const withoutTag = (() => {
      try {
        execFileSync(process.execPath, [SCRIPT, file], { stdio: 'pipe', timeout: 10_000 })
        return 0
      } catch (error) {
        return (error as { status?: number }).status ?? -1
      }
    })()
    expect(withoutTag).toBe(2)

    const result = runScript(file, ['--tag', 'not-semver'])
    expect(result.status).toBe(2)
  })
})

describe('release-assets-verify: the real Pages workflow consumes the script', () => {
  const workflowPath = path.resolve(process.cwd(), '.github', 'workflows', 'pages.yml')
  const workflow = fs.readFileSync(workflowPath, 'utf8')

  it('runs the verifier against the fetched release metadata before any download', () => {
    expect(workflow).toContain('release-assets-verify.mjs')
    // The verifier call must precede the asset download step.
    const verifyAt = workflow.indexOf('release-assets-verify.mjs')
    const downloadAt = workflow.indexOf('name: Download release assets')
    expect(verifyAt).toBeGreaterThan(-1)
    expect(downloadAt).toBeGreaterThan(verifyAt)
  })

  it('keeps metadata and download network calls bounded with connect/total timeouts', () => {
    for (const match of workflow.matchAll(/curl -[^\n]*\\$/gm)) {
      expect(
        match[0],
        `curl call must use --connect-timeout and --max-time: ${match[0]}`,
      ).toContain('--connect-timeout')
    }
    expect(workflow).toContain('--max-time')
  })

  it('does not wait with sleep for assets to become ready', () => {
    expect(workflow).not.toMatch(/^\s*sleep\s+\d/m)
  })

  it('verifies checksum and zip contract before extraction and deployment', () => {
    const order = [
      'name: Verify SHA-256 checksum',
      'name: Verify release zip before extraction',
      'name: Extract release assets to _site',
      'name: Configure Pages',
    ]
    const positions = order.map((step) => workflow.indexOf(step))
    expect(positions.every((p) => p > -1)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })

  it('downloads only the URLs the verifier resolved and checks sizes against metadata', () => {
    expect(workflow).toContain('source release-assets.env')
    expect(workflow).toContain('metadata size')
  })
})
