// Offline tests for scripts/download-release-assets.mjs (v2.5.9).
//
// This is the REAL consumer the Pages workflow uses instead of the retired
// `source release-assets.env` (v2.5.9 boundary defect: sourcing shell
// assignments executed command substitutions embedded in metadata strings).
// The tests replace only the network boundary (fetchImpl stand-in) and pin:
//
// - success: both files written verbatim with the verified names/bytes;
// - size mismatch fails with the workflow's exit-9 contract BEFORE writing;
// - permanent HTTP errors fail fast, transient 5xx use the bounded retry
//   budget, network errors fail after it;
// - malformed verified metadata and non-canonical URLs are rejected (code 2)
//   — the consumer re-validates through scripts/release-url-contract.mjs;
// - URL strings reach the network layer VERBATIM as data arguments —
//   never parsed as commands, never re-composed into a shell string;
// - the CLI maps typed errors onto its documented exit codes (0/2/9/10)
//   without a network for the usage/JSON-error paths.

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadVerifiedAssets } from '../scripts/download-release-assets.mjs'

const TAG = 'v1.2.3'
const REPO = 'owner/repo'
const ZIP_NAME = `pmbus-calculator-${TAG}-web.zip`
const ZIP_URL = `https://github.com/${REPO}/releases/download/${TAG}/${ZIP_NAME}`
const SUMS_URL = `https://github.com/${REPO}/releases/download/${TAG}/SHA256SUMS.txt`

const tmpDirs: string[] = []
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function newOutDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-assets-download-'))
  tmpDirs.push(dir)
  return dir
}

function verified(overrides: Record<string, unknown> = {}) {
  return {
    tag: TAG,
    zip: { name: ZIP_NAME, size: 5, url: ZIP_URL },
    sums: { name: 'SHA256SUMS.txt', size: 3, url: SUMS_URL },
    ...overrides,
  }
}

/** Fake fetch that answers every URL with the same bytes. */
function okFetch(bytes: () => Uint8Array, calls: string[] = []): typeof fetch {
  return (async (url: string | URL | Request) => {
    calls.push(String(url instanceof Request ? url.url : url))
    return new Response(bytes(), { status: 200 })
  }) as unknown as typeof fetch
}

const ZIP_BYTES = new TextEncoder().encode('ZIP!!')
const SUMS_BYTES = new TextEncoder().encode('abc')

describe('downloadVerifiedAssets: success contract', () => {
  it('writes both files verbatim with the verified names and exact bytes', async () => {
    const outDir = newOutDir()
    const calls: string[] = []
    const bytesByUrl = new Map<string, Uint8Array>([
      [ZIP_URL, ZIP_BYTES],
      [SUMS_URL, SUMS_BYTES],
    ])
    const fetchImpl = (async (url: string | URL | Request) => {
      const key = String(url instanceof Request ? url.url : url)
      calls.push(key)
      return new Response(bytesByUrl.get(key), { status: 200 })
    }) as unknown as typeof fetch

    await downloadVerifiedAssets(verified(), { repo: REPO, outDir, fetchImpl })

    expect(calls).toEqual([ZIP_URL, SUMS_URL])
    expect(fs.readFileSync(path.join(outDir, ZIP_NAME))).toEqual(Buffer.from(ZIP_BYTES))
    expect(fs.readFileSync(path.join(outDir, 'SHA256SUMS.txt'))).toEqual(Buffer.from(SUMS_BYTES))
  })

  it('passes URL strings to the network layer verbatim as data arguments', async () => {
    // Boundary proof: the consumer hands the verified URL strings to the
    // network layer untouched — no shell, source or eval path exists. URLs
    // carrying shell-looking text can never reach here: the canonical-URL
    // contract and safe-basename names reject them upstream (pinned in
    // tests/release-assets-verify.test.ts and the code-2 case below).
    const outDir = newOutDir()
    const calls: string[] = []
    const fetchImpl = (async (url: string | URL | Request) => {
      calls.push(String(url instanceof Request ? url.url : url))
      return new Response(bytesByUrl.get(String(url instanceof Request ? url.url : url)), {
        status: 200,
      })
    }) as unknown as typeof fetch
    const bytesByUrl = new Map<string, Uint8Array>([
      [ZIP_URL, ZIP_BYTES],
      [SUMS_URL, SUMS_BYTES],
    ])

    await downloadVerifiedAssets(verified(), { repo: REPO, outDir, fetchImpl })

    expect(calls).toEqual([ZIP_URL, SUMS_URL])
  })
})

describe('downloadVerifiedAssets: failure contract', () => {
  it('fails with code 9 when the downloaded bytes do not match the verified size', async () => {
    const outDir = newOutDir()
    const fetchImpl = okFetch(() => new TextEncoder().encode('ZIP!short'))
    await expect(
      downloadVerifiedAssets(verified(), { repo: REPO, outDir, fetchImpl }),
    ).rejects.toMatchObject({ code: 9 })
    expect(fs.readdirSync(outDir)).toEqual([])
  })

  it('fails fast with code 10 on a permanent 4xx without retries', async () => {
    const outDir = newOutDir()
    let calls = 0
    const fetchImpl = (async () => {
      calls++
      return new Response('nope', { status: 404 })
    }) as unknown as typeof fetch
    await expect(
      downloadVerifiedAssets(verified(), { repo: REPO, outDir, fetchImpl }),
    ).rejects.toMatchObject({ code: 10, message: expect.stringContaining('HTTP 404') })
    expect(calls).toBe(1)
    expect(fs.readdirSync(outDir)).toEqual([])
  })

  it('uses the bounded retry budget for transient 5xx and can still succeed', async () => {
    const outDir = newOutDir()
    let zipCalls = 0
    const fetchImplByUrl = (async (url: string | URL | Request) => {
      const key = String(url instanceof Request ? url.url : url)
      if (key === ZIP_URL) {
        zipCalls++
        if (zipCalls < 3) return new Response('boom', { status: 503 })
        return new Response(ZIP_BYTES, { status: 200 })
      }
      return new Response(SUMS_BYTES, { status: 200 })
    }) as unknown as typeof fetch
    await downloadVerifiedAssets(verified(), {
      repo: REPO,
      outDir,
      fetchImpl: fetchImplByUrl,
      sleepImpl: () => Promise.resolve(),
    })
    expect(zipCalls).toBe(3)
    expect(fs.readFileSync(path.join(outDir, ZIP_NAME))).toEqual(Buffer.from(ZIP_BYTES))
  })

  it('retries HTTP 408 as a transient status', async () => {
    const outDir = newOutDir()
    let zipCalls = 0
    const fetchImplByUrl = (async (url: string | URL | Request) => {
      const key = String(url instanceof Request ? url.url : url)
      if (key === ZIP_URL) {
        zipCalls++
        if (zipCalls < 2) return new Response('timeout', { status: 408 })
        return new Response(ZIP_BYTES, { status: 200 })
      }
      return new Response(SUMS_BYTES, { status: 200 })
    }) as unknown as typeof fetch
    await downloadVerifiedAssets(verified(), {
      repo: REPO,
      outDir,
      fetchImpl: fetchImplByUrl,
      sleepImpl: () => Promise.resolve(),
    })
    expect(zipCalls).toBe(2)
    expect(fs.readFileSync(path.join(outDir, ZIP_NAME))).toEqual(Buffer.from(ZIP_BYTES))
  })

  it('fails with code 10 after the bounded retries when every attempt errors', async () => {
    const outDir = newOutDir()
    let calls = 0
    const fetchImpl = (async () => {
      calls++
      return new Response('boom', { status: 500 })
    }) as unknown as typeof fetch
    await expect(
      downloadVerifiedAssets(verified(), {
        repo: REPO,
        outDir,
        fetchImpl,
        sleepImpl: () => Promise.resolve(),
      }),
    ).rejects.toMatchObject({ code: 10 })
    expect(calls).toBe(3)
  })

  it('fails with code 10 when the network stand-in rejects', async () => {
    const outDir = newOutDir()
    const fetchImpl = (async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    await expect(
      downloadVerifiedAssets(verified(), { repo: REPO, outDir, fetchImpl }),
    ).rejects.toMatchObject({ code: 10 })
  })

  it('rejects malformed verified metadata with code 2 (missing sums entry)', async () => {
    const outDir = newOutDir()
    await expect(
      downloadVerifiedAssets(verified({ sums: undefined }), {
        repo: REPO,
        outDir,
        fetchImpl: okFetch(() => ZIP_BYTES),
      }),
    ).rejects.toMatchObject({ code: 2 })
  })

  it('rejects a non-canonical URL in the verified metadata with code 2', async () => {
    const outDir = newOutDir()
    await expect(
      downloadVerifiedAssets(
        verified({
          zip: {
            name: ZIP_NAME,
            size: 5,
            url: 'https://example.invalid/$(printf PMBUS_AUDIT_SENTINEL)',
          },
        }),
        { repo: REPO, outDir, fetchImpl: okFetch(() => ZIP_BYTES) },
      ),
    ).rejects.toMatchObject({ code: 2 })
    expect(fs.readdirSync(outDir)).toEqual([])
  })

  it('rejects an unsafe asset name with code 2 (no path or shell fragments)', async () => {
    const outDir = newOutDir()
    await expect(
      downloadVerifiedAssets(verified({ zip: { name: '../evil.zip', size: 5, url: ZIP_URL } }), {
        repo: REPO,
        outDir,
        fetchImpl: okFetch(() => ZIP_BYTES),
      }),
    ).rejects.toMatchObject({ code: 2 })
  })
})

describe('downloadVerifiedAssets: cumulative deadline contract (v2.5.10)', () => {
  /** Fake fetch that hangs until its AbortSignal fires, then rejects. */
  function hangingFetch(): typeof fetch {
    return (async (_url: string | URL | Request, init?: RequestInit) => {
      return new Promise<never>((_, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError')),
        )
      })
    }) as unknown as typeof fetch
  }

  const realSleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

  it('cuts off a hung request at the remaining-budget signal (per-attempt deadline)', async () => {
    const outDir = newOutDir()
    await expect(
      downloadVerifiedAssets(verified(), {
        repo: REPO,
        outDir,
        fetchImpl: hangingFetch(),
        budgetMs: 150,
      }),
    ).rejects.toMatchObject({
      code: 10,
      message: expect.stringContaining('deadline exhausted'),
    })
    expect(fs.readdirSync(outDir)).toEqual([])
  })

  it('shares one budget across both assets: a slow first asset exhausts the deadline', async () => {
    const outDir = newOutDir()
    const slowThenHanging = (async (url: string | URL | Request, init?: RequestInit) => {
      const key = String(url instanceof Request ? url.url : url)
      if (key === ZIP_URL) {
        await realSleep(100)
        return new Response(ZIP_BYTES, { status: 200 })
      }
      return hangingFetch()(url, init)
    }) as unknown as typeof fetch
    await expect(
      downloadVerifiedAssets(verified(), {
        repo: REPO,
        outDir,
        fetchImpl: slowThenHanging,
        budgetMs: 200,
      }),
    ).rejects.toMatchObject({
      code: 10,
      message: expect.stringContaining('deadline exhausted'),
    })
    // The first asset was fully downloaded, but nothing may be written when
    // the operation fails — no partial release inputs.
    expect(fs.readdirSync(outDir)).toEqual([])
  }, 10_000)

  it('never grants a fresh timeout per attempt: consumed budget stays consumed', async () => {
    const outDir = newOutDir()
    let fakeNow = 0
    let calls = 0
    // Each fetch attempt burns 4 of the 5 fake-budget minutes, then 503s.
    const fetchImpl = (async () => {
      calls++
      fakeNow += 240_000
      return new Response('boom', { status: 503 })
    }) as unknown as typeof fetch
    await expect(
      downloadVerifiedAssets(verified(), {
        repo: REPO,
        outDir,
        fetchImpl,
        budgetMs: 300_000,
        nowImpl: () => fakeNow,
        sleepImpl: (ms) => {
          fakeNow += ms
          return Promise.resolve()
        },
      }),
    ).rejects.toMatchObject({
      code: 10,
      message: expect.stringContaining('deadline exhausted'),
    })
    // Attempt 3 never happened: with a per-attempt fresh timeout it would
    // have received a new full budget, but the shared deadline was already
    // gone after two 4-minute attempts.
    expect(calls).toBe(2)
    expect(fs.readdirSync(outDir)).toEqual([])
  })
})

describe('downloadVerifiedAssets: bounded network-rejection backoff (v2.5.11)', () => {
  /** Fetch stand-in: rejects the first N calls with a plain network error,
   * then answers every URL with its verified bytes. */
  function rejectingFetch(rejectTimes: number, calls: string[] = []): typeof fetch {
    const bytesByUrl = new Map<string, Uint8Array>([
      [ZIP_URL, ZIP_BYTES],
      [SUMS_URL, SUMS_BYTES],
    ])
    return (async (url: string | URL | Request) => {
      const key = String(url instanceof Request ? url.url : url)
      calls.push(key)
      if (calls.length <= rejectTimes) throw new TypeError('fetch failed')
      return new Response(bytesByUrl.get(key), { status: 200 })
    }) as unknown as typeof fetch
  }

  it('backs off once after a network rejection and succeeds on the next attempt', async () => {
    const outDir = newOutDir()
    const calls: string[] = []
    const sleeps: number[] = []
    await downloadVerifiedAssets(verified(), {
      repo: REPO,
      outDir,
      fetchImpl: rejectingFetch(1, calls),
      nowImpl: () => 0,
      sleepImpl: (ms) => {
        sleeps.push(ms)
        return Promise.resolve()
      },
    })
    expect(calls).toEqual([ZIP_URL, ZIP_URL, SUMS_URL])
    // Full budget remains: the backoff is the configured 2000ms, not 0.
    expect(sleeps).toEqual([2_000])
    expect(fs.readFileSync(path.join(outDir, ZIP_NAME))).toEqual(Buffer.from(ZIP_BYTES))
  })

  it('fails after three rejections with exactly two backoffs (bounded attempts)', async () => {
    const outDir = newOutDir()
    const calls: string[] = []
    const sleeps: number[] = []
    await expect(
      downloadVerifiedAssets(verified(), {
        repo: REPO,
        outDir,
        fetchImpl: rejectingFetch(99, calls),
        nowImpl: () => 0,
        sleepImpl: (ms) => {
          sleeps.push(ms)
          return Promise.resolve()
        },
      }),
    ).rejects.toMatchObject({
      code: 10,
      message: expect.stringContaining('download failed after 3 attempts'),
    })
    expect(calls).toEqual([ZIP_URL, ZIP_URL, ZIP_URL])
    expect(sleeps).toEqual([2_000, 2_000])
    expect(fs.readdirSync(outDir)).toEqual([])
  })

  it('clamps the backoff to the remaining budget and never starts an out-of-budget request', async () => {
    const outDir = newOutDir()
    let fakeNow = 0
    let calls = 0
    const sleeps: number[] = []
    await expect(
      downloadVerifiedAssets(verified(), {
        repo: REPO,
        outDir,
        fetchImpl: (async () => {
          calls++
          throw new TypeError('fetch failed')
        }) as unknown as typeof fetch,
        budgetMs: 300,
        nowImpl: () => fakeNow,
        sleepImpl: (ms) => {
          fakeNow += ms
          sleeps.push(ms)
          return Promise.resolve()
        },
      }),
    ).rejects.toMatchObject({
      code: 10,
      message: expect.stringContaining('deadline exhausted'),
    })
    // The rejection backoff slept only the remaining 300ms; attempt 2 then
    // saw an empty budget and never started.
    expect(sleeps).toEqual([300])
    expect(calls).toBe(1)
    expect(fs.readdirSync(outDir)).toEqual([])
  })

  it('never retries a shared-deadline abort (TimeoutError)', async () => {
    const outDir = newOutDir()
    let calls = 0
    const sleeps: number[] = []
    await expect(
      downloadVerifiedAssets(verified(), {
        repo: REPO,
        outDir,
        fetchImpl: (async () => {
          calls++
          throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
        }) as unknown as typeof fetch,
        nowImpl: () => 0,
        sleepImpl: (ms) => {
          sleeps.push(ms)
          return Promise.resolve()
        },
      }),
    ).rejects.toMatchObject({
      code: 10,
      message: expect.stringContaining('deadline exhausted'),
    })
    expect(calls).toBe(1)
    expect(sleeps).toEqual([])
    expect(fs.readdirSync(outDir)).toEqual([])
  })

  it('keeps permanent 4xx fail-fast with zero backoff', async () => {
    const outDir = newOutDir()
    const sleeps: number[] = []
    for (const status of [400, 401, 403, 404]) {
      let calls = 0
      await expect(
        downloadVerifiedAssets(verified(), {
          repo: REPO,
          outDir,
          fetchImpl: (async () => {
            calls++
            return new Response('nope', { status })
          }) as unknown as typeof fetch,
          nowImpl: () => 0,
          sleepImpl: (ms) => {
            sleeps.push(ms)
            return Promise.resolve()
          },
        }),
      ).rejects.toMatchObject({ code: 10, message: expect.stringContaining(`HTTP ${status}`) })
      expect(calls, `status ${status}`).toBe(1)
    }
    expect(sleeps).toEqual([])
  })

  it('keeps tokens, auth headers and signed query strings out of diagnostics', async () => {
    const outDir = newOutDir()
    let caught: string | undefined
    await downloadVerifiedAssets(verified(), {
      repo: REPO,
      outDir,
      fetchImpl: (async () => {
        throw new TypeError('fetch failed')
      }) as unknown as typeof fetch,
    }).catch((error: Error) => {
      caught = `${error.name}: ${error.message}`
    })
    // The failure chain only ever carries the verified canonical URL and the
    // transport error text — no credential-shaped fragment may appear.
    expect(caught).toContain('download failed after 3 attempts')
    for (const fragment of ['token', 'Authorization', 'sig=', 'Bearer']) {
      expect(caught, fragment).not.toContain(fragment)
    }
  })

  it('distinguishes transient HTTP, network rejection and backoff in stderr logs', async () => {
    const outDir = newOutDir()
    const logs: string[] = []
    const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args) => {
      logs.push(args.map(String).join(' '))
    })
    try {
      // ZIP: 503 transient, then success. SUMS: three network rejections.
      let zipCalls = 0
      let sumsCalls = 0
      const fetchImpl = (async (url: string | URL | Request) => {
        const key = String(url instanceof Request ? url.url : url)
        if (key === ZIP_URL) {
          zipCalls++
          if (zipCalls === 1) return new Response('boom', { status: 503 })
          return new Response(ZIP_BYTES, { status: 200 })
        }
        sumsCalls++
        throw new TypeError('fetch failed')
      }) as unknown as typeof fetch
      await expect(
        downloadVerifiedAssets(verified(), {
          repo: REPO,
          outDir,
          fetchImpl,
          nowImpl: () => 0,
          sleepImpl: () => Promise.resolve(),
        }),
      ).rejects.toMatchObject({ code: 10 })
      expect(zipCalls).toBe(2)
      expect(sumsCalls).toBe(3)
      expect(logs.some((l) => l.includes('transient HTTP 503'))).toBe(true)
      expect(logs.some((l) => l.includes('network rejection'))).toBe(true)
      expect(logs.some((l) => l.includes('backing off'))).toBe(true)
    } finally {
      errorSpy.mockRestore()
    }
  })
})

describe('download-release-assets CLI: usage and error mapping (offline paths)', () => {
  const SCRIPT = path.resolve(process.cwd(), 'scripts', 'download-release-assets.mjs')

  function runCli(args: string[]): { status: number; stderr: string } {
    const result = spawnSync(process.execPath, [SCRIPT, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10_000,
      encoding: 'buffer',
    })
    return {
      status: result.status ?? -1,
      stderr: (result.stderr ?? Buffer.alloc(0)).toString('utf8'),
    }
  }

  it('maps a missing --repo to exit 2', () => {
    const dir = newOutDir()
    const file = path.join(dir, 'verified.json')
    fs.writeFileSync(file, JSON.stringify(verified()))
    const result = runCli([file])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('--repo')
  })

  it('maps unreadable/invalid verified JSON to exit 2', () => {
    const dir = newOutDir()
    const file = path.join(dir, 'broken.json')
    fs.writeFileSync(file, '{ not json')
    const result = runCli([file, '--repo', REPO])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('cannot read/parse')
  })

  it('maps an incomplete verified object to exit 2 without any network call', () => {
    const dir = newOutDir()
    const file = path.join(dir, 'verified.json')
    fs.writeFileSync(file, JSON.stringify(verified({ zip: { name: ZIP_NAME } })))
    const result = runCli([file, '--repo', REPO])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('incomplete')
  })

  it('rejects unknown options with exit 2', () => {
    const result = runCli(['whatever.json', '--repo', REPO, '--curl-flag'])
    expect(result.status).toBe(2)
  })
})
