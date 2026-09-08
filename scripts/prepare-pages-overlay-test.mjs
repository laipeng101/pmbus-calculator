#!/usr/bin/env node
// Explicit local/PR fixture preparation, never called by build or Pages deploy.
// Uses a synthetic token even if the caller has a real deployment secret.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { generateAssets, runExecFile } from './prepare-release-assets.mjs'
import { applyPagesOverlay } from './apply-pages-overlay.mjs'
import { verifyPagesOverlay } from './verify-pages-overlay.mjs'
import {
  DEFAULT_ROOT,
  REPOSITORY,
  TOKEN_ENV,
  CSS_NAME,
  assertNoOverlayContamination,
  indexText,
  isMain,
  readSiteFiles,
  requireContract,
  resolveSite,
  verifyIndex,
} from './pages-overlay-contract.mjs'

/** @param {string} [repoRoot] */
export async function preparePagesOverlayTest(repoRoot = DEFAULT_ROOT) {
  const root = fs.realpathSync(repoRoot)
  const dist = path.join(root, 'dist')
  const baseline = readSiteFiles(dist)
  assertNoOverlayContamination(baseline)
  verifyIndex(indexText(/** @type {Buffer} */ (baseline.get('index.html'))), baseline, null)
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pmbus-pages-fixture-'))
  const site = path.join(root, '_site')
  try {
    fs.copyFileSync(path.join(root, 'package.json'), path.join(temp, 'package.json'))
    fs.cpSync(dist, path.join(temp, 'dist'), { recursive: true })
    const output = path.join(temp, 'release-output')
    // Exercises the real deterministic packager, checksum and ZIP safety gate.
    const { plan } = await generateAssets(path.join(temp, 'dist'), output, false)
    const zip = path.join(output, plan.zipName)
    const originalZip = fs.readFileSync(zip)
    const sums = fs.readFileSync(path.join(output, plan.sumsName))
    if (fs.lstatSync(site, { throwIfNoEntry: false })) {
      // This one ignored, rebuildable target is the same clean-policy target.
      // Reject symlinks/special files before replacing an earlier test fixture.
      readSiteFiles(resolveSite('_site', root))
      fs.rmSync(site, { recursive: true })
    }
    fs.mkdirSync(site)
    await runExecFile(
      process.env.PYTHON3 || 'python3',
      [
        '-c',
        'import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])',
        zip,
        site,
      ],
      { timeout: 30_000 },
    )
    const env = { GITHUB_REPOSITORY: REPOSITORY, [TOKEN_ENV]: '0'.repeat(32) }
    applyPagesOverlay('_site', { repoRoot: root, env })
    const verified = verifyPagesOverlay('_site', { repoRoot: root, env })
    requireContract(
      originalZip.equals(fs.readFileSync(zip)) &&
        sums.equals(fs.readFileSync(path.join(output, plan.sumsName))),
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
    console.log(JSON.stringify(await preparePagesOverlayTest()))
  } catch {
    // The fixture must never accidentally log a deployment secret inherited
    // from the caller, even when third-party packaging/I/O code throws.
    console.error('Local Pages fixture failed; verify dist, staging paths and Release ZIP contract')
    process.exitCode = 1
  }
}
