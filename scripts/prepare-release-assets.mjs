// Deterministic, transactional release asset generation (M25, hardened M26).
//
// Generates reproducible pmbus-calculator-vX.Y.Z-web.zip and SHA256SUMS.txt
// from the final dist/ directory. Key properties:
// - Version is read from package.json (single source of truth).
// - Asset naming from shared contract (scripts/release-artifact-contract.mjs).
// - Zip contents are sorted, timestamped at DOS epoch, no extra fields.
// - Same dist/ + same Python/zlib toolchain -- same zip bytes.
// - Fail-closed Dirent classification: no silent skip of symlinks/special files.
// - Transactional publish with explicit state machine and recovery.
// - Atomic O_EXCL concurrency lock with ownership metadata.
// - No .cache/zip-* temp files; no dynamic Python script generation.
// - Python executable is injectable via PYTHON3 environment variable.
// - Checksum verification uses Node crypto (not shell shasum).
//
// Usage:
//   node scripts/prepare-release-assets.mjs              # normal run
//   node scripts/prepare-release-assets.mjs --force      # overwrite existing
//   node scripts/prepare-release-assets.mjs --recover    # recover from interrupt
//   node scripts/prepare-release-assets.mjs --recover-lock  # recover stale lock
//   PYTHON3=/path/to/python3 node ...                    # inject Python

import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
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
const LOCK_SCHEMA_VERSION = 1
const PYTHON3 = process.env.PYTHON3 || 'python3'

// ---------------------------------------------------------------------------
// getReleasePlan -- behavioral artifact contract (WP-E)
// ---------------------------------------------------------------------------

/**
 * Return the actual release plan a generator would use for a given version.
 * This is a pure function with no side effects. check-release-contract must
 * call this (or --print-plan-json) instead of grepping source strings.
 *
 * @param {string} version -- plain semver from package.json
 * @returns {{
 *   tag: string,
 *   zipName: string,
 *   sumsName: string,
 *   stagingDir: string,
 *   outputDir: string,
 *   pagesZipTemplate: string,
 *   contractSchemaVersion: number,
 * }}
 */
export function getReleasePlan(version) {
  const names = assetNames(version)
  return {
    tag: `v${version}`,
    zipName: names.zip,
    sumsName: names.sums,
    stagingDir: STAGING_DIR,
    outputDir: 'release-output',
    pagesZipTemplate: 'pmbus-calculator-${RELEASE_TAG}-web.zip',
    contractSchemaVersion: LOCK_SCHEMA_VERSION,
  }
}

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
 * @param {{ execFile?: typeof execFileSync }} [deps]
 */
function createDeterministicZip(distDir, files, outputPath, python3 = PYTHON3, deps) {
  const execFile = (deps && deps.execFile) || execFileSync
  const entries = validateAndCollectEntries(distDir, files)

  // Build manifest as JSON lines
  const manifestLines = entries.map((entry) =>
    JSON.stringify({ entry, path: path.join(distDir, entry.split('/').join(path.sep)) }),
  )
  const manifest = manifestLines.join('\n')

  const zipHelper = path.join(repoRoot, 'scripts', '_zip_helper.py')

  execFile(python3, [zipHelper, distDir, outputPath], {
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
 * @param {{ writeFileSync?: typeof fs.writeFileSync, readFileSync?: typeof fs.readFileSync, createHash?: typeof createHash }} [deps]
 */
function generateChecksums(filePath, sumsPath, deps) {
  const readFileSync = (deps && deps.readFileSync) || fs.readFileSync
  const writeFileSync = (deps && deps.writeFileSync) || fs.writeFileSync
  const hashFn = (deps && deps.createHash) || createHash
  const data = readFileSync(filePath)
  const hash = hashFn('sha256').update(data).digest('hex')
  const name = path.basename(filePath)
  writeFileSync(sumsPath, `${hash}  ${name}\n`)
}

/**
 * Verify a SHA256SUMS.txt file against its listed file using Node crypto.
 *
 * @param {string} sumsPath
 * @param {string} expectedDir -- directory containing the listed file
 * @param {{ readFileSync?: typeof fs.readFileSync, createHash?: typeof createHash }} [deps]
 * @returns {boolean}
 */
function verifyChecksums(sumsPath, expectedDir, deps) {
  const readFileSync = (deps && deps.readFileSync) || fs.readFileSync
  const hashFn = (deps && deps.createHash) || createHash
  const content = readFileSync(sumsPath, 'utf8').trim()
  const lines = content.split('\n').filter((l) => l.length > 0)
  for (const line of lines) {
    const match = line.match(/^([0-9a-f]{64})\s{2}(.+)$/)
    if (!match) {
      throw new Error(`invalid checksum line: ${line}`)
    }
    const expectedHash = match[1]
    const fileName = match[2]
    const filePath = path.join(expectedDir, fileName)
    const actualHash = hashFn('sha256').update(readFileSync(filePath)).digest('hex')
    if (actualHash !== expectedHash) {
      throw new Error(
        `checksum mismatch for ${fileName}: expected ${expectedHash}, got ${actualHash}`,
      )
    }
  }
  return true
}

// ---------------------------------------------------------------------------
// Atomic concurrency lock with ownership (WP-A)
// ---------------------------------------------------------------------------

/**
 * @typedef {{
 *   schemaVersion: number,
 *   pid: number,
 *   startedAt: string,
 *   nonce: string,
 *   repoRealpath: string,
 * }} LockMetadata
 */

/**
 * Acquire a concurrency lock using O_CREAT|O_EXCL (atomic).
 *
 * Lock content is structured JSON with ownership metadata. The lock is
 * only cleaned up when nonce, PID, and repo all match the creating process.
 *
 * Invalid JSON, EPERM, unknown PID, or ambiguous locks are NOT auto-deleted.
 * Use --recover-lock for explicit recovery.
 *
 * @param {string} repoRoot
 * @param {{ openSync?: typeof fs.openSync, writeSync?: typeof fs.writeSync, closeSync?: typeof fs.closeSync, existsSync?: typeof fs.existsSync, readFileSync?: typeof fs.readFileSync, unlinkSync?: typeof fs.unlinkSync, realpathSync?: typeof fs.realpathSync }} [deps]
 * @returns {{ release: () => void, nonce: string }}
 */
export function acquireLock(repoRoot, deps) {
  const openSync = (deps && deps.openSync) || fs.openSync
  const writeSync = (deps && deps.writeSync) || fs.writeSync
  const closeSync = (deps && deps.closeSync) || fs.closeSync
  const existsSync = (deps && deps.existsSync) || fs.existsSync
  const readFileSync = (deps && deps.readFileSync) || fs.readFileSync
  const unlinkSync = (deps && deps.unlinkSync) || fs.unlinkSync
  const realpathSync = (deps && deps.realpathSync) || fs.realpathSync

  const lockPath = path.join(repoRoot, LOCK_FILE)
  const nonce = randomUUID()
  const repoRealpath = realpathSync(repoRoot)

  /** @type {LockMetadata} */
  const metadata = {
    schemaVersion: LOCK_SCHEMA_VERSION,
    pid: process.pid,
    startedAt: new Date().toISOString(),
    nonce,
    repoRealpath,
  }

  // Atomic O_CREAT|O_EXCL: 'wx' flag
  let fd
  try {
    fd = openSync(lockPath, 'wx', 0o600)
  } catch (e) {
    const err = /** @type {{ code?: string }} */ (/** @type {unknown} */ (e))
    if (err.code === 'EEXIST') {
      // Lock exists -- read and diagnose
      /** @type {LockMetadata | null} */
      let existing = null
      let parseError = false
      try {
        const raw = readFileSync(lockPath, 'utf8')
        existing = JSON.parse(raw)
      } catch {
        parseError = true
      }

      if (parseError || !existing || typeof existing.pid !== 'number') {
        throw new Error(
          `Lock file ${LOCK_FILE} exists but contains invalid data. ` +
            `Use --recover-lock to inspect and recover manually.`,
        )
      }

      // Check if the owning process is still alive
      let alive = false
      try {
        process.kill(existing.pid, 0)
        alive = true
      } catch (ke) {
        const kerr = /** @type {{ code?: string }} */ (/** @type {unknown} */ (ke))
        if (kerr.code === 'ESRCH') {
          alive = false
        } else if (kerr.code === 'EPERM') {
          // Process exists but we don't have permission to signal it
          throw new Error(
            `Lock held by PID ${existing.pid} (permission denied). ` +
              `Cannot determine if it's stale. Use --recover-lock for manual recovery.`,
          )
        } else {
          throw ke
        }
      }

      if (alive) {
        throw new Error(
          `Another release asset generation is in progress (PID ${existing.pid}). ` +
            `If this is stale, use --recover-lock.`,
        )
      }

      // Process is dead, but we don't auto-delete. Require explicit recovery.
      throw new Error(
        `Lock file ${LOCK_FILE} exists but PID ${existing.pid} is not running. ` +
          `Use --recover-lock to recover.`,
      )
    }
    throw e
  }

  // Write lock metadata
  writeSync(fd, JSON.stringify(metadata) + '\n')
  closeSync(fd)

  let released = false

  return {
    nonce,
    release() {
      if (released) return
      released = true
      try {
        if (!existsSync(lockPath)) return
        const raw = readFileSync(lockPath, 'utf8')
        /** @type {LockMetadata} */
        let parsed
        try {
          parsed = JSON.parse(raw)
        } catch {
          // Can't parse -- don't touch
          return
        }
        // Only delete if nonce, PID, and repo all match
        if (
          parsed.nonce === nonce &&
          parsed.pid === process.pid &&
          parsed.repoRealpath === repoRealpath
        ) {
          unlinkSync(lockPath)
        }
      } catch {
        // best effort
      }
    },
  }
}

/**
 * Attempt to recover a stale lock. Only succeeds when the lock is provably
 * dead and belongs to this repo.
 *
 * @param {string} repoRoot
 * @param {{ existsSync?: typeof fs.existsSync, readFileSync?: typeof fs.readFileSync, unlinkSync?: typeof fs.unlinkSync, realpathSync?: typeof fs.realpathSync }} [deps]
 * @returns {{ recovered: boolean, reason?: string }}
 */
export function recoverLock(repoRoot, deps) {
  const existsSync = (deps && deps.existsSync) || fs.existsSync
  const readFileSync = (deps && deps.readFileSync) || fs.readFileSync
  const unlinkSync = (deps && deps.unlinkSync) || fs.unlinkSync
  const realpathSync = (deps && deps.realpathSync) || fs.realpathSync

  const lockPath = path.join(repoRoot, LOCK_FILE)

  if (!existsSync(lockPath)) {
    return { recovered: false, reason: 'no lock file found' }
  }

  /** @type {LockMetadata | null} */
  let metadata = null
  try {
    const raw = readFileSync(lockPath, 'utf8')
    metadata = JSON.parse(raw)
  } catch {
    return {
      recovered: false,
      reason: `lock file ${LOCK_FILE} contains invalid JSON -- manual audit required`,
    }
  }

  if (!metadata || typeof metadata.pid !== 'number' || !metadata.nonce || !metadata.repoRealpath) {
    return {
      recovered: false,
      reason: `lock file ${LOCK_FILE} has incomplete metadata -- manual audit required`,
    }
  }

  // Check repo match
  const currentRepoRealpath = realpathSync(repoRoot)
  if (metadata.repoRealpath !== currentRepoRealpath) {
    return {
      recovered: false,
      reason: `lock belongs to a different repo: ${metadata.repoRealpath}`,
    }
  }

  // Check PID is dead
  try {
    process.kill(metadata.pid, 0)
    return { recovered: false, reason: `PID ${metadata.pid} is still running -- cannot recover` }
  } catch (e) {
    const kerr = /** @type {{ code?: string }} */ (/** @type {unknown} */ (e))
    if (kerr.code === 'EPERM') {
      return {
        recovered: false,
        reason: `PID ${metadata.pid} status unknown (EPERM) -- manual audit required`,
      }
    }
    if (kerr.code !== 'ESRCH') {
      return {
        recovered: false,
        reason: `cannot determine PID ${metadata.pid} status: ${/** @type {Error} */ (/** @type {unknown} */ (e)).message || kerr}`,
      }
    }
    // ESRCH -- process not running, safe to recover
  }

  unlinkSync(lockPath)
  return { recovered: true }
}

// ---------------------------------------------------------------------------
// Transaction state machine (WP-B)
// ---------------------------------------------------------------------------

/**
 * Detect stale state from a previous interrupted run.
 * Fails closed: refuses to run if we can't determine safety.
 *
 * @param {string} repoRoot
 * @param {{ existsSync?: typeof fs.existsSync, readdirSync?: typeof fs.readdirSync }} [deps]
 */
function detectStaleState(repoRoot, deps) {
  const existsSync = (deps && deps.existsSync) || fs.existsSync
  const readdirSync = (deps && deps.readdirSync) || fs.readdirSync

  const staging = path.join(repoRoot, STAGING_DIR)

  if (existsSync(staging)) {
    const entries = readdirSync(staging)
    if (entries.length > 0) {
      throw new Error(
        `.release-staging/ is not empty (${entries.length} entries). ` +
          `A previous run may have been interrupted. Run 'npm run clean' to remove staging.`,
      )
    }
  }

  // Check for backup from interrupted --force
  const backups = readdirSync(repoRoot).filter((e) => e.startsWith('release-output.backup'))
  if (backups.length > 0) {
    throw new Error(
      `Backup directories exist: ${backups.join(', ')}. ` +
        `A previous --force run may have been interrupted. Use --recover to attempt recovery.`,
    )
  }
}

/**
 * Verify that the output directory contains exactly the two expected assets.
 *
 * @param {string} outputDir
 * @param {string} zipName
 * @param {string} sumsName
 * @param {{ readdirSync?: typeof fs.readdirSync, existsSync?: typeof fs.existsSync }} [deps]
 */
function verifyOutputContents(outputDir, zipName, sumsName, deps) {
  const readdirSync = (deps && deps.readdirSync) || fs.readdirSync
  const existsSync = (deps && deps.existsSync) || fs.existsSync

  if (!existsSync(outputDir)) {
    throw new Error(`output directory does not exist: ${outputDir}`)
  }

  const entries = readdirSync(outputDir).filter((e) => e !== '.' && e !== '..')

  if (entries.length !== 2) {
    throw new Error(
      `output directory ${outputDir} has ${entries.length} entries (${entries.join(', ')}), expected exactly 2 (${zipName}, ${sumsName})`,
    )
  }

  const hasZip = entries.includes(zipName)
  const hasSums = entries.includes(sumsName)

  if (!hasZip || !hasSums) {
    throw new Error(
      `output directory ${outputDir} has unexpected contents: ${entries.join(', ')}. ` +
        `Expected: ${zipName}, ${sumsName}`,
    )
  }
}

/**
 * Attempt to recover from an interrupted --force run.
 * Recovery rules:
 * - output missing + only backup exists → restore from backup
 * - output and backup both exist → refuse (require manual audit)
 * - no backup → nothing to recover
 *
 * @param {string} repoRoot
 * @param {string} outputDir
 * @param {string} zipName
 * @param {string} sumsName
 * @param {{ existsSync?: typeof fs.existsSync, readdirSync?: typeof fs.readdirSync, renameSync?: typeof fs.renameSync, rmSync?: typeof fs.rmSync }} [deps]
 * @returns {{ recovered: boolean, reason?: string }}
 */
export function recoverTransaction(repoRoot, outputDir, zipName, sumsName, deps) {
  const existsSync = (deps && deps.existsSync) || fs.existsSync
  const readdirSync = (deps && deps.readdirSync) || fs.readdirSync
  const renameSync = (deps && deps.renameSync) || fs.renameSync

  // Find backup directories
  const backups = readdirSync(repoRoot).filter((e) => e.startsWith('release-output.backup'))

  if (backups.length === 0) {
    return { recovered: false, reason: 'no backup directories found' }
  }

  if (backups.length > 1) {
    return {
      recovered: false,
      reason: `multiple backup directories found: ${backups.join(', ')} -- manual audit required`,
    }
  }

  const backupDir = path.join(repoRoot, backups[0])
  const outputExists = existsSync(outputDir)

  if (outputExists) {
    return {
      recovered: false,
      reason:
        `both output and backup exist -- manual audit required. ` +
        `Compare ${outputDir} and ${backupDir} before proceeding.`,
    }
  }

  // Verify backup contents
  try {
    verifyOutputContents(backupDir, zipName, sumsName, { existsSync, readdirSync })
  } catch (e) {
    return {
      recovered: false,
      reason: `backup ${backupDir} failed verification: ${/** @type {Error} */ (e).message}`,
    }
  }

  // Restore: rename backup to output
  renameSync(backupDir, outputDir)
  return { recovered: true }
}

/**
 * Generate assets into a unique staging directory, verify, then publish
 * using a transactional state machine.
 *
 * @param {string} distDir
 * @param {string} outputDir -- release-output/
 * @param {boolean} force
 * @param {string} [python3] -- injectable Python executable
 * @param {{
 *   execFile?: typeof execFileSync,
 *   mkdirSync?: typeof fs.mkdirSync,
 *   mkdtempSync?: typeof fs.mkdtempSync,
 *   renameSync?: typeof fs.renameSync,
 *   rmSync?: typeof fs.rmSync,
 *   existsSync?: typeof fs.existsSync,
 *   readdirSync?: typeof fs.readdirSync,
 *   statSync?: typeof fs.statSync,
 *   readFileSync?: typeof fs.readFileSync,
 *   writeFileSync?: typeof fs.writeFileSync,
 *   createHash?: typeof createHash,
 * }} [deps]
 */
export function generateAssets(distDir, outputDir, force, python3 = PYTHON3, deps) {
  const mkdirSync = (deps && deps.mkdirSync) || fs.mkdirSync
  const mkdtempSync = (deps && deps.mkdtempSync) || fs.mkdtempSync
  const renameSync = (deps && deps.renameSync) || fs.renameSync
  const rmSync = (deps && deps.rmSync) || fs.rmSync
  const existsSync = (deps && deps.existsSync) || fs.existsSync
  const statSync = (deps && deps.statSync) || fs.statSync
  const readFileSync = (deps && deps.readFileSync) || fs.readFileSync

  const repoRoot = path.resolve(outputDir, '..')

  // Detect stale state
  detectStaleState(repoRoot, { existsSync, readdirSync: fs.readdirSync })

  // Read version from package.json
  const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
  const version = pkg.version
  const names = assetNames(version)
  const zipPath = path.join(outputDir, names.zip)
  const sumsPath = path.join(outputDir, names.sums)

  // Check if output already exists
  const outputExists = existsSync(zipPath) || existsSync(sumsPath)
  if (outputExists && !force) {
    throw new Error(`Assets already exist in ${outputDir}. Use --force to overwrite.`)
  }

  // If output exists, verify it's a valid asset pair
  if (outputExists && force) {
    verifyOutputContents(outputDir, names.zip, names.sums, {
      existsSync,
      readdirSync: fs.readdirSync,
    })
  }

  // Validate dist exists
  if (!existsSync(distDir) || !statSync(distDir).isDirectory()) {
    throw new Error(`dist/ directory not found at ${distDir}. Run 'npm run build' first.`)
  }

  // Collect files with fail-closed walk
  const files = walkDist(distDir)

  // Create unique staging directory with random nonce
  const stagingRoot = path.join(repoRoot, STAGING_DIR)
  mkdirSync(stagingRoot, { recursive: true })
  const stagingNonce = randomUUID().split('-')[0]
  const stagingDir = mkdtempSync(path.join(stagingRoot, `run-${stagingNonce}-`))
  const stagingZip = path.join(stagingDir, names.zip)
  const stagingSums = path.join(stagingDir, names.sums)

  /** @type {string | null} */
  let backupDir = null
  let published = false

  try {
    // Phase 1: Generate into staging
    console.log(`Creating ${names.zip} ...`)
    createDeterministicZip(distDir, files, stagingZip, python3, deps)

    console.log(`Creating ${names.sums} ...`)
    generateChecksums(stagingZip, stagingSums, deps)

    // Phase 2: Verify staging
    console.log('Verifying checksum ...')
    verifyChecksums(stagingSums, stagingDir, deps)

    console.log('Verifying zip with verify_release_zip.py ...')
    const verifyScript = path.join(
      repoRoot,
      '.github',
      'workflows',
      'scripts',
      'verify_release_zip.py',
    )
    const execFile = (deps && deps.execFile) || execFileSync
    execFile(python3, [verifyScript, stagingZip], {
      stdio: 'inherit',
      timeout: 30_000,
    })

    // Verify staging contains exactly the two expected assets
    verifyOutputContents(stagingDir, names.zip, names.sums, {
      existsSync,
      readdirSync: fs.readdirSync,
    })

    // Phase 3: Publish
    if (outputExists && force) {
      // Transactional: backup -> staging promotion -> re-verify -> delete backup
      const backupNonce = randomUUID().split('-')[0]
      backupDir = path.join(repoRoot, `release-output.backup-${backupNonce}`)

      // Step 3a: Backup old output
      renameSync(outputDir, backupDir)

      try {
        // Step 3b: Promote staging to output
        renameSync(stagingDir, outputDir)
        published = true

        // Step 3c: Re-verify published assets
        console.log('Verifying published checksum ...')
        verifyChecksums(sumsPath, outputDir, deps)
        console.log('Verifying published zip ...')
        execFile(python3, [verifyScript, zipPath], {
          stdio: 'inherit',
          timeout: 30_000,
        })

        // Step 3d: Remove backup
        rmSync(backupDir, { recursive: true, force: true })
        backupDir = null
      } catch (e) {
        // Rollback: restore old output from backup
        if (published) {
          try {
            rmSync(outputDir, { recursive: true, force: true })
          } catch {
            // best effort
          }
          published = false
        }
        renameSync(/** @type {string} */ (backupDir), outputDir)
        backupDir = null
        throw e
      }
    } else {
      // First-time publish: staging -> output directly (no backup needed)
      renameSync(stagingDir, outputDir)
      published = true
    }

    const zipSize = statSync(zipPath).size
    console.log(`\nDone: ${names.zip} (${zipSize} bytes)`)
    console.log(`      ${names.sums}`)
  } finally {
    // Clean up staging residue
    if (!published && existsSync(stagingDir)) {
      try {
        rmSync(stagingDir, { recursive: true, force: true })
      } catch {
        // best effort
      }
    }

    // If --force failed after backup, restore old output
    if (backupDir && existsSync(backupDir)) {
      if (published) {
        try {
          rmSync(outputDir, { recursive: true, force: true })
        } catch {
          // best effort
        }
      }
      try {
        renameSync(backupDir, outputDir)
      } catch {
        // best effort
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
// CLI -- returns exit code, no process.exit() in try/catch
// ---------------------------------------------------------------------------

/**
 * Parse CLI arguments and run the generator.
 *
 * @param {string[]} argv
 * @param {{
 *   stdout?: typeof process.stdout,
 *   stderr?: typeof process.stderr,
 *   env?: typeof process.env,
 * }} [io]
 * @returns {Promise<number>} exit code
 */
export async function runCli(argv, io) {
  const stdout = (io && io.stdout) || process.stdout
  const stderr = (io && io.stderr) || process.stderr
  const env = (io && io.env) || process.env

  const args = argv.slice(2)
  let force = false
  let recoverFlag = false
  let recoverLockFlag = false

  for (const arg of args) {
    if (arg === '--force') {
      force = true
    } else if (arg === '--recover') {
      recoverFlag = true
    } else if (arg === '--recover-lock') {
      recoverLockFlag = true
    } else {
      stderr.write(`unknown option: ${arg}\n`)
      stderr.write(
        'Usage: node scripts/prepare-release-assets.mjs [--force] [--recover] [--recover-lock]\n',
      )
      return 2
    }
  }

  const distDir = path.join(repoRoot, 'dist')
  const outputDir = path.join(repoRoot, 'release-output')
  const python3 = env.PYTHON3 || PYTHON3

  // Handle --recover-lock
  if (recoverLockFlag) {
    const result = recoverLock(repoRoot)
    if (result.recovered) {
      stdout.write(`Lock recovered successfully.\n`)
      return 0
    }
    stderr.write(`Lock recovery failed: ${result.reason}\n`)
    return 1
  }

  // Handle --recover
  if (recoverFlag) {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
    const names = assetNames(pkg.version)
    const result = recoverTransaction(repoRoot, outputDir, names.zip, names.sums)
    if (result.recovered) {
      stdout.write(`Transaction recovered successfully.\n`)
      return 0
    }
    stderr.write(`Transaction recovery failed: ${result.reason}\n`)
    return 1
  }

  // Acquire concurrency lock (must fail before any other work)
  let lock
  try {
    lock = acquireLock(repoRoot)
  } catch (e) {
    stderr.write(`release:prepare-assets: ${/** @type {Error} */ (e).message}\n`)
    return 1
  }

  try {
    generateAssets(distDir, outputDir, force, python3)
    return 0
  } catch (e) {
    stderr.write(`release:prepare-assets failed: ${/** @type {Error} */ (e).message}\n`)
    return 1
  } finally {
    lock.release()
  }
}

async function main() {
  process.exitCode = await runCli(process.argv)
}

const isDirectRun =
  typeof process.argv[1] === 'string' &&
  process.argv[1].length > 0 &&
  fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(process.argv[1])

if (isDirectRun) {
  main()
}
