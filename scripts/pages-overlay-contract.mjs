// The deployment overlay consumes a verified Release tree. Nothing in this
// module is imported by Vite or the application. Unknown HTML/CSP shapes fail
// closed so a future build change requires an explicit contract review.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { validateZipEntry } from './release-artifact-contract.mjs'
import {
  CLOUDFLARE_BEACON_URL,
  CLOUDFLARE_RUM_ORIGIN,
  PAGES_REPOSITORY as REPOSITORY,
  PAGES_REPOSITORY_URL,
  PAGES_REPOSITORY_NAME,
  RELEASE_CSP,
  PAGES_CSP,
  isSafePagesPath,
  parseCsp,
} from './pages-network-policy.mjs'

export const TOKEN_ENV = 'CLOUDFLARE_WEB_ANALYTICS_TOKEN'
export const CSS_NAME = 'pages-overlay.css'
export const DEFAULT_ROOT = fileURLToPath(new URL('../', import.meta.url))
const HTML_SPACE = /^[\t\n\f\r ]*$/
export const OVERLAY_MARKERS = Object.freeze([
  'data-cf-beacon',
  new URL(CLOUDFLARE_BEACON_URL).hostname,
  new URL(CLOUDFLARE_RUM_ORIGIN).hostname,
  'data-pages-only',
  CSS_NAME,
])

// Original source-code glyph: no trademark artwork, package or network icon.
export const REPOSITORY_LINK = `<a data-pages-only="repository-link" href="${PAGES_REPOSITORY_URL}" target="_blank" rel="noopener noreferrer" aria-label="${PAGES_REPOSITORY_NAME}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
        <path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18" />
      </svg>
    </a>`

/** @param {boolean} condition @param {string} message */
export function requireContract(condition, message) {
  if (!condition) throw new Error(message)
}

/** @param {NodeJS.ProcessEnv} env */
export function deploymentToken(env) {
  requireContract(
    env.GITHUB_REPOSITORY === undefined || env.GITHUB_REPOSITORY === REPOSITORY,
    'Pages overlay is restricted to the official repository',
  )
  const token = env[TOKEN_ENV]
  requireContract(typeof token === 'string' && token.length > 0, `${TOKEN_ENV} is required`)
  requireContract(
    typeof token === 'string' && token.length === 32 && /^[a-fA-F0-9]{32}$/.test(token),
    `${TOKEN_ENV} must be exactly 32 hexadecimal characters`,
  )
  return /** @type {string} */ (token)
}

/** @param {string} site @param {string} [repoRoot] */
export function resolveSite(site, repoRoot = DEFAULT_ROOT) {
  const root = fs.realpathSync(repoRoot)
  const expected = path.join(root, '_site')
  requireContract(
    typeof site === 'string' &&
      site.length > 0 &&
      (path.resolve(repoRoot, site) === path.resolve(repoRoot, '_site') ||
        path.resolve(root, site) === expected),
    'Only the checkout staging directory _site may be used',
  )
  const stat = fs.lstatSync(expected, { throwIfNoEntry: false })
  requireContract(
    Boolean(stat?.isDirectory() && !stat.isSymbolicLink()),
    '_site must be a real directory',
  )
  requireContract(
    fs.realpathSync(expected) === expected,
    '_site must not resolve through a symlink',
  )
  return expected
}

/** Read only regular, unlinked files; an overlay cannot write through links.
 * @param {string} dir @returns {Map<string, Buffer>} */
export function readSiteFiles(dir) {
  /** @type {Map<string, Buffer>} */
  const files = new Map()
  /** @param {string} current */
  function walk(current) {
    for (const entry of fs
      .readdirSync(current, { withFileTypes: true })
      .sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = path.join(current, entry.name)
      requireContract(!entry.isSymbolicLink(), 'Site tree must not contain symlinks')
      if (entry.isDirectory()) {
        walk(full)
      } else {
        requireContract(entry.isFile(), 'Site tree must contain only regular files')
        const stat = fs.lstatSync(full)
        requireContract(
          stat.isFile() && stat.nlink === 1,
          'Site files must be regular files without hard links',
        )
        const relative = path.relative(dir, full).split(path.sep).join('/')
        requireContract(
          validateZipEntry(relative).ok && isSafePagesPath(relative),
          'Site tree contains an unsafe resource path for live entity verification',
        )
        files.set(relative, fs.readFileSync(full))
      }
    }
  }
  walk(dir)
  requireContract(files.has('index.html'), 'Site must contain a regular index.html file')
  requireContract(
    [...files.keys()].some((name) => name.startsWith('assets/')),
    'Site must contain assets/',
  )
  return files
}

/** @param {Buffer} bytes */
export function indexText(bytes) {
  const html = bytes.toString('utf8')
  requireContract(Buffer.from(html).equals(bytes), 'index.html must be valid UTF-8')
  return html
}

/** @param {Map<string, Buffer>} files @param {boolean} [pages] */
export function assertNoOverlayContamination(files, pages = false) {
  for (const [name, bytes] of files) {
    if (pages && (name === 'index.html' || name === CSS_NAME)) continue
    const text = bytes.toString('utf8').toLowerCase()
    requireContract(
      !OVERLAY_MARKERS.some(
        (marker) => name.toLowerCase().includes(marker) || text.includes(marker),
      ),
      'Release baseline contains Pages-only content (or overlay was already applied)',
    )
  }
}

/** This parser deliberately accepts only the generated static index grammar,
 * not arbitrary browser-tolerated HTML. All resource attributes are quoted;
 * duplicate attributes, entities, inline code and unknown elements fail closed.
 * @typedef {{tag: string, attrs: Record<string,string>, parent: HtmlNode|null, start: number, openEnd: number, closeStart: number, end: number, text: string}} HtmlNode
 * @param {string} html @returns {HtmlNode[]} */
export function parseIndex(html) {
  /** @type {HtmlNode[]} */
  const nodes = []
  /** @type {HtmlNode[]} */
  const stack = []
  let cursor = 0
  let doctype = 0
  while (cursor < html.length) {
    if (html[cursor] !== '<') {
      const next = html.indexOf('<', cursor)
      const end = next < 0 ? html.length : next
      const text = html.slice(cursor, end)
      const parent = stack.at(-1)
      requireContract(
        HTML_SPACE.test(text) || parent?.tag === 'title',
        'Unexpected text or inline code in index.html',
      )
      if (parent) parent.text += text
      cursor = end
      continue
    }
    if (html.startsWith('<!--', cursor)) {
      const end = html.indexOf('-->', cursor + 4)
      requireContract(
        end >= 0 &&
          !/[<>]/.test(html.slice(cursor + 4, end)) &&
          !html.slice(cursor + 4, end).includes('--'),
        'Malformed HTML comment',
      )
      cursor = end + 3
      continue
    }
    const doc = /^<!doctype html>/i.exec(html.slice(cursor))
    if (doc) {
      requireContract(doctype === 0 && nodes.length === 0, 'Unexpected doctype')
      doctype++
      cursor += doc[0].length
      continue
    }
    const match = /^<(\/?)([a-z][a-z0-9-]*)((?:[^<>"']|"[^"<>]*"|'[^'<>]*')*)>/i.exec(
      html.slice(cursor),
    )
    requireContract(Boolean(match), 'Malformed or unsupported index.html markup')
    const token = /** @type {RegExpExecArray} */ (match)
    const tag = token[2].toLowerCase()
    const end = cursor + token[0].length
    if (token[1]) {
      const node = stack.pop()
      requireContract(HTML_SPACE.test(token[3]) && node?.tag === tag, 'Mismatched HTML closing tag')
      if (node) {
        node.closeStart = cursor
        node.end = end
      }
    } else {
      const selfClosing = /\/$/.test(token[3])
      const source = token[3].replace(/\/$/, '')
      /** @type {Record<string,string>} */
      const attrs = Object.create(null)
      let rest = source
      while (!HTML_SPACE.test(rest)) {
        const attr =
          /^[\t\n\f\r ]+([a-zA-Z_:][a-zA-Z0-9_:.-]*)(?:[\t\n\f\r ]*=[\t\n\f\r ]*(?:"([^"<>]*)"|'([^'<>]*)'))?/.exec(
            rest,
          )
        requireContract(Boolean(attr), 'Attributes must use the generated quoted HTML grammar')
        const item = /** @type {RegExpExecArray} */ (attr)
        const name = item[1].toLowerCase()
        const value = item[2] ?? item[3] ?? ''
        requireContract(
          !(name in attrs) && !/[&\u0000-\u001f]/.test(value),
          'Duplicate or encoded HTML attribute',
        )
        attrs[name] = value
        rest = rest.slice(item[0].length)
      }
      const node = {
        tag,
        attrs,
        parent: stack.at(-1) ?? null,
        start: cursor,
        openEnd: end,
        closeStart: end,
        end,
        text: '',
      }
      nodes.push(node)
      if (!['meta', 'link', 'path'].includes(tag)) {
        requireContract(!selfClosing, 'Unexpected self-closing HTML element')
        stack.push(node)
      } else if (tag === 'path') {
        requireContract(selfClosing, 'SVG path must be self-closing')
      }
    }
    cursor = end
  }
  requireContract(doctype === 1 && stack.length === 0, 'Incomplete production document')
  return nodes
}

/** @param {HtmlNode[]} nodes @param {string} tag */
function only(nodes, tag) {
  const found = nodes.filter((node) => node.tag === tag)
  requireContract(found.length === 1, `index.html must contain exactly one ${tag}`)
  return found[0]
}

/** @param {HtmlNode} node @param {string[]} allowed */
function attributes(node, allowed) {
  requireContract(
    Object.keys(node.attrs).every((name) => allowed.includes(name)),
    `Unexpected attribute on ${node.tag}`,
  )
}

/** @param {string} href @param {Map<string, Buffer>} files @param {string} extension */
function localAsset(href, files, extension) {
  requireContract(
    typeof href === 'string' &&
      /^\.\/assets\/[A-Za-z0-9_.-]+$/.test(href) &&
      href.endsWith(extension) &&
      files.has(href.slice(2)),
    'Application scripts, styles and preloads must reference existing same-origin assets',
  )
}

/** @param {string} html @param {Map<string, Buffer>} files @param {string|null} token */
export function verifyIndex(html, files, token) {
  const pages = token !== null
  const nodes = parseIndex(html)
  const document = only(nodes, 'html')
  const head = only(nodes, 'head')
  const body = only(nodes, 'body')
  const root = only(nodes, 'div')
  const title = only(nodes, 'title')
  requireContract(
    document.parent === null && document.attrs.lang === 'zh-CN',
    'Unexpected HTML document root',
  )
  requireContract(
    head.parent === document && body.parent === document && head.end <= body.start,
    'Unexpected head/body structure',
  )
  requireContract(
    root.parent === body && root.attrs.id === 'root' && !nodes.some((node) => node.parent === root),
    '#root must be an empty body child',
  )
  requireContract(title.parent === head && title.text.trim().length > 0, 'Missing document title')
  const metas = nodes.filter((node) => node.tag === 'meta')
  const policies = metas.filter(
    (node) => node.attrs['http-equiv']?.toLowerCase() === 'content-security-policy',
  )
  requireContract(policies.length === 1, 'Expected exactly one production CSP meta')
  const csp = policies[0]
  requireContract(
    isDeepStrictEqual(parseCsp(csp.attrs.content ?? ''), pages ? PAGES_CSP : RELEASE_CSP),
    'Unexpected CSP directives or sources',
  )
  let appScripts = 0
  let appStyles = 0
  let beacons = 0
  let overlayStyles = 0
  for (const node of nodes) {
    const { attrs, tag, parent } = node
    if (tag === 'html') attributes(node, ['lang'])
    else if (['head', 'body', 'title'].includes(tag)) attributes(node, [])
    else if (tag === 'div') attributes(node, ['id'])
    else if (tag === 'meta') {
      requireContract(parent === head, 'Meta must be in head')
      if (node === csp) attributes(node, ['http-equiv', 'content'])
      else if ('charset' in attrs) {
        attributes(node, ['charset'])
        requireContract(attrs.charset.toLowerCase() === 'utf-8', 'Unexpected character encoding')
      } else {
        attributes(node, ['name', 'content', 'media'])
        requireContract(
          [
            'viewport',
            'theme-color',
            'mobile-web-app-capable',
            'apple-mobile-web-app-status-bar-style',
          ].includes(attrs.name) && typeof attrs.content === 'string',
          'Unexpected production meta',
        )
      }
    } else if (tag === 'script') {
      requireContract(
        node.start > csp.end && attrs.type === 'module' && node.text.trim() === '',
        'Scripts must be external modules after CSP',
      )
      if (pages && attrs.src === CLOUDFLARE_BEACON_URL) {
        attributes(node, ['type', 'src', 'data-cf-beacon'])
        requireContract(
          parent === body && attrs['data-cf-beacon'] === JSON.stringify({ token }),
          'Cloudflare beacon configuration does not match deployment input',
        )
        beacons++
      } else {
        attributes(node, ['type', 'src', 'crossorigin'])
        requireContract(
          parent === head && (attrs.crossorigin ?? '') === '',
          'Unexpected application module attributes',
        )
        localAsset(attrs.src, files, '.js')
        appScripts++
      }
    } else if (tag === 'link') {
      requireContract(
        parent === head && node.start > csp.end,
        'Resource links must be in head after CSP',
      )
      if (pages && attrs.href === `./${CSS_NAME}`) {
        attributes(node, ['rel', 'href'])
        requireContract(attrs.rel === 'stylesheet', 'Pages overlay CSS must be a stylesheet')
        overlayStyles++
      } else {
        attributes(node, ['rel', 'href', 'crossorigin'])
        requireContract((attrs.crossorigin ?? '') === '', 'Unexpected resource crossorigin value')
        requireContract(
          ['stylesheet', 'modulepreload'].includes(attrs.rel),
          'Unexpected resource link',
        )
        localAsset(attrs.href, files, attrs.rel === 'stylesheet' ? '.css' : '.js')
        if (attrs.rel === 'stylesheet') appStyles++
      }
    } else if (pages && tag === 'a') {
      requireContract(
        parent === body && html.slice(node.start, node.end) === REPOSITORY_LINK,
        'Pages repository link or accessible SVG differs from the audited template',
      )
    } else if (pages && tag === 'svg') {
      requireContract(parent?.tag === 'a', 'SVG must belong to the Pages repository link')
    } else if (pages && tag === 'path') {
      requireContract(parent?.tag === 'svg', 'Path must belong to the repository SVG')
    } else {
      throw new Error('Unexpected element or external resource in index.html')
    }
  }
  requireContract(appScripts > 0 && appStyles > 0, 'Missing application script or stylesheet')
  if (pages) {
    only(nodes, 'a')
    only(nodes, 'svg')
    only(nodes, 'path')
    requireContract(
      beacons === 1 && overlayStyles === 1,
      'Expected exactly one beacon and Pages stylesheet',
    )
  }
  return { csp, head, body }
}

/** @returns {Buffer} */
export function overlayCss() {
  return fs.readFileSync(new URL('./pages-overlay.css', import.meta.url))
}

/** @param {string[]} argv */
export function parseSiteArg(argv) {
  requireContract(
    argv.length === 2 && argv[0] === '--site' && argv[1].length > 0,
    'usage: --site _site (deployment token is read from the environment only)',
  )
  return argv[1]
}

/** Redact even unexpected I/O diagnostics: argv/HTML/environment never go to logs.
 * @param {unknown} error @param {NodeJS.ProcessEnv} env */
export function safeDiagnostic(error, env) {
  let message = error instanceof Error ? error.message : 'Pages overlay failed'
  const token = env[TOKEN_ENV]
  if (token) message = message.split(token).join('[redacted]')
  return message.replace(/[a-fA-F0-9]{32}/g, '[redacted]')
}

/** Canonicalize macOS /var and other invocation aliases before comparison.
 * @param {string} importMetaUrl */
export function isMain(importMetaUrl) {
  const entry = process.argv[1]
  return Boolean(
    entry &&
    fs.existsSync(entry) &&
    fs.realpathSync(entry) === fs.realpathSync(fileURLToPath(importMetaUrl)),
  )
}
