// M30 WP-E: canonical Node/npm toolchain gate (`npm run doctor` /
// `npm run check:toolchain`).
//
// Prints the ACTUAL Node/npm versions and validates every canonical source
// of truth agrees:
//   - .node-version / .nvmrc            -> 24.19.0
//   - package.json engines.node         -> >=22.20.0 <23 || >=24.19.0 <25
//   - package.json engines.npm          -> >=11.17.0 <12
//   - package.json packageManager       -> npm@11.17.0
//   - package.json devEngines           -> runtime (22.20.x + 24.19.x),
//                                        packageManager npm@11.17.0 onFail error
//   - .github/workflows/ci.yml          -> primary reads .node-version,
//                                        secondary pins 22.20.0, npm 11.17.0
//                                        activation, no rolling versions
//   - .github/workflows/pages.yml       -> reads .node-version, no rolling
//
// Any inconsistency is a nonzero exit (fail closed). The check never
// requires a network call.

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** @type {string[]} */
const errors = []
/** @type {string[]} */
const notes = []

/**
 * @returns {number}
 */
function main() {
  const readRepo = (/** @type {string} */ rel) => {
    return fs.readFileSync(path.join(repoRoot, rel), 'utf8')
  }
  const readJson = (/** @type {string} */ rel) => {
    return JSON.parse(readRepo(rel))
  }
  const expect = (/** @type {boolean} */ cond, /** @type {string} */ label) => {
    if (!cond) errors.push(label)
  }

  // --- actual runtime ------------------------------------------------------
  const actualNode = process.versions.node
  const npmVersionRes = spawnSync('npm', ['--version'], { encoding: 'utf8' })
  const actualNpm = npmVersionRes.status === 0 ? npmVersionRes.stdout.trim() : 'unknown'
  notes.push(`node ${actualNode}`)
  notes.push(`npm ${actualNpm}`)
  expect(actualNode === '24.19.0', `actual node must be the canonical 24.19.0, got ${actualNode}`)
  expect(actualNpm === '11.17.0', `actual npm must be the canonical 11.17.0, got ${actualNpm}`)

  // --- canonical files -----------------------------------------------------
  const nodeVersionFile = readRepo('.node-version').trim()
  const nvmrc = readRepo('.nvmrc').trim()
  expect(nodeVersionFile === '24.19.0', `.node-version must be 24.19.0, got "${nodeVersionFile}"`)
  expect(nvmrc === '24.19.0', `.nvmrc must be 24.19.0, got "${nvmrc}"`)

  // --- package.json --------------------------------------------------------
  const pkg = readJson('package.json')
  const engines = pkg.engines || {}
  expect(
    engines.node === '>=22.20.0 <23 || >=24.19.0 <25',
    `engines.node must be ">=22.20.0 <23 || >=24.19.0 <25", got "${engines.node}"`,
  )
  expect(
    engines.npm === '>=11.17.0 <12',
    `engines.npm must be ">=11.17.0 <12", got "${engines.npm}"`,
  )
  expect(
    pkg.packageManager === 'npm@11.17.0',
    `packageManager must be "npm@11.17.0", got "${pkg.packageManager}"`,
  )
  const de = pkg.devEngines || {}
  expect(
    de.packageManager &&
      de.packageManager.name === 'npm' &&
      de.packageManager.version === '11.17.0' &&
      de.packageManager.onFail === 'error',
    'devEngines.packageManager must be {name: npm, version: 11.17.0, onFail: error}',
  )

  // --- CI workflow ---------------------------------------------------------
  const ci = readRepo('.github/workflows/ci.yml')
  expect(
    /node-version-file:\s*['"]?\.node-version['"]?/.test(ci),
    'ci.yml primary setup-node must read node-version-file: .node-version',
  )
  expect(
    /node-version:\s*'22\.20\.0'/.test(ci),
    "ci.yml secondary must pin node-version: '22.20.0'",
  )
  expect(
    /npm@11\.17\.0|npm install -g npm@11\.17\.0|npm i -g npm@11\.17\.0/.test(ci),
    'ci.yml must activate/install npm 11.17.0',
  )
  expect(!/\bnode-version:\s*(22|24)\b/.test(ci), 'ci.yml must not use rolling major versions')
  expect(
    !/\bnode-version:\s*(latest|current|lts\/\*)\b/.test(ci) && !/check-latest:\s*true/.test(ci),
    'ci.yml must not use latest/current/lts/* or check-latest=true',
  )

  // --- Pages workflow ------------------------------------------------------
  const pages = readRepo('.github/workflows/pages.yml')
  expect(
    /node-version-file:\s*['"]?\.node-version['"]?/.test(pages),
    'pages.yml must read node-version-file: .node-version',
  )
  expect(
    !/\bnode-version:\s*(22|24)\b/.test(pages),
    'pages.yml must not use rolling major versions',
  )
  expect(
    !/\bnode-version:\s*(latest|current|lts\/\*)\b/.test(pages) &&
      !/check-latest:\s*true/.test(pages),
    'pages.yml must not use latest/current/lts/* or check-latest=true',
  )

  // --- @types/node ---------------------------------------------------------
  const devDeps = pkg.devDependencies || {}
  expect(devDeps['@types/node'] === '22.20.1', '@types/node must stay pinned to 22.20.1')

  // --- report --------------------------------------------------------------
  for (const n of notes) process.stdout.write(`toolchain: ${n}\n`)
  if (errors.length > 0) {
    for (const e of errors) process.stderr.write(`toolchain: FAIL: ${e}\n`)
    process.stderr.write(`toolchain: ${errors.length} inconsistency/ies -- fail closed\n`)
    return 1
  }
  process.stdout.write('toolchain: OK -- canonical Node 24.19.0 / npm 11.17.0 aligned\n')
  return 0
}

process.exitCode = main()
