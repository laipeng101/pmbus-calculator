#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { verifyPagesAssetReferences } from './verify-pages-asset-references.mjs'
import {
  BEACON_URL,
  CSS_NAME,
  PAGES_CSP,
  REPOSITORY_LINK,
  assertNoOverlayContamination,
  deploymentToken,
  indexText,
  isMain,
  overlayCss,
  parseSiteArg,
  readSiteFiles,
  resolveSite,
  safeDiagnostic,
  verifyIndex,
} from './pages-overlay-contract.mjs'

/** The only permitted write surface is the checkout's _site. All input gates
 * run before the first write. An I/O failure leaves disposable staging for
 * re-extraction; it never changes dist or either immutable Release ZIP.
 * @param {string} site @param {{repoRoot?: string, env?: NodeJS.ProcessEnv}} [options] */
export function applyPagesOverlay(site, options = {}) {
  const token = deploymentToken(options.env ?? process.env)
  const dir = resolveSite(site, options.repoRoot)
  const files = readSiteFiles(dir)
  assertNoOverlayContamination(files)
  verifyPagesAssetReferences(files)
  const html = indexText(/** @type {Buffer} */ (files.get('index.html')))
  const { csp, head, body } = verifyIndex(html, files, null)
  // Hex validation above excludes HTML metacharacters; JSON serialization
  // makes the only beacon option explicit. No calculator events or inputs.
  const data = JSON.stringify({ token })
  const policy = Object.entries(PAGES_CSP)
    .map(([name, value]) => `${name} ${value}`)
    .join('; ')
  const replacements = [
    {
      start: csp.start,
      end: csp.openEnd,
      text: `<meta http-equiv="Content-Security-Policy" content="${policy}" />`,
    },
    {
      start: head.closeStart,
      end: head.closeStart,
      text: `  <link rel="stylesheet" href="./${CSS_NAME}" />\n  `,
    },
    {
      start: body.closeStart,
      end: body.closeStart,
      text: `  ${REPOSITORY_LINK}\n    <!-- Cloudflare Web Analytics -->\n    <script type="module" src="${BEACON_URL}" data-cf-beacon='${data}'></script>\n    <!-- End Cloudflare Web Analytics -->\n  `,
    },
  ].sort((a, b) => b.start - a.start)
  let result = html
  for (const edit of replacements)
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end)
  const css = overlayCss()
  const finalFiles = new Map(files).set('index.html', Buffer.from(result)).set(CSS_NAME, css)
  verifyIndex(result, finalFiles, token)
  fs.writeFileSync(path.join(dir, CSS_NAME), css, { flag: 'wx', mode: 0o644 })
  fs.writeFileSync(path.join(dir, 'index.html'), result, 'utf8')
  return { ok: true, site: '_site', modified: ['index.html'], added: [CSS_NAME] }
}

/** @param {string[]} argv @param {NodeJS.ProcessEnv} [env] */
export function runCli(argv, env = process.env) {
  try {
    const result = applyPagesOverlay(parseSiteArg(argv), { env })
    process.stdout.write(`${JSON.stringify(result)}\n`)
    return 0
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ ok: false })}\n`)
    process.stderr.write(`Pages overlay: ${safeDiagnostic(error, env)}\n`)
    return 1
  }
}

if (isMain(import.meta.url)) {
  process.exitCode = runCli(process.argv.slice(2))
}
