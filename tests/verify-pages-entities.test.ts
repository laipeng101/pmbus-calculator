// Post-deploy Pages entity full-manifest verifier contract
// (scripts/verify-pages-entities.mjs).
//
// The gate dynamically enumerates the FULL manifest from the verified,
// extracted `_site` tree and requires every live entity to match it. These
// tests run the REAL CLI via an async spawn (the fixture server lives in this
// same process; a blocking spawnSync would starve its event loop) against
// local node:http fixture servers:
//   positive — a fixture tree served byte-identical → exit 0, with the
//     manifest size derived at runtime from the fixture tree, never a
//     hard-coded constant;
//   negative — 404, 200 HTML fallback, content flip, truncation,
//     non-identity Content-Encoding, cross-origin redirect, unreachable
//     origin, per-request timeout and shared deadline exhaustion each fail
//     with their own exit code and a classified stderr diagnostic;
//   contract — unsafe relative paths, missing/empty/non-directory site,
//     credentialed/queried base URLs and argv violations fail closed.
//
// The fixture tree is a real directory of files; the manifest size assertion
// is derived from that tree (countFiles), so adding or removing a fixture
// file never changes a test constant.

import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { gzipSync } from 'node:zlib'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { afterAll, describe, expect, it } from 'vitest'
import { isSafeRelativePath } from '../scripts/verify-pages-entities.mjs'

const SCRIPT = path.resolve(process.cwd(), 'scripts', 'verify-pages-entities.mjs')

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-pages-entities-'))
const tempDirs: string[] = []
const servers: Server[] = []

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(tempRoot, 'case-'))
  tempDirs.push(dir)
  return dir
}

/** Deterministic pseudo-random-but-stable bytes for fixtures. */
function deterministicBytes(size: number, seedTick: number): Buffer {
  const bytes = Buffer.allocUnsafe(size)
  let state = 0x9e3779b9 ^ seedTick
  for (let i = 0; i < size; i++) {
    state = (state * 1664525 + 1013904223) >>> 0
    bytes[i] = state & 0xff
  }
  return bytes
}

function writeTree(siteDir: string, files: Record<string, string | Buffer>): void {
  for (const [relative, content] of Object.entries(files)) {
    const full = path.join(siteDir, relative)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content)
  }
}

/** Count regular files under a directory — the dynamic manifest expectation. */
function countFiles(dir: string): number {
  let count = 0
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) count += countFiles(full)
    else if (entry.isFile()) count += 1
  }
  return count
}

interface FixtureServerOptions {
  /** Map of request path (relative to base) to a canned response override. */
  overrides?: Record<
    string,
    {
      status?: number
      body?: string | Buffer
      headers?: Record<string, string>
      /** Never respond (simulates a hang). */
      hang?: boolean
      /** Delay before responding, in ms. */
      delayMs?: number
      /** Respond with a redirect instead of a body. */
      redirectTo?: string
    }
  >
  /** Serve the site tree's real bytes for any other path. */
  serveSite?: boolean
}

interface FixtureServer {
  url: string
  close: () => Promise<void>
}

/**
 * Start a Pages-like fixture server rooted at /base/. Requests under /base/
 * are served from the site tree byte-identical; overrides let a test
 * substitute one path with a failure response.
 */
function startFixtureServer(
  siteDir: string,
  options: FixtureServerOptions = {},
): Promise<FixtureServer> {
  const { overrides = {}, serveSite = true } = options
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (url.pathname.startsWith('/base/')) {
      const relative = decodeURIComponent(url.pathname.slice('/base/'.length))
      const override = overrides[relative]
      if (override !== undefined) {
        if (override.hang === true) return
        if (override.delayMs !== undefined && override.delayMs > 0) {
          setTimeout(() => finish(override), override.delayMs)
          return
        }
        if (override.redirectTo !== undefined) {
          res.writeHead(override.status ?? 302, { Location: override.redirectTo })
          res.end()
          return
        }
        finish(override)
        return
      }
      if (serveSite) {
        const full = path.join(siteDir, relative)
        if (fs.existsSync(full) && fs.statSync(full).isFile()) {
          const body = fs.readFileSync(full)
          res.writeHead(200, { 'Content-Type': contentTypeFor(relative) })
          res.end(body)
          return
        }
      }
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('not found')
      return
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('not found')

    function finish(override: NonNullable<FixtureServerOptions['overrides']>[string]): void {
      const body = Buffer.from(override.body ?? '')
      res.writeHead(override.status ?? 200, {
        'Content-Type': override.headers?.['Content-Type'] ?? 'application/octet-stream',
        ...(override.headers ?? {}),
      })
      res.end(body)
    }
  })
  servers.push(server)
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        throw new Error('fixture server did not bind a port')
      }
      resolve({
        url: `http://127.0.0.1:${address.port}/base/`,
        close: () =>
          new Promise((done) => {
            server.closeAllConnections()
            server.close(() => done())
          }),
      })
    })
  })
}

function contentTypeFor(relative: string): string {
  if (relative.endsWith('.html')) return 'text/html; charset=utf-8'
  if (relative.endsWith('.js')) return 'text/javascript'
  if (relative.endsWith('.css')) return 'text/css'
  if (relative.endsWith('.woff2')) return 'font/woff2'
  return 'application/octet-stream'
}

interface CliResult {
  status: number | null
  stdout: string
  stderr: string
}

/**
 * Run the REAL CLI asynchronously so this process's event loop stays free and
 * the in-process fixture server can answer the child's requests (spawnSync
 * would deadlock the sweep). A generous safety timeout guards CI hangs.
 */
function runCliAsync(args: string[]): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT, ...args])
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', reject)
    child.on('close', (code) => resolve({ status: code, stdout, stderr }))
  })
}

/** Synchronous variant — only for LOCAL (no-network) contract checks where
 * no in-process server must serve the child. */
function runCliSync(args: string[]): CliResult {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' })
  return {
    status: result.status,
    stdout: String(result.stdout ?? ''),
    stderr: String(result.stderr ?? ''),
  }
}

function parseReport(stdout: string): {
  manifest: { count: number; bytes: number }
  okCount: number
  failures: number
  firstFailure: { path: string; class: number; category: string } | null
} {
  return JSON.parse(stdout) as {
    manifest: { count: number; bytes: number }
    okCount: number
    failures: number
    firstFailure: { path: string; class: number; category: string } | null
  }
}

afterAll(async () => {
  for (const server of servers) {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve())).catch(() => undefined)
  }
  fs.rmSync(tempRoot, { recursive: true, force: true })
})

describe('verify-pages-entities positive sweep', () => {
  it('verifies every fixture-tree entity byte-identical to the live origin', async () => {
    const siteDir = makeTempDir()
    writeTree(siteDir, {
      'index.html': '<!doctype html><html><body>PMBus</body></html>',
      'assets/app.js': deterministicBytes(2048, 11),
      'assets/app.css': deterministicBytes(512, 12),
      'assets/font.woff2': deterministicBytes(1024, 13),
    })
    const server = await startFixtureServer(siteDir)

    const result = await runCliAsync(['--site', siteDir, '--base-url', server.url])
    expect(result.status).toBe(0)

    const report = parseReport(result.stdout)
    // The expected manifest size is DERIVED from the fixture tree — adding or
    // removing a fixture file changes no test constant.
    expect(report.manifest.count).toBe(countFiles(siteDir))
    expect(report.manifest.bytes).toBeGreaterThan(0)
    expect(report.okCount).toBe(report.manifest.count)
    expect(report.failures).toBe(0)
    expect(report.firstFailure).toBeNull()
    expect(result.stderr).toContain(`ok: ${report.manifest.count}/${report.manifest.count}`)
    await server.close()
  })

  it('sends identity/no-cache headers and the caller-provided cache-busting query', async () => {
    const siteDir = makeTempDir()
    const indexBody = '<!doctype html><html><body>x</body></html>'
    writeTree(siteDir, { 'index.html': indexBody })
    const seenRequests: {
      pathname: string
      query: string
      acceptEncoding: string | null
      cacheControl: string | null
    }[] = []
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      seenRequests.push({
        pathname: url.pathname,
        query: url.search,
        acceptEncoding: req.headers['accept-encoding'] ?? null,
        cacheControl: req.headers['cache-control'] ?? null,
      })
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(indexBody)
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('no port')
    const baseUrl = `http://127.0.0.1:${address.port}/base/`

    const result = await runCliAsync([
      '--site',
      siteDir,
      '--base-url',
      baseUrl,
      '--query',
      'run-12345',
    ])
    expect(result.status).toBe(0)
    expect(seenRequests.length).toBe(1)
    expect(seenRequests[0].pathname).toBe('/base/index.html')
    expect(seenRequests[0].query).toBe('?cb=run-12345')
    expect(seenRequests[0].acceptEncoding).toBe('identity')
    expect(seenRequests[0].cacheControl).toBe('no-cache')
    // The cache-busting token never leaks into data or diagnostics.
    expect(result.stdout).not.toContain('run-12345')
    expect(result.stderr).not.toContain('run-12345')
  })

  it('accepts a same-origin redirect that lands on the identical entity bytes', async () => {
    const siteDir = makeTempDir()
    writeTree(siteDir, {
      'index.html': '<!doctype html><html><body>PMBus</body></html>',
      'assets/app.js': deterministicBytes(1024, 21),
      'legacy.js': deterministicBytes(1024, 21),
    })
    const server = await startFixtureServer(siteDir, {
      overrides: {
        'legacy.js': { status: 302, redirectTo: '/base/assets/app.js' },
      },
    })

    const result = await runCliAsync(['--site', siteDir, '--base-url', server.url])
    expect(result.status).toBe(0)
    const report = parseReport(result.stdout)
    expect(report.okCount).toBe(report.manifest.count)
    await server.close()
  })
})

describe('verify-pages-entities failure classes', () => {
  it('fails a 404 with the status class', async () => {
    const siteDir = makeTempDir()
    writeTree(siteDir, {
      'index.html': '<!doctype html><html><body>x</body></html>',
      'missing.js': 'x',
    })
    const server = await startFixtureServer(siteDir, {
      overrides: { 'missing.js': { status: 404, body: 'not found' } },
    })

    const result = await runCliAsync(['--site', siteDir, '--base-url', server.url])
    expect(result.status).toBe(21)
    const report = parseReport(result.stdout)
    expect(report.failures).toBe(1)
    expect(report.firstFailure?.path).toBe('missing.js')
    expect(report.firstFailure?.class).toBe(21)
    expect(report.firstFailure?.category).toBe('status')
    expect(result.stderr).toContain('HTTP 404')
    await server.close()
  })

  it('fails a 200 text/html fallback for a non-index entity with the fallback class', async () => {
    const siteDir = makeTempDir()
    writeTree(siteDir, {
      'index.html': '<!doctype html><html><body>x</body></html>',
      'assets/app.js': deterministicBytes(1024, 22),
    })
    const server = await startFixtureServer(siteDir, {
      overrides: {
        'assets/app.js': {
          status: 200,
          body: '<!doctype html><html><body>SPA fallback</body></html>',
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        },
      },
    })

    const result = await runCliAsync(['--site', siteDir, '--base-url', server.url])
    expect(result.status).toBe(25)
    expect(result.stderr).toContain('200 text/html fallback')
    expect(result.stderr).toContain('assets/app.js')
    const report = parseReport(result.stdout)
    expect(report.firstFailure?.category).toBe('fallback')
    await server.close()
  })

  it('fails a byte-flipped entity with the hash class', async () => {
    const siteDir = makeTempDir()
    const original = deterministicBytes(1024, 23)
    const flipped = Buffer.from(original)
    flipped[500] = original[500] ^ 0xff
    writeTree(siteDir, {
      'index.html': '<!doctype html><html><body>x</body></html>',
      'assets/app.js': original,
    })
    const server = await startFixtureServer(siteDir, {
      overrides: {
        'assets/app.js': {
          status: 200,
          body: flipped,
          headers: { 'Content-Type': 'text/javascript' },
        },
      },
    })

    const result = await runCliAsync(['--site', siteDir, '--base-url', server.url])
    expect(result.status).toBe(27)
    expect(result.stderr).toContain('sha256')
    const report = parseReport(result.stdout)
    expect(report.firstFailure?.category).toBe('hash')
    await server.close()
  })

  it('fails a truncated entity with the length class', async () => {
    const siteDir = makeTempDir()
    writeTree(siteDir, {
      'index.html': '<!doctype html><html><body>x</body></html>',
      'assets/app.js': deterministicBytes(1024, 24),
    })
    const server = await startFixtureServer(siteDir, {
      overrides: {
        'assets/app.js': {
          status: 200,
          body: deterministicBytes(512, 24),
          headers: { 'Content-Type': 'text/javascript' },
        },
      },
    })

    const result = await runCliAsync(['--site', siteDir, '--base-url', server.url])
    expect(result.status).toBe(26)
    expect(result.stderr).toContain('length')
    const report = parseReport(result.stdout)
    expect(report.firstFailure?.category).toBe('length')
    await server.close()
  })

  it('fails a non-identity Content-Encoding with the content-encoding class', async () => {
    const siteDir = makeTempDir()
    const bytes = deterministicBytes(1024, 25)
    writeTree(siteDir, {
      'index.html': '<!doctype html><html><body>x</body></html>',
      'assets/app.js': bytes,
    })
    const server = await startFixtureServer(siteDir, {
      overrides: {
        'assets/app.js': {
          status: 200,
          body: gzipSync(bytes),
          headers: { 'Content-Type': 'text/javascript', 'Content-Encoding': 'gzip' },
        },
      },
    })

    const result = await runCliAsync(['--site', siteDir, '--base-url', server.url])
    expect(result.status).toBe(24)
    expect(result.stderr).toContain('Content-Encoding')
    expect(result.stderr).toContain('gzip')
    const report = parseReport(result.stdout)
    expect(report.firstFailure?.category).toBe('content-encoding')
    await server.close()
  })

  it('fails a cross-origin redirect landing with the origin class', async () => {
    const siteDir = makeTempDir()
    writeTree(siteDir, {
      'index.html': '<!doctype html><html><body>x</body></html>',
      'leaks.js': 'x',
    })
    const other = await startFixtureServer(siteDir, { serveSite: false })
    const otherOrigin = new URL(other.url).origin + '/'
    const server = await startFixtureServer(siteDir, {
      overrides: { 'leaks.js': { status: 302, redirectTo: otherOrigin } },
    })

    const result = await runCliAsync(['--site', siteDir, '--base-url', server.url])
    expect(result.status).toBe(23)
    expect(result.stderr).toContain('left the Pages origin')
    const report = parseReport(result.stdout)
    expect(report.firstFailure?.category).toBe('origin')
    await server.close()
    await other.close()
  })

  it('fails an unreachable origin with the network class', async () => {
    const siteDir = makeTempDir()
    writeTree(siteDir, { 'index.html': '<!doctype html><html><body>x</body></html>' })

    // Port 9 is discard: nothing listens there.
    const result = await runCliAsync(['--site', siteDir, '--base-url', 'http://127.0.0.1:9/base/'])
    expect(result.status).toBe(20)
    expect(result.stderr).toContain('network error')
    const report = parseReport(result.stdout)
    expect(report.firstFailure?.category).toBe('network')
  })

  it('fails a hanging request with the per-request timeout class', async () => {
    const siteDir = makeTempDir()
    writeTree(siteDir, {
      'index.html': '<!doctype html><html><body>x</body></html>',
      'assets/slow.js': deterministicBytes(64, 26),
    })
    const server = await startFixtureServer(siteDir, {
      overrides: { 'assets/slow.js': { hang: true } },
    })

    const result = await runCliAsync([
      '--site',
      siteDir,
      '--base-url',
      server.url,
      '--request-timeout-ms',
      '250',
    ])
    expect(result.status).toBe(28)
    expect(result.stderr).toContain('per-request timeout')
    expect(result.stderr).toContain('assets/slow.js')
    const report = parseReport(result.stdout)
    expect(report.firstFailure?.category).toBe('timeout')
    await server.close()
  })

  it('fails with the deadline class when the shared total deadline is exhausted', async () => {
    const siteDir = makeTempDir()
    writeTree(siteDir, {
      'index.html': '<!doctype html><html><body>x</body></html>',
      'assets/slow.js': deterministicBytes(64, 27),
    })
    const server = await startFixtureServer(siteDir, {
      overrides: { 'assets/slow.js': { delayMs: 5_000 } },
    })

    const result = await runCliAsync([
      '--site',
      siteDir,
      '--base-url',
      server.url,
      '--deadline-ms',
      '300',
      '--request-timeout-ms',
      '10000',
    ])
    expect(result.status).toBe(29)
    expect(result.stderr).toContain('deadline')
    const report = parseReport(result.stdout)
    expect(report.firstFailure?.category).toBe('deadline')
    await server.close()
  })
})

describe('verify-pages-entities local contract', () => {
  it('rejects unsafe relative paths and accepts safe ones (unit check)', () => {
    for (const bad of [
      '',
      '.',
      '..',
      '../x',
      '/x',
      '//x',
      'a/../../x',
      'a\\b',
      'a#b',
      'a?b',
      'http://evil/x',
      'x:y',
    ]) {
      expect(isSafeRelativePath(bad), `expected unsafe: ${JSON.stringify(bad)}`).toBe(false)
    }
    for (const good of ['index.html', 'assets/app.js', 'deep/nested/file.png', 'a-b_c.d']) {
      expect(isSafeRelativePath(good), `expected safe: ${JSON.stringify(good)}`).toBe(true)
    }
  })

  it('rejects a missing, empty or non-directory site with the manifest class', () => {
    const siteDir = makeTempDir()
    writeTree(siteDir, { 'index.html': '<!doctype html><html><body>x</body></html>' })

    const missing = runCliSync([
      '--site',
      path.join(siteDir, 'absent'),
      '--base-url',
      'http://127.0.0.1:9/base/',
    ])
    expect(missing.status).toBe(3)
    expect(missing.stderr).toContain('site directory is missing')

    const emptyDir = makeTempDir()
    const empty = runCliSync(['--site', emptyDir, '--base-url', 'http://127.0.0.1:9/base/'])
    expect(empty.status).toBe(3)
    expect(empty.stderr).toContain('contains no files')

    const filePath = path.join(siteDir, 'index.html')
    const notDir = runCliSync(['--site', filePath, '--base-url', 'http://127.0.0.1:9/base/'])
    expect(notDir.status).toBe(3)
    expect(notDir.stderr).toContain('not a directory')
  })

  it('rejects credentialed or queried base URLs with the config class', () => {
    const siteDir = makeTempDir()
    writeTree(siteDir, { 'index.html': '<!doctype html><html><body>x</body></html>' })

    const credentialed = runCliSync([
      '--site',
      siteDir,
      '--base-url',
      'http://user:pass@127.0.0.1:9/base/',
    ])
    expect(credentialed.status).toBe(3)
    expect(credentialed.stderr).toContain('credentials')

    const queried = runCliSync(['--site', siteDir, '--base-url', 'http://127.0.0.1:9/base/?v=1'])
    expect(queried.status).toBe(3)
    expect(queried.stderr).toContain('query string')
  })

  it('enforces the argv contract: unknown flags, missing values and invalid numbers exit 2', async () => {
    expect((await runCliAsync(['--bogus'])).status).toBe(2)
    expect((await runCliAsync([])).status).toBe(2)
    expect((await runCliAsync(['--site', 'x'])).status).toBe(2)
    expect(
      (
        await runCliAsync([
          '--site',
          'x',
          '--base-url',
          'http://127.0.0.1:9/base/',
          '--concurrency',
          '0',
        ])
      ).status,
    ).toBe(2)
    expect(
      (
        await runCliAsync([
          '--site',
          'x',
          '--base-url',
          'http://127.0.0.1:9/base/',
          '--deadline-ms',
          'abc',
        ])
      ).status,
    ).toBe(2)
    expect((await runCliAsync(['--help'])).status).toBe(0)
  })
})
