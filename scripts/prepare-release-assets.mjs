import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  OUTPUT_DIR,
  STAGING_DIR,
  isReleaseZipName,
  isStableReleaseVersion,
  releaseAssetNames,
} from './release-artifact-contract.mjs'

const repoRoot = fileURLToPath(new URL('../', import.meta.url))
const zipScript = fileURLToPath(new URL('./release-zip.py', import.meta.url))

/** @param {string[]} args */
function runZip(args) {
  const { status, signal, error, stderr } = spawnSync(
    process.env.PYTHON3 || 'python3',
    [zipScript, ...args],
    {
      encoding: 'utf8',
      timeout: 60_000,
    },
  )
  if (error) throw error
  if (status !== 0) throw new Error(stderr.trim() || `ZIP command stopped (${signal ?? status})`)
}

/** @param {string} zip @param {string} destination */
export function extractReleaseZip(zip, destination) {
  runZip(['extract', zip, destination])
}

/** @param {string} outputDir @param {boolean} force @param {string} sumsName */
function checkExistingOutput(outputDir, force, sumsName) {
  const existing = fs.lstatSync(outputDir, { throwIfNoEntry: false })
  if (!existing) return false
  if (!force)
    throw new Error(`Assets directory already exists: ${outputDir}. Use --force to replace it.`)
  if (existing.isDirectory()) {
    const entries = fs.readdirSync(outputDir, { withFileTypes: true })
    if (
      entries.length === 2 &&
      entries.every((entry) => entry.isFile()) &&
      entries.some((entry) => entry.name === sumsName) &&
      entries.some((entry) => isReleaseZipName(entry.name))
    )
      return true
  }
  throw new Error(
    `Refusing to replace ${outputDir}: expected only a release ZIP and SHA256SUMS.txt`,
  )
}

/** @param {string} distDir @param {string} outputDir @param {boolean} [force] */
export function generateAssets(distDir, outputDir, force = false) {
  const root = path.dirname(outputDir)
  const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  if (!isStableReleaseVersion(version))
    throw new Error('package.json must contain a stable release version')

  const { zipName, sumsName } = releaseAssetNames(`v${version}`)
  checkExistingOutput(outputDir, force, sumsName)
  const stagingRoot = path.join(root, STAGING_DIR)
  fs.mkdirSync(stagingRoot, { recursive: true })
  const staging = fs.mkdtempSync(path.join(stagingRoot, 'run-'))
  const assets = path.join(staging, 'assets')
  const backup = path.join(staging, 'previous')
  let keepBackup = false
  try {
    fs.mkdirSync(assets)
    const zip = path.join(assets, zipName)
    runZip(['create', distDir, zip])
    const bytes = fs.readFileSync(zip)
    const digest = createHash('sha256').update(bytes).digest('hex')
    fs.writeFileSync(path.join(assets, sumsName), `${digest}  ${zipName}\n`)

    const replace = checkExistingOutput(outputDir, force, sumsName)
    if (replace) fs.renameSync(outputDir, backup)
    try {
      // Check what was actually moved before discarding the previous output.
      if (replace) checkExistingOutput(backup, true, sumsName)
      fs.renameSync(assets, outputDir)
    } catch (error) {
      if (replace) {
        try {
          fs.renameSync(backup, outputDir)
        } catch {
          keepBackup = true
          throw new Error(
            `Could not move the new assets into place. Previous assets are in ${backup}`,
            {
              cause: error,
            },
          )
        }
      }
      throw error
    }
    return { zipName, sumsName, zipSize: bytes.length }
  } finally {
    if (!keepBackup) fs.rmSync(staging, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2)
  const force = args.length === 1 && args[0] === '--force'
  if (args.length > 0 && !force) {
    console.error('Usage: node scripts/prepare-release-assets.mjs [--force]')
    process.exitCode = 2
  } else {
    try {
      const { zipName, sumsName, zipSize } = generateAssets(
        path.join(repoRoot, 'dist'),
        path.join(repoRoot, OUTPUT_DIR),
        force,
      )
      console.log(`Prepared ${zipName} (${zipSize} bytes) and ${sumsName}.`)
    } catch (error) {
      console.error(error instanceof Error ? error.message : error)
      process.exitCode = 1
    }
  }
}
