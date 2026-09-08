// @vitest-environment node
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { applyPagesOverlay } from '../scripts/apply-pages-overlay.mjs'
import { verifyPagesOverlay } from '../scripts/verify-pages-overlay.mjs'
import {
  BEACON_URL,
  CSS_NAME,
  OVERLAY_MARKERS,
  REPOSITORY,
  REPOSITORY_LINK,
  TOKEN_ENV,
  parseCsp,
  parseSiteArg,
  readSiteFiles,
} from '../scripts/pages-overlay-contract.mjs'
import { generateAssets } from '../scripts/prepare-release-assets.mjs'
import { verifyPagesEntities } from '../scripts/verify-pages-entities.mjs'

const policy =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'"
const token = 'a'.repeat(32) // Synthetic fixture input, never a site configuration.
const env = { GITHUB_REPOSITORY: REPOSITORY, [TOKEN_ENV]: token }
const roots: string[] = []

function fixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pmbus-overlay-unit-'))
  roots.push(root)
  fs.mkdirSync(path.join(root, '_site', 'assets'), { recursive: true })
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '3.3.0' }))
  fs.writeFileSync(
    path.join(root, '_site', 'index.html'),
    `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${policy}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>PMBus fixture</title>
    <script type="module" crossorigin src="./assets/app.js"></script>
    <link rel="stylesheet" crossorigin href="./assets/app.css">
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`,
  )
  fs.writeFileSync(path.join(root, '_site', 'assets', 'app.js'), 'export {}\n')
  fs.writeFileSync(path.join(root, '_site', 'assets', 'app.css'), 'body { color: black; }\n')
  return root
}

function index(root: string): string {
  return fs.readFileSync(path.join(root, '_site', 'index.html'), 'utf8')
}

function edit(root: string, transform: (html: string) => string): void {
  fs.writeFileSync(path.join(root, '_site', 'index.html'), transform(index(root)))
}

function apply(root: string): void {
  applyPagesOverlay('_site', { repoRoot: root, env })
}

function verify(root: string): ReturnType<typeof verifyPagesOverlay> {
  return verifyPagesOverlay('_site', { repoRoot: root, env })
}

function tree(root: string): Map<string, Buffer> {
  return readSiteFiles(path.join(root, '_site'))
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('deterministic Pages-only transform', () => {
  it('adds exactly one beacon, accessible repository link and local CSS; only index changes', () => {
    const root = fixture()
    const before = tree(root)
    apply(root)
    const after = tree(root)
    expect(verify(root)).toEqual({
      ok: true,
      site: '_site',
      files: 4,
      beaconCount: 1,
      repositoryLinkCount: 1,
    })
    expect(after.size).toBe(before.size + 1)
    expect(after.has(CSS_NAME)).toBe(true)
    for (const [name, bytes] of before) {
      if (name === 'index.html') expect(after.get(name)).not.toEqual(bytes)
      else expect(after.get(name)).toEqual(bytes)
    }
    expect(index(root)).toContain(`script-src 'self' ${BEACON_URL}`)
    expect(index(root)).toContain("connect-src 'self' https://cloudflareinsights.com")
    expect(index(root)).toContain(`data-cf-beacon='${JSON.stringify({ token })}'`)
    expect(index(root)).toContain(REPOSITORY_LINK)
    expect(index(root)).not.toContain('integrity=')
    for (const directive of policy.split('; ').filter((part) => !part.startsWith('script-src'))) {
      expect(index(root)).toContain(directive)
    }
  })

  it('same Release bytes and deployment inputs give byte-identical trees in different directories', () => {
    const one = fixture()
    const two = fixture()
    fs.utimesSync(path.join(two, '_site', 'index.html'), new Date(0), new Date(0))
    apply(one)
    apply(two)
    expect(tree(one)).toEqual(tree(two))
  })

  it('rejects a second apply without changing the first overlay', () => {
    const root = fixture()
    apply(root)
    const before = tree(root)
    expect(() => apply(root)).toThrow(/already applied|Pages-only/)
    expect(tree(root)).toEqual(before)
  })

  it('accepts an explicit absolute path only when it is the exact checkout staging tree', () => {
    const root = fixture()
    applyPagesOverlay(path.join(root, '_site'), { repoRoot: root, env })
    expect(verify(root).ok).toBe(true)
  })

  it('does not require GitHub environment metadata for an explicit local overlay invocation', () => {
    const root = fixture()
    applyPagesOverlay('_site', { repoRoot: root, env: { [TOKEN_ENV]: token } })
    expect(verify(root).ok).toBe(true)
  })

  it('preserves an uppercase hexadecimal deployment input without changing its value', () => {
    const root = fixture()
    const uppercaseEnv = { ...env, [TOKEN_ENV]: token.toUpperCase() }
    applyPagesOverlay('_site', { repoRoot: root, env: uppercaseEnv })
    expect(verifyPagesOverlay('_site', { repoRoot: root, env: uppercaseEnv }).ok).toBe(true)
  })
})

describe('input gates fail before any mutation', () => {
  it.each([
    undefined,
    '',
    'a'.repeat(31),
    'a'.repeat(33),
    'g'.repeat(32),
    ` ${token}`,
    `${token}\n`,
    '"><script>alert(1)</script>',
  ])('rejects missing/malformed token case %#', (value) => {
    const root = fixture()
    const before = tree(root)
    expect(() =>
      applyPagesOverlay('_site', { repoRoot: root, env: { [TOKEN_ENV]: value } }),
    ).toThrow(/CLOUDFLARE_WEB_ANALYTICS_TOKEN/)
    expect(tree(root)).toEqual(before)
  })

  it.each(['someone/fork', 'laipeng101/pmbus-calculator.evil', 'Laipeng101/pmbus-calculator', ''])(
    'rejects a different repository %s',
    (repository) => {
      const root = fixture()
      expect(() =>
        applyPagesOverlay('_site', {
          repoRoot: root,
          env: { ...env, GITHUB_REPOSITORY: repository },
        }),
      ).toThrow(/official repository/)
      expect(fs.existsSync(path.join(root, '_site', CSS_NAME))).toBe(false)
    },
  )

  it.each(['', '.', 'dist', 'release-output', '../_site', 'nested/_site', '/tmp/_site'])(
    'rejects an unintended staging directory %s',
    (site) => {
      const root = fixture()
      const before = tree(root)
      expect(() => applyPagesOverlay(site, { repoRoot: root, env })).toThrow(/Only.*_site/)
      expect(tree(root)).toEqual(before)
    },
  )

  it.each(
    [
      [],
      ['--site'],
      ['--site', '_site', '--token', token],
      ['--site', '_site', '--site', '_site'],
      ['_site'],
    ].map((args) => ({ args })),
  )('rejects incomplete/extra CLI arguments case %#', ({ args }) => {
    expect(() => parseSiteArg(args)).toThrow(/environment only/)
  })

  // Non-HTML whitespace before/in head is body text to the browser. trim()
  // would accept a CSP that the browser moves into body and then ignores.
  it.each(['\u00a0', '\ufeff', '\u2000', '\u2028'])(
    'rejects non-HTML whitespace at structural boundaries: %#',
    (space) => {
      for (const change of [
        (html: string) => html.replace('<head>', `${space}<head>`),
        (html: string) => html.replace('<meta charset=', `${space}<meta charset=`),
        (html: string) => html.replace('http-equiv=', `${space}http-equiv=`),
        (html: string) => html.replace("script-src 'self'", `script-src${space}'self'`),
      ]) {
        const root = fixture()
        edit(root, change)
        const before = tree(root)
        expect(() => apply(root)).toThrow()
        expect(tree(root)).toEqual(before)
      }
    },
  )

  it('rejects non-ASCII and control characters anywhere in CSP, including the end', () => {
    for (const space of ['\u00a0', '\ufeff', '\u2000', '\u2028', '\t', '\r', '\n']) {
      expect(() => parseCsp(`${policy}${space}`, false)).toThrow(/ASCII/)
      expect(() => parseCsp(policy.replace('script-src ', `script-src${space}`), false)).toThrow(
        /ASCII/,
      )
    }
    expect(() => parseCsp(policy.replaceAll(' ', '  '), false)).not.toThrow()
  })

  it.each(['missing', 'directory', 'symlink', 'hardlink'] as const)(
    'requires index.html to be an unlinked regular file: %s',
    (kind) => {
      const root = fixture()
      const file = path.join(root, '_site', 'index.html')
      const original = fs.readFileSync(file)
      fs.unlinkSync(file)
      const external = path.join(root, 'untouched.html')
      fs.writeFileSync(external, original)
      if (kind === 'directory') fs.mkdirSync(file)
      if (kind === 'symlink') fs.symlinkSync(external, file)
      if (kind === 'hardlink') fs.linkSync(external, file)
      expect(() => apply(root)).toThrow()
      expect(fs.readFileSync(external)).toEqual(original)
      expect(fs.existsSync(path.join(root, '_site', CSS_NAME))).toBe(false)
    },
  )

  it('rejects a symlink staging directory', () => {
    const root = fixture()
    fs.renameSync(path.join(root, '_site'), path.join(root, 'dist'))
    fs.symlinkSync(path.join(root, 'dist'), path.join(root, '_site'))
    expect(() => apply(root)).toThrow(/real directory/)
    expect(fs.existsSync(path.join(root, 'dist', CSS_NAME))).toBe(false)
  })

  it('rejects nested directory symlinks and special files without following/opening them', () => {
    const root = fixture()
    const alias = path.join(root, '_site', 'alias')
    fs.symlinkSync(path.join(root, '_site', 'assets'), alias)
    expect(() => apply(root)).toThrow(/symlink/)
    fs.unlinkSync(alias)
    execFileSync('mkfifo', [alias], { timeout: 5_000 })
    expect(() => apply(root)).toThrow(/regular files/)
  })

  it.each(OVERLAY_MARKERS)('rejects existing marker anywhere in the Release tree: %s', (marker) => {
    const root = fixture()
    fs.appendFileSync(path.join(root, '_site', 'assets', 'app.js'), `/* ${marker.toUpperCase()} */`)
    const before = tree(root)
    expect(() => apply(root)).toThrow(/Pages-only/)
    expect(tree(root)).toEqual(before)
  })

  it('rejects an existing overlay CSS filename even if empty', () => {
    const root = fixture()
    fs.writeFileSync(path.join(root, '_site', CSS_NAME), '')
    expect(() => apply(root)).toThrow(/Pages-only/)
  })

  it.each(['unused#fragment.js', 'unused?query.js', 'unused%2Fencoded.js'])(
    'rejects manifest URL ambiguity before deploy: %s',
    (name) => {
      const root = fixture()
      fs.writeFileSync(path.join(root, '_site', 'assets', name), '')
      expect(() => apply(root)).toThrow(/unsafe resource path/)
      expect(fs.existsSync(path.join(root, '_site', CSS_NAME))).toBe(false)
    },
  )

  it.each([
    '<!--><img src="https://unexpected.example/pixel">-->',
    '<!---><script src="https://unexpected.example/module.js"></script>-->',
  ])('rejects browser-abrupt comments case %#', (comment) => {
    const root = fixture()
    edit(root, (html) => html.replace('<head>', `${comment}<head>`))
    const before = tree(root)
    expect(() => apply(root)).toThrow(/comment/)
    expect(tree(root)).toEqual(before)
  })

  it.each([
    ['missing CSP', (html: string) => html.replace(/<meta http-equiv[^>]+>/, '')],
    [
      'duplicate CSP',
      (html: string) =>
        html.replace(
          '</head>',
          `<meta http-equiv="content-security-policy" content="${policy}" /></head>`,
        ),
    ],
    [
      'broader script source',
      (html: string) => html.replace("script-src 'self'", "script-src 'self' https:"),
    ],
    [
      'weakened object source',
      (html: string) => html.replace("object-src 'none'", "object-src 'self'"),
    ],
    [
      'unknown directive',
      (html: string) =>
        html.replace("form-action 'self'", "form-action 'self'; connect-src 'self'"),
    ],
    [
      'duplicate directive',
      (html: string) => html.replace("form-action 'self'", "form-action 'self'; script-src 'self'"),
    ],
    [
      'unsafe attribute',
      (html: string) => html.replace('id="root"', 'id="root" onload="alert(1)"'),
    ],
    ['duplicate attribute', (html: string) => html.replace('id="root"', 'id="root" ID="other"')],
    [
      'encoded URL',
      (html: string) => html.replace('./assets/app.js', '&#104;ttps://evil.example/app.js'),
    ],
    ['inline script', (html: string) => html.replace('</script>', 'alert(1)</script>')],
    [
      'script before CSP',
      (html: string) =>
        html.replace(
          '<meta charset="UTF-8" />',
          '<script type="module" src="./assets/app.js"></script>',
        ),
    ],
    [
      'external stylesheet',
      (html: string) => html.replace('./assets/app.css', 'https://evil.example/a.css'),
    ],
    [
      'nonempty root',
      (html: string) =>
        html.replace(
          '<div id="root"></div>',
          '<div id="root"><script type="module" src="./assets/app.js"></script></div>',
        ),
    ],
    [
      'missing referenced asset',
      (html: string) => html.replace('./assets/app.js', './assets/missing.js'),
    ],
  ] as const)('rejects unexpected Release HTML/CSP shape: %s', (_name, change) => {
    const root = fixture()
    edit(root, change)
    const before = tree(root)
    expect(() => apply(root)).toThrow()
    expect(tree(root)).toEqual(before)
  })
})

describe('independent final overlay verifier', () => {
  it('rejects a clean Release tree', () => {
    expect(() => verify(fixture())).toThrow(/stylesheet/)
  })

  it.each([
    [
      'missing beacon',
      (html: string) => html.replace(/<script type="module" src="https:[^<]+<\/script>/, ''),
    ],
    [
      'duplicate beacon',
      (html: string) =>
        html.replace(
          '</body>',
          `${html.match(/<script type="module" src="https:[^<]+<\/script>/)?.[0]}</body>`,
        ),
    ],
    [
      'classic beacon',
      (html: string) =>
        html.replace(
          `type="module" src="${BEACON_URL}"`,
          `type="text/javascript" src="${BEACON_URL}"`,
        ),
    ],
    [
      'unversioned SRI',
      (html: string) =>
        html.replace('data-cf-beacon=', 'integrity="sha384-unknown" data-cf-beacon='),
    ],
    ['wrong token', (html: string) => html.replace(token, 'b'.repeat(32))],
    [
      'extra analytics option',
      (html: string) =>
        html.replace(JSON.stringify({ token }), JSON.stringify({ token, custom: 'raw' })),
    ],
    [
      'beacon query',
      (html: string) => html.replace(`src="${BEACON_URL}"`, `src="${BEACON_URL}?unexpected=1"`),
    ],
    [
      'wrong repository',
      (html: string) =>
        html.replace(
          'href="https://github.com/laipeng101/pmbus-calculator"',
          'href="https://github.com/other/repository"',
        ),
    ],
    ['missing label', (html: string) => html.replace(' aria-label="在 GitHub 查看项目源码"', '')],
    ['unsafe target', (html: string) => html.replace('target="_blank"', 'target="_self"')],
    ['unsafe rel', (html: string) => html.replace('rel="noopener noreferrer"', 'rel="opener"')],
    ['exposed SVG', (html: string) => html.replace('aria-hidden="true"', 'aria-hidden="false"')],
    ['wrong icon color', (html: string) => html.replace('stroke="currentColor"', 'stroke="#000"')],
    ['duplicate link', (html: string) => html.replace('</body>', `${REPOSITORY_LINK}</body>`)],
    [
      'marker in comment',
      (html: string) => html.replace('</body>', '<!-- data-pages-only --></body>'),
    ],
    [
      'external script',
      (html: string) =>
        html.replace(
          '</body>',
          '<script type="module" src="https://evil.example/a.js"></script></body>',
        ),
    ],
    [
      'external stylesheet',
      (html: string) =>
        html.replace('</head>', '<link rel="stylesheet" href="https://evil.example/a.css"></head>'),
    ],
    [
      'external font preload',
      (html: string) =>
        html.replace(
          '</head>',
          '<link rel="preload" as="font" href="https://evil.example/a.woff2"></head>',
        ),
    ],
    [
      'external image',
      (html: string) =>
        html.replace('</body>', '<img src="https://evil.example/pixel.png"></body>'),
    ],
    [
      'external base',
      (html: string) => html.replace('</head>', '<base href="https://evil.example/"></head>'),
    ],
    [
      'external frame',
      (html: string) =>
        html.replace('</body>', '<iframe src="https://evil.example/"></iframe></body>'),
    ],
    [
      'wider Cloudflare script CSP',
      (html: string) =>
        html.replace(`'self' ${BEACON_URL}`, "'self' https://static.cloudflareinsights.com"),
    ],
    [
      'wider connect CSP',
      (html: string) =>
        html.replace(
          "connect-src 'self' https://cloudflareinsights.com",
          "connect-src 'self' https:",
        ),
    ],
    [
      'extra CSP permission',
      (html: string) =>
        html.replace("img-src 'self' data:", "img-src 'self' data: https://evil.example"),
    ],
    [
      'missing CSP exception',
      (html: string) => html.replace("; connect-src 'self' https://cloudflareinsights.com", ''),
    ],
  ] as const)('rejects tampering: %s', (_name, change) => {
    const root = fixture()
    apply(root)
    edit(root, change)
    const before = tree(root)
    expect(() => verify(root)).toThrow()
    expect(tree(root)).toEqual(before)
  })

  it.each(['missing', 'tampered', 'symlink', 'directory'] as const)(
    'requires exact regular overlay CSS: %s',
    (kind) => {
      const root = fixture()
      apply(root)
      const css = path.join(root, '_site', CSS_NAME)
      fs.unlinkSync(css)
      if (kind === 'tampered') fs.writeFileSync(css, '@import "https://evil.example/a.css";')
      if (kind === 'symlink') fs.symlinkSync(path.join(root, '_site', 'assets', 'app.css'), css)
      if (kind === 'directory') fs.mkdirSync(css)
      expect(() => verify(root)).toThrow()
    },
  )

  it('rejects vendored beacon/configuration outside index.html', () => {
    const root = fixture()
    apply(root)
    fs.writeFileSync(
      path.join(root, '_site', 'assets', 'beacon.js'),
      '/* cloudflareinsights.com */',
    )
    expect(() => verify(root)).toThrow(/Pages-only/)
  })
})

describe('Release/provenance and CLI integration', () => {
  it('a verified ZIP stays byte-identical while only its extraction receives the overlay', async () => {
    const root = fixture()
    fs.cpSync(path.join(root, '_site'), path.join(root, 'dist'), { recursive: true })
    const output = path.join(root, 'release-output')
    const { plan } = await generateAssets(path.join(root, 'dist'), output, false)
    const zip = path.join(output, plan.zipName)
    const originalZip = fs.readFileSync(zip)
    const sums = fs.readFileSync(path.join(output, plan.sumsName))
    fs.rmSync(path.join(root, '_site'), { recursive: true })
    execFileSync(
      'python3',
      [
        '-c',
        'import sys,zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])',
        zip,
        path.join(root, '_site'),
      ],
      { timeout: 10_000 },
    )
    apply(root)
    expect(verify(root).ok).toBe(true)
    expect(fs.readFileSync(zip)).toEqual(originalZip)
    expect(fs.readFileSync(path.join(output, plan.sumsName))).toEqual(sums)
    await generateAssets(path.join(root, 'dist'), output, true)
    expect(fs.readFileSync(zip)).toEqual(originalZip)
  })

  it('real CLI emits one JSON object, never token contents, on success or failure', () => {
    const root = fixture()
    fs.mkdirSync(path.join(root, 'scripts'))
    for (const name of [
      'apply-pages-overlay.mjs',
      'verify-pages-overlay.mjs',
      'pages-overlay-contract.mjs',
      'release-artifact-contract.mjs',
      'verify-pages-entities.mjs',
      'verify-pages-asset-references.mjs',
      CSS_NAME,
    ]) {
      fs.copyFileSync(
        new URL(`../scripts/${name}`, import.meta.url),
        path.join(root, 'scripts', name),
      )
    }
    const run = (script: string, inputEnv: NodeJS.ProcessEnv, args = ['--site', '_site']) =>
      spawnSync(process.execPath, [path.join(root, 'scripts', script), ...args], {
        cwd: root,
        env: { ...process.env, ...inputEnv },
        encoding: 'utf8',
        timeout: 10_000,
      })
    for (const script of ['apply-pages-overlay.mjs', 'verify-pages-overlay.mjs']) {
      const result = run(script, env)
      expect(result.status).toBe(0)
      expect(JSON.parse(result.stdout).ok).toBe(true)
      expect(result.stdout + result.stderr).not.toContain(token)
    }
    for (const result of [
      run('apply-pages-overlay.mjs', env),
      run('verify-pages-overlay.mjs', { ...env, [TOKEN_ENV]: 'b'.repeat(32) }),
      run('verify-pages-overlay.mjs', { ...env, [TOKEN_ENV]: '' }),
      run('apply-pages-overlay.mjs', env, ['--site', '_site', '--token', token]),
    ]) {
      expect(result.status).toBe(1)
      expect(JSON.parse(result.stdout)).toEqual({ ok: false })
      expect(result.stderr).not.toBe('')
      expect(result.stdout + result.stderr).not.toContain(token)
      expect(result.stdout + result.stderr).not.toContain('b'.repeat(32))
    }
  })

  it('live entity verification derives its manifest from FINAL index and overlay CSS', async () => {
    const root = fixture()
    const originalIndex = Buffer.from(index(root))
    apply(root)
    const files = tree(root)
    const observed: string[] = []
    let stale = false
    const server = http.createServer((request, response) => {
      const name = new URL(request.url!, 'http://localhost').pathname.replace(
        '/pmbus-calculator/',
        '',
      )
      observed.push(name)
      const bytes = stale && name === 'index.html' ? originalIndex : files.get(name)
      response.writeHead(bytes ? 200 : 404)
      response.end(bytes)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address() as { port: number }
      const url = `http://127.0.0.1:${address.port}/pmbus-calculator/`
      const options = { concurrency: 2, deadlineMs: 5_000, requestTimeoutMs: 1_000, query: null }
      const result = await verifyPagesEntities(path.join(root, '_site'), url, options)
      expect(result.failures).toBe(0)
      expect(result.manifest.count).toBe(files.size)
      expect(observed).toContain(CSS_NAME)
      expect(observed).toContain('index.html')
      stale = true
      const mismatch = await verifyPagesEntities(path.join(root, '_site'), url, options)
      expect(mismatch.failures).toBeGreaterThan(0)
      expect(mismatch.firstFailure?.path).toBe('index.html')
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
    }
  })
})
