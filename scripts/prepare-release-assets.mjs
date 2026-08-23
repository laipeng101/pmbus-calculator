// Deterministic, transactional release asset generation (M24, hardened M25).
//
// Generates reproducible pmbus-calculator-vX.Y.Z-web.zip and SHA256SUMS.txt
// from the final dist/ directory. Key properties:
// - Version is read from package.json (single source of truth).
// - Asset naming from shared contract (scripts/release-artifact-contract.mjs).
// - Zip contents are sorted, timestamped at DOS epoch, no extra fields.
// - Same dist/ + same Python/zlib toolchain → same zip bytes.
// - Fail-closed Dirent classification: no silent skip of symlinks/special files.
// - Transactional publish with staging, backup, and rollback.
// - Concurrency lock (one process at a time).
// - No .cache/zip-* temp files; no dynamic Python script generation.
// - Python executable is injectable via PYTHON3 environment variable.
// - Checksum verification uses Node crypto (not shell shasum).
//
// Usage:
//   node scripts/prepare-release-assets.mjs            # normal run
//   node scripts/prepare-release-assets.mjs --force    # overwrite existing
//   PYTHON3=/path/to/python3 node ...                  # inject Python

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { assetNames, validateZipEntry } from './release-artifact-contract.mjs'

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const STAGING_DIR = '.release-staging'
const LOCK_FILE = '.release-staging.lock'
const PYTHON3 = process.env.PYTHON3 || 'python3'

// ---------------------------------------------------------------------------
// walkDist -- fail-closed Dirent classification
// ---------------------------------------------------------------------------

/**
 * Recursively collect regular files from a directory. Fails on:
 * - symlinks (file or directory)
 * - FIFO, socket, device, or any non-regular non-directory type
 * - unknown Dirent types
 *
 * @param {string} dir
 * @returns {string[]} -- absolute paths to regular files, sorted
 */
export function walkDist(dir) {
  /** @type {string[]} */
  const files = []
  /** @type {fs.Dirent[]} */
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch (e) {
    throw new Error(`cannot read directory ${dir}: ${/** @type {Error} */ (e).message}`)
  }
  entries.sort((a, b) => a.name.localeCompare(b.name))

  for (const entry of entries) {
    const full = path.join(dir, entry.name)

    if (entry.isSymbolicLink()) {
      throw new Error(`symlink not allowed in dist: ${full}`)
    }
    if (entry.isDirectory()) {
      files.push(...walkDist(full))
    } else if (entry.isFile()) {
      files.push(full)
    } else if (entry.isFIFO()) {
      throw new Error(`FIFO not allowed in dist: ${full}`)
    } else if (entry.isSocket()) {
      throw new Error(`socket not allowed in dist: ${full}`)
    } else if (entry.isBlockDevice() || entry.isCharacterDevice()) {
      throw new Error(`device file not allowed in dist: ${full}`)
    } else {
      // Unknown Dirent type -- fail closed
      throw new Error(`unknown file type in dist: ${full}`)
    }
  }

  return files
}

// ---------------------------------------------------------------------------
// ZIP entry validation
// ---------------------------------------------------------------------------

/**
 * Validate all ZIP entries from a dist directory. Each relative path must
 * pass the shared contract's validateZipEntry.
 *
 * @param {string} distDir
 * @param {string[]} files -- absolute paths from walkDist
 * @returns {string[]} -- sorted relative POSIX paths
 */
function validateAndCollectEntries(distDir, files) {
  const entries = files.map((f) => {
    const rel = path.relative(distDir, f)
    // Must be POSIX relative
    if (path.isAbsolute(rel) || rel.startsWith('..')) {
      throw new Error(`path escapes dist: ${rel}`)
    }
    const normalized = rel.split(path.sep).join('/')
    const result = validateZipEntry(normalized)
    if (!result.ok) {
      throw new Error(`invalid zip entry: ${result.reason}`)
    }
    return normalized
  })
  return entries.sort()
}

// ---------------------------------------------------------------------------
// ZIP generation (via fixed Python helper)
// ---------------------------------------------------------------------------

/**
 * Create a deterministic ZIP using the fixed _zip_helper.py script.
 * The manifest is passed via stdin as JSON lines (not a temp file).
 *
 * @param {string} distDir
 * @param {string[]} files -- absolute paths from walkDist
 * @param {string} outputPath -- destination zip path
 * @param {string} [python3] -- injectable Python executable
 */
function createDeterministicZip(distDir, files, outputPath, python3 = PYTHON3) {
  const entries = validateAndCollectEntries(distDir, files)

  // Build manifest as JSON lines
  const manifestLines = entries.map((entry) =>
    JSON.stringify({ entry, path: path.join(distDir, entry.split('/').join(path.sep)) }),
  )
  const manifest = manifestLines.join('\n')

  const zipHelper = path.join(repoRoot, 'scripts', '_zip_helper.py')

  execFileSync(python3, [zipHelper, distDir, outputPath], {
    input: manifest,
    stdio: ['pipe', 'inherit', 'inherit'],
    timeout: 60_000,
  })
}

// ---------------------------------------------------------------------------
// Checksum generation (Node crypto, no shell)
// ---------------------------------------------------------------------------

/**
 * Generate SHA256SUMS.txt for a file using Node crypto.
 *
 * @param {string} filePath
 * @param {string} sumsPath
 */
function generateChecksums(filePath, sumsPath) {
  const data = fs.readFileSync(filePath)
  const hash = createHash('sha256').update(data).digest('hex')
  const name = path.basename(filePath)
  fs.writeFileSync(sumsPath, `${hash}  ${name}\n`)
}

/**
 * Verify a SHA256SUMS.txt file against its listed file using Node crypto.
 * Unlike shell `shasum -c`, this does not depend on platform shasum.
 *
 * @param {string} sumsPath
 * @param {string} expectedDir -- directory containing the listed file
 * @returns {boolean}
 */
function verifyChecksums(sumsPath, expectedDir) {
  const content = fs.readFileSync(sumsPath, 'utf8').trim()
  const lines = content.split('\n').filter((l) => l.length > 0)
  for (const line of lines) {
    const match = line.match(/^([0-9a-f]{64})\s{2}(.+)$/)
    if (!match) {
      throw new Error(`invalid checksum line: ${line}`)
    }
    const expectedHash = match[1]
    const fileName = match[2]
    const filePath = path.join(expectedDir, fileName)
    const actualHash = createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
    if (actualHash !== expectedHash) {
      throw new Error(
        `checksum mismatch for ${fileName}: expected ${expectedHash}, got ${actualHash}`,
      )
    }
  }
  return true
}

// ---------------------------------------------------------------------------
// Concurrency lock
// ---------------------------------------------------------------------------

/**
 * Acquire a concurrency lock. Returns a cleanup function.
 * If the lock is held by another process, throws.
 * If a stale lock is detected (no PID file or process not running), removes it.
 *
 * @param {string} repoRoot
 * @returns {() => void} -- cleanup function to release the lock
 */
function acquireLock(repoRoot) {
  const lockPath = path.join(repoRoot, LOCK_FILE)
  if (fs.existsSync(lockPath)) {
    try {
      const pid = parseInt(fs.readFileSync(lockPath, 'utf8').trim(), 10)
      if (isNaN(pid) || pid <= 0) {
        // Stale lock with invalid PID
        fs.unlinkSync(lockPath)
      } else {
        try {
          process.kill(pid, 0)
          throw new Error(
            `another release asset generation is in progress (PID ${pid}). ` +
              `If stale, manually remove ${LOCK_FILE}`,
          )
        } catch (e) {
          if (/** @type {{ code?: string }} */ (/** @type {unknown} */ (e)).code === 'ESRCH') {
            // Process not running -- stale lock
            fs.unlinkSync(lockPath)
          } else {
            throw e
          }
        }
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes('another release')) throw e
      // If we can't read/parse the lock, try to remove it
      try {
        fs.unlinkSync(lockPath)
      } catch {
        /* best effort */
      }
    }
  }

  fs.writeFileSync(lockPath, String(process.pid))

  return () => {
    try {
      if (fs.existsSync(lockPath)) {
        const content = fs.readFileSync(lockPath, 'utf8').trim()
        if (content === String(process.pid)) {
          fs.unlinkSync(lockPath)
        }
      }
    } catch {
      // best effort cleanup
    }
  }
}

// ---------------------------------------------------------------------------
// Transactional publish
// ---------------------------------------------------------------------------

/**
 * Detect and handle stale state from a previous interrupted run.
 * Fails closed: refuses to run if we can't determine safety.
 *
 * @param {string} repoRoot
 */
function detectStaleState(repoRoot) {
  const staging = path.join(repoRoot, STAGING_DIR)
  const output = path.join(repoRoot, 'release-output')

  if (fs.existsSync(staging)) {
    const entries = fs.readdirSync(staging)
    if (entries.length > 0) {
      throw new Error(
        `.release-staging/ is not empty (${entries.length} entries). ` +
          `A previous run may have been interrupted. Run 'npm run clean' to remove staging.`,
      )
    }
  }

  // Check for backup from interrupted --force
  const backup = path.join(repoRoot, 'release-output.backup')
  if (fs.existsSync(backup)) {
    throw new Error(
      `release-output.backup exists from a previous interrupted --force run. ` +
        `Manual audit required before proceeding.`,
    )
  }

  // Check for output without backup (normal state, OK)
  if (fs.existsSync(output) && !fs.existsSync(backup)) {
    // Normal state -- OK
  }
}

/**
 * Generate assets into a unique staging directory, verify, then publish.
 *
 * @param {string} distDir
 * @param {string} outputDir -- release-output/
 * @param {boolean} force
 * @param {string} [python3] -- injectable Python executable
 */
export function generateAssets(distDir, outputDir, force, python3 = PYTHON3) {
  const repoRoot = path.resolve(outputDir, '..')

  // Detect stale state
  detectStaleState(repoRoot)

  // Read version from package.json
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
  const version = pkg.version
  const names = assetNames(version)
  const zipPath = path.join(outputDir, names.zip)
  const sumsPath = path.join(outputDir, names.sums)

  // Check if output already exists
  const outputExists = fs.existsSync(zipPath) || fs.existsSync(sumsPath)
  if (outputExists && !force) {
    throw new Error(`Assets already exist in ${outputDir}. Use --force to overwrite.`)
  }

  // Validate dist exists
  if (!fs.existsSync(distDir) || !fs.statSync(distDir).isDirectory()) {
    throw new Error(`dist/ directory not found at ${distDir}. Run 'npm run build' first.`)
  }

  // Collect files with fail-closed walk
  const files = walkDist(distDir)

  // Create unique staging directory
  const stagingRoot = path.join(repoRoot, STAGING_DIR)
  fs.mkdirSync(stagingRoot, { recursive: true })
  const stagingDir = fs.mkdtempSync(path.join(stagingRoot, 'run-'))
  const stagingZip = path.join(stagingDir, names.zip)
  const stagingSums = path.join(stagingDir, names.sums)

  let backupDir = null
  let published = false

  try {
    // 1. Generate into staging
    console.log(`Creating ${names.zip} ...`)
    createDeterministicZip(distDir, files, stagingZip, python3)

    console.log(`Creating ${names.sums} ...`)
    generateChecksums(stagingZip, stagingSums)

    // 2. Verify staging
    console.log('Verifying checksum ...')
    verifyChecksums(stagingSums, stagingDir)

    console.log('Verifying zip with verify_release_zip.py ...')
    const verifyScript = path.join(
      repoRoot,
      '.github',
      'workflows',
      'scripts',
      'verify_release_zip.py',
    )
    execFileSync(python3, [verifyScript, stagingZip], {
      stdio: 'inherit',
      timeout: 30_000,
    })

    // 3. Verify staging contains exactly the two expected assets
    const stagingEntries = fs.readdirSync(stagingDir).filter((e) => e !== '.' && e !== '..')
    if (stagingEntries.length !== 2) {
      throw new Error(`staging directory contains ${stagingEntries.length} entries, expected 2`)
    }

    // 4. Publish
    if (outputExists && force) {
      // Transactional: backup → staging → output
      backupDir = path.join(repoRoot, 'release-output.backup')
      fs.mkdirSync(outputDir, { recursive: true })
      fs.renameSync(outputDir, backupDir)

      try {
        fs.renameSync(stagingDir, outputDir)
        published = true

        // Quick re-verify
        console.log('Verifying published checksum ...')
        verifyChecksums(sumsPath, outputDir)
        console.log('Verifying published zip ...')
        execFileSync(python3, [verifyScript, zipPath], {
          stdio: 'inherit',
          timeout: 30_000,
        })
      } catch (e) {
        // Rollback: restore old output
        if (published) {
          try {
            fs.rmSync(outputDir, { recursive: true, force: true })
          } catch {
            /* best effort */
          }
        }
        fs.renameSync(backupDir, outputDir)
        throw e
      }

      // Success -- delete backup
      fs.rmSync(backupDir, { recursive: true, force: true })
      backupDir = null
    } else {
      // First-time publish
      fs.mkdirSync(outputDir, { recursive: true })
      fs.renameSync(stagingDir, outputDir)
      published = true
    }

    const zipSize = fs.statSync(zipPath).size
    console.log(`\nDone: ${names.zip} (${zipSize} bytes)`)
    console.log(`      ${names.sums}`)
  } finally {
    // Clean up staging residue
    if (!published && fs.existsSync(stagingDir)) {
      try {
        fs.rmSync(stagingDir, { recursive: true, force: true })
      } catch {
        /* best effort */
      }
    }

    // If --force failed after backup, restore old output
    if (backupDir && fs.existsSync(backupDir)) {
      if (published) {
        try {
          fs.rmSync(outputDir, { recursive: true, force: true })
        } catch {
          /* best effort */
        }
      }
      try {
        fs.renameSync(backupDir, outputDir)
      } catch {
        /* best effort */
      }
    }

    // Clean up empty staging root
    try {
      const remaining = fs.readdirSync(stagingRoot)
      if (remaining.length === 0) {
        fs.rmdirSync(stagingRoot)
      }
    } catch {
      // best effort
    }
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2)
  let force = false
  for (const arg of args) {
    if (arg === '--force') {
      force = true
    } else {
      process.stderr.write(`unknown option: ${arg}\n`)
      process.exit(2)
    }
  }

  const distDir = path.join(repoRoot, 'dist')
  const outputDir = path.join(repoRoot, 'release-output')

  // Acquire concurrency lock
  const releaseLock = acquireLock(repoRoot)

  try {
    generateAssets(distDir, outputDir, force, PYTHON3)
  } catch (e) {
    process.stderr.write(`release:prepare-assets failed: ${/** @type {Error} */ (e).message}\n`)
    process.exit(1)
  } finally {
    releaseLock()
  }
}

const isDirectRun =
  typeof process.argv[1] === 'string' &&
  process.argv[1].length > 0 &&
  fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(process.argv[1])

if (isDirectRun) {
  main()
}
