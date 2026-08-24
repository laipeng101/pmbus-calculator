// Deterministic, transactional release asset generation (M25/M26, M27 commit semantics).
//
// Generates reproducible pmbus-calculator-vX.Y.Z-web.zip and SHA256SUMS.txt
// from the final dist/ directory. Key properties:
// - Version is read from package.json (single source of truth).
// - The release plan comes exclusively from buildReleasePlan()
//   (scripts/release-artifact-contract.mjs) — no local naming templates (WP-E).
// - Zip contents are sorted, timestamped at DOS epoch, no extra fields.
// - Same dist/ + same Python/zlib toolchain -- same zip bytes.
// - Fail-closed Dirent classification: no silent skip of symlinks/special files.
// - Explicit transaction state machine with a versioned journal and a single
//   commit point at NEW_OUTPUT_VERIFIED -> COMMITTED (WP-C).
// - One atomic O_EXCL mutex for normal, --force, AND --recover runs; only
//   --recover-lock may touch the lock file without holding it (WP-A).
// - Lock creation/release errors are loud: partial locks are cleaned by owned
//   inode, release failures propagate as LockReleaseError (WP-B).
// - No .cache/zip-* temp files; no dynamic Python script generation.
// - Python executable is injectable via PYTHON3 environment variable.
// - Checksum verification uses Node crypto (not shell shasum).
// - Every transaction transition has a named failpoint (WP-C #6); tests must
//   assert failpoint names, never createHash call counts.
//
// Usage:
//   node scripts/prepare-release-assets.mjs              # normal run
//   node scripts/prepare-release-assets.mjs --force      # overwrite existing
//   node scripts/prepare-release-assets.mjs --recover    # recover from interrupt (holds lock)
//   node scripts/prepare-release-assets.mjs --recover-lock  # recover stale lock (no lock held)
//   PYTHON3=/path/to/python3 node ...                    // inject Python

import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import {
  BACKUP_PREFIX,
  JOURNAL_FILE,
  STAGING_DIR,
  OUTPUT_DIR,
  buildReleasePlan,
  validateZipEntry,
} from './release-artifact-contract.mjs'

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Directory of this module -- static helper scripts ship with the module. */
const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const scriptRepoRoot = path.resolve(scriptDir, '..')

const LOCK_FILE = '.release-staging.lock'
const LOCK_SCHEMA_VERSION = 1
const JOURNAL_SCHEMA_VERSION = 1
const PYTHON3 = process.env.PYTHON3 || 'python3'

/**
 * Default repository root (the checkout containing this script). runCli
 * accepts an injected repoRoot so fixtures can exercise the real CLI
 * against temporary repositories (M27 WP-E #5).
 */
export const defaultRepoRoot = scriptRepoRoot

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Thrown when acquireLock or lock release fails loudly (WP-B). */
export class LockReleaseError extends Error {
  /**
   * @param {string} message
   * @param {{ code?: string }} [details]
   */
  constructor(message, details) {
    super(message)
    this.name = 'LockReleaseError'
    this.code = details && details.code ? details.code : undefined
  }
}

/** Thrown when a transaction fails and the on-disk outcome needs explanation. */
class TransactionError extends Error {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(message)
    this.name = 'TransactionError'
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
 * The helper script always resolves from the MODULE location so fixture
 * repositories do not need copies of it.
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

  const zipHelper = path.join(scriptRepoRoot, 'scripts', '_zip_helper.py')

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
// Lock metadata validation (WP-B #7)
// ---------------------------------------------------------------------------

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SHA256_HEX = /^[0-9a-f]{64}$/
const SAFE_BACKUP_NAME = /^release-output\.backup-[0-9a-zA-Z-]+$/
const STRICT_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

/**
 * Write a buffer completely using writeSync, failing fast when the
 * underlying call makes no forward progress (M28 WP-B). Zero, negative,
 * NaN, non-integer, or values larger than the remaining payload are all
 * treated as failures -- never as a license to loop forever.
 *
 * @param {number} fd
 * @param {Buffer} payload
 * @param {Record<string, any>} [deps]
 */
export function writeAllSync(fd, payload, deps = {}) {
  const writeSync =
    /** @type {(fd: number, buffer: NodeJS.ArrayBufferView, offset?: number | null, length?: number | null) => number} */ (
      (deps && deps.writeSync) || fs.writeSync
    )
  let written = 0
  while (written < payload.length) {
    const remaining = payload.length - written
    const n = writeSync(fd, payload, written, remaining)
    if (typeof n !== 'number' || !Number.isInteger(n) || n <= 0 || n > remaining) {
      throw new Error(
        `writeSync returned ${String(n)} (expected an integer in 1..${remaining}); aborting to avoid an infinite loop`,
      )
    }
    written += n
  }
}

/**
 * Parse and validate lock metadata. Unknown schema versions are rejected:
 * they must never be recovered automatically (WP-B #7).
 *
 * @param {string} raw
 * @returns {{ ok: true, metadata: LockMetadata } | { ok: false, reason: string }}
 */
export function validateLockMetadata(raw) {
  /** @type {any} */
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, reason: 'invalid JSON' }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'metadata is not an object' }
  }
  if (parsed.schemaVersion !== LOCK_SCHEMA_VERSION) {
    return {
      ok: false,
      reason: `unsupported schemaVersion ${JSON.stringify(parsed.schemaVersion)} (expected ${LOCK_SCHEMA_VERSION}) -- manual audit required`,
    }
  }
  if (typeof parsed.pid !== 'number' || !Number.isInteger(parsed.pid) || parsed.pid <= 0) {
    return { ok: false, reason: 'pid missing or invalid' }
  }
  if (typeof parsed.startedAt !== 'string' || Number.isNaN(Date.parse(parsed.startedAt))) {
    return { ok: false, reason: 'startedAt missing or not an ISO timestamp' }
  }
  if (typeof parsed.nonce !== 'string' || !UUID_PATTERN.test(parsed.nonce)) {
    return { ok: false, reason: 'nonce missing or not a UUID' }
  }
  if (typeof parsed.repoRealpath !== 'string' || parsed.repoRealpath.length === 0) {
    return { ok: false, reason: 'repoRealpath missing' }
  }
  return {
    ok: true,
    metadata: /** @type {LockMetadata} */ (parsed),
  }
}

// ---------------------------------------------------------------------------
// Atomic concurrency lock with ownership (WP-A / WP-B)
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
 * @typedef {{
 *   openSync?: (path: fs.PathLike, flags: string | number, mode?: number | null) => number,
 *   writeSync?: (fd: number, buffer: ArrayBufferView, offset?: number | null, length?: number | null) => number,
 *   closeSync?: typeof fs.closeSync,
 *   existsSync?: typeof fs.existsSync,
 *   readFileSync?: typeof fs.readFileSync,
 *   unlinkSync?: typeof fs.unlinkSync,
 *   realpathSync?: typeof fs.realpathSync,
 *   fstatSync?: typeof fs.fstatSync,
 *   lstatSync?: typeof fs.lstatSync,
 * }} LockDeps
 */

/**
 * Acquire a concurrency lock using O_CREAT|O_EXCL (atomic).
 *
 * Lock content is structured JSON with ownership metadata. Release only
 * deletes the lock when nonce, PID, repo realpath AND the original inode
 * (dev+ino captured at creation) still match -- a replaced lock is never
 * removed by us.
 *
 * Creation failures after successful open (write error, short-write loop
 * abort, close error) close the fd and remove ONLY the inode this call
 * created, then rethrow (WP-B #1/#2).
 *
 * Invalid JSON, EPERM, unknown PID, unknown schema, or ambiguous locks are
 * NOT auto-deleted. Use --recover-lock for explicit recovery.
 *
 * @param {string} repoRoot
 * @param {LockDeps} [deps]
 * @returns {{
 *   nonce: string,
 *   lockPath: string,
 *   release: () => { released: boolean, reason?: string },
 * }}
 */
export function acquireLock(repoRoot, deps) {
  const openSync = (deps && deps.openSync) || fs.openSync
  const writeSync = (deps && deps.writeSync) || fs.writeSync
  const closeSync = (deps && deps.closeSync) || fs.closeSync
  const readFileSync = (deps && deps.readFileSync) || fs.readFileSync
  const unlinkSync = (deps && deps.unlinkSync) || fs.unlinkSync
  const realpathSync = (deps && deps.realpathSync) || fs.realpathSync
  const fstatSync = (deps && deps.fstatSync) || fs.fstatSync

  const lstatSync = (deps && deps.lstatSync) || fs.lstatSync
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

  /** Remove the lock file only if it is still the exact inode we created. */
  const removeOwnedInode = () => {
    try {
      const st = lstatSync(lockPath)
      if (st.dev === createdDev && st.ino === createdIno) {
        unlinkSync(lockPath)
      }
    } catch {
      // Nothing at lockPath (already gone) or unreadable: nothing safe to do.
    }
  }

  // Atomic O_CREAT|O_EXCL: 'wx' flag
  /** @type {number} */
  let fd
  /** @type {number} */
  let createdDev = -1
  /** @type {number} */
  let createdIno = -1
  try {
    fd = openSync(lockPath, 'wx', 0o600)
  } catch (e) {
    const err = /** @type {{ code?: string }} */ (/** @type {unknown} */ (e))
    if (err.code === 'EEXIST') {
      diagnoseExistingLock(lockPath, readFileSync)
    }
    throw e
  }

  try {
    const st = fstatSync(fd)
    createdDev = st.dev
    createdIno = st.ino
  } catch (e) {
    // Without fstat we cannot prove which inode we own, so we must NOT
    // delete anything blindly. Close the fd and surface the failure.
    try {
      closeSync(fd)
    } catch {
      // fd unusable anyway
    }
    throw new Error(
      `failed to stat freshly created lock file: ${/** @type {Error} */ (e).message} -- `,
    )
  }

  // Write metadata with a progress-checked loop (M28 WP-B).
  const payload = Buffer.from(JSON.stringify(metadata) + '\n', 'utf8')
  try {
    writeAllSync(fd, payload, { writeSync })
  } catch (e) {
    try {
      closeSync(fd)
    } catch {
      // best effort -- original error must win
    }
    removeOwnedInode()
    throw new Error(`failed to write lock metadata: ${/** @type {Error} */ (e).message}. `)
  }

  try {
    closeSync(fd)
  } catch (e) {
    removeOwnedInode()
    throw new Error(`failed to close lock file descriptor: ${/** @type {Error} */ (e).message}. `)
  }

  let released = false

  return {
    nonce,
    lockPath,

    /**
     * Release the lock. Never swallows errors (WP-B #3/#4):
     * - success            -> { released: true }
     * - double release     -> { released: false, reason: 'already-released' }
     * - any other failure  -> throws LockReleaseError (lock stays on disk,
     *                         recoverable via --recover-lock)
     */
    release() {
      if (released) {
        return { released: false, reason: 'already-released' }
      }
      released = true

      /** @type {fs.Stats} */
      let st
      try {
        st = lstatSync(lockPath)
      } catch (e) {
        const err = /** @type {{ code?: string }} */ (/** @type {unknown} */ (e))
        if (err.code === 'ENOENT') {
          throw new LockReleaseError(
            `cannot release lock: ${LOCK_FILE} no longer exists (removed externally?)`,
          )
        }
        throw new LockReleaseError(
          `cannot release lock: lstat failed: ${/** @type {Error} */ (e).message}`,
        )
      }

      if (st.isSymbolicLink() || !st.isFile()) {
        throw new LockReleaseError(
          `cannot release lock: ${LOCK_FILE} is not a regular file -- manual audit required`,
        )
      }

      // Inode ownership: the lock must still be the exact file we created.
      if (!(st.dev === createdDev && st.ino === createdIno)) {
        throw new LockReleaseError(
          'cannot release lock: file was replaced after acquisition -- not deleting a foreign lock',
        )
      }

      let raw
      try {
        raw = readFileSync(lockPath, 'utf8')
      } catch (e) {
        throw new LockReleaseError(
          `cannot release lock: read failed: ${/** @type {Error} */ (e).message}`,
        )
      }
      const validated = validateLockMetadata(raw)
      if (!validated.ok) {
        throw new LockReleaseError(`cannot release lock: ${validated.reason}`)
      }
      const owned =
        validated.metadata.nonce === nonce &&
        validated.metadata.pid === process.pid &&
        validated.metadata.repoRealpath === repoRealpath
      if (!owned) {
        throw new LockReleaseError(
          'cannot release lock: metadata does not belong to this acquisition -- not deleting',
        )
      }

      try {
        unlinkSync(lockPath)
      } catch (e) {
        throw new LockReleaseError(
          `cannot release lock: unlink failed: ${/** @type {Error} */ (e).message}. `,
          /** @type {{ code?: string }} */ (/** @type {unknown} */ (e)),
        )
      }
      return { released: true }
    },
  }
}

/**
 * Diagnose an existing lock file and throw a descriptive error. Never
 * deletes anything (WP-A: only --recover-lock may remove a lock it can
 * prove dead).
 *
 * @param {string} lockPath
 * @param {typeof fs.readFileSync} readFileSync
 * @returns {never}
 */
function diagnoseExistingLock(lockPath, readFileSync) {
  /** @type {LockMetadata | null} */
  let existing = null
  let validationReason = ''
  try {
    const validated = validateLockMetadata(readFileSync(lockPath, 'utf8'))
    if (validated.ok) {
      existing = validated.metadata
    } else {
      validationReason = validated.reason
    }
  } catch (e) {
    validationReason = /** @type {Error} */ (e).message
  }

  if (!existing) {
    throw new Error(`Lock file ${LOCK_FILE} exists but cannot be used (${validationReason}). `)
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
      throw new Error(`Lock held by PID ${existing.pid} (permission denied). `)
    } else {
      throw ke
    }
  }

  if (alive) {
    throw new Error(`Another release asset generation is in progress (PID ${existing.pid}). `)
  }

  // Process is dead, but we don't auto-delete. Require explicit recovery.
  throw new Error(`Lock file ${LOCK_FILE} exists but PID ${existing.pid} is not running. `)
}

/**
 * Attempt to recover a stale lock. Only succeeds when the lock provably
 * belongs to this repo, has a known schema, complete valid metadata, and a
 * dead owner PID. Unknown schema, EPERM, or incomplete metadata require a
 * manual audit and are NEVER auto-recovered (WP-B #7).
 *
 * @param {string} repoRoot
 * @param {{
 *   existsSync?: typeof fs.existsSync,
 *   readFileSync?: typeof fs.readFileSync,
 *   unlinkSync?: typeof fs.unlinkSync,
 *   realpathSync?: typeof fs.realpathSync,
 *   lstatSync?: typeof fs.lstatSync,
 * }} [deps]
 * @returns {{ recovered: boolean, reason?: string }}
 */
export function recoverLock(repoRoot, deps) {
  const existsSync = (deps && deps.existsSync) || fs.existsSync
  const readFileSync = (deps && deps.readFileSync) || fs.readFileSync
  const unlinkSync = (deps && deps.unlinkSync) || fs.unlinkSync
  const realpathSync = (deps && deps.realpathSync) || fs.realpathSync

  const lstatSync = (deps && deps.lstatSync) || fs.lstatSync
  const lockPath = path.join(repoRoot, LOCK_FILE)

  if (!existsSync(lockPath)) {
    return { recovered: false, reason: 'no lock file found' }
  }

  // Refuse to operate on non-regular files (symlink/hardlink tricks).
  try {
    const st = lstatSync(lockPath)
    if (st.isSymbolicLink()) {
      return {
        recovered: false,
        reason: `lock file ${LOCK_FILE} is a symlink -- manual audit required`,
      }
    }
    if (!st.isFile()) {
      return {
        recovered: false,
        reason: `lock file ${LOCK_FILE} is not a regular file -- manual audit required`,
      }
    }
  } catch {
    return { recovered: false, reason: `cannot stat ${lockPath}` }
  }

  let raw = ''
  try {
    raw = readFileSync(lockPath, 'utf8')
  } catch (e) {
    return {
      recovered: false,
      reason: `lock file ${LOCK_FILE} is unreadable (${/** @type {Error} */ (e).message}) -- manual audit required`,
    }
  }

  const validated = validateLockMetadata(raw)
  if (!validated.ok) {
    return {
      recovered: false,
      reason: `lock file ${LOCK_FILE} rejected: ${validated.reason}`,
    }
  }
  const metadata = validated.metadata

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

  try {
    unlinkSync(lockPath)
  } catch (e) {
    return {
      recovered: false,
      reason: `unlink failed (${/** @type {Error} */ (e).message}) -- manual audit required`,
    }
  }
  return { recovered: true }
}

// ---------------------------------------------------------------------------
// Versioned transaction journal (WP-C #4/#5)
// ---------------------------------------------------------------------------

/**
 * @typedef {{
 *   schema: number,
 *   nonce: string,
 *   version: string,
 *   state: string,
 *   outputPath: string,
 *   backupPath: string | null,
 *   oldSha256: { zip: string, sums: string } | null,
 *   newSha256: { zip: string, sums: string },
 *   updatedAt: string,
 * }} TransactionJournal
 */

/**
 * States strictly ordered: PRE_COMMIT states precede COMMITTED.
 * INIT -> STAGING_GENERATED -> STAGING_VERIFIED -> OLD_OUTPUT_BACKED_UP
 *      -> NEW_OUTPUT_PROMOTED -> NEW_OUTPUT_VERIFIED -> COMMITTED
 *      -> BACKUP_CLEANED
 */
const STATE_ORDER = [
  'INIT',
  'STAGING_GENERATED',
  'STAGING_VERIFIED',
  'OLD_OUTPUT_BACKED_UP',
  'NEW_OUTPUT_PROMOTED',
  'NEW_OUTPUT_VERIFIED',
  'COMMITTED',
  'BACKUP_CLEANED',
]

/**
 * @param {string} state
 * @returns {boolean}
 */
export function isCommittedState(state) {
  const index = STATE_ORDER.indexOf(state)
  const committedIndex = STATE_ORDER.indexOf('COMMITTED')
  return index >= committedIndex
}

/**
 * Validate a journal record read from disk.
 *
 * @param {string} raw
 * @returns {{ ok: true, journal: TransactionJournal } | { ok: false, reason: string }}
 */
/**
 * Validate a journal record read from disk. With M28 WP-B the journal is
 * strictly bound to the current transaction: package version, normalized
 * output path, safe single-segment backup name, lowercase 64-hex hashes,
 * consistent state/backupPath/oldSha256 combos, and a strict ISO updatedAt.
 *
 * @param {string} raw
 * @param {string} [expectedVersion] -- package.json version to bind against
 * @returns {{ ok: true, journal: TransactionJournal } | { ok: false, reason: string }}
 */
export function validateJournal(raw, expectedVersion) {
  /** @type {any} */
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, reason: 'journal contains invalid JSON' }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'journal is not an object' }
  }
  if (parsed.schema !== JOURNAL_SCHEMA_VERSION) {
    return {
      ok: false,
      reason: `unsupported journal schema ${JSON.stringify(parsed.schema)} -- manual audit required`,
    }
  }
  if (typeof parsed.nonce !== 'string' || !UUID_PATTERN.test(parsed.nonce)) {
    return { ok: false, reason: 'journal nonce missing or invalid' }
  }
  if (typeof parsed.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(parsed.version)) {
    return { ok: false, reason: 'journal version missing or invalid' }
  }
  if (expectedVersion !== undefined && parsed.version !== expectedVersion) {
    return {
      ok: false,
      reason: `journal version ${parsed.version} does not match package.json version ${expectedVersion}`,
    }
  }
  if (typeof parsed.state !== 'string' || !STATE_ORDER.includes(parsed.state)) {
    return {
      ok: false,
      reason: `journal state missing or unknown: ${JSON.stringify(parsed.state)}`,
    }
  }
  if (parsed.outputPath !== OUTPUT_DIR) {
    return {
      ok: false,
      reason: `journal outputPath must be exactly ${JSON.stringify(OUTPUT_DIR)}, got ${JSON.stringify(parsed.outputPath)}`,
    }
  }
  if (parsed.backupPath !== null) {
    if (typeof parsed.backupPath !== 'string' || !SAFE_BACKUP_NAME.test(parsed.backupPath)) {
      return {
        ok: false,
        reason: `journal backupPath invalid (must be a safe single-segment backup name): ${JSON.stringify(parsed.backupPath)}`,
      }
    }
  }

  const validSha = (/** @type {any} */ v) =>
    v !== null &&
    typeof v === 'object' &&
    typeof v.zip === 'string' &&
    SHA256_HEX.test(v.zip) &&
    typeof v.sums === 'string' &&
    SHA256_HEX.test(v.sums)

  if (!validSha(parsed.newSha256)) {
    return {
      ok: false,
      reason: 'journal newSha256 invalid (must be lowercase 64-hex zip+sums)',
    }
  }
  if (parsed.oldSha256 !== null && !validSha(parsed.oldSha256)) {
    return {
      ok: false,
      reason: 'journal oldSha256 invalid (must be lowercase 64-hex zip+sums)',
    }
  }

  // Field-combination consistency (M28 WP-B): a journal must not claim a
  // backup without hashes, nor carry pre-backup state with backup fields.
  const preBackupStates = new Set(['INIT', 'STAGING_GENERATED', 'STAGING_VERIFIED'])
  if (preBackupStates.has(parsed.state)) {
    if (parsed.backupPath !== null) {
      return { ok: false, reason: `journal state ${parsed.state} cannot have backupPath set` }
    }
    if (parsed.oldSha256 !== null) {
      return { ok: false, reason: `journal state ${parsed.state} cannot have oldSha256 set` }
    }
  }
  if (parsed.backupPath !== null && parsed.oldSha256 === null) {
    return { ok: false, reason: 'journal backupPath set but oldSha256 null' }
  }

  if (
    typeof parsed.updatedAt !== 'string' ||
    !STRICT_ISO.test(parsed.updatedAt) ||
    Number.isNaN(Date.parse(parsed.updatedAt))
  ) {
    return {
      ok: false,
      reason: 'journal updatedAt invalid (must be strict ISO 8601 with milliseconds)',
    }
  }
  return { ok: true, journal: /** @type {TransactionJournal} */ (parsed) }
}

/**
 * Read the transaction journal, distinguishing "absent" from "broken".
 *
 * @param {string} repoRoot
 * @param {{ readFileSync?: typeof fs.readFileSync, existsSync?: typeof fs.existsSync }} [deps]
 * @returns {{ present: boolean, validated?: { ok: true, journal: TransactionJournal } | { ok: false, reason: string } }}
 */
export function readJournalFile(repoRoot, deps) {
  const readFileSync = (deps && deps.readFileSync) || fs.readFileSync
  const existsSync = (deps && deps.existsSync) || fs.existsSync
  const journalPath = path.join(repoRoot, JOURNAL_FILE)
  if (!existsSync(journalPath)) {
    return { present: false }
  }
  // Bind the journal to the current package.json version (M28 WP-B).
  let expectedVersion
  try {
    expectedVersion = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version
  } catch (e) {
    return {
      present: true,
      validated: {
        ok: false,
        reason: `package.json unreadable for journal binding: ${/** @type {Error} */ (e).message}`,
      },
    }
  }
  try {
    return {
      present: true,
      validated: validateJournal(readFileSync(journalPath, 'utf8'), expectedVersion),
    }
  } catch (e) {
    return {
      present: true,
      validated: {
        ok: false,
        reason: `journal unreadable: ${/** @type {Error} */ (e).message}`,
      },
    }
  }
}

/**
 * Atomically persist the journal: temp file + fsync + rename (WP-C #5).
 *
 * @param {string} repoRoot
 * @param {TransactionJournal} journal
 * @param {{
 *   writeFileSync?: typeof fs.writeFileSync,
 *   renameSync?: typeof fs.renameSync,
 *   openSync?: (path: fs.PathLike, flags: string | number, mode?: number | null) => number,
 *   writeSync?: (fd: number, buffer: ArrayBufferView, offset?: number | null, length?: number | null) => number,
 *   fsyncSync?: typeof fs.fsyncSync,
 *   closeSync?: typeof fs.closeSync,
 *   unlinkSync?: typeof fs.unlinkSync,
 * }} [deps]
 */
function writeJournal(repoRoot, journal, deps) {
  const openSync = (deps && deps.openSync) || fs.openSync
  const fsyncSync = (deps && deps.fsyncSync) || fs.fsyncSync
  const closeSync = (deps && deps.closeSync) || fs.closeSync
  const renameSync = (deps && deps.renameSync) || fs.renameSync
  const unlinkSync = (deps && deps.unlinkSync) || fs.unlinkSync

  const journalPath = path.join(repoRoot, JOURNAL_FILE)
  const tmpPath = `${journalPath}.tmp-${journal.nonce.slice(0, 8)}`
  const payload = Buffer.from(JSON.stringify(journal, null, 2) + '\n', 'utf8')

  const cleanupTmp = () => {
    try {
      unlinkSync(tmpPath)
    } catch {
      // best effort -- the journal must never be promoted from a tmp path
      // that was not fully written, fsynced, and closed.
    }
  }

  let fd
  try {
    fd = openSync(tmpPath, 'w', 0o600)
  } catch (e) {
    throw new Error(`failed to open journal temp file: ${/** @type {Error} */ (e).message}`)
  }

  try {
    writeAllSync(fd, payload, deps)
    fsyncSync(fd)
  } catch (e) {
    try {
      closeSync(fd)
    } catch {
      // keep the original error
    }
    cleanupTmp()
    throw new Error(`failed to write journal: ${/** @type {Error} */ (e).message}`)
  }

  try {
    closeSync(fd)
  } catch (e) {
    cleanupTmp()
    throw new Error(`failed to close journal temp file: ${/** @type {Error} */ (e).message}`)
  }

  try {
    renameSync(tmpPath, journalPath)
  } catch (e) {
    cleanupTmp()
    throw new Error(`failed to promote journal: ${/** @type {Error} */ (e).message}`)
  }

  // Post-rename durability: fsync the parent directory where the platform
  // supports it. When unsupported we document the boundary instead of
  // silently claiming more durability than the filesystem offers (M28 WP-B).
  try {
    const dirFd = openSync(path.dirname(journalPath), 'r')
    try {
      fsyncSync(dirFd)
    } finally {
      closeSync(dirFd)
    }
  } catch (e) {
    process.stderr.write(
      `note: journal renamed but parent-directory fsync unavailable (${/** @type {Error} */ (e).message}); durability boundary documented in docs/RELEASING.md\n`,
    )
  }
}

/**
 * Delete the journal file after BACKUP_CLEANED (best effort but reported).
 *
 * @param {string} repoRoot
 * @param {(p: fs.PathLike) => void} unlinkSync
 * @param {(p: fs.PathLike) => boolean} existsSync
 */
function deleteJournal(
  repoRoot,
  unlinkSync = (p) => fs.unlinkSync(p),
  existsSync = (p) => fs.existsSync(p),
) {
  const journalPath = path.join(repoRoot, JOURNAL_FILE)
  if (existsSync(journalPath)) {
    unlinkSync(journalPath)
  }
}

// ---------------------------------------------------------------------------
// Output/staging verification helpers
// ---------------------------------------------------------------------------

/**
 * Verify that a directory contains exactly the two expected assets as
 * regular files. Symlinks, directories, and any extra entry fail closed.
 *
 * @param {string} dir
 * @param {string} zipName
 * @param {string} sumsName
 * @param {{ readdirSync?: typeof fs.readdirSync, existsSync?: typeof fs.existsSync, lstatSync?: typeof fs.lstatSync }} [deps]
 */
function verifyAssetPair(dir, zipName, sumsName, deps) {
  const readdirSync = (deps && deps.readdirSync) || fs.readdirSync
  const existsSync = (deps && deps.existsSync) || fs.existsSync

  if (!existsSync(dir)) {
    throw new Error(`directory does not exist: ${dir}`)
  }

  /** @type {fs.Dirent[]} */
  const dirents = readdirSync(dir, { withFileTypes: true })
  const entries = dirents.map((d) => d.name)

  if (entries.length !== 2) {
    throw new Error(
      `directory ${dir} has ${entries.length} entries (${entries.join(', ')}), expected exactly 2 (${zipName}, ${sumsName})`,
    )
  }

  for (const dirent of dirents) {
    if (dirent.isSymbolicLink()) {
      throw new Error(`symlink not allowed in ${dir}: ${dirent.name}`)
    }
    if (!dirent.isFile()) {
      throw new Error(`non-regular file not allowed in ${dir}: ${dirent.name}`)
    }
  }

  const hasZip = entries.includes(zipName)
  const hasSums = entries.includes(sumsName)

  if (!hasZip || !hasSums) {
    throw new Error(
      `directory ${dir} has unexpected contents: ${entries.join(', ')}. ` +
        `Expected: ${zipName}, ${sumsName}`,
    )
  }
}

// Compatibility alias kept for external callers/tests that verified output
// contents by name before M27 renamed the helper semantics.
export const verifyOutputContents = verifyAssetPair

// ---------------------------------------------------------------------------
// Backup validation (WP-D #1/#2)
// ---------------------------------------------------------------------------

/**
 * Deeply validate a backup directory before recovery may touch it:
 * - exactly two regular files (zip + SHA256SUMS), no symlinks/dirs/extras
 * - SHA256SUMS has exactly one line listing exactly the expected zip name
 * - checksum matches the actual zip bytes
 * - verify_release_zip.py accepts the zip (injectable)
 * - internal contract: zip name embeds the current package version
 *
 * @param {string} backupDir
 * @param {ReturnType<typeof buildReleasePlan>} plan
 * @param {string} version
 * @param {{
 *   readdirSync?: typeof fs.readdirSync,
 *   lstatSync?: typeof fs.lstatSync,
 *   readFileSync?: typeof fs.readFileSync,
 *   createHash?: typeof createHash,
 *   execFile?: typeof execFileSync,
 *   python3?: string,
 *   skipPythonVerifier?: boolean,
 * }} [opts]
 */
export function validateBackupDir(backupDir, plan, version, opts = {}) {
  const readdirSync = opts.readdirSync || fs.readdirSync
  const readFileSync = opts.readFileSync || fs.readFileSync
  const hashFn = opts.createHash || createHash
  const python3 = opts.python3 || PYTHON3
  const execFile = opts.execFile || execFileSync

  let dirents
  try {
    dirents = readdirSync(backupDir, { withFileTypes: true })
  } catch (e) {
    throw new TransactionError(
      `backup \"${backupDir}\" unreadable: ${/** @type {Error} */ (e).message}`,
    )
  }

  if (dirents.length !== 2) {
    throw new TransactionError(
      `backup must contain exactly 2 entries, found ${dirents.length}: ${dirents.map((d) => d.name).join(', ')}`,
    )
  }
  for (const d of dirents) {
    if (d.isSymbolicLink()) {
      throw new TransactionError(`backup symlink refused: ${d.name}`)
    }
    if (!d.isFile()) {
      throw new TransactionError(`backup entry is not a regular file: ${d.name}`)
    }
  }
  const names = dirents.map((d) => d.name).sort()
  if (names[0] !== plan.sumsName || names[1] !== plan.zipName) {
    throw new TransactionError(
      `backup contents wrong: [${names.join(', ')}], expected [${plan.sumsName}, ${plan.zipName}]`,
    )
  }

  const sumsRaw = readFileSync(path.join(backupDir, plan.sumsName), 'utf8')
  const lines = sumsRaw.split('\n').filter((l) => l.trim().length > 0)
  if (lines.length !== 1) {
    throw new TransactionError(`SHA256SUMS must have exactly one line, found ${lines.length}`)
  }
  const match = lines[0].trim().match(/^([0-9a-f]{64})\s{2}(.+)$/)
  if (!match) {
    throw new TransactionError(`SHA256SUMS line malformed: ${lines[0]}`)
  }
  if (match[2] !== plan.zipName) {
    throw new TransactionError(`SHA256SUMS lists \"${match[2]}\", expected \"${plan.zipName}\"`)
  }

  const zipPath = path.join(backupDir, plan.zipName)
  const actualHash = hashFn('sha256').update(readFileSync(zipPath)).digest('hex')
  if (actualHash !== match[1]) {
    throw new TransactionError(
      `backup checksum mismatch: sums says ${match[1]}, actual ${actualHash}`,
    )
  }

  // Internal contract: the zip name must embed the CURRENT package version.
  if (!plan.zipName.includes(`-v${version}-web.zip`)) {
    throw new TransactionError(
      `backup zip \"${plan.zipName}\" does not match package version v${version}`,
    )
  }

  // Full ZIP structural/content verification through the real verifier.
  if (!opts.skipPythonVerifier) {
    const verifyScript = path.join(
      scriptRepoRoot,
      '.github',
      'workflows',
      'scripts',
      'verify_release_zip.py',
    )
    try {
      execFile(python3, [verifyScript, zipPath], { stdio: 'pipe', timeout: 30_000 })
    } catch (e) {
      const err = /** @type {{ message?: string, stderr?: Buffer | string }} */ (
        /** @type {unknown} */ (e)
      )
      const detail = err.stderr ? String(err.stderr).trim().split('\n').pop() : err.message
      throw new TransactionError(`backup zip failed verification: ${detail}`)
    }
  }
}

// ---------------------------------------------------------------------------
// Stale-state detection (refuse normal runs on interrupted transactions)
// ---------------------------------------------------------------------------

/**
 * Detect stale state from a previous interrupted run. Fails closed: refuses
 * to run if we can't determine safety.
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
      throw new Error(`${STAGING_DIR}/ is not empty (${entries.length} entries). `)
    }
  }

  const journalState = readJournalFile(repoRoot, { existsSync })
  if (journalState.present) {
    throw new TransactionError(
      `transaction journal ${JOURNAL_FILE} exists -- a previous run may be unfinished. `,
    )
  }

  // Check for backup from interrupted --force
  const backups = readdirSync(repoRoot).filter((e) => e.startsWith(BACKUP_PREFIX))
  if (backups.length > 0) {
    throw new Error(`Backup directories exist: ${backups.join(', ')}. `)
  }
}

// ---------------------------------------------------------------------------
// recoverTransaction (WP-D)
// ---------------------------------------------------------------------------

/**
 * Recover an interrupted transaction while HOLDING THE LOCK (enforced by
 * the CLI flow; direct callers must hold the lock themselves).
 *
 * Decision matrix (WP-D #3):
 * - output absent, one backup present, backup validates -> restore, re-verify
 * - both present:
 *     - journal COMMITTED/BACKUP_CLEANED -> keep verified output, clean residual backup+journal
 *     - journal PRE_COMMIT               -> drop unverified output, restore verified backup
 *     - journal missing/corrupt/unknown  -> refuse (manual audit)
 * - multiple backups -> refuse
 * - corrupt backup -> NEVER promoted anywhere
 *
 * After a successful restore the recovered output is fully re-verified
 * (checksums + ZIP verifier) before reporting success (WP-D #6).
 *
 * @param {string} repoRoot
 * @param {string} outputDir
 * @param {string} zipName -- must equal plan.zipName for the package version
 * @param {string} sumsName -- must equal plan.sumsName
 * @param {{
 *   existsSync?: typeof fs.existsSync,
 *   readdirSync?: typeof fs.readdirSync,
 *   renameSync?: typeof fs.renameSync,
 *   rmSync?: typeof fs.rmSync,
 *   readFileSync?: typeof fs.readFileSync,
 *   createHash?: typeof createHash,
 *   execFile?: typeof execFileSync,
 *   lstatSync?: typeof fs.lstatSync,
 *   unlinkSync?: typeof fs.unlinkSync,
 *   python3?: string,
 *   skipPythonVerifier?: boolean,
 * }} [deps]
 * @returns {{ recovered: boolean, action?: string, reason?: string }}
 */
export function recoverTransaction(repoRoot, outputDir, zipName, sumsName, deps = {}) {
  const existsSync = deps.existsSync || fs.existsSync
  const readdirSync = deps.readdirSync || fs.readdirSync
  const renameSync = deps.renameSync || fs.renameSync
  const rmSync = deps.rmSync || fs.rmSync
  const readFileSync = deps.readFileSync || fs.readFileSync

  // Derive the plan from package.json -- recovery validates against the
  // same naming contract the generator used.
  const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
  const plan = buildReleasePlan(pkg.version)
  if (zipName !== plan.zipName || sumsName !== plan.sumsName) {
    return {
      recovered: false,
      reason: `requested asset names (${zipName}, ${sumsName}) do not match the release plan (${plan.zipName}, ${plan.sumsName}) -- refusing recovery`,
    }
  }

  const backups = readdirSync(repoRoot).filter((e) => e.startsWith(BACKUP_PREFIX))
  if (backups.length > 1) {
    return {
      recovered: false,
      reason: `multiple backup directories found: ${backups.join(', ')} -- manual audit required`,
    }
  }

  // M28 WP-A: read and strictly validate the journal FIRST, then decide the
  // action from (journal state + output presence + backup count). The old
  // "backup required before journal" ordering is gone.
  const journalState = readJournalFile(repoRoot, { existsSync, readFileSync })
  if (!journalState.present) {
    return {
      recovered: false,
      reason:
        'no transaction journal found -- manual audit required; recovery must be journal-driven',
    }
  }
  if (!journalState.validated || journalState.validated.ok === false) {
    const detail = journalState.validated
      ? journalState.validated.reason
      : 'the journal is unreadable'
    return {
      recovered: false,
      reason: `transaction journal invalid (${detail}) -- manual audit required`,
    }
  }
  const journal = journalState.validated.journal

  // Bind journal.backupPath to the single actual backup directory (M28 WP-B).
  const actualBackup = backups.length === 1 ? backups[0] : null
  if (journal.backupPath !== null) {
    if (actualBackup !== journal.backupPath) {
      return {
        recovered: false,
        reason: `journal references backup "${journal.backupPath}" but disk has ${actualBackup === null ? 'no backup' : '"' + actualBackup + '"'} -- manual audit required`,
      }
    }
  } else if (actualBackup !== null) {
    return {
      recovered: false,
      reason: `journal has backupPath null but backup directory "${actualBackup}" exists on disk -- manual audit required`,
    }
  }

  const outputExists = existsSync(outputDir)
  const backupDir = journal.backupPath !== null ? path.join(repoRoot, journal.backupPath) : null

  /** Full verification plus hash equality against the journal. */
  const verifyOutput = (/** @type {{ zip: string, sums: string } | undefined} */ expectSha) => {
    verifyOutputAgainstSha(outputDir, plan, deps, expectSha)
  }

  if (isCommittedState(journal.state)) {
    // COMMITTED / BACKUP_CLEANED: the new output is authoritative. Verify it
    // FULLY (asset pair + SHA256SUMS + ZIP verifier + journal hash equality)
    // before deleting any backup or the journal (M28 WP-A #1/#2).
    if (!outputExists) {
      return {
        recovered: false,
        reason: `journal says ${journal.state} but ${OUTPUT_DIR} is missing -- manual audit required`,
      }
    }
    try {
      verifyOutput(journal.newSha256)
    } catch (e) {
      return {
        recovered: false,
        reason: `journal says ${journal.state} but output failed full verification (${/** @type {Error} */ (e).message}) -- output, backup and journal preserved; manual audit required`,
      }
    }
    if (backupDir) {
      try {
        rmSync(backupDir, { recursive: true, force: true })
      } catch (e) {
        return {
          recovered: false,
          reason: `output verified but residual backup could not be removed (${/** @type {Error} */ (e).message}) -- manual audit required`,
        }
      }
    }
    try {
      deleteJournal(repoRoot, deps.unlinkSync, existsSync)
    } catch (e) {
      return {
        recovered: false,
        reason: `output verified but journal could not be removed (${/** @type {Error} */ (e).message}) -- output is safe; rerun --recover to retry journal cleanup`,
      }
    }
    return {
      recovered: true,
      action: backupDir ? 'committed-cleanup' : 'committed-no-backup-cleanup',
    }
  }

  // PRE_COMMIT states.
  if (backupDir) {
    // Validate the backup deeply BEFORE deleting or moving anything (M28 WP-A #4).
    try {
      validateBackupDir(backupDir, plan, pkg.version, {
        readdirSync,
        lstatSync: deps.lstatSync,
        readFileSync,
        createHash: deps.createHash,
        execFile: deps.execFile,
        python3: deps.python3,
        skipPythonVerifier: deps.skipPythonVerifier,
      })
    } catch (e) {
      return {
        recovered: false,
        reason: `PRE_COMMIT recovery refused: ${/** @type {Error} */ (e).message} -- backup, output and journal preserved`,
      }
    }
    if (outputExists) {
      try {
        rmSync(outputDir, { recursive: true, force: true })
      } catch (e) {
        return {
          recovered: false,
          reason: `PRE_COMMIT recovery could not remove unverified output (${/** @type {Error} */ (e).message}) -- manual audit required`,
        }
      }
    }
    try {
      renameSync(backupDir, outputDir)
    } catch (e) {
      return {
        recovered: false,
        reason: `PRE_COMMIT recovery restore failed (${/** @type {Error} */ (e).message}) -- backup and journal preserved; manual audit required`,
      }
    }
    // Re-verify the restored old output AND bind it to journal.oldSha256.
    try {
      verifyOutput(journal.oldSha256 ?? undefined)
    } catch (e) {
      return {
        recovered: false,
        reason: `restored output failed full verification (${/** @type {Error} */ (e).message}) -- manual audit required`,
      }
    }
    try {
      deleteJournal(repoRoot, deps.unlinkSync, existsSync)
    } catch {
      // Keep the residue rather than failing a completed restore.
    }
    return { recovered: true, action: 'pre-commit-restore' }
  }

  // PRE_COMMIT with no backup: first publish interrupted before COMMITTED.
  // Only a hash-proven output may finalize; nothing is deleted blindly (M28 WP-A #3).
  if (!outputExists) {
    return {
      recovered: false,
      reason: `journal ${journal.state} (no backup) but ${OUTPUT_DIR} is missing -- manual audit required`,
    }
  }
  try {
    verifyOutput(journal.newSha256)
  } catch (e) {
    return {
      recovered: false,
      reason: `journal ${journal.state} (first publish, no backup) but output failed verification (${/** @type {Error} */ (e).message}) -- output and journal preserved; manual audit required`,
    }
  }
  try {
    deleteJournal(repoRoot, deps.unlinkSync, existsSync)
  } catch (e) {
    return {
      recovered: false,
      reason: `output verified but journal could not be removed (${/** @type {Error} */ (e).message})`,
    }
  }
  return { recovered: true, action: 'pre-commit-first-publish-finalize' }
}

/**
 * Full output verification (M28 WP-A): asset pair, SHA256SUMS, the real
 * ZIP verifier, and optional hash equality against the journal's recorded
 * zip/sums hashes. Throws on any failure; deletes nothing.
 *
 * @param {string} outputDir
 * @param {ReturnType<typeof buildReleasePlan>} plan
 * @param {Record<string, any>} deps
 * @param {{ zip: string, sums: string } | undefined} expectSha
 * @returns {void}
 */
function verifyOutputAgainstSha(outputDir, plan, deps, expectSha) {
  verifyAssetPair(outputDir, plan.zipName, plan.sumsName, {
    existsSync: deps.existsSync,
    readdirSync: deps.readdirSync,
    lstatSync: deps.lstatSync,
  })
  verifyChecksums(path.join(outputDir, plan.sumsName), outputDir, {
    readFileSync: deps.readFileSync,
    createHash: deps.createHash,
  })
  if (!deps.skipPythonVerifier) {
    const verifyScript = path.join(
      scriptRepoRoot,
      '.github',
      'workflows',
      'scripts',
      'verify_release_zip.py',
    )
    const execFile = deps.execFile || execFileSync
    const python3 = deps.python3 || PYTHON3
    execFile(python3, [verifyScript, path.join(outputDir, plan.zipName)], {
      stdio: 'pipe',
      timeout: 30_000,
    })
  }
  if (expectSha) {
    const zipHash = sha256File(path.join(outputDir, plan.zipName), deps.createHash)
    const sumsHash = sha256File(path.join(outputDir, plan.sumsName), deps.createHash)
    if (zipHash !== expectSha.zip) {
      throw new Error(`output zip hash ${zipHash} does not match journal zip hash ${expectSha.zip}`)
    }
    if (sumsHash !== expectSha.sums) {
      throw new Error(
        `output sums hash ${sumsHash} does not match journal sums hash ${expectSha.sums}`,
      )
    }
  }
}

// ---------------------------------------------------------------------------
// generateAssets -- explicit commit-point transaction (WP-C)
// ---------------------------------------------------------------------------

/**
 * Named failpoints, invoked in order. Tests inject a recorder plus a
 * throwing injection for the exact phase under test and MUST assert that
 * the declared failpoint fired (WP-G #3/#4).
 *
 * staging.checksum       -- before staging checksum verification
 * staging.zipverifier    -- before staging ZIP verifier execution
 * backup.rename.before   -- before output->backup rename (--force only)
 * backup.rename.after    -- after output->backup rename
 * promotion.before       -- before staging->output rename
 * promotion.after        -- after staging->output rename
 * publish.checksum       -- before published checksum verification
 * publish.zipverifier    -- before published ZIP verifier execution
 * commit.journal         -- before the COMMITTED journal write (commit point)
 * backup.remove.before   -- before residual backup removal (post-commit)
 * backup.remove.partial  -- mid backup removal, after the zip entry is gone
 * journal.delete         -- before journal deletion (final transition)
 */
export const FAILPOINTS = [
  'staging.checksum',
  'staging.zipverifier',
  'backup.rename.before',
  'backup.rename.after',
  'promotion.before',
  'promotion.after',
  'publish.checksum',
  'publish.zipverifier',
  'commit.journal',
  'backup.remove.before',
  'backup.remove.partial',
  'journal.delete',
]

/**
 * Generate assets into a unique staging directory, verify, then publish
 * using an explicit transactional state machine with a versioned journal.
 *
 * Commit point: NEW_OUTPUT_VERIFIED -> COMMITTED. Before COMMITTED every
 * failure rolls back to a byte-identical old output (or fails loudly
 * keeping backup/journal for --recover); after COMMITTED a backup-cleanup
 * failure NEVER touches the verified new output and demands explicit
 * cleanup/recovery (WP-C #1-#3, #9).
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
 *   lstatSync?: typeof fs.lstatSync,
 *   unlinkSync?: typeof fs.unlinkSync,
 *   failpoint?: (name: string) => void,
 *   trace?: string[],
 * }} [deps]
 * @returns {{ trace: string[], plan: ReturnType<typeof buildReleasePlan> }}
 */
export function generateAssets(distDir, outputDir, force, python3 = PYTHON3, deps = {}) {
  const mkdirSync = deps.mkdirSync || fs.mkdirSync
  const mkdtempSync = deps.mkdtempSync || fs.mkdtempSync
  const renameSync = deps.renameSync || fs.renameSync
  const rmSync = deps.rmSync || fs.rmSync
  const existsSync = deps.existsSync || fs.existsSync
  const statSync = deps.statSync || fs.statSync
  const readFileSync = deps.readFileSync || fs.readFileSync
  const trace = deps.trace || []

  /** Record and invoke a named failpoint (tests assert these names). */
  const fp = (/** @type {string} */ name) => {
    trace.push(name)
    if (deps.failpoint) {
      deps.failpoint(name)
    }
  }

  const repoRoot = path.resolve(outputDir, '..')

  // Detect stale state
  detectStaleState(repoRoot, { existsSync, readdirSync: fs.readdirSync })

  // Read version from package.json and derive the ENTIRE plan from the
  // shared contract (WP-E #3/#4): no local naming templates here.
  const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
  const version = pkg.version
  const plan = buildReleasePlan(version)
  const zipPath = path.join(outputDir, plan.zipName)
  const sumsPath = path.join(outputDir, plan.sumsName)

  // Check if output already exists
  const outputExists = existsSync(zipPath) || existsSync(sumsPath)
  if (outputExists && !force) {
    throw new Error(`Assets already exist in ${outputDir}. Use --force to overwrite.`)
  }

  // If output exists, verify it's a valid asset pair
  if (outputExists && force) {
    verifyAssetPair(outputDir, plan.zipName, plan.sumsName, {
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
  const nonce = randomUUID()
  const stagingNonce = nonce.split('-')[0]
  const stagingDir = mkdtempSync(path.join(stagingRoot, `run-${stagingNonce}-`))
  const stagingZip = path.join(stagingDir, plan.zipName)
  const stagingSums = path.join(stagingDir, plan.sumsName)

  /** @type {string | null} */
  let backupDir = null
  /** @type {string | null} */
  let backupRel = null
  let promoted = false
  let committed = false

  /** @type {TransactionJournal} */
  const journal = {
    schema: JOURNAL_SCHEMA_VERSION,
    nonce,
    version,
    state: 'INIT',
    outputPath: path.relative(repoRoot, outputDir),
    backupPath: null,
    oldSha256: null,
    newSha256: { zip: '', sums: '' },
    updatedAt: new Date().toISOString(),
  }

  const advance = (/** @type {string} */ state) => {
    journal.state = state
    journal.backupPath = backupRel
    journal.updatedAt = new Date().toISOString()
    writeJournal(repoRoot, journal, deps)
  }

  /** Already-rolled-back guard: rollback must be idempotent (inner catch
   * + outer catch both call it). */
  let rolledBack = false
  /** Set when a rollback attempt itself threw; the original error is kept. */
  let rollbackFailed = false
  /** @type {TransactionError | null} */
  let rollbackError = null

  /** Rollback to the byte-identical old output. Throws loudly on failure. */
  const rollbackToOldOutput = (/** @type {unknown} */ cause) => {
    if (rolledBack || committed) {
      return
    }
    rolledBack = true
    try {
      performRollback()
    } catch (e) {
      if (e instanceof TransactionError) {
        rollbackFailed = true
        rollbackError = e
      }
      throw e
    }
    void cause
  }

  const performRollback = () => {
    if (backupDir && existsSync(backupDir)) {
      if (promoted && existsSync(outputDir)) {
        try {
          rmSync(outputDir, { recursive: true, force: true })
        } catch (rmErr) {
          rollbackFailed = true
          throw new TransactionError(
            `rollback could not remove unverified new output (${/** @type {Error} */ (rmErr).message}); ${OUTPUT_DIR} and the backup are left in place -- run --recover or audit manually. Do not overwrite anything by hand.`,
          )
        }
      }
      try {
        renameSync(backupDir, outputDir)
        backupDir = null
        backupRel = null
      } catch (renameErr) {
        rollbackFailed = true
        throw new TransactionError(
          `rollback restore failed (${/** @type {Error} */ (renameErr).message}); backup and journal kept for --recover`,
        )
      }
      // Prove the restored output is byte-identical to what we backed up.
      const restoredZip = sha256File(path.join(outputDir, plan.zipName), deps.createHash)
      if (journal.oldSha256 !== null && restoredZip !== journal.oldSha256.zip) {
        rollbackFailed = true
        throw new TransactionError(
          `restored old output does not match recorded old checksum; manual audit required before any further release run`,
        )
      }
    } else if (promoted && existsSync(outputDir) && !committed) {
      // No backup existed (first-time publish): remove the uncommitted output.
      try {
        rmSync(outputDir, { recursive: true, force: true })
      } catch (rmErr) {
        rollbackFailed = true
        throw new TransactionError(
          `could not remove uncommitted first publish output (${/** @type {Error} */ (rmErr).message}); manual audit required`,
        )
      }
    }
  }

  try {
    // ---- Phase 1: Generate into staging -------------------------------
    console.log(`Creating ${plan.zipName} ...`)
    createDeterministicZip(distDir, files, stagingZip, python3, deps)
    advance('STAGING_GENERATED')

    console.log(`Creating ${plan.sumsName} ...`)
    generateChecksums(stagingZip, stagingSums, deps)

    // ---- Phase 2: Verify staging --------------------------------------
    fp('staging.checksum')
    console.log('Verifying checksum ...')
    verifyChecksums(stagingSums, stagingDir, deps)

    fp('staging.zipverifier')
    console.log('Verifying zip with verify_release_zip.py ...')
    const verifyScript = path.join(
      scriptRepoRoot,
      '.github',
      'workflows',
      'scripts',
      'verify_release_zip.py',
    )
    const execFile = deps.execFile || execFileSync
    execFile(python3, [verifyScript, stagingZip], {
      stdio: 'inherit',
      timeout: 30_000,
    })

    // Verify staging contains exactly the two expected regular assets
    verifyAssetPair(stagingDir, plan.zipName, plan.sumsName, {
      existsSync,
      readdirSync: fs.readdirSync,
    })
    advance('STAGING_VERIFIED')
    journal.newSha256 = {
      zip: sha256File(stagingZip, deps.createHash),
      sums: sha256File(stagingSums, deps.createHash),
    }
    writeJournal(repoRoot, journal, deps)

    // ---- Phase 3: Publish ---------------------------------------------
    if (outputExists && force) {
      // Transactional: backup -> promotion -> re-verify -> COMMITTED -> cleanup
      const backupNonce = nonce.split('-')[1] ?? randomUUID().split('-')[0]
      backupRel = `${BACKUP_PREFIX}${backupNonce}`
      backupDir = path.join(repoRoot, backupRel)

      fp('backup.rename.before')
      renameSync(outputDir, backupDir)
      advance('OLD_OUTPUT_BACKED_UP')
      journal.oldSha256 = {
        zip: sha256File(path.join(backupDir, plan.zipName), deps.createHash),
        sums: sha256File(path.join(backupDir, plan.sumsName), deps.createHash),
      }
      writeJournal(repoRoot, journal, deps)
      fp('backup.rename.after')

      try {
        fp('promotion.before')
        renameSync(stagingDir, outputDir)
        promoted = true
        fp('promotion.after')
        advance('NEW_OUTPUT_PROMOTED')

        fp('publish.checksum')
        console.log('Verifying published checksum ...')
        verifyChecksums(sumsPath, outputDir, deps)

        fp('publish.zipverifier')
        console.log('Verifying published zip ...')
        execFile(python3, [verifyScript, zipPath], {
          stdio: 'inherit',
          timeout: 30_000,
        })
        advance('NEW_OUTPUT_VERIFIED')

        // ---- COMMIT POINT (WP-C #1) ----------------------------------
        fp('commit.journal')
        advance('COMMITTED')
        committed = true
      } catch (e) {
        // Pre-commit failure: rollback to the byte-identical old output.
        rollbackToOldOutput(e)
        throw e
      }

      // Post-commit: backup cleanup failure must NOT endanger the new output.
      fp('backup.remove.before')
      removeBackupEntries(backupDir, plan, fp, rmSync, existsSync)
      backupDir = null
      backupRel = null
      advance('BACKUP_CLEANED')

      fp('journal.delete')
      deleteJournal(repoRoot, deps.unlinkSync, existsSync)
    } else {
      // First-time publish: staging -> output directly (no backup needed).
      fp('promotion.before')
      renameSync(stagingDir, outputDir)
      promoted = true
      fp('promotion.after')
      advance('NEW_OUTPUT_PROMOTED')

      fp('publish.checksum')
      console.log('Verifying published checksum ...')
      verifyChecksums(sumsPath, outputDir, deps)

      fp('publish.zipverifier')
      console.log('Verifying published zip ...')
      execFile(python3, [verifyScript, zipPath], {
        stdio: 'inherit',
        timeout: 30_000,
      })
      advance('NEW_OUTPUT_VERIFIED')

      fp('commit.journal')
      advance('COMMITTED')
      committed = true

      // Nothing to clean up: no backup ever existed. Close out the journal.
      advance('BACKUP_CLEANED')
      fp('journal.delete')
      deleteJournal(repoRoot, deps.unlinkSync, existsSync)
    }

    const zipSize = statSync(zipPath).size
    console.log(`\nDone: ${plan.zipName} (${zipSize} bytes)`)
    console.log(`      ${plan.sumsName}`)
  } catch (e) {
    // Any pre-commit failure that escaped local handling gets a rollback
    // attempt here; post-commit failures must leave everything untouched.
    if (!committed && rollbackFailed && rollbackError) {
      // A previous rollback attempt already failed. Surface the SPECIFIC
      // rollback error; backup+journal stay for explicit --recover.
      throw rollbackError
    }
    if (!committed) {
      try {
        rollbackToOldOutput(e)
      } catch (rollbackErr) {
        throw rollbackErr
      }
      // Rollback completed: the transaction is fully aborted, so the journal
      // must not linger and block future runs.
      try {
        deleteJournal(repoRoot, deps.unlinkSync, existsSync)
      } catch {
        console.log('note: transaction journal could not be removed after rollback')
      }
    }
    throw e
  } finally {
    // Clean up staging residue (never touches output/backup/journal).
    if (!promoted && existsSync(stagingDir)) {
      try {
        rmSync(stagingDir, { recursive: true, force: true })
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

    // NOTE (WP-C #3/#9): post-commit backup/journal residue is intentionally
    // preserved here for explicit --recover / manual audit. Pre-commit
    // rollback already handled restoration above; if it threw, backup and
    // journal remain on disk deliberately.
  }

  return { trace, plan }
}

/**
 * Remove the residual backup AFTER the commit point, entry by entry, with
 * a failpoint between entries so tests can simulate partial deletion.
 * Failure here leaves the partially deleted backup in place next to the
 * untouched verified output (caller reports nonzero exit).
 *
 * @param {string} backupDir
 * @param {ReturnType<typeof buildReleasePlan>} plan
 * @param {(name: string) => void} fp
 * @param {(p: fs.PathLike, opts?: fs.RmOptions) => void} rmSync
 * @param {typeof fs.existsSync} existsSync
 */
function removeBackupEntries(backupDir, plan, fp, rmSync, existsSync) {
  if (!existsSync(backupDir)) return
  rmSync(path.join(backupDir, plan.zipName), { force: true })
  fp('backup.remove.partial')
  rmSync(path.join(backupDir, plan.sumsName), { force: true })
  rmSync(backupDir, { recursive: true, force: true })
}

/**
 * @param {string} filePath
 * @param {typeof createHash} [hashFn]
 */
function sha256File(filePath, hashFn = createHash) {
  return hashFn('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

// ---------------------------------------------------------------------------
// CLI -- returns exit code, no process.exit() in try/catch
// ---------------------------------------------------------------------------

/**
 * Fatal-signal handling for the lock holder (WP-B #6): attempt to release
 * the OWNED lock; on failure keep the recoverable metadata (the lock file
 * with valid JSON) so --recover-lock can clean up later. Never removes a
 * lock this process does not own (release() enforces ownership).
 *
 * Exported for behavior tests.
 *
 * @param {string} signal
 * @param {{ release: () => { released: boolean, reason?: string }, lockPath: string } | null} lockHandle
 * @param {{ stderr?: { write: (s: string) => void }, exit?: (code: number) => void }} [io]
 * @returns {number} exit code the process should end with
 */
export function handleFatalSignal(signal, lockHandle, io = {}) {
  const stderr = io.stderr || { write: (chunk) => process.stderr.write(chunk) }
  const exit =
    io.exit ||
    ((code) => {
      process.exitCode = code
    })
  // M28 WP-D: a signal handler only RECORDS the termination request. The
  // lock is released by the unified finally after every write/rename/execFile
  // has stopped -- never while the process may still modify release state.
  if (lockHandle) {
    stderr.write(
      `release:${signal}: termination requested -- finishing the current atomic stage; lock stays held until all writes stop (unified finally)\n`,
    )
  } else {
    stderr.write(`release:${signal}: termination requested\n`)
  }
  const code = signal === 'SIGINT' ? 130 : 143
  exit(code)
  return code
}

/**
 * Parse CLI arguments and run the generator.
 *
 * Normal, --force AND --recover all run under the SAME atomic mutex;
 * --recover-lock is the only command that operates on the lock file
 * without holding it (WP-A #1/#2).
 *
 * @param {string[]} argv
 * @param {{
 *   stdout?: { write: (chunk: string) => boolean },
 *   stderr?: { write: (chunk: string) => boolean },
 *   env?: typeof process.env,
 *   repoRoot?: string,
 * }} [io]
 * @returns {Promise<number>} exit code
 */
export async function runCli(argv, io = {}) {
  const stdout = io.stdout || { write: (chunk) => process.stdout.write(chunk) }
  const stderr = io.stderr || { write: (chunk) => process.stderr.write(chunk) }
  const env = io.env || process.env
  const repoRoot = io.repoRoot || defaultRepoRoot

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

  // M28 WP-F: --force, --recover and --recover-lock are mutually exclusive.
  // Reject conflicts BEFORE any lock is created.
  const flagCount = (force ? 1 : 0) + (recoverFlag ? 1 : 0) + (recoverLockFlag ? 1 : 0)
  if (flagCount > 1) {
    stderr.write('--force, --recover and --recover-lock are mutually exclusive\n')
    stderr.write(
      'Usage: node scripts/prepare-release-assets.mjs [--force] [--recover] [--recover-lock]\n',
    )
    return 2
  }

  const distDir = path.join(repoRoot, 'dist')
  const outputDir = path.join(repoRoot, OUTPUT_DIR)
  const python3 = env.PYTHON3 || PYTHON3

  // Handle --recover-lock OUTSIDE the lock domain (WP-A #2).
  if (recoverLockFlag) {
    const result = recoverLock(repoRoot)
    if (result.recovered) {
      stdout.write('Lock recovered successfully.\n')
      return 0
    }
    stderr.write(`Lock recovery failed: ${result.reason}\n`)
    return 1
  }

  // EVERYTHING below runs under the atomic mutex (WP-A #1).
  /** @type {ReturnType<typeof acquireLock> | null} */
  let lock = null
  try {
    lock = acquireLock(repoRoot)
  } catch (e) {
    stderr.write(`release:prepare-assets: ${/** @type {Error} */ (e).message}\n`)
    return 1
  }

  // M28 WP-D: record termination requests only. The lock stays held until
  // the unified release below runs AFTER runLocked has fully returned.
  /** @type {'SIGINT' | 'SIGTERM' | null} */
  let terminating = null
  const signalHandler = (/** @type {string} */ signal) => {
    if (terminating === null) {
      terminating = /** @type {'SIGINT' | 'SIGTERM'} */ (signal)
      handleFatalSignal(signal, lock, {
        stderr,
        exit: (code) => {
          process.exitCode = code
        },
      })
    }
  }
  process.once('SIGINT', signalHandler)
  process.once('SIGTERM', signalHandler)

  /**
   * Run the locked work and classify the outcome.
   * @returns {Promise<'ok' | 'failed'>}
   */
  const runLocked = async () => {
    try {
      if (recoverFlag) {
        const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
        const plan = buildReleasePlan(pkg.version)
        const result = recoverTransaction(repoRoot, outputDir, plan.zipName, plan.sumsName)
        if (result.recovered) {
          stdout.write(`Transaction recovered successfully (${result.action ?? 'restore'}).\n`)
          return 'ok'
        }
        stderr.write(`Transaction recovery failed: ${result.reason}\n`)
        return 'failed'
      }
      generateAssets(distDir, outputDir, force, python3)
      return 'ok'
    } catch (e) {
      stderr.write(`release:prepare-assets failed: ${/** @type {Error} */ (e).message}\n`)
      return 'failed'
    }
  }

  const outcome = await runLocked()

  // Yield to the event loop so a signal that arrived during the synchronous
  // generator work is delivered to the handler BEFORE the exit-code decision
  // (M28 WP-D). Writes have already stopped; the lock is still held.
  await new Promise((resolve) => setImmediate(resolve))

  process.removeListener('SIGINT', signalHandler)
  process.removeListener('SIGTERM', signalHandler)

  // Unified release: the lock is released ONLY after every write/rename/
  // execFile inside runLocked has stopped (M28 WP-D). A release failure must
  // produce a nonzero exit and, after a successful generation, an explicit
  // partial-success message instead of a full success claim (WP-B #5).
  let lockLeaked = false
  try {
    const released = lock.release()
    if (!released.released && released.reason !== 'already-released') {
      stderr.write(`release:prepare-assets: lock release skipped (${released.reason})\n`)
      lockLeaked = true
    }
  } catch (e) {
    lockLeaked = true
    stderr.write(`release:prepare-assets: LOCK NOT RELEASED: ${/** @type {Error} */ (e).message} `)
  }

  // A termination request wins over any generation result; never claim a
  // full success after a signal (M28 WP-D).
  if (terminating !== null) {
    stderr.write(
      `release:${terminating}: run stopped; lock released in unified finally; final state preserved for audit\n`,
    )
    return terminating === 'SIGINT' ? 130 : 143
  }

  if (outcome === 'ok') {
    if (lockLeaked) {
      stderr.write(
        `release:prepare-assets: ASSETS WERE GENERATED SUCCESSFULLY, but the lock was not released -- treating the run as FAILED (exit 1).\n`,
      )
      return 1
    }
    return 0
  }
  return 1
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
