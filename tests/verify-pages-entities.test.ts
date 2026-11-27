import { execFile } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer, type RequestListener, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { gzipSync } from 'node:zlib'
import { afterEach, expect, test } from 'vitest'
import { applyPagesOverlay } from '../scripts/apply-pages-overlay.mjs'
import { PAGES_BASE_PATH } from '../scripts/pages-network-policy.mjs'
import { TOKEN_ENV } from '../scripts/pages-overlay-contract.mjs'
import { verifyPagesEntities } from '../scripts/verify-pages-entities.mjs'
import { writeReleaseSite } from './fixtures/pages-site'

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
  return `http://127.0.0.1:${address.port}${PAGES_BASE_PATH}`
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

test('CLI checks the complete overlaid Pages tree with a fresh identity request per file', async () => {
  const root = site({})
  const finalSite = writeReleaseSite(root)
  const fontName = 'assets/字体 1.woff2'
  writeFileSync(path.join(finalSite, fontName), Buffer.from([0, 1, 2, 255]))
  const indexPath = path.join(finalSite, 'index.html')
  const releaseIndex = readFileSync(indexPath)
  applyPagesOverlay('_site', { repoRoot: root, env: { [TOKEN_ENV]: 'a'.repeat(32) } })
  const files = new Map(
    ['index.html', 'pages-overlay.css', 'assets/app.js', 'assets/app.css', fontName].map((name) => [
      name,
      readFileSync(path.join(finalSite, name)),
    ]),
  )
  const runId = 'original-run-id'
  const requests: string[][] = []
  const base = await serve((request, response) => {
    const url = new URL(request.url!, 'http://localhost')
    const requestPath = decodeURIComponent(url.pathname)
    requests.push([
      requestPath,
      request.method!,
      url.search,
      request.headers['accept-encoding']!,
      request.headers['cache-control']!,
    ])
    const name = requestPath.slice(PAGES_BASE_PATH.length)
    const bytes = files.get(name)
    if (bytes) response.end(bytes)
    else response.writeHead(404).end()
  })
  const args = [script, '--site', finalSite, '--base-url', base, '--query', runId]

  const result = await run(process.execPath, args, { timeout: 3_000 })
  expect(result.stdout).toContain(`${files.size}/${files.size} files verified`)
  expect(requests).toHaveLength(files.size)
  expect(requests).toEqual(
    expect.arrayContaining(
      [...files.keys()].map((name) => [
        `${PAGES_BASE_PATH}${name}`,
        'GET',
        `?cb=${runId}`,
        'identity',
        'no-cache',
      ]),
    ),
  )
  expect(result.stdout + result.stderr).not.toContain(runId)

  const finalIndex = files.get('index.html')!
  // Pad the pre-overlay document so an incorrect response can only fail the digest check.
  files.set(
    'index.html',
    Buffer.concat([releaseIndex, Buffer.alloc(finalIndex.length - releaseIndex.length, ' ')]),
  )
  await expect(run(process.execPath, args, { timeout: 3_000 })).rejects.toMatchObject({
    code: 1,
    stderr: expect.stringContaining('"index.html": SHA-256 mismatch'),
  })

  files.set('index.html', finalIndex)
  files.delete('pages-overlay.css')
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
    if (request.url === `${PAGES_BASE_PATH}assets/app.js`) {
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
