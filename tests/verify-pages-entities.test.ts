import { execFile } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer, type RequestListener, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { gzipSync } from 'node:zlib'
import { afterEach, expect, test } from 'vitest'
import { verifyPagesEntities } from '../scripts/verify-pages-entities.mjs'

const run = promisify(execFile)
const script = fileURLToPath(new URL('../scripts/verify-pages-entities.mjs', import.meta.url))
const directories: string[] = []
const servers: Server[] = []

function site(files: Record<string, string | Buffer> = { 'assets/app.js': 'hello' }) {
  const root = mkdtempSync(path.join(tmpdir(), 'verify-pages-'))
  directories.push(root)
  for (const [name, bytes] of Object.entries(files)) {
    const file = path.join(root, name)
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, bytes)
  }
  return root
}

async function serve(onRequest: RequestListener) {
  const server = createServer(onRequest)
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture server address')
  return `http://127.0.0.1:${address.port}/pmbus-calculator/`
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => {
      server.closeAllConnections()
      return new Promise<void>((resolve) => server.close(() => resolve()))
    }),
  )
  for (const directory of directories.splice(0)) rmSync(directory, { force: true, recursive: true })
})

test('CLI checks the complete tree at the Pages prefix with a fresh identity request per file', async () => {
  const files = {
    'index.html': '<!doctype html><title>PMBus</title>',
    'assets/字体 1.woff2': Buffer.from([0, 1, 2, 255]),
    'pages-overlay.css': 'body{}',
  }
  const requests = new Map<string, string[]>()
  let missing = false
  const base = await serve((request, response) => {
    const url = new URL(request.url!, 'http://localhost')
    requests.set(decodeURIComponent(url.pathname), [
      request.method!,
      url.search,
      request.headers['accept-encoding']!,
      request.headers['cache-control']!,
    ])
    const name = decodeURIComponent(url.pathname.slice('/pmbus-calculator/'.length))
    if (Object.hasOwn(files, name) && !(missing && name === 'pages-overlay.css')) {
      response.end(files[name as keyof typeof files])
    } else {
      response.writeHead(404).end()
    }
  })
  const args = [script, '--site', site(files), '--base-url', base, '--query', 'original-run-id']

  const result = await run(process.execPath, args, { timeout: 3_000 })
  expect(result.stdout).toMatch(/3\/3 files verified/)
  expect(Object.fromEntries(requests)).toEqual(
    Object.fromEntries(
      Object.keys(files).map((name) => [
        `/pmbus-calculator/${name}`,
        ['GET', '?cb=original-run-id', 'identity', 'no-cache'],
      ]),
    ),
  )
  expect(result.stdout + result.stderr).not.toContain('original-run-id')

  missing = true
  await expect(run(process.execPath, args, { timeout: 3_000 })).rejects.toMatchObject({
    code: 1,
    stderr: expect.stringContaining('"pages-overlay.css": HTTP 404'),
  })
})

test.each([
  ['<html/>', { 'content-type': 'text/html' }, 'Unexpected HTML response'],
  ['hell!', {}, 'SHA-256 mismatch'],
  ['hell', {}, 'Length mismatch'],
  [gzipSync('hello'), { 'content-encoding': 'gzip' }, 'Expected identity Content-Encoding'],
] as const)(
  'rejects substituted or transformed asset bytes (%#)',
  async (body, headers, reason) => {
    const url = await serve((_, response) => response.writeHead(200, headers).end(body))
    const report = await verifyPagesEntities(site(), url)
    expect(report).toMatchObject({
      okCount: 0,
      failures: 1,
      firstFailure: { path: 'assets/app.js', reason: expect.stringContaining(reason) },
    })
  },
)

test('rejects an oversized response without waiting for the rest of the body', async () => {
  const url = await serve((_, response) => {
    response.writeHead(200)
    response.write('hello!')
  })
  const report = await verifyPagesEntities(site(), url, { requestTimeoutMs: 500 })
  expect(report.firstFailure).toEqual({
    path: 'assets/app.js',
    reason: 'Length mismatch: expected 5 bytes, received at least 6',
  })
})

test('rejects redirects before contacting either a same-path alias or an external origin', async () => {
  let redirectedRequests = 0
  const external = await serve((_, response) => {
    redirectedRequests += 1
    response.end('hello')
  })
  let redirectTo = external
  const url = await serve((request, response) => {
    if (request.url === '/pmbus-calculator/assets/app.js') {
      response.writeHead(302, { location: redirectTo }).end()
    } else {
      redirectedRequests += 1
      response.end('hello')
    }
  })
  const directory = site()
  for (const target of [external, `${url}alias.js`]) {
    redirectTo = target
    const report = await verifyPagesEntities(directory, url)
    expect(report.firstFailure).toEqual({
      path: 'assets/app.js',
      reason: 'HTTP 302 (expected 200)',
    })
  }
  expect(redirectedRequests).toBe(0)
})

test.each([
  [250, 2_000, 'Request timed out'],
  [2_000, 250, 'Shared deadline exceeded'],
] as const)(
  'bounds a stalled body for %s ms request / %s ms shared budgets',
  async (requestTimeoutMs, deadlineMs, reason) => {
    let sent = false
    const url = await serve((_, response) => {
      response.writeHead(200)
      response.write('hello', () => {
        sent = true
      })
    })
    const report = await verifyPagesEntities(site(), url, { requestTimeoutMs, deadlineMs })
    expect(sent).toBe(true)
    expect(report.firstFailure).toEqual({ path: 'assets/app.js', reason })
  },
)

test('limits concurrent requests and stops taking new files after a failure', async () => {
  const directory = site(Object.fromEntries(['a', 'b', 'c', 'd'].map((name) => [name, 'file'])))
  const visited: string[] = []
  const url = await serve((request, response) => {
    visited.push(request.url!)
    if (visited.length === 2) response.writeHead(404).end()
  })
  const report = await verifyPagesEntities(directory, url, {
    concurrency: 2,
    requestTimeoutMs: 1_000,
  })
  expect(report.firstFailure?.reason).toBe('HTTP 404 (expected 200)')
  expect(visited).toHaveLength(2)
})

test('requires an HTTP(S) base without credentials, query or fragment and a real staging tree', async () => {
  const root = site()
  const url = 'http://localhost/test/'
  for (const unsafe of [
    'file:///tmp/',
    `${url}?q=1`,
    `${url}#hash`,
    'http://user:pass@localhost/',
  ]) {
    await expect(verifyPagesEntities(root, unsafe)).rejects.toThrow('Base URL must be HTTP(S)')
  }
  await expect(verifyPagesEntities(site({}), url)).rejects.toThrow('Site contains no files')
  await expect(verifyPagesEntities(path.join(root, 'missing'), url)).rejects.toThrow(
    'Site must be a real directory',
  )
})

test.skipIf(process.platform === 'win32')(
  'rejects a nested symlink before opening a connection',
  async () => {
    const root = site()
    symlinkSync('app.js', path.join(root, 'assets/link.js'))
    await expect(verifyPagesEntities(root, 'http://localhost/test/')).rejects.toThrow(
      'Invalid site file: "assets/link.js"',
    )
  },
)
