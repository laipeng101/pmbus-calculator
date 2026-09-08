#!/usr/bin/env node
import { verifyPagesAssetReferences } from './verify-pages-asset-references.mjs'
import {
  CSS_NAME,
  assertNoOverlayContamination,
  deploymentToken,
  indexText,
  isMain,
  overlayCss,
  parseSiteArg,
  readSiteFiles,
  requireContract,
  resolveSite,
  safeDiagnostic,
  verifyIndex,
} from './pages-overlay-contract.mjs'

/** Independent readback of FINAL _site, with no writes and no token output.
 * @param {string} site @param {{repoRoot?: string, env?: NodeJS.ProcessEnv}} [options] */
export function verifyPagesOverlay(site, options = {}) {
  const token = deploymentToken(options.env ?? process.env)
  const files = readSiteFiles(resolveSite(site, options.repoRoot))
  assertNoOverlayContamination(files, true)
  const css = files.get(CSS_NAME)
  requireContract(
    Boolean(css?.equals(overlayCss())),
    'pages-overlay.css must be the exact audited stylesheet',
  )
  verifyPagesAssetReferences(files)
  verifyIndex(indexText(/** @type {Buffer} */ (files.get('index.html'))), files, token)
  return { ok: true, site: '_site', files: files.size, beaconCount: 1, repositoryLinkCount: 1 }
}

/** @param {string[]} argv @param {NodeJS.ProcessEnv} [env] */
export function runCli(argv, env = process.env) {
  try {
    process.stdout.write(`${JSON.stringify(verifyPagesOverlay(parseSiteArg(argv), { env }))}\n`)
    return 0
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ ok: false })}\n`)
    process.stderr.write(`Pages overlay verification: ${safeDiagnostic(error, env)}\n`)
    return 1
  }
}

if (isMain(import.meta.url)) {
  process.exitCode = runCli(process.argv.slice(2))
}
