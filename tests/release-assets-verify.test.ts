// Offline tests for scripts/release-assets-verify.mjs (v2.5.8; v2.5.9 data
// interface + URL contract).
//
// The v2.5.7 release race published a Release before its assets existed, so
// the release-published Pages run failed inside "Download release assets"
// (the jq asset selection exited 4 with no proof of which contract broke).
// The verifier is the single readiness gate consumed by BOTH the real
// Pages workflow (before any download/deploy) and the release operator
// (against the draft, before publishing) — this file pins its exit codes,
// diagnostics, the workflow wiring and the DATA-ONLY output contract so the
// script can never become a test-only implementation.
//
// v2.5.9: stdout is ONE JSON object and diagnostics live on stderr — the
// previous `key=value` stdout was consumed with `source` in the Pages
// workflow, which EXECUTED command substitutions embedded in metadata
// strings (the audit's harmless-offline-fixture sentinel below). URLs are
// validated with the URL parser against the canonical
// github.com/<repo>/releases/download contract, never a string prefix.
//
// Checksum and zip-content failures are pinned by
// tests/zip-helper-security.test.ts and tests/release-assets.test.ts;
// the downloader consumer is pinned by tests/download-release-assets.test.ts.

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { afterEach, describe, expect, it } from 'vitest'

const SCRIPT = path.resolve(process.cwd(), 'scripts', 'release-assets-verify.mjs')
const TAG = 'v1.2.3'
const REPO = 'owner/repo'
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
    browser_download_url: `https://github.com/${REPO}/releases/download/${TAG}/${name}`,
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
  const result = spawnSync(
    process.execPath,
    [SCRIPT, file, '--tag', TAG, '--repo', REPO, ...extraArgs],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10_000,
      encoding: 'utf8',
    },
  )
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

function parseOutput(stdout: string) {
  return JSON.parse(stdout) as {
    tag: string
    mode: string
    repo: string
    zip: { name: string; size: number; url: string }
    sums: { name: string; size: number; url: string }
  }
}

describe('release-assets-verify: asset readiness matrix', () => {
  it('accepts a valid complete published release and resolves both assets as JSON', () => {
    const result = runScript(writeFixture(validRelease()))
    expect(result.status).toBe(0)
    const parsed = parseOutput(result.stdout)
    expect(parsed.tag).toBe(TAG)
    expect(parsed.mode).toBe('published')
    expect(parsed.repo).toBe(REPO)
    expect(parsed.zip).toEqual({
      name: ZIP_NAME,
      size: 1070107,
      url: `https://github.com/${REPO}/releases/download/${TAG}/${ZIP_NAME}`,
    })
    expect(parsed.sums).toEqual({
      name: 'SHA256SUMS.txt',
      size: 165,
      url: `https://github.com/${REPO}/releases/download/${TAG}/SHA256SUMS.txt`,
    })
    // stdout is pure JSON — one document, no key=value shell assignments.
    expect(result.stdout.trim().startsWith('{')).toBe(true)
    expect(result.stdout).not.toMatch(/^\s*\w+=/m)
    expect(result.stderr).toContain('assets ready')
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
})

describe('release-assets-verify: URL contract (v2.5.9, exit 8)', () => {
  const cases: Array<[string, string]> = [
    ['plain http', 'http://github.com/owner/repo/releases/download/v1.2.3/x.zip'],
    ['wrong host', 'https://evil.example/owner/repo/releases/download/v1.2.3/x.zip'],
    ['host lookalike', 'https://github.com.evil.example/owner/repo/releases/download/v1.2.3/x.zip'],
    ['userinfo', 'https://user:pass@github.com/owner/repo/releases/download/v1.2.3/x.zip'],
    ['query string', `https://github.com/${REPO}/releases/download/${TAG}/${ZIP_NAME}?x=1`],
    ['fragment', `https://github.com/${REPO}/releases/download/${TAG}/${ZIP_NAME}#frag`],
    ['wrong repo path', `https://github.com/other/repo/releases/download/${TAG}/${ZIP_NAME}`],
    ['wrong tag path', `https://github.com/${REPO}/releases/download/v9.9.9/${ZIP_NAME}`],
    ['wrong name path', `https://github.com/${REPO}/releases/download/${TAG}/other.zip`],
    ['path escape', `https://github.com/${REPO}/releases/download/${TAG}/../${ZIP_NAME}`],
    ['encoded path segment', `https://github.com/${REPO}/releases/download/${TAG}/a%2Fb`],
    // The audit sentinel: a harmless offline fixture whose URL carries a
    // command substitution. It must be REJECTED as a non-canonical URL —
    // never stored, never executed.
    ['command substitution', 'https://example.invalid/$(printf PMBUS_AUDIT_SENTINEL)'],
    ['backticks', 'https://example.invalid/`id`'],
    ['semicolon chain', 'https://example.invalid/a;b'],
    ['newline injection', 'https://github.com/owner/repo/releases/download/v1.2.3/x.zip\nX=1'],
  ]

  for (const [label, url] of cases) {
    it(`rejects ${label}`, () => {
      const result = runScript(
        writeFixture(
          validRelease({
            assets: [asset(ZIP_NAME, { browser_download_url: url }), asset('SHA256SUMS.txt')],
          }),
        ),
      )
      expect(result.status, label).toBe(8)
      expect(result.stderr, label).toContain(ZIP_NAME)
    })
  }

  it('never emits the rejected URL on stdout', () => {
    const result = runScript(
      writeFixture(
        validRelease({
          assets: [
            asset(ZIP_NAME, {
              browser_download_url: 'https://example.invalid/$(printf PMBUS_AUDIT_SENTINEL)',
            }),
            asset('SHA256SUMS.txt'),
          ],
        }),
      ),
    )
    expect(result.status).toBe(8)
    expect(result.stdout).toBe('')
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
    const parsed = parseOutput(ok.stdout)
    expect(parsed.mode).toBe('draft')

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

  it('draft mode accepts GitHub placeholder-tag asset URLs (live REST behavior)', () => {
    // A draft Release's browser_download_url keeps an `untagged-<hex>` tag
    // segment until publish — observed against live REST metadata when the
    // v2.5.9 draft was verified. The operator's draft check must accept it;
    // repo/name still stay canonical.
    const draft = validRelease({
      draft: true,
      assets: [
        asset(ZIP_NAME, {
          browser_download_url: `https://github.com/${REPO}/releases/download/untagged-e2aca66cb8e41dc389e5/${ZIP_NAME}`,
        }),
        asset('SHA256SUMS.txt', {
          size: 165,
          browser_download_url: `https://github.com/${REPO}/releases/download/untagged-e2aca66cb8e41dc389e5/SHA256SUMS.txt`,
        }),
      ],
    })
    const ok = runScript(writeFixture(draft), ['--mode', 'draft'])
    expect(ok.status).toBe(0)
    const parsed = parseOutput(ok.stdout)
    expect(parsed.zip.url).toContain('/releases/download/untagged-e2aca66cb8e41dc389e5/')
  })

  it('published mode rejects the draft placeholder tag form (strict Pages gate)', () => {
    const result = runScript(
      writeFixture(
        validRelease({
          assets: [
            asset(ZIP_NAME, {
              browser_download_url: `https://github.com/${REPO}/releases/download/untagged-e2aca66cb8e41dc389e5/${ZIP_NAME}`,
            }),
            asset('SHA256SUMS.txt'),
          ],
        }),
      ),
    )
    expect(result.status).toBe(8)
    expect(result.stderr).toContain('canonical')
  })

  it('draft placeholder acceptance stays scoped to the expected repo and asset name', () => {
    const draftBase = { draft: true }
    const wrongRepo = validRelease({
      ...draftBase,
      assets: [
        asset(ZIP_NAME, {
          browser_download_url: `https://github.com/other/repo/releases/download/untagged-e2aca66cb8e41dc389e5/${ZIP_NAME}`,
        }),
        asset('SHA256SUMS.txt'),
      ],
    })
    expect(runScript(writeFixture(wrongRepo), ['--mode', 'draft']).status).toBe(8)

    const wrongName = validRelease({
      ...draftBase,
      assets: [
        asset(ZIP_NAME, {
          browser_download_url: `https://github.com/${REPO}/releases/download/untagged-e2aca66cb8e41dc389e5/other.zip`,
        }),
        asset('SHA256SUMS.txt'),
      ],
    })
    expect(runScript(writeFixture(wrongName), ['--mode', 'draft']).status).toBe(8)

    // The placeholder form is a segment shape, not a free wildcard: a
    // partially-untagged path (arbitrary junk) stays rejected.
    const junkTag = validRelease({
      ...draftBase,
      assets: [
        asset(ZIP_NAME, {
          browser_download_url: `https://github.com/${REPO}/releases/download/not-a-placeholder/${ZIP_NAME}`,
        }),
        asset('SHA256SUMS.txt'),
      ],
    })
    expect(runScript(writeFixture(junkTag), ['--mode', 'draft']).status).toBe(8)
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

  it('rejects a missing --repo, a malformed slug, or a non-stable tag', () => {
    const file = writeFixture(validRelease())
    const run = (args: string[]): number => {
      const result = spawnSync(process.execPath, [SCRIPT, file, ...args], {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 10_000,
      })
      return result.status ?? -1
    }
    expect(run(['--tag', TAG])).toBe(2)
    expect(run(['--tag', TAG, '--repo', 'owner'])).toBe(2)
    expect(run(['--tag', TAG, '--repo', 'owner/../repo'])).toBe(2)
    expect(run(['--tag', 'not-semver', '--repo', REPO])).toBe(2)
  })

  it('rejects unsafe --zip-name/--sums-name values (path or shell fragments)', () => {
    const file = writeFixture(validRelease())
    const slash = runScript(file, ['--zip-name', '../evil.zip'])
    expect(slash.status).toBe(2)
    const fragment = runScript(file, ['--zip-name', 'x.zip; rm -rf /'])
    expect(fragment.status).toBe(2)
    const sums = runScript(file, ['--sums-name', 'a$(id).txt'])
    expect(sums.status).toBe(2)
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

  it('keeps the metadata network call bounded with connect/total timeouts', () => {
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

  it('passes the expected repository to the verifier and validates the JSON output', () => {
    expect(workflow).toContain('--repo "${GITHUB_REPOSITORY}"')
    expect(workflow).toContain('> release-assets.json')
    expect(workflow).toContain("jq -e '.zip.url and .sums.url'")
  })

  it('downloads through the Node data consumer and never sources the verifier output', () => {
    expect(workflow).toContain('scripts/download-release-assets.mjs release-assets.json')
    // v2.5.9 regression pin: `source` executed command substitutions inside
    // metadata strings; the workflow must never re-interpret them as code.
    expect(workflow).not.toContain('source release-assets.env')
    expect(workflow).not.toContain('release-assets.env')
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
})
