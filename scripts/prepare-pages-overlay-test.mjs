#!/usr/bin/env node
// Explicit local/PR fixture preparation, never called by build or Pages deploy.
// Uses a synthetic token even if the caller has a real deployment secret.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PAGES_REPOSITORY } from './pages-network-policy.mjs'
import { extractReleaseZip, generateAssets } from './prepare-release-assets.mjs'
import { applyPagesOverlay } from './apply-pages-overlay.mjs'
import { verifyPagesOverlay } from './verify-pages-overlay.mjs'
import {
  DEFAULT_ROOT,
  TOKEN_ENV,
  CSS_NAME,
  isMain,
  readSiteFiles,
  requireContract,
  resolveSite,
} from './pages-overlay-contract.mjs'

export const PAGES_OVERLAY_TEST_SITE = 'test-results/pages-overlay-fixture/_site'

/** @param {string} [repoRoot] */
export function preparePagesOverlayTest(repoRoot = DEFAULT_ROOT) {
  const root = fs.realpathSync(repoRoot)
  const dist = path.join(root, 'dist')
  const baseline = readSiteFiles(dist)
  const site = path.join(root, PAGES_OVERLAY_TEST_SITE)
  const fixtureRoot = path.dirname(site)
  for (const dir of [path.dirname(fixtureRoot), fixtureRoot]) {
    fs.mkdirSync(dir, { recursive: true })
    requireContract(
      fs.realpathSync(dir) === dir,
      'Pages test output must not resolve through a symlink',
    )
  }
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pmbus-pages-fixture-'))
  try {
    fs.copyFileSync(path.join(root, 'package.json'), path.join(temp, 'package.json'))
    const output = path.join(temp, 'release-output')
    // Exercises the real deterministic packager, checksum and ZIP safety gate.
    const { zipName, sumsName } = generateAssets(dist, output)
    const zip = path.join(output, zipName)
    const originalZip = fs.readFileSync(zip)
    const sums = fs.readFileSync(path.join(output, sumsName))
    if (fs.lstatSync(site, { throwIfNoEntry: false })) {
      fs.rmSync(resolveSite('_site', fixtureRoot), { recursive: true })
    }
    extractReleaseZip(zip, site)
    const env = { GITHUB_REPOSITORY: PAGES_REPOSITORY, [TOKEN_ENV]: '0'.repeat(32) }
    applyPagesOverlay('_site', { repoRoot: fixtureRoot, env })
    const verified = verifyPagesOverlay('_site', { repoRoot: fixtureRoot, env })
    requireContract(
      originalZip.equals(fs.readFileSync(zip)) &&
        sums.equals(fs.readFileSync(path.join(output, sumsName))),
      'Overlay changed Release assets',
    )
    const final = readSiteFiles(site)
    const distAfter = readSiteFiles(dist)
    requireContract(
      final.size === baseline.size + 1 && final.has(CSS_NAME),
      'Overlay changed the Release file inventory unexpectedly',
    )
    requireContract(distAfter.size === baseline.size, 'Overlay changed dist file inventory')
    for (const [name, bytes] of baseline) {
      requireContract(Boolean(distAfter.get(name)?.equals(bytes)), 'Overlay changed dist bytes')
      if (name !== 'index.html')
        requireContract(Boolean(final.get(name)?.equals(bytes)), 'Overlay changed a Release asset')
    }
    return {
      ...verified,
      site: PAGES_OVERLAY_TEST_SITE,
      scope: 'synthetic local fixture',
      releaseZipUnchanged: true,
      releaseFiles: baseline.size,
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true })
  }
}

if (isMain(import.meta.url)) {
  try {
    requireContract(
      process.argv.length === 2,
      'usage: prepare-pages-overlay-test.mjs (no arguments)',
    )
    console.log(JSON.stringify(preparePagesOverlayTest()))
  } catch {
    // The fixture must never accidentally log a deployment secret inherited
    // from the caller, even when third-party packaging/I/O code throws.
    console.error('Local Pages fixture failed; verify dist, staging paths and Release ZIP contract')
    process.exitCode = 1
  }
}
