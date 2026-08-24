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

import { spawn } from 'node:child_process'
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
// M33 WP-A: lock schema v2 binds a persistent child-state to the lock nonce.
// v1 locks (owner-PID only) cannot prove a detached helper group is gone and
// are NEVER auto-recovered -- explicit manual audit (see recoverLock).
// M34 WP-A: lock schema v3 upgrades the child-state contract -- the sidecar is
// nonce-qualified (basename embeds the lock nonce) so stale cleanup from an
// old recovery can never delete a newer acquisition's state, and the child
// state carries state/field INVARIANTS (impossible combinations are rejected,
// never recovered). v1/v2 locks fail closed / manual audit -- no guessing.
const LOCK_SCHEMA_VERSION = 3
// M34 WP-A: nonce-qualified sidecar basename. The basename embeds the lock
// nonce, which (a) lets recovery target EXACTLY the sidecar belonging to the
// lock under audit and (b) makes the fixed-name cleanup race (old recovery
// deleting a new acquisition's sidecar) structurally impossible.
/** @param {string} nonce */
export function childStateFileName(nonce) {
  return `.release-staging.child-state-${nonce}.json`
}
/**
 * Max bytes of a readable child-state sidecar. Anything larger is rejected
 * (M34 WP-A #5) -- a sidecar is a tiny JSON document, oversized content is a
 * signal of tampering or a non-sidecar file.
 */
export const CHILD_STATE_MAX_BYTES = 64 * 1024
const CHILD_STATE_SCHEMA_VERSION = 2

/**
 * M33 WP-A: persistent child-ownership states (single source of truth).
 * - EMPTY: lock acquired, no helper was ever spawned.
 * - SPAWN_INTENT: persisted (durable) BEFORE the first spawn; a crash after
 *   this point but before ACTIVE means we CANNOT prove no process exists --
 *   recovery must refuse (manual audit).
 * - ACTIVE: a helper group is running (PGID recorded at spawn time).
 * - QUIESCENCE_PROVEN: the controlled group was proven absent (ESRCH) and
 *   the state was persisted before the lock may be released.
 * - MANUAL_AUDIT_REQUIRED: fail-closed path -- the group could not be proven
 *   gone; recovery refuses and a human must audit.
 */
export const CHILD_STATES = Object.freeze({
  EMPTY: 'EMPTY',
  SPAWN_INTENT: 'SPAWN_INTENT',
  ACTIVE: 'ACTIVE',
  QUIESCENCE_PROVEN: 'QUIESCENCE_PROVEN',
  MANUAL_AUDIT_REQUIRED: 'MANUAL_AUDIT_REQUIRED',
})

/** @type {readonly string[]} */
const CHILD_STATE_VALUES = Object.freeze(Object.values(CHILD_STATES))

/**
 * M34 WP-A: state/field invariants -- the single source of truth for what a
 * child-state may and may not contain in each state. `validateChildState`
 * enforces these BEFORE anything (including a recovery) may act on the state;
 * `writeChildStateSync` validates before writing so the implementation can
 * never generate an impossible state itself.
 *
 * - EMPTY / QUIESCENCE_PROVEN: pgid and helperPid MUST be null. A non-null
 *   PID field in these states is impossible -- a live group under a
 *   "no process" claim must be a manual audit, never an auto-recovery
 *   (P1-A: probe demonstrated both states were recovered while the detached
 *   helper group was still alive and writing).
 * - SPAWN_INTENT: pgid/helperPid MUST be null (they are set only in ACTIVE).
 * - ACTIVE: pgid and helperPid MUST be positive integers AND equal -- under
 *   the POSIX detached-spawn contract the direct child is the process-group
 *   leader, so pgid === helperPid. A mismatch is impossible (P1-A-5).
 * - MANUAL_AUDIT_REQUIRED: pgid/helperPid MUST be null; the last-known
 *   ownership is carried in dedicated lastKnownPgid/lastKnownHelperPid fields
 *   with auditReason -- never disguised as a QUIESCENCE/EMPTY state.
 */
export const CHILD_STATE_FIELD_INVARIANTS = Object.freeze({
  EMPTY: Object.freeze({ pgid: 'null', helperPid: 'null' }),
  SPAWN_INTENT: Object.freeze({ pgid: 'null', helperPid: 'null' }),
  ACTIVE: Object.freeze({
    pgid: 'positive-int',
    helperPid: 'positive-int',
    pgidEqualsHelperPid: true,
  }),
  QUIESCENCE_PROVEN: Object.freeze({ pgid: 'null', helperPid: 'null' }),
  MANUAL_AUDIT_REQUIRED: Object.freeze({
    pgid: 'null',
    helperPid: 'null',
    requiresLastKnown: true,
  }),
})

/** Allowed extra fields per state (beyond the common base). */
export const CHILD_STATE_EXTRA_FIELDS = Object.freeze({
  EMPTY: Object.freeze([]),
  SPAWN_INTENT: Object.freeze([]),
  ACTIVE: Object.freeze([]),
  QUIESCENCE_PROVEN: Object.freeze([]),
  MANUAL_AUDIT_REQUIRED: Object.freeze(['lastKnownPgid', 'lastKnownHelperPid', 'auditReason']),
})

/**
 * Strict ISO-8601 timestamp pattern for child-state `updatedAt`. Rejects
 * ambiguous/loose dates (M34 WP-A #2: invalid timestamps refuse recovery).
 */
export const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/
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

/**
 * M29 WP-B: thrown at a transaction stage boundary when a fatal signal was
 * observed by the runCli handler. The current atomic stage has already
 * completed; no NEW stage may start. runCli classifies this separately from
 * ordinary failures so the exit code stays 130/143 and no success claim is
 * printed.
 */
class SignalStoppedError extends Error {
  /**
   * @param {string} signal
   */
  constructor(signal) {
    super(
      'termination requested (' + signal + '); stopped at the current transaction stage boundary',
    )
    this.name = 'SignalStoppedError'
    this.signal = signal
  }
}

/**
 * M29 WP-B: cooperative stop check. Reads the injected termination state at
 * a stage boundary; when a signal has been observed, throws so the caller
 * stops before entering the next transaction stage.
 *
 * @param {(() => string | null) | undefined} shouldStop
 * @returns {Promise<void>}
 */
async function checkStop(shouldStop) {
  if (shouldStop) {
    const signal = shouldStop()
    if (signal) {
      throw new SignalStoppedError(signal)
    }
  }
}

/**
 * M29 WP-C: thrown when directory durability cannot be proven (a real I/O
 * failure on parent-directory fsync). The transaction must fail closed and
 * keep journal/backup/lock recovery information -- never roll back and
 * delete the journal while durability is uncertain.
 */
class DurabilityError extends Error {
  /**
   * @param {string} message
   * @param {{ code?: string }} [details]
   */
  constructor(message, details) {
    super(message)
    this.name = 'DurabilityError'
    this.code = details && details.code ? details.code : undefined
  }
}

/**
 * M29 WP-C: fsync a parent directory after a rename/unlink/delete so the
 * directory entry change is durable. Error classification:
 *
 * Tolerated (platform does not support directory fsync -- documented note):
 *   EINVAL, ENOTSUP, EOPNOTSUPP, and any other code explicitly proven by a
 *   supported platform as "directory fsync unsupported".
 *
 * Fatal (real I/O failure -- durability cannot be proven, transaction state
 * must be preserved for recovery):
 *   EIO, ENOSPC, EROFS, EBADF, unknown errors, and close() failures.
 *
 * @param {string} dirPath
 * @param {Record<string, any>} [deps]
 * @returns {void}
 */
export function fsyncParentDirectorySync(dirPath, deps = {}) {
  const openSync = deps.openSync || fs.openSync
  const fsyncSync = deps.fsyncSync || fs.fsyncSync
  const closeSync = deps.closeSync || fs.closeSync
  const tolerate = deps.tolerateCodes || new Set(['EINVAL', 'ENOTSUP', 'EOPNOTSUPP'])

  let fd
  try {
    fd = openSync(dirPath, 'r')
  } catch (e) {
    throw new DurabilityError(
      `cannot open parent directory ${dirPath} for fsync: ${/** @type {Error} */ (e).message}`,
      /** @type {{ code?: string }} */ (/** @type {unknown} */ (e)),
    )
  }

  try {
    fsyncSync(fd)
  } catch (e) {
    const err = /** @type {{ code?: string, message: string }} */ (/** @type {unknown} */ (e))
    if (err.code && tolerate.has(err.code)) {
      process.stderr.write(
        `note: parent-directory fsync unsupported on this platform (${err.code}); durability boundary documented in docs/RELEASING.md\n`,
      )
      return
    }
    throw new DurabilityError(
      `parent-directory fsync failed (${err.code || err.message}) -- durability cannot be proven; journal/backup/lock preserved for recovery`,
      { code: err.code },
    )
  } finally {
    try {
      closeSync(fd)
    } catch (e) {
      throw new DurabilityError(
        `failed to close directory fd after fsync: ${/** @type {Error} */ (e).message}`,
        /** @type {{ code?: string }} */ (/** @type {unknown} */ (e)),
      )
    }
  }
}

/**
 * M30 WP-B / M34 WP-C: live registry of every active child CONTROLLER
 * registered by execFileAsync. Each entry owns its termination state machine:
 * `requestTermination(reason)` starts the bounded controlled termination
 * (SIGTERM -> escalation -> deadline -> group-gone proof) -- runCli NEVER
 * reaches into a ChildProcess directly. runCli checks the registry is EMPTY
 * before releasing the lock, so a helper/verifier (or its descendants) can
 * never keep running -- or keep writing to the release path -- after the lock
 * is gone.
 */
export const activeChildren = new Set()

// ---------------------------------------------------------------------------
// Platform capability gate (M31 WP-C)
// ---------------------------------------------------------------------------

/**
 * M31 WP-C: release asset generation is POSIX-only. Windows has no process
 * groups and child.kill() only reaches the DIRECT child, so a "kill the
 * direct child and call it fail-closed" policy cannot guarantee that
 * grandchildren stop writing to the release path (probe P3/P4). Instead of
 * pretending that is safe, the CLI refuses to run on unsupported platforms
 * BEFORE registering any transaction side effect, lock, staging or output.
 *
 * @type {readonly string[]}
 */
export const SUPPORTED_GENERATION_PLATFORMS = Object.freeze(['linux', 'darwin'])

/**
 * Testable capability gate.
 *
 * @param {string} platform
 * @returns {boolean}
 */
export function isSupportedPlatform(platform) {
  return SUPPORTED_GENERATION_PLATFORMS.includes(platform)
}

/**
 * M32 WP-A: bounded poll interval and overall termination deadline for
 * proving that the controlled process group is gone. Both are finite,
 * positive integers -- never an unbounded wait, never a random retry.
 * Exported so tests can pin the contract.
 */
export const GROUP_SETTLE_POLL_MS = 50
export const GROUP_SETTLE_DEADLINE_MS = 10_000

/**
 * @typedef {{
 *   input?: string,
 *   stdio?: Array<'pipe' | 'inherit' | 'ignore'> | 'pipe' | 'inherit' | 'ignore',
 *   timeout?: number,
 *   childState?: {
 *     beginSpawn?: () => void | Promise<void>,
 *     onSpawn?: (pgid: number | null, helperPid: number | null) => void | Promise<void>,
 *     onQuiesced?: () => void | Promise<void>,
 *     onAudit?: (why: string, lastKnownPgid?: number | null, lastKnownHelperPid?: number | null) => void | Promise<void>,
 *   },
 *   timingProfile?: {
 *     settlePollMs?: number,
 *     settleDeadlineMs?: number,
 *     escalationDelayMs?: number,
 *   },
 * }} ExecFileOpts
 */

/**
 * M30 WP-B / M31 WP-B / M32 WP-A: promisified execFile with inherited stdio
 * and a fully controlled child/process-tree lifecycle. The child runs
 * ASYNCHRONOUSLY so the Node event loop can deliver pending signals while
 * the helper/verifier executes.
 *
 * Lifecycle state machine (M32 WP-A -- the M31 implementation conflated
 * "never spawned" with "spawned then errored" and treated the DIRECT child's
 * 'close' as proof that the process group was gone):
 * 1. State is tracked explicitly: `spawned` is set by the ChildProcess
 *    'spawn' event (the ONLY reliable signal that a process was created);
 *    `pgid` is captured at spawn time and never re-derived from a recycled
 *    PID after close.
 * 2. A child that was never created (spawn 'error', e.g. ENOENT) rejects
 *    immediately from the 'error' event with a clean registry -- there is no
 *    process, no group and no 'close' to wait for (M31 contract kept).
 * 3. An 'error' AFTER a successful spawn (kill failure / IPC failure /
 *    abort -- NOT a spawn failure) is recorded as a runtime error: the
 *    promise does NOT settle, the registry is NOT emptied, and controlled
 *    termination continues; the final message never claims `failed to start`.
 * 4. On timeout: record a TimeoutError, request stop (SIGTERM to the whole
 *    controlled process group), WAIT for the direct child's close, and
 *    escalate to SIGKILL if close does not arrive.
 * 5. The direct child's 'close' is NOT proof the tree is gone: after close,
 *    if `process.kill(-pgid, 0)` still finds the group (e.g. a grandchild
 *    that alone ignores SIGTERM), SIGKILL is escalated to the group and the
 *    implementation polls up to GROUP_SETTLE_DEADLINE_MS for ESRCH.
 * 6. A successfully spawned call settles ONLY when: the direct child closed,
 *    the controlled process group is proven absent (POSIX), every owned
 *    timer (main timeout, escalation, termination deadline, group poll) is
 *    cleared, and the activeChildren registry is updated.
 * 7. If the group cannot be proven gone within the bounded deadline (EPERM,
 *    unknown errors, kill failures): FAIL CLOSED -- the promise rejects with
 *    an audit message, the registry entry is PRESERVED, and runCli refuses
 *    to release the release lock while the registry is non-empty.
 * 8. No infinite waits, no random retries, no sleep-based race masking.
 * 9. child.kill() returning false is never a crash -- the outcome still
 *    comes from the state machine above.
 * 10. stdin EPIPE/error is captured (error listener) -- never an unhandled
 *     stream error.
 * 11. POSIX uses a dedicated process group (detached: true) so SIGTERM/
 *     SIGKILL can address the whole tree (-pgid). Windows has no process
 *     groups; the CLI refuses to run there entirely (M31 WP-C platform
 *     gate); this function keeps a defensive direct-kill fallback for direct
 *     callers only.
 *
 * @param {string} cmd
 * @param {string[]} args
 * @param {ExecFileOpts} [opts]
 * @param {{
 *   kill?: (child: import('node:child_process').ChildProcess, signal: NodeJS.Signals) => boolean,
 *   postSpawnError?: Error,
 * }} [deps]
 * @returns {Promise<void>}
 */
export function execFileAsync(cmd, args, opts = {}, deps = {}) {
  return new Promise((resolve, reject) => {
    const stdio = /** @type {Array<'pipe' | 'inherit' | 'ignore'>} */ (
      Array.isArray(opts.stdio)
        ? opts.stdio
        : opts.stdio
          ? [opts.stdio]
          : ['pipe', 'inherit', 'inherit']
    )
    const spawnOpts = /** @type {import('node:child_process').SpawnOptions} */ ({ stdio })
    // POSIX: dedicated process group so the whole tree can be stopped.
    // Windows: no process groups -- leave default (CLI refuses Windows at the
    // platform gate, M31 WP-C; direct callers get a defensive direct kill).
    if (process.platform !== 'win32') {
      spawnOpts.detached = true
    }
    // M33 WP-A #3/#4: the pre-spawn barrier. SPAWN_INTENT is made durable
    // (sidecar temp+fsync+rename) BEFORE the process is created, so a crash
    // between this point and the ACTIVE write leaves SPAWN_INTENT on disk and
    // recovery refuses (manual audit) -- the crash window is closed by
    // fail-closed recovery, never by a plain post-spawn write.
    const begin = async () => {
      if (opts.childState && typeof opts.childState.beginSpawn === 'function') {
        try {
          await opts.childState.beginSpawn()
        } catch (e) {
          reject(
            new Error(
              `${cmd}: child-state SPAWN_INTENT persistence failed before spawn (${e instanceof Error ? e.message : String(e)}) -- no process created; lock must not be released`,
            ),
          )
          return
        }
      }
      const child = spawn(cmd, args, spawnOpts)
      let stderrBuf = ''
      let settled = false
      /** Whether the 'spawn' event was observed -- a process was created. */
      let spawned = false
      /** PGID captured at spawn time (POSIX); never re-derived after close. */
      /** @type {number | null} */
      let pgid = null
      /** @type {number | null} */
      let exitCode = null
      /** @type {NodeJS.Signals | null} */
      let exitSignal = null
      /** @type {Error | null} */
      let timeoutError = null
      /** @type {Error | null} */
      let runtimeError = null
      /** @type {ReturnType<typeof setTimeout> | null} */
      let timer = null
      /** @type {ReturnType<typeof setTimeout> | null} */
      let escalationTimer = null
      /** @type {ReturnType<typeof setTimeout> | null} */
      let deadlineTimer = null
      /** @type {ReturnType<typeof setTimeout> | null} */
      let groupPollTimer = null
      /** @type {ReturnType<typeof setTimeout> | null} */
      let faultInjectTimer = null

      /** Clear every timer owned by this call (main + escalation + deadline + poll + fault-injection). */
      const clearOwnedTimers = () => {
        if (timer) {
          clearTimeout(timer)
          timer = null
        }
        if (escalationTimer) {
          clearTimeout(escalationTimer)
          escalationTimer = null
        }
        if (deadlineTimer) {
          clearTimeout(deadlineTimer)
          deadlineTimer = null
        }
        if (groupPollTimer) {
          clearTimeout(groupPollTimer)
          groupPollTimer = null
        }
        if (faultInjectTimer) {
          clearTimeout(faultInjectTimer)
          faultInjectTimer = null
        }
      }

      /**
       * POSIX: does the controlled process group still exist? ESRCH means gone;
       * EPERM or any unknown error means we CANNOT prove it is gone -- treat it
       * as alive (fail closed).
       *
       * @returns {boolean}
       */
      const groupExists = () => {
        if (process.platform === 'win32' || pgid === null) return false
        try {
          process.kill(-pgid, 0)
          return true
        } catch (e) {
          const err = /** @type {{ code?: string }} */ (/** @type {unknown} */ (e))
          if (err.code === 'ESRCH') return false
          return true
        }
      }

      /**
       * Stop the whole controlled process group (POSIX) or the direct child
       * (Windows fallback). Never throws; returns whether the signal was
       * delivered.
       *
       * @param {NodeJS.Signals} signal
       * @returns {boolean}
       */
      const stopTree = (signal) => {
        if (deps.kill) {
          try {
            return deps.kill(child, signal)
          } catch {
            return false
          }
        }
        if (process.platform !== 'win32') {
          try {
            if (pgid === null) {
              return child.kill(signal)
            }
            process.kill(-pgid, signal)
            return true
          } catch (e) {
            const err = /** @type {{ code?: string }} */ (/** @type {unknown} */ (e))
            if (err.code === 'ESRCH') return false
            try {
              return child.kill(signal)
            } catch {
              return false
            }
          }
        }
        try {
          return child.kill(signal)
        } catch {
          return false
        }
      }

      /**
       * M33 WP-D: injectable timing profile (production defaults unchanged;
       * tests use short deterministic values; no global mutable constants).
       */
      const timing = opts.timingProfile || {}
      const settlePollMs = timing.settlePollMs ?? GROUP_SETTLE_POLL_MS
      const settleDeadlineMs = timing.settleDeadlineMs ?? GROUP_SETTLE_DEADLINE_MS
      const escalationDelayMs = timing.escalationDelayMs ?? 1000

      /**
       * M33 WP-B: let the parent process exit NATURALLY (non-zero) after a
       * fail-closed settle while the unterminatable child keeps running.
       * child.unref() alone is not sufficient -- the stdio pipes are also
       * active event-loop handles and must be destroyed (probe P1-B: the CLI
       * stayed alive >1s after top-level await completed). This never calls
       * process.exit() and never clears the registry entry: the preserved
       * entry is what forces runCli to refuse releasing the lock.
       *
       * @returns {void}
       */
      const detachForNaturalExit = () => {
        try {
          child.unref()
        } catch {
          // defensive
        }
        try {
          if (child.stdin) child.stdin.destroy()
        } catch {
          // defensive
        }
        try {
          if (child.stdout) child.stdout.destroy()
        } catch {
          // defensive
        }
        try {
          if (child.stderr) child.stderr.destroy()
        } catch {
          // defensive
        }
      }

      /**
       * M34 WP-C: bounded controlled termination. Started by a timeout, a
       * post-spawn runtime error (kill failure / IPC failure / abort /
       * child-state ACTIVE persistence failure) OR an explicit user signal
       * through the controller's `requestTermination(reason)` -- the signal
       * path never waits out the helper's own long timeout (P1-B).
       *
       * Re-entrancy guard: a kill() injection that emits a post-spawn 'error'
       * from inside stopTree() would otherwise re-enter this function through
       * the error handler (probe M5: the escalation timer was created 73
       * times and only 3 timers were cleared). The FIRST entry owns the
       * termination; later entries are no-ops.
       *
       * @param {string} reason
       * @returns {void}
       */
      let terminationStarted = false
      /** @type {string | null} */
      let terminationReason = null
      /** @param {string} reason @returns {void} */
      const startControlledTermination = (reason) => {
        if (terminationStarted) return
        terminationStarted = true
        terminationReason = reason
        // Diagnostic only: the reason rides into the final error message via
        // failClosedSettle below (M34 WP-C: signal/timeout/runtime-error are
        // distinguishable in the audit trail).
        void terminationReason
        startTerminationDeadline()
        stopTree('SIGTERM')
        if (!escalationTimer) {
          escalationTimer = setTimeout(() => {
            if (!settled) {
              stopTree('SIGKILL')
            }
          }, escalationDelayMs)
        }
      }

      /**
       * M34 WP-C: this call's controller -- the ONLY surface runCli (or a
       * signal handler) may use to stop this child. Registered in the
       * activeChildren registry from spawn until settle; removed on settle
       * (or on a never-spawned error). requestTermination is idempotent:
       * repeated calls only record that a termination was already in
       * progress and never create a second timer.
       */
      const controller = {
        /** @param {string} reason @returns {boolean} */
        requestTermination: (reason) => {
          if (settled || terminationStarted) {
            // already in progress / already settled -- idempotent
            return false
          }
          startControlledTermination(reason)
          return true
        },
        get alive() {
          return !settled
        },
      }
      activeChildren.add(controller)

      /**
       * Normal completion: direct child closed AND the controlled group is
       * proven absent; QUIESCENCE_PROVEN persisted (fail closed if that
       * persistence fails); timers cleared; registry updated.
       *
       * @returns {void}
       */
      const finishSettle = () => {
        if (settled) return
        // M33 WP-A #7/#8: persist QUIESCENCE_PROVEN BEFORE settling -- the
        // child-state must prove the group was gone before the lock may be
        // released. A persistence failure fails closed (registry preserved,
        // lock not released). Supports both sync and async callbacks.
        if (opts.childState && typeof opts.childState.onQuiesced === 'function') {
          const failQuiesce = (/** @type {unknown} */ e) => {
            failClosedSettle(
              `child-state QUIESCENCE_PROVEN persistence failed after group proven gone: ${e instanceof Error ? e.message : String(e)}`,
            )
          }
          let r
          try {
            r = opts.childState.onQuiesced()
          } catch (e) {
            failQuiesce(e)
            return
          }
          if (r && typeof r.then === 'function') {
            r.then(() => finishSettleAfterQuiesce(), failQuiesce)
            return
          }
        }
        finishSettleAfterQuiesce()
      }

      /**
       * Second half of finishSettle (after the quiescence persistence step).
       *
       * @returns {void}
       */
      const finishSettleAfterQuiesce = () => {
        if (settled) return
        settled = true
        activeChildren.delete(controller)
        clearOwnedTimers()
        if (runtimeError) {
          reject(runtimeError)
          return
        }
        if (timeoutError) {
          reject(timeoutError)
          return
        }
        if (exitSignal) {
          reject(new Error(`${cmd} was terminated by signal ${exitSignal}: ${stderrBuf.trim()}`))
          return
        }
        if (exitCode !== 0) {
          reject(new Error(`${cmd} exited with status ${String(exitCode)}: ${stderrBuf.trim()}`))
          return
        }
        resolve()
      }

      /**
       * Fail closed: the group could not be proven gone within the bounded
       * deadline. The registry entry is PRESERVED on purpose -- runCli refuses
       * to release the release lock while activeChildren is non-empty, so the
       * on-disk state stays recoverable/auditable. The child-state is marked
       * MANUAL_AUDIT_REQUIRED (best effort) and the child is detached so the
       * CLI process can still exit naturally and non-zero.
       *
       * @param {string} why
       * @returns {void}
       */
      const failClosedSettle = (why) => {
        if (settled) return
        settled = true
        clearOwnedTimers()
        // M34 WP-B #1: the MANUAL_AUDIT_REQUIRED state records last-known
        // ownership (pgid/helperPid) so a formal audit acknowledgement can
        // act on it later -- never a bare QUIESCENCE-shaped state.
        if (opts.childState && typeof opts.childState.onAudit === 'function') {
          try {
            opts.childState.onAudit(why, pgid, child.pid ?? null)
          } catch {
            // best effort -- the preserved registry entry and the held lock
            // are the primary fail-closed guarantees
          }
        }
        detachForNaturalExit()
        const runtimeDetail = runtimeError ? `; runtime error: ${runtimeError.message}` : ''
        reject(
          new Error(
            `${cmd}: FAILED CLOSED -- ${why}${runtimeDetail}; child registry entry preserved and release lock must not be released`,
          ),
        )
      }

      /**
       * Bounded poll for process-group disappearance (ESRCH).
       *
       * @param {number} deadlineAt
       * @returns {void}
       */
      const pollGroupGone = (deadlineAt) => {
        if (settled) return
        if (!groupExists()) {
          finishSettle()
          return
        }
        if (Date.now() >= deadlineAt) {
          failClosedSettle(
            'could not prove the process group disappeared within the bounded deadline',
          )
          return
        }
        groupPollTimer = setTimeout(() => pollGroupGone(deadlineAt), settlePollMs)
        // NOTE: intentionally NOT unref'd. After the direct child's close the
        // poll timer can be the ONLY active handle in the event loop; unref'd
        // timers do not keep the loop alive and the promise would never settle
        // (observed as an unsettled top-level await in the standalone stress
        // process). The timer is always cleared by clearOwnedTimers on settle.
      }

      /**
       * The direct child closed but the controlled group is STILL alive (e.g. a
       * grandchild that alone ignores SIGTERM): escalate to SIGKILL and poll
       * until ESRCH or the bounded deadline.
       *
       * @returns {void}
       */
      const escalateAndWaitGroup = () => {
        if (settled) return
        stopTree('SIGKILL')
        pollGroupGone(Date.now() + settleDeadlineMs)
      }

      /**
       * Bounded overall termination deadline: after a timeout or a post-spawn
       * runtime error, if neither close nor a proven-gone group arrives in
       * time, fail closed instead of waiting forever.
       *
       * @returns {void}
       */
      const startTerminationDeadline = () => {
        if (deadlineTimer) return
        deadlineTimer = setTimeout(() => {
          if (!settled) {
            failClosedSettle(
              'termination deadline exceeded: neither the direct child close nor a proven-gone process group arrived in time',
            )
          }
        }, settleDeadlineMs)
      }

      child.on('spawn', () => {
        spawned = true
        // POSIX: the detached child is the process-group leader, so the PGID
        // equals child.pid -- captured at spawn time (never re-derived from a
        // recycled PID after close, M32 WP-A #9).
        if (process.platform !== 'win32' && child.pid !== undefined) {
          pgid = child.pid
        }
        // M33 WP-B #4 test/fault-injection hook: simulate a post-spawn error
        // (IPC failure / abort / external kill failure) arriving asynchronously
        // even when NO opts.timeout was set -- the controlled termination must
        // start regardless. Small delay so the child has started executing.
        // M34 WP-C #8: the fault-injection timer is an OWNED timer -- cleared
        // on settle so no live handle survives the state machine.
        if (deps.postSpawnError !== undefined) {
          faultInjectTimer = setTimeout(() => {
            if (!settled) {
              child.emit('error', deps.postSpawnError)
            }
          }, 300)
        }
        // M33 WP-A #4: persist ACTIVE as early as possible after spawn. A crash
        // between SPAWN_INTENT and this write leaves SPAWN_INTENT on disk and
        // recovery refuses (manual audit) -- the crash window is fail-closed.
        if (opts.childState && typeof opts.childState.onSpawn === 'function') {
          const failActivate = (/** @type {unknown} */ e) => {
            if (settled) return
            runtimeError = new Error(
              `${cmd}: child-state ACTIVE persistence failed after spawn (${e instanceof Error ? e.message : String(e)})`,
            )
            startControlledTermination('child-state-ACTIVE-persistence-failed')
          }
          try {
            const r = opts.childState.onSpawn(pgid, child.pid ?? null)
            if (r && typeof r.catch === 'function') {
              r.catch(failActivate)
            }
          } catch (e) {
            failActivate(e)
          }
        }
      })

      child.on('error', (e) => {
        if (settled) return
        if (!spawned) {
          // A child that was never created (spawn error, e.g. ENOENT) rejects
          // here -- there is no process, no group and no 'close' to wait for;
          // the registry entry is removed because nothing is alive to leak.
          settled = true
          activeChildren.delete(controller)
          clearOwnedTimers()
          reject(new Error(`failed to start ${cmd}: ${e.message}`))
          return
        }
        // Post-spawn runtime error (kill failure / IPC failure / abort): record
        // it, do NOT settle, do NOT touch the registry -- controlled
        // termination and group cleanup continue (M32 WP-A #3). M33 WP-B #4:
        // even without opts.timeout a bounded controlled termination starts.
        runtimeError = new Error(
          `${cmd} failed after spawn (${/** @type {{ code?: string }} */ (/** @type {unknown} */ (e)).code || 'runtime error'}): ${e.message}`,
        )
        startControlledTermination('post-spawn-error')
      })

      const stderrStream = child.stderr
      if (stderrStream) {
        stderrStream.on('data', (d) => {
          stderrBuf += String(d)
        })
        stderrStream.on('error', () => {
          // stderr stream errors are not fatal for the outcome.
        })
      }

      if (opts.input !== undefined && child.stdin) {
        // stdin errors (e.g. EPIPE when the helper exits before reading the
        // manifest) must never surface as unhandled stream errors -- record
        // them; the outcome is decided by the state machine above.
        child.stdin.on('error', (e) => {
          const err = /** @type {{ code?: string, message: string }} */ (/** @type {unknown} */ (e))
          stderrBuf += `(stdin: ${err.code || err.message})\n`
        })
        try {
          child.stdin.write(opts.input)
        } catch {
          // sink -- the error listener above owns the failure
        }
        child.stdin.end()
      }

      child.on('close', (code, signal) => {
        if (settled) return
        exitCode = code
        exitSignal = signal
        // M32 WP-A #5: the direct child's close is NOT proof the process group
        // is gone. While the group still exists, keep terminating (SIGKILL
        // escalation) and poll for ESRCH -- only then settle.
        if (process.platform !== 'win32' && pgid !== null && groupExists()) {
          escalateAndWaitGroup()
          return
        }
        finishSettle()
      })

      const mainTimeoutTimer =
        opts.timeout !== undefined && opts.timeout > 0
          ? setTimeout(() => {
              if (settled) return
              timeoutError = new Error(`child ${cmd} timed out after ${opts.timeout}ms`)
              // 1) bounded overall deadline; 2) request stop; 3) the close
              // handler settles (or escalates + polls); 4) escalate if close
              // never arrives. Unified with the post-spawn-error path so the
              // escalation timer is created exactly once (M33 WP-B #4).
              startControlledTermination('timeout')
            }, opts.timeout)
          : null
      timer = mainTimeoutTimer
    }
    void begin()
  })
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
 * @param {Record<string, any>} [deps]
 * @returns {Promise<void>}
 */
async function createDeterministicZip(distDir, files, outputPath, python3 = PYTHON3, deps) {
  // M33 WP-A: childState is threaded into every execFile call so SPAWN_INTENT
  // is persisted before each helper spawn and ACTIVE after it.
  /**
   * @param {string} cmd
   * @param {string[]} args
   * @param {ExecFileOpts} [opts2]
   */
  const execFile = (cmd, args, opts2 = {}) =>
    (deps && deps.execFile ? deps.execFile : execFileAsync)(cmd, args, {
      ...opts2,
      childState: deps && deps.childState,
    })
  const entries = validateAndCollectEntries(distDir, files)

  // Build manifest as JSON lines
  const manifestLines = entries.map((entry) =>
    JSON.stringify({ entry, path: path.join(distDir, entry.split('/').join(path.sep)) }),
  )
  const manifest = manifestLines.join('\n')

  const zipHelper = path.join(scriptRepoRoot, 'scripts', '_zip_helper.py')

  await execFile(python3, [zipHelper, distDir, outputPath], {
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
 * M33 WP-A / M34 WP-A: persistent child-ownership state (single source of
 * truth shared by the lock metadata and the sidecar file). M34 adds the
 * MANUAL_AUDIT_REQUIRED last-known fields: when a group cannot be proven gone,
 * lastKnownPgid/lastKnownHelperPid/auditReason carry the audit trail in
 * DEDICATED fields (never disguised as a QUIESCENCE/EMPTY state).
 *
 * @typedef {{
 *   schemaVersion: number,
 *   nonce: string,
 *   repoRealpath: string,
 *   state: string,
 *   pgid: number | null,
 *   helperPid: number | null,
 *   updatedAt: string,
 *   lastKnownPgid?: number | null,
 *   lastKnownHelperPid?: number | null,
 *   auditReason?: string,
 * }} ChildState
 */

/**
 * M34 WP-A: validate a child-state object against the schema AND the
 * state/field invariants (CHILD_STATE_FIELD_INVARIANTS). Any impossible
 * combination, extra dangerous field, unknown schema/state, invalid timestamp
 * or nonce/repo mismatch refuses recovery (manual audit) -- never guessed.
 *
 * @param {unknown} value
 * @param {string} [expectedNonce] -- lock nonce the child-state must match
 * @param {string} [expectedRepoRealpath]
 * @returns {{ ok: true, childState: ChildState } | { ok: false, reason: string }}
 */
export function validateChildState(value, expectedNonce, expectedRepoRealpath) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, reason: 'childState is not an object' }
  }
  const cs = /** @type {Record<string, unknown>} */ (value)
  if (cs.schemaVersion !== CHILD_STATE_SCHEMA_VERSION) {
    return {
      ok: false,
      reason: `unsupported child-state schemaVersion ${JSON.stringify(cs.schemaVersion)} (expected ${CHILD_STATE_SCHEMA_VERSION}) -- manual audit required`,
    }
  }
  if (typeof cs.state !== 'string' || !CHILD_STATE_VALUES.includes(cs.state)) {
    return {
      ok: false,
      reason: `unknown child-state state ${JSON.stringify(cs.state)} -- manual audit required`,
    }
  }
  if (typeof cs.nonce !== 'string' || cs.nonce.length === 0) {
    return { ok: false, reason: 'child-state nonce missing' }
  }
  if (expectedNonce !== undefined && cs.nonce !== expectedNonce) {
    return {
      ok: false,
      reason: `child-state nonce does not match lock nonce ${expectedNonce} -- manual audit required`,
    }
  }
  if (typeof cs.repoRealpath !== 'string' || cs.repoRealpath.length === 0) {
    return { ok: false, reason: 'child-state repoRealpath missing' }
  }
  if (expectedRepoRealpath !== undefined && cs.repoRealpath !== expectedRepoRealpath) {
    return {
      ok: false,
      reason: 'child-state repoRealpath does not match lock repoRealpath -- manual audit required',
    }
  }
  if (typeof cs.updatedAt !== 'string' || !ISO_TIMESTAMP_PATTERN.test(cs.updatedAt)) {
    return {
      ok: false,
      reason:
        'child-state updatedAt missing or not a strict ISO-8601 timestamp -- manual audit required',
    }
  }
  if (Number.isNaN(Date.parse(cs.updatedAt))) {
    return {
      ok: false,
      reason: 'child-state updatedAt is not a parseable date -- manual audit required',
    }
  }

  /** @param {unknown} v */
  const posInt = (v) => typeof v === 'number' && Number.isInteger(v) && v > 0

  // M34 WP-A #1: state/field invariants -- validate the COMBINATION, not just
  // the field types. Impossible combinations are manual-audit conditions.
  const invariant =
    /** @type {Record<string, { pgid: string, helperPid: string, pgidEqualsHelperPid?: boolean, requiresLastKnown?: boolean }>} */ (
      CHILD_STATE_FIELD_INVARIANTS
    )[cs.state]
  /** @param {string} field @returns {string | null} */
  const checkNull = (field) => {
    if (cs[field] !== null) {
      return `child-state ${cs.state} requires ${field} to be null (got ${JSON.stringify(cs[field])}) -- impossible state, manual audit required`
    }
    return null
  }
  /** @param {string} field @returns {string | null} */
  const checkPosInt = (field) => {
    if (!posInt(cs[field])) {
      return `child-state ${cs.state} requires ${field} to be a positive integer (got ${JSON.stringify(cs[field])}) -- impossible state, manual audit required`
    }
    return null
  }
  if (invariant.pgid === 'null') {
    const err = checkNull('pgid')
    if (err) return { ok: false, reason: err }
  } else {
    const err = checkPosInt('pgid')
    if (err) return { ok: false, reason: err }
  }
  if (invariant.helperPid === 'null') {
    const err = checkNull('helperPid')
    if (err) return { ok: false, reason: err }
  } else {
    const err = checkPosInt('helperPid')
    if (err) return { ok: false, reason: err }
  }
  if (invariant.pgidEqualsHelperPid && cs.pgid !== cs.helperPid) {
    return {
      ok: false,
      reason: `child-state ACTIVE pgid (${JSON.stringify(cs.pgid)}) does not equal helperPid (${JSON.stringify(cs.helperPid)}) -- violates detached group-leader contract, manual audit required`,
    }
  }

  // M34 WP-A #1: extra fields beyond the schema are dangerous -- reject.
  const baseFields = [
    'schemaVersion',
    'nonce',
    'repoRealpath',
    'state',
    'pgid',
    'helperPid',
    'updatedAt',
  ]
  const allowed = new Set([
    ...baseFields,
    .../** @type {readonly string[]} */ (
      /** @type {Record<string, readonly string[]>} */ (CHILD_STATE_EXTRA_FIELDS)[cs.state] || []
    ),
  ])
  for (const key of Object.keys(cs)) {
    if (!allowed.has(key)) {
      return {
        ok: false,
        reason: `child-state contains unexpected field ${JSON.stringify(key)} -- manual audit required`,
      }
    }
  }

  // M34 WP-A #1: MANUAL_AUDIT_REQUIRED must carry last-known ownership and a
  // reason in DEDICATED fields -- never disguised as QUIESCENCE/EMPTY.
  if (cs.state === CHILD_STATES.MANUAL_AUDIT_REQUIRED) {
    if (typeof cs.auditReason !== 'string' || cs.auditReason.length === 0) {
      return {
        ok: false,
        reason: 'child-state MANUAL_AUDIT_REQUIRED missing auditReason -- manual audit required',
      }
    }
    if (!posInt(cs.lastKnownPgid)) {
      return {
        ok: false,
        reason:
          'child-state MANUAL_AUDIT_REQUIRED missing/invalid lastKnownPgid -- manual audit required',
      }
    }
    if (!posInt(cs.lastKnownHelperPid)) {
      return {
        ok: false,
        reason:
          'child-state MANUAL_AUDIT_REQUIRED missing/invalid lastKnownHelperPid -- manual audit required',
      }
    }
  }

  return {
    ok: true,
    childState: /** @type {ChildState} */ (cs),
  }
}

/**
 * M34 WP-A #4/#5: safely read and validate the nonce-qualified child-state
 * sidecar bound to a lock.
 *
 * Hardening over M33:
 * - the sidecar basename embeds the lock nonce (strict basename validation --
 *   no path traversal, nothing but a UUID suffix);
 * - lstat first: symlink / directory / FIFO / socket / device are all
 *   rejected (P2-1a: a symlink sidecar was followed and the lock recovered;
 *   P2-1b: a FIFO sidecar blocked readFileSync forever);
 * - bounded size: CHILD_STATE_MAX_BYTES -- oversized content is rejected
 *   before reading;
 * - open + fstat: the fd must be a regular file with the SAME dev+ino the
 *   lstat observed -- a replace race between lstat and open is detected;
 * - read errors, short reads and JSON parse failures are manual-audit
 *   conditions.
 *
 * @param {string} repoRoot
 * @param {string} nonce -- the lock nonce; the sidecar basename must match
 * @param {{
 *   lstatSync?: typeof fs.lstatSync,
 *   openSync?: typeof fs.openSync,
 *   fstatSync?: typeof fs.fstatSync,
 *   readSync?: typeof fs.readSync,
 *   closeSync?: typeof fs.closeSync,
 * }} [deps]
 * @returns {{ ok: true, childState: ChildState, path: string } | { ok: false, reason: string, path: string }}
 */
export function readChildStateFile(repoRoot, nonce, deps = {}) {
  const lstatSync = deps.lstatSync || fs.lstatSync
  const openSync = deps.openSync || fs.openSync
  const fstatSync = deps.fstatSync || fs.fstatSync
  const readSync = deps.readSync || fs.readSync
  const closeSync = deps.closeSync || fs.closeSync

  // Strict basename: nonce-qualified, no separators, no traversal.
  const basename = childStateFileName(nonce)
  if (basename.includes('/') || basename.includes('\\') || basename.includes('..')) {
    return {
      ok: false,
      reason: `child-state sidecar basename for nonce ${nonce} is unsafe -- manual audit required`,
      path: path.join(repoRoot, basename),
    }
  }
  const childStatePath = path.join(repoRoot, basename)

  /** @type {fs.Stats} */
  let lst
  try {
    lst = lstatSync(childStatePath)
  } catch (e) {
    const err = /** @type {{ code?: string }} */ (/** @type {unknown} */ (e))
    if (err.code === 'ENOENT') {
      return {
        ok: false,
        reason: `${basename} missing -- cannot prove child ownership -- manual audit required`,
        path: childStatePath,
      }
    }
    return {
      ok: false,
      reason: `${basename} unreadable (${e instanceof Error ? e.message : String(e)}) -- manual audit required`,
      path: childStatePath,
    }
  }
  if (lst.isSymbolicLink()) {
    return {
      ok: false,
      reason: `${basename} is a symlink -- manual audit required`,
      path: childStatePath,
    }
  }
  if (!lst.isFile()) {
    return {
      ok: false,
      reason: `${basename} is not a regular file -- manual audit required`,
      path: childStatePath,
    }
  }
  if (lst.size > CHILD_STATE_MAX_BYTES) {
    return {
      ok: false,
      reason: `${basename} exceeds the ${CHILD_STATE_MAX_BYTES}-byte sidecar limit (${lst.size} bytes) -- manual audit required`,
      path: childStatePath,
    }
  }

  /** @type {number} */
  let fd
  try {
    fd = openSync(childStatePath, 'r')
  } catch (e) {
    return {
      ok: false,
      reason: `${basename} open failed (${e instanceof Error ? e.message : String(e)}) -- manual audit required`,
      path: childStatePath,
    }
  }
  /** @type {fs.Stats} */
  let fst
  try {
    fst = fstatSync(fd)
  } catch (e) {
    try {
      closeSync(fd)
    } catch {
      // best effort
    }
    return {
      ok: false,
      reason: `${basename} fstat failed (${e instanceof Error ? e.message : String(e)}) -- manual audit required`,
      path: childStatePath,
    }
  }
  // Replace race: the fd must be the exact inode the lstat observed.
  if (!fst.isFile() || fst.dev !== lst.dev || fst.ino !== lst.ino) {
    try {
      closeSync(fd)
    } catch {
      // best effort
    }
    return {
      ok: false,
      reason: `${basename} was replaced between stat and open -- manual audit required`,
      path: childStatePath,
    }
  }
  if (fst.size > CHILD_STATE_MAX_BYTES) {
    try {
      closeSync(fd)
    } catch {
      // best effort
    }
    return {
      ok: false,
      reason: `${basename} exceeds the ${CHILD_STATE_MAX_BYTES}-byte sidecar limit after open (${fst.size} bytes) -- manual audit required`,
      path: childStatePath,
    }
  }

  const buf = Buffer.alloc(fst.size)
  let offset = 0
  while (offset < buf.length) {
    let n = 0
    try {
      n = readSync(fd, buf, offset, buf.length - offset, null)
    } catch (e) {
      try {
        closeSync(fd)
      } catch {
        // best effort
      }
      return {
        ok: false,
        reason: `${basename} read failed (${e instanceof Error ? e.message : String(e)}) -- manual audit required`,
        path: childStatePath,
      }
    }
    if (n === 0) break // EOF before expected size -- the file shrank mid-read
    offset += n
  }
  try {
    closeSync(fd)
  } catch {
    // best effort -- content already read
  }
  if (offset !== buf.length) {
    return {
      ok: false,
      reason: `${basename} shrank while reading (read ${offset}/${buf.length} bytes) -- manual audit required`,
      path: childStatePath,
    }
  }

  /** @type {unknown} */
  let parsed
  try {
    parsed = JSON.parse(buf.toString('utf8'))
  } catch {
    return {
      ok: false,
      reason: `${basename} is not valid JSON -- manual audit required`,
      path: childStatePath,
    }
  }
  const validated = validateChildState(parsed, nonce)
  if (!validated.ok) {
    return {
      ok: false,
      reason: `${basename} rejected: ${validated.reason}`,
      path: childStatePath,
    }
  }
  return { ok: true, childState: validated.childState, path: childStatePath }
}

/**
 * Durably persist a child-state sidecar update: temp file + writeAllSync +
 * fsync + rename + parent-directory fsync. Throws on ANY failure -- the
 * caller must fail closed (never release the main lock when child-state
 * persistence cannot be proven).
 *
 * @param {string} repoRoot
 * @param {string} nonce -- lock nonce the state is bound to
 * @param {string} repoRealpath
 * @param {string} state
 * @param {number | null} pgid
 * @param {number | null} helperPid
 * @param {LockDeps} [deps]
 * @returns {void}
 */
export function writeChildStateSync(
  repoRoot,
  nonce,
  repoRealpath,
  state,
  pgid,
  helperPid,
  deps = {},
) {
  const openSync = deps.openSync || fs.openSync
  const writeSync = deps.writeSync || fs.writeSync
  const closeSync = deps.closeSync || fs.closeSync
  const renameSync = deps.renameSync || fs.renameSync
  const unlinkSync = deps.unlinkSync || fs.unlinkSync
  const fsyncSync = deps.fsyncSync || fs.fsyncSync
  const basename = childStateFileName(nonce)
  const childStatePath = path.join(repoRoot, basename)
  const tmpPath = path.join(repoRoot, `.${basename}.tmp`)
  /** @type {ChildState} */
  const stateObj = {
    schemaVersion: CHILD_STATE_SCHEMA_VERSION,
    nonce,
    repoRealpath,
    state,
    pgid,
    helperPid,
    updatedAt: new Date().toISOString(),
  }
  // M34 WP-A #3: the SAME validator used for recovery runs before writing --
  // the implementation can never persist an impossible state (a write of an
  // invalid state would otherwise be read back as a manual-audit condition
  // forever).
  const selfCheck = validateChildState(stateObj, nonce, repoRealpath)
  if (!selfCheck.ok) {
    throw new Error(`refusing to write impossible child-state: ${selfCheck.reason}`)
  }
  const payload = Buffer.from(JSON.stringify(stateObj) + '\n', 'utf8')
  let fd
  try {
    fd = openSync(tmpPath, 'wx', 0o600)
  } catch (e) {
    throw new Error(`child-state temp open failed (${e instanceof Error ? e.message : String(e)})`)
  }
  try {
    writeAllSync(fd, payload, { writeSync })
    fsyncSync(fd)
    closeSync(fd)
  } catch (e) {
    try {
      closeSync(fd)
    } catch {
      // original error wins
    }
    try {
      unlinkSync(tmpPath)
    } catch {
      // best effort
    }
    throw new Error(`child-state write failed (${e instanceof Error ? e.message : String(e)})`)
  }
  try {
    renameSync(tmpPath, childStatePath)
    fsyncParentDirectorySync(repoRoot, deps)
  } catch (e) {
    try {
      unlinkSync(tmpPath)
    } catch {
      // best effort
    }
    throw new Error(
      `child-state rename/durability failed (${e instanceof Error ? e.message : String(e)})`,
    )
  }
}

/**
 * Child-state manager bound to a specific lock acquisition (nonce). Used by
 * execFileAsync hooks and by runCli's unified finally. All state transitions
 * are durable or throw (fail closed). M34 WP-A: every artifact (path, temp,
 * cleanup) is nonce-qualified so an old recovery can never touch a new
 * acquisition's sidecar.
 *
 * @param {string} repoRoot
 * @param {string} lockNonce
 * @param {string} repoRealpath
 * @param {LockDeps} [deps]
 * @returns {{
 *   childStatePath: string,
 *   beginSpawn: () => void,
 *   onSpawn: (pgid: number | null, helperPid: number | null) => void,
 *   onQuiesced: () => void,
 *   onAudit: (why: string, lastKnownPgid?: number | null, lastKnownHelperPid?: number | null) => void,
 *   finalize: () => boolean,
 *   cleanup: () => void,
 * }}
 */
export function makeChildStateManager(repoRoot, lockNonce, repoRealpath, deps = {}) {
  const childStatePath = path.join(repoRoot, childStateFileName(lockNonce))
  /**
   * @param {string} state
   * @param {number | null} pgid
   * @param {number | null} helperPid
   */
  const write = (state, pgid, helperPid) =>
    writeChildStateSync(repoRoot, lockNonce, repoRealpath, state, pgid, helperPid, deps)
  return {
    childStatePath,
    beginSpawn: () => write(CHILD_STATES.SPAWN_INTENT, null, null),
    // execFileAsync hook contract (onSpawn/onQuiesced/onAudit).
    onSpawn: (pgid, helperPid) => write(CHILD_STATES.ACTIVE, pgid, helperPid),
    onQuiesced: () => write(CHILD_STATES.QUIESCENCE_PROVEN, null, null),
    // M34 WP-B #1: MANUAL_AUDIT_REQUIRED keeps last-known ownership in
    // DEDICATED fields (lastKnownPgid/lastKnownHelperPid) plus the reason --
    // never disguised as a QUIESCENCE/EMPTY state, so a formal audit
    // acknowledgement can act on it. The write is atomic (temp+fsync+rename)
    // and self-validated.
    onAudit: (why, lastKnownPgid = null, lastKnownHelperPid = null) => {
      const sidecar = {
        schemaVersion: CHILD_STATE_SCHEMA_VERSION,
        nonce: lockNonce,
        repoRealpath,
        state: CHILD_STATES.MANUAL_AUDIT_REQUIRED,
        pgid: null,
        helperPid: null,
        lastKnownPgid: lastKnownPgid ?? null,
        lastKnownHelperPid: lastKnownHelperPid ?? null,
        auditReason: why,
        updatedAt: new Date().toISOString(),
      }
      const selfCheck = validateChildState(sidecar, lockNonce, repoRealpath)
      if (!selfCheck.ok) {
        // The audit state must always be persistable when a real fail-closed
        // path runs; a failure here means the world is inconsistent -- surface
        // it loudly (the preserved registry entry and held lock remain the
        // primary fail-closed guarantees).
        throw new Error(
          `refusing to write impossible MANUAL_AUDIT_REQUIRED state: ${selfCheck.reason}`,
        )
      }
      const tmpPath = path.join(repoRoot, `.${childStateFileName(lockNonce)}.tmp`)
      const payload = Buffer.from(JSON.stringify(sidecar, null, 2) + '\n', 'utf8')
      let fd
      try {
        fd = (deps.openSync || fs.openSync)(tmpPath, 'wx', 0o600)
      } catch (e) {
        throw new Error(
          `child-state audit temp open failed (${e instanceof Error ? e.message : String(e)})`,
        )
      }
      try {
        writeAllSync(fd, payload, { writeSync: deps.writeSync || fs.writeSync })
        ;(deps.fsyncSync || fs.fsyncSync)(fd)
        ;(deps.closeSync || fs.closeSync)(fd)
      } catch (e) {
        try {
          ;(deps.closeSync || fs.closeSync)(fd)
        } catch {
          // original error wins
        }
        try {
          ;(deps.unlinkSync || fs.unlinkSync)(tmpPath)
        } catch {
          // best effort
        }
        throw new Error(
          `child-state audit write failed (${e instanceof Error ? e.message : String(e)})`,
        )
      }
      try {
        ;(deps.renameSync || fs.renameSync)(tmpPath, childStatePath)
        fsyncParentDirectorySync(repoRoot, deps)
      } catch (e) {
        try {
          ;(deps.unlinkSync || fs.unlinkSync)(tmpPath)
        } catch {
          // best effort
        }
        throw new Error(
          `child-state audit rename/durability failed (${e instanceof Error ? e.message : String(e)})`,
        )
      }
    },
    finalize: () => {
      try {
        write(CHILD_STATES.QUIESCENCE_PROVEN, null, null)
        return true
      } catch {
        return false
      }
    },
    // M34 WP-A #6: cleanup targets the nonce-qualified sidecar ONLY -- a stale
    // recovery cleanup can never delete a newer acquisition's sidecar (which
    // has a different nonce in its basename).
    cleanup: () => {
      try {
        fs.unlinkSync(childStatePath)
      } catch {
        // best effort -- a stale sidecar is bound to its (already gone) lock
      }
    },
  }
}

/**
 * Parse and validate lock metadata. Unknown schema versions are rejected:
 * they must never be recovered automatically (WP-B #7). M33 WP-A: schema v1
 * (owner-PID only) is explicitly unsupported -- it cannot prove a detached
 * helper group is gone and requires manual audit.
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
  // M34 WP-A #4: the childStateFile must be the EXACT nonce-qualified basename
  // for this lock's nonce -- nothing else (prevents path traversal and any
  // attempt to bind the lock to a foreign sidecar).
  if (typeof parsed.nonce !== 'string' || !UUID_PATTERN.test(parsed.nonce)) {
    return { ok: false, reason: 'nonce missing or not a UUID' }
  }
  if (typeof parsed.repoRealpath !== 'string' || parsed.repoRealpath.length === 0) {
    return { ok: false, reason: 'repoRealpath missing' }
  }
  if (parsed.childStateFile !== childStateFileName(parsed.nonce)) {
    return {
      ok: false,
      reason: `unsupported childStateFile ${JSON.stringify(parsed.childStateFile)} (expected ${childStateFileName(parsed.nonce)}) -- manual audit required`,
    }
  }
  const csValidated = validateChildState(parsed.childState, parsed.nonce, parsed.repoRealpath)
  if (!csValidated.ok) {
    return { ok: false, reason: `childState rejected: ${csValidated.reason}` }
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
 *   childStateFile: string,
 *   childState: ChildState,
 * }} LockMetadata
 */

/**
 * @typedef {{
 *   openSync?: (path: fs.PathLike, flags: string | number, mode?: number | null) => number,
 *   writeSync?: (fd: number, buffer: ArrayBufferView, offset?: number | null, length?: number | null) => number,
 *   readSync?: (fd: number, buffer: ArrayBufferView, offset?: number | null, length?: number | null, position?: fs.ReadPosition | null) => number,
 *   closeSync?: typeof fs.closeSync,
 *   existsSync?: typeof fs.existsSync,
 *   readFileSync?: typeof fs.readFileSync,
 *   unlinkSync?: typeof fs.unlinkSync,
 *   realpathSync?: typeof fs.realpathSync,
 *   fstatSync?: typeof fs.fstatSync,
 *   lstatSync?: typeof fs.lstatSync,
 *   renameSync?: typeof fs.renameSync,
 *   fsyncSync?: typeof fs.fsyncSync,
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
 *   childState: ReturnType<typeof makeChildStateManager>,
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
    childStateFile: childStateFileName(nonce),
    childState: {
      schemaVersion: CHILD_STATE_SCHEMA_VERSION,
      nonce,
      repoRealpath,
      state: CHILD_STATES.EMPTY,
      pgid: null,
      helperPid: null,
      updatedAt: new Date().toISOString(),
    },
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

  // M33 WP-A #3/#8: persist the EMPTY child-state sidecar (durable) as part
  // of lock acquisition. If it cannot be persisted, the lock must NOT be
  // handed out -- child ownership could never be proven afterwards.
  try {
    writeChildStateSync(repoRoot, nonce, repoRealpath, CHILD_STATES.EMPTY, null, null, deps)
  } catch (e) {
    removeOwnedInode()
    throw new Error(
      `failed to persist initial child-state (${/** @type {Error} */ (e).message}) -- lock file removed; nothing was handed out`,
    )
  }

  let released = false

  return {
    nonce,
    lockPath,
    childState: makeChildStateManager(repoRoot, nonce, repoRealpath, deps),

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
 * M34 WP-A: attempt to recover a stale lock. Succeeds ONLY when every
 * contract holds: the lock provably belongs to this repo, has the exact
 * schema (v3, nonce-qualified sidecar), complete valid metadata, a dead owner
 * PID, and a child-state whose state/field INVARIANTS prove no live group
 * exists. Unknown schema, EPERM, impossible state combinations, live ACTIVE
 * groups or any replace race are manual-audit conditions -- NEVER recovered.
 *
 * M34 hardening over M33:
 * - the sidecar is read by nonce-qualified basename with lstat/no-follow/
 *   bounded-size/replace-race guards (P2-1a/1b: symlink was followed and a
 *   FIFO blocked recovery);
 * - EMPTY/QUIESCENCE_PROVEN recovery requires the invariant pgid/helperPid
 *   === null (enforced by validateChildState); a live group under a
 *   "no process" claim is impossible and refused (P1-A-1/P1-A-2);
 * - before deletion the lock metadata AND inode and the sidecar are
 *   re-verified against the values already audited -- a replaced lock or
 *   sidecar is never deleted (M34 WP-A #7);
 * - cleanup targets the nonce-qualified sidecar of THIS lock only -- an old
 *   recovery can never delete a newer acquisition's sidecar (P2-2);
 * - recovery NEVER sends a signal to a historical PGID -- probe only.
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
    // ESRCH -- process not running; child ownership must still be proven
  }

  // M34 WP-A: child-state gate -- read the NONCE-QUALIFIED sidecar with the
  // hardened read path (lstat/no-follow/size/replace-race). A missing,
  // invalid, oversized, symlinked or replaced sidecar is NEVER recovered.
  const childStateRes = readChildStateFile(repoRoot, metadata.nonce, deps)
  if (!childStateRes.ok) {
    return { recovered: false, reason: `lock recovery refused: ${childStateRes.reason}` }
  }
  const childState = childStateRes.childState
  if (childState.nonce !== metadata.nonce) {
    return {
      recovered: false,
      reason:
        'lock recovery refused: child-state nonce does not match lock nonce -- manual audit required',
    }
  }
  if (childState.repoRealpath !== currentRepoRealpath) {
    return {
      recovered: false,
      reason:
        'lock recovery refused: child-state repoRealpath does not match lock repoRealpath -- manual audit required',
    }
  }

  // M34 WP-A #8/#9: state branch. IMPOSSIBLE state/field combinations were
  // already rejected by validateChildState (EMPTY/QUIESCENCE_PROVEN with any
  // non-null PID field, ACTIVE with null/mismatched PIDs, MANUAL without
  // last-known fields, extra dangerous fields). What remains here is the
  // per-state decision; recovery never signals a historical PGID.
  switch (childState.state) {
    case CHILD_STATES.EMPTY:
    case CHILD_STATES.QUIESCENCE_PROVEN:
      // M34 WP-A #9: invariant fields are exactly null (validated above) --
      // no helper was ever spawned, or the group was already proven absent.
      // Recovery is safe once the owner PID is dead.
      break
    case CHILD_STATES.SPAWN_INTENT:
      // A helper may have been spawned but ACTIVE was never persisted (the
      // M33 crash window): we CANNOT prove no process exists.
      return {
        recovered: false,
        reason:
          'lock recovery refused: child-state is SPAWN_INTENT -- cannot prove no process was spawned -- manual audit required',
      }
    case CHILD_STATES.MANUAL_AUDIT_REQUIRED:
      // M34 WP-B #2: normal --recover-lock keeps refusing MANUAL state; only
      // the explicit audit acknowledgement path may act on it.
      return {
        recovered: false,
        reason:
          'lock recovery refused: child-state is MANUAL_AUDIT_REQUIRED -- use the explicit audit acknowledgement (see RELEASING.md)',
      }
    case CHILD_STATES.ACTIVE: {
      // Probe only (signal 0): never deliver a signal to a possibly-reused
      // PGID. ESRCH proves the group is gone; anything else is unprovable.
      // (validateChildState guaranteed pgid === helperPid positive; TS needs
      // the explicit narrowing.)
      const activePgid = /** @type {number} */ (childState.pgid)
      try {
        process.kill(-activePgid, 0)
        return {
          recovered: false,
          reason: `lock recovery refused: ACTIVE process group ${activePgid} still exists (or its state is unprovable) -- manual audit required`,
        }
      } catch (e) {
        const kerr = /** @type {{ code?: string }} */ (/** @type {unknown} */ (e))
        if (kerr.code !== 'ESRCH') {
          return {
            recovered: false,
            reason: `lock recovery refused: cannot prove ACTIVE group ${activePgid} gone (${kerr.code || 'unknown'}) -- manual audit required`,
          }
        }
        // ESRCH + all nonce/repo/schema/inode contracts hold -> explicit
        // recovery is allowed below.
      }
      break
    }
    default:
      return {
        recovered: false,
        reason: `lock recovery refused: unknown child-state ${childState.state} -- manual audit required`,
      }
  }

  // M34 WP-A #7: re-verify BEFORE deleting -- the lock must still be the
  // same regular file with the same metadata, and the sidecar must still be
  // the same regular file. A replaced lock or sidecar is never deleted.
  let recheck
  try {
    const st = lstatSync(lockPath)
    if (st.isSymbolicLink() || !st.isFile()) {
      return {
        recovered: false,
        reason: `lock recovery refused: ${LOCK_FILE} changed shape before deletion -- manual audit required`,
      }
    }
    recheck = validateLockMetadata(readFileSync(lockPath, 'utf8'))
    if (!recheck.ok) {
      return {
        recovered: false,
        reason: `lock recovery refused: ${LOCK_FILE} metadata changed before deletion (${recheck.reason})`,
      }
    }
    if (
      recheck.metadata.nonce !== metadata.nonce ||
      recheck.metadata.pid !== metadata.pid ||
      recheck.metadata.repoRealpath !== currentRepoRealpath
    ) {
      return {
        recovered: false,
        reason:
          'lock recovery refused: lock metadata changed before deletion -- manual audit required',
      }
    }
  } catch (e) {
    return {
      recovered: false,
      reason: `lock recovery refused: cannot re-verify lock before deletion (${/** @type {Error} */ (e).message})`,
    }
  }
  try {
    const sst = lstatSync(childStateRes.path)
    if (sst.isSymbolicLink() || !sst.isFile()) {
      return {
        recovered: false,
        reason: `lock recovery refused: sidecar ${path.basename(childStateRes.path)} changed shape before deletion -- manual audit required`,
      }
    }
  } catch {
    return {
      recovered: false,
      reason: 'lock recovery refused: sidecar disappeared before deletion -- manual audit required',
    }
  }

  try {
    unlinkSync(lockPath)
  } catch (e) {
    return {
      recovered: false,
      reason: `unlink failed (${/** @type {Error} */ (e).message}) -- manual audit required`,
    }
  }
  // M34 WP-A #6: cleanup targets THIS lock's nonce-qualified sidecar only --
  // an old recovery can never delete a newer acquisition's sidecar.
  try {
    unlinkSync(childStateRes.path)
  } catch {
    // best effort -- the lock is gone; a stale sidecar is bound to its
    // (removed) lock nonce and harmless
  }
  return { recovered: true }
}

/**
 * M34 WP-B #3/#4/#6: explicit audit acknowledgement for a MANUAL_AUDIT_REQUIRED
 * lock. This is the ONLY formal recovery path for MANUAL state -- maintainers
 * no longer hand-edit the sidecar JSON.
 *
 * The operator must supply the exact lock nonce and the exact last-known PGID
 * recorded in the MANUAL state. The function:
 * - re-reads and re-validates the lock metadata (schema/nonce/inode/repo);
 * - requires state === MANUAL_AUDIT_REQUIRED;
 * - requires the supplied nonce to match the lock nonce EXACTLY;
 * - requires the supplied PGID to match lastKnownPgid EXACTLY;
 * - requires owner PID ESRCH (alive/EPERM refuses);
 * - requires the last-known group to be ESRCH (probe only -- never signals);
 * - refuses on ANY mismatch with ZERO deletions;
 * - on success deletes the lock and its nonce-qualified sidecar (state
 *   acknowledgement only -- it never kills processes).
 *
 * @param {string} repoRoot
 * @param {{ nonce: string, lastKnownPgid: number }} request
 * @param {{
 *   existsSync?: typeof fs.existsSync,
 *   readFileSync?: typeof fs.readFileSync,
 *   unlinkSync?: typeof fs.unlinkSync,
 *   realpathSync?: typeof fs.realpathSync,
 *   lstatSync?: typeof fs.lstatSync,
 * }} [deps]
 * @returns {{ acknowledged: boolean, reason?: string }}
 */
export function auditLockAcknowledgement(repoRoot, request, deps = {}) {
  const readFileSync = deps.readFileSync || fs.readFileSync
  const unlinkSync = deps.unlinkSync || fs.unlinkSync
  const realpathSync = deps.realpathSync || fs.realpathSync
  const lstatSync = deps.lstatSync || fs.lstatSync
  const existsSync = deps.existsSync || fs.existsSync
  const lockPath = path.join(repoRoot, LOCK_FILE)

  if (typeof request !== 'object' || request === null) {
    return {
      acknowledged: false,
      reason: 'audit acknowledgement requires { nonce, lastKnownPgid }',
    }
  }
  const { nonce, lastKnownPgid } = request
  if (typeof nonce !== 'string' || !UUID_PATTERN.test(nonce)) {
    return {
      acknowledged: false,
      reason: 'audit acknowledgement requires the exact lock nonce (UUID)',
    }
  }
  if (!Number.isInteger(lastKnownPgid) || lastKnownPgid <= 0) {
    return {
      acknowledged: false,
      reason: 'audit acknowledgement requires the exact last-known PGID (positive integer)',
    }
  }
  if (!existsSync(lockPath)) {
    return { acknowledged: false, reason: 'no lock file found' }
  }

  // Shape + inode capture of the lock under audit.
  let lockStat
  try {
    lockStat = lstatSync(lockPath)
    if (lockStat.isSymbolicLink() || !lockStat.isFile()) {
      return {
        acknowledged: false,
        reason: `lock file ${LOCK_FILE} is not a regular file -- refusing`,
      }
    }
  } catch {
    return { acknowledged: false, reason: `cannot stat ${lockPath}` }
  }

  let raw
  try {
    raw = readFileSync(lockPath, 'utf8')
  } catch (e) {
    return {
      acknowledged: false,
      reason: `lock file ${LOCK_FILE} unreadable (${/** @type {Error} */ (e).message}) -- refusing`,
    }
  }
  const validated = validateLockMetadata(raw)
  if (!validated.ok) {
    return { acknowledged: false, reason: `lock file ${LOCK_FILE} rejected: ${validated.reason}` }
  }
  const metadata = validated.metadata

  const currentRepoRealpath = realpathSync(repoRoot)
  if (metadata.repoRealpath !== currentRepoRealpath) {
    return {
      acknowledged: false,
      reason: `lock belongs to a different repo: ${metadata.repoRealpath}`,
    }
  }

  // Exact nonce.
  if (metadata.nonce !== nonce) {
    return {
      acknowledged: false,
      reason: `audit acknowledgement refused: nonce does not match the lock (lock nonce ${metadata.nonce}) -- zero deletions`,
    }
  }

  // Must be MANUAL state -- acknowledging a non-MANUAL state is refused.
  const childStateRes = readChildStateFile(repoRoot, metadata.nonce, deps)
  if (!childStateRes.ok) {
    return { acknowledged: false, reason: `audit acknowledgement refused: ${childStateRes.reason}` }
  }
  const childState = childStateRes.childState
  if (childState.state !== CHILD_STATES.MANUAL_AUDIT_REQUIRED) {
    return {
      acknowledged: false,
      reason: `audit acknowledgement refused: child-state is ${childState.state}, not MANUAL_AUDIT_REQUIRED -- zero deletions`,
    }
  }

  // Exact last-known PGID.
  if (childState.lastKnownPgid !== lastKnownPgid) {
    return {
      acknowledged: false,
      reason: `audit acknowledgement refused: lastKnownPgid ${childState.lastKnownPgid} does not match requested ${lastKnownPgid} -- zero deletions`,
    }
  }

  // Owner must be ESRCH (alive / EPERM refuses).
  try {
    process.kill(metadata.pid, 0)
    return {
      acknowledged: false,
      reason: `audit acknowledgement refused: PID ${metadata.pid} is still running`,
    }
  } catch (e) {
    const kerr = /** @type {{ code?: string }} */ (/** @type {unknown} */ (e))
    if (kerr.code === 'EPERM') {
      return {
        acknowledged: false,
        reason: `audit acknowledgement refused: PID ${metadata.pid} status unknown (EPERM)`,
      }
    }
    if (kerr.code !== 'ESRCH') {
      return {
        acknowledged: false,
        reason: `audit acknowledgement refused: cannot determine PID ${metadata.pid} status`,
      }
    }
  }

  // Last-known group must be ESRCH -- probe only, never a signal.
  try {
    process.kill(-lastKnownPgid, 0)
    return {
      acknowledged: false,
      reason: `audit acknowledgement refused: last-known process group ${lastKnownPgid} still exists (or its state is unprovable) -- zero deletions; clean it up externally and retry`,
    }
  } catch (e) {
    const kerr = /** @type {{ code?: string }} */ (/** @type {unknown} */ (e))
    if (kerr.code !== 'ESRCH') {
      return {
        acknowledged: false,
        reason: `audit acknowledgement refused: cannot prove last-known group ${lastKnownPgid} gone (${kerr.code || 'unknown'}) -- zero deletions`,
      }
    }
  }

  // Final re-verification before deletion (same inode + same metadata).
  try {
    const st = lstatSync(lockPath)
    if (st.isSymbolicLink() || !st.isFile() || st.dev !== lockStat.dev || st.ino !== lockStat.ino) {
      return {
        acknowledged: false,
        reason:
          'audit acknowledgement refused: lock file was replaced during acknowledgement -- zero deletions',
      }
    }
    const recheck = validateLockMetadata(readFileSync(lockPath, 'utf8'))
    if (
      !recheck.ok ||
      recheck.metadata.nonce !== metadata.nonce ||
      recheck.metadata.pid !== metadata.pid
    ) {
      return {
        acknowledged: false,
        reason:
          'audit acknowledgement refused: lock metadata changed during acknowledgement -- zero deletions',
      }
    }
  } catch {
    return {
      acknowledged: false,
      reason:
        'audit acknowledgement refused: cannot re-verify lock before deletion -- zero deletions',
    }
  }
  try {
    const sst = lstatSync(childStateRes.path)
    if (sst.isSymbolicLink() || !sst.isFile()) {
      return {
        acknowledged: false,
        reason:
          'audit acknowledgement refused: sidecar changed shape during acknowledgement -- zero deletions',
      }
    }
  } catch {
    return {
      acknowledged: false,
      reason:
        'audit acknowledgement refused: sidecar disappeared during acknowledgement -- zero deletions',
    }
  }

  // Acknowledgement ONLY: delete the lock + its nonce-qualified sidecar.
  try {
    unlinkSync(lockPath)
  } catch (e) {
    return {
      acknowledged: false,
      reason: `audit acknowledgement failed: unlink ${LOCK_FILE} failed (${/** @type {Error} */ (e).message}) -- zero further deletions`,
    }
  }
  try {
    unlinkSync(childStateRes.path)
  } catch {
    // best effort -- the lock is gone
  }
  return { acknowledged: true }
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
 * INIT -> STAGING_GENERATED -> STAGING_VERIFIED -> OLD_OUTPUT_BACKUP_INTENT
 *      -> OLD_OUTPUT_BACKED_UP -> NEW_OUTPUT_PROMOTED -> NEW_OUTPUT_VERIFIED
 *      -> COMMITTED -> BACKUP_CLEANED
 *
 * M29 WP-D crash consistency: every state persisted to disk after its fsync
 * must be accepted by validateJournal and correspond to the on-disk topology
 * it describes. OLD_OUTPUT_BACKUP_INTENT is written BEFORE the output->backup
 * rename (with oldSha256 already computed from the untouched output), so a
 * crash between the intent write and the rename leaves a journal that still
 * describes the untouched output.
 */
const STATE_ORDER = [
  'INIT',
  'STAGING_GENERATED',
  'STAGING_VERIFIED',
  'OLD_OUTPUT_BACKUP_INTENT',
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

  // M29 WP-D state-dependent hash requirement: only the earliest states may
  // carry empty (not-yet-computed) new hashes. Every state persisted after
  // the hashes are filled must carry complete lowercase 64-hex hashes so a
  // crash leaves a journal that can actually drive recovery.
  const emptySha = (/** @type {any} */ v) =>
    v !== null && typeof v === 'object' && v.zip === '' && v.sums === ''
  const preHashStates = new Set(['INIT', 'STAGING_GENERATED'])
  if (preHashStates.has(parsed.state)) {
    if (!validSha(parsed.newSha256) && !emptySha(parsed.newSha256)) {
      return {
        ok: false,
        reason:
          'journal newSha256 invalid for state ' +
          parsed.state +
          ' (must be lowercase 64-hex zip+sums, or empty only in INIT/STAGING_GENERATED)',
      }
    }
  } else if (!validSha(parsed.newSha256)) {
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

  // Field-combination consistency (M28 WP-B / M29 WP-D): a journal must not
  // claim a backup without hashes, nor carry pre-backup state with backup
  // fields. States at or after OLD_OUTPUT_BACKUP_INTENT may carry a backup
  // path; pre-backup states must not.
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

  // Post-rename durability (M29 WP-C): fsync the parent directory. Real I/O
  // failures (EIO/ENOSPC/EROFS/EBADF/unknown/close) throw DurabilityError and
  // fail the transaction closed; only proven "directory fsync unsupported"
  // codes (EINVAL/ENOTSUP/EOPNOTSUPP) degrade to a documented note.
  fsyncParentDirectorySync(path.dirname(journalPath), deps)
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
  deps = {},
) {
  const journalPath = path.join(repoRoot, JOURNAL_FILE)
  if (existsSync(journalPath)) {
    unlinkSync(journalPath)
  }
  // M29 WP-C: make the journal deletion itself durable (6th mutation
  // boundary). Real fsync failures throw DurabilityError and fail closed.
  fsyncParentDirectorySync(repoRoot, deps)
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
 *   execFile?: (cmd: string, args: string[], opts?: any) => Promise<void>,
 *   childState?: ReturnType<typeof makeChildStateManager>,
 *   python3?: string,
 *   skipPythonVerifier?: boolean,
 * }} [opts]
 * @returns {Promise<void>}
 */
export async function validateBackupDir(backupDir, plan, version, opts = {}) {
  const readdirSync = opts.readdirSync || fs.readdirSync
  const readFileSync = opts.readFileSync || fs.readFileSync
  const hashFn = opts.createHash || createHash
  const python3 = opts.python3 || PYTHON3
  // M33 WP-A: childState is threaded into every execFile call.
  /**
   * @param {string} cmd
   * @param {string[]} args
   * @param {ExecFileOpts} [opts2]
   */
  const execFile = (cmd, args, opts2 = {}) =>
    (opts.execFile || execFileAsync)(cmd, args, { ...opts2, childState: opts.childState })

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
      await execFile(python3, [verifyScript, zipPath], { stdio: 'pipe', timeout: 30_000 })
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
 *   execFile?: (cmd: string, args: string[], opts?: any) => Promise<void>,
 *   lstatSync?: typeof fs.lstatSync,
 *   unlinkSync?: typeof fs.unlinkSync,
 *   openSync?: typeof fs.openSync,
 *   fsyncSync?: typeof fs.fsyncSync,
 *   closeSync?: typeof fs.closeSync,
 *   python3?: string,
 *   skipPythonVerifier?: boolean,
 *   shouldStop?: () => string | null,
 *   childState?: ReturnType<typeof makeChildStateManager>,
 * }} [deps]
 * @returns {Promise<{ recovered: boolean, action?: string, reason?: string }>}
 */
export async function recoverTransaction(repoRoot, outputDir, zipName, sumsName, deps = {}) {
  const existsSync = deps.existsSync || fs.existsSync
  const readdirSync = deps.readdirSync || fs.readdirSync
  const renameSync = deps.renameSync || fs.renameSync
  const rmSync = deps.rmSync || fs.rmSync
  const readFileSync = deps.readFileSync || fs.readFileSync
  const shouldStop = deps.shouldStop
  const stopAtBoundary = async () => {
    await checkStop(shouldStop)
  }

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
  // M29 WP-D: OLD_OUTPUT_BACKUP_INTENT is persisted BEFORE the output->backup
  // rename, so at that state the disk legitimately has NO backup (and the
  // untouched old output must still exist).
  const actualBackup = backups.length === 1 ? backups[0] : null
  if (journal.backupPath !== null) {
    if (journal.state === 'OLD_OUTPUT_BACKUP_INTENT') {
      if (actualBackup !== null) {
        return {
          recovered: false,
          reason: `journal OLD_OUTPUT_BACKUP_INTENT references backup "${journal.backupPath}" but disk already has "${actualBackup}" -- manual audit required`,
        }
      }
    } else if (actualBackup !== journal.backupPath) {
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
  const verifyOutput = async (
    /** @type {{ zip: string, sums: string } | undefined} */ expectSha,
  ) => {
    await verifyOutputAgainstSha(outputDir, plan, deps, expectSha)
  }

  /** Remove transaction staging residue (safe: it never contains output). */
  const removeStaging = () => {
    const staging = path.join(repoRoot, STAGING_DIR)
    if (existsSync(staging)) {
      rmSync(staging, { recursive: true, force: true })
    }
  }

  // M29 WP-D: pre-backup states mean the transaction never touched the
  // published output (no backup rename happened). Recovery is: remove the
  // staging residue and the journal, keep the untouched output -- idempotent.
  const preBackupStates = new Set(['INIT', 'STAGING_GENERATED', 'STAGING_VERIFIED'])
  if (preBackupStates.has(journal.state)) {
    try {
      removeStaging()
    } catch (e) {
      return {
        recovered: false,
        reason: `journal ${journal.state} but staging residue could not be removed (${/** @type {Error} */ (e).message}) -- manual audit required`,
      }
    }
    try {
      deleteJournal(repoRoot, deps.unlinkSync, existsSync, deps)
    } catch (e) {
      return {
        recovered: false,
        reason: `journal ${journal.state} but journal could not be removed (${/** @type {Error} */ (e).message})`,
      }
    }
    return { recovered: true, action: 'pre-backup-abort' }
  }

  // M29 WP-D: OLD_OUTPUT_BACKUP_INTENT -- the output->backup rename never
  // happened, so the (old) output is still the authoritative copy. Remove
  // staging + journal; the output stays untouched.
  if (journal.state === 'OLD_OUTPUT_BACKUP_INTENT') {
    if (!outputExists) {
      return {
        recovered: false,
        reason: `journal OLD_OUTPUT_BACKUP_INTENT but ${OUTPUT_DIR} is missing -- manual audit required`,
      }
    }
    try {
      removeStaging()
    } catch (e) {
      return {
        recovered: false,
        reason: `journal OLD_OUTPUT_BACKUP_INTENT but staging residue could not be removed (${/** @type {Error} */ (e).message}) -- manual audit required`,
      }
    }
    try {
      deleteJournal(repoRoot, deps.unlinkSync, existsSync, deps)
    } catch (e) {
      return {
        recovered: false,
        reason: `journal OLD_OUTPUT_BACKUP_INTENT but journal could not be removed (${/** @type {Error} */ (e).message})`,
      }
    }
    return { recovered: true, action: 'backup-intent-abort' }
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
      await verifyOutput(journal.newSha256)
    } catch (e) {
      return {
        recovered: false,
        reason: `journal says ${journal.state} but output failed full verification (${/** @type {Error} */ (e).message}) -- output, backup and journal preserved; manual audit required`,
      }
    }
    if (backupDir) {
      try {
        rmSync(backupDir, { recursive: true, force: true })
        // M29 WP-C: residual backup deletion must be durable.
        fsyncParentDirectorySync(repoRoot, deps)
      } catch (e) {
        return {
          recovered: false,
          reason: `output verified but residual backup could not be removed (${/** @type {Error} */ (e).message}) -- manual audit required`,
        }
      }
    }
    try {
      deleteJournal(repoRoot, deps.unlinkSync, existsSync, deps)
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

  // PRE_COMMIT states with a backup (OLD_OUTPUT_BACKED_UP / NEW_OUTPUT_*).
  if (backupDir) {
    // Validate the backup deeply BEFORE deleting or moving anything (M28 WP-A #4).
    try {
      await validateBackupDir(backupDir, plan, pkg.version, {
        readdirSync,
        lstatSync: deps.lstatSync,
        readFileSync,
        createHash: deps.createHash,
        execFile: deps.execFile,
        childState: deps.childState,
        python3: deps.python3,
        skipPythonVerifier: deps.skipPythonVerifier,
      })
    } catch (e) {
      return {
        recovered: false,
        reason: `PRE_COMMIT recovery refused: ${/** @type {Error} */ (e).message} -- backup, output and journal preserved`,
      }
    }
    // M29 WP-D: prove the backup matches journal.oldSha256 BEFORE any rm or
    // rename. A mismatch must leave every path untouched (zero mutation).
    if (journal.oldSha256 !== null) {
      const zipHash = sha256File(path.join(backupDir, plan.zipName), deps.createHash)
      const sumsHash = sha256File(path.join(backupDir, plan.sumsName), deps.createHash)
      if (zipHash !== journal.oldSha256.zip || sumsHash !== journal.oldSha256.sums) {
        return {
          recovered: false,
          reason: `PRE_COMMIT recovery refused: backup hashes do not match journal.oldSha256 (zip ${zipHash} vs ${journal.oldSha256.zip}; sums ${sumsHash} vs ${journal.oldSha256.sums}) -- NO files were modified; backup, output and journal preserved`,
        }
      }
    }
    // M29 WP-B: no new recovery stage after a signal was observed.
    await stopAtBoundary()
    if (outputExists) {
      try {
        rmSync(outputDir, { recursive: true, force: true })
        // M29 WP-C: deletion of the unverified output must be durable.
        fsyncParentDirectorySync(repoRoot, deps)
      } catch (e) {
        return {
          recovered: false,
          reason: `PRE_COMMIT recovery could not remove unverified output (${/** @type {Error} */ (e).message}) -- manual audit required`,
        }
      }
    }
    try {
      renameSync(backupDir, outputDir)
      // M29 WP-C: the restore rename must be durable.
      fsyncParentDirectorySync(repoRoot, deps)
      // M29 WP-B: no new recovery stage after a signal was observed.
      await stopAtBoundary()
    } catch (e) {
      return {
        recovered: false,
        reason: `PRE_COMMIT recovery restore failed (${/** @type {Error} */ (e).message}) -- backup and journal preserved; manual audit required`,
      }
    }
    // Re-verify the restored old output AND bind it to journal.oldSha256.
    try {
      await verifyOutput(journal.oldSha256 ?? undefined)
    } catch (e) {
      return {
        recovered: false,
        reason: `restored output failed full verification (${/** @type {Error} */ (e).message}) -- manual audit required`,
      }
    }
    try {
      deleteJournal(repoRoot, deps.unlinkSync, existsSync, deps)
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
    await verifyOutput(journal.newSha256)
  } catch (e) {
    return {
      recovered: false,
      reason: `journal ${journal.state} (first publish, no backup) but output failed verification (${/** @type {Error} */ (e).message}) -- output and journal preserved; manual audit required`,
    }
  }
  try {
    deleteJournal(repoRoot, deps.unlinkSync, existsSync, deps)
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
 * @returns {Promise<void>}
 */
async function verifyOutputAgainstSha(outputDir, plan, deps, expectSha) {
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
    /**
     * @param {string} cmd
     * @param {string[]} args
     * @param {ExecFileOpts} [opts2]
     */
    const execFile = (cmd, args, opts2 = {}) =>
      (deps.execFile || execFileAsync)(cmd, args, { ...opts2, childState: deps.childState })
    const python3 = deps.python3 || PYTHON3
    await execFile(python3, [verifyScript, path.join(outputDir, plan.zipName)], {
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
  'backup.intent.before',
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
 *   execFile?: (cmd: string, args: string[], opts?: any) => Promise<void>,
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
 *   openSync?: typeof fs.openSync,
 *   fsyncSync?: typeof fs.fsyncSync,
 *   closeSync?: typeof fs.closeSync,
 *   failpoint?: (name: string) => void,
 *   shouldStop?: () => string | null,
 *   childState?: ReturnType<typeof makeChildStateManager>,
 *   trace?: string[],
 * }} [deps]
 * @returns {Promise<{ trace: string[], plan: ReturnType<typeof buildReleasePlan>, zipSize: number, sumsName: string, committed: boolean }>}
 */
export async function generateAssets(distDir, outputDir, force, python3 = PYTHON3, deps = {}) {
  const mkdirSync = deps.mkdirSync || fs.mkdirSync
  const mkdtempSync = deps.mkdtempSync || fs.mkdtempSync
  const renameSync = deps.renameSync || fs.renameSync
  const rmSync = deps.rmSync || fs.rmSync
  const existsSync = deps.existsSync || fs.existsSync
  const statSync = deps.statSync || fs.statSync
  const readFileSync = deps.readFileSync || fs.readFileSync
  const trace = deps.trace || []
  // M33 WP-A: childState is threaded into every execFile call.
  /**
   * @param {string} cmd
   * @param {string[]} args
   * @param {ExecFileOpts} [opts2]
   */
  const execFile = (cmd, args, opts2 = {}) =>
    (deps.execFile || execFileAsync)(cmd, args, { ...opts2, childState: deps.childState })
  const shouldStop = deps.shouldStop
  /** M30 WP-C: committed zip size, returned (not printed) to runCli. */
  let zipSize = 0

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

  // M29 WP-B: every journal write is a transaction stage boundary. After the
  // atomic journal write completes we check whether a fatal signal was
  // observed; if so we stop BEFORE entering the next stage (SignalStoppedError).
  const advance = async (/** @type {string} */ state) => {
    journal.state = state
    journal.backupPath = backupRel
    journal.updatedAt = new Date().toISOString()
    writeJournal(repoRoot, journal, deps)
    await checkStop(shouldStop)
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
    // ---- Phase 0: open the transaction (INIT journal) ------------------
    // M29 WP-B/WP-D: persist the INIT journal BEFORE any long-running child
    // process, so a signal (or crash) at any later point always leaves an
    // on-disk journal that --recover can resolve (never a bare staging
    // residue with no journal and no committed output).
    await advance('INIT')

    // ---- Phase 1: Generate into staging -------------------------------
    console.log(`Creating ${plan.zipName} ...`)
    await createDeterministicZip(distDir, files, stagingZip, python3, deps)
    await checkStop(shouldStop)
    console.log(`Creating ${plan.sumsName} ...`)
    generateChecksums(stagingZip, stagingSums, deps)
    // M29 WP-D: persist STAGING_GENERATED (empty hashes are valid in this
    // state) so a crash between generation and hash computation leaves a
    // journal the validator accepts and --recover can resolve.
    await advance('STAGING_GENERATED')

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
    await execFile(python3, [verifyScript, stagingZip], {
      stdio: 'inherit',
      timeout: 30_000,
    })
    await checkStop(shouldStop)

    // Verify staging contains exactly the two expected regular assets
    verifyAssetPair(stagingDir, plan.zipName, plan.sumsName, {
      existsSync,
      readdirSync: fs.readdirSync,
    })

    // M29 WP-D: fill the new hashes BEFORE persisting STAGING_VERIFIED so the
    // on-disk journal never carries the state without its required hashes.
    journal.newSha256 = {
      zip: sha256File(stagingZip, deps.createHash),
      sums: sha256File(stagingSums, deps.createHash),
    }
    await advance('STAGING_VERIFIED')

    // ---- Phase 3: Publish ---------------------------------------------
    if (outputExists && force) {
      // Transactional: intent -> backup -> promotion -> re-verify ->
      // COMMITTED -> cleanup
      const backupNonce = nonce.split('-')[1] ?? randomUUID().split('-')[0]
      backupRel = `${BACKUP_PREFIX}${backupNonce}`
      backupDir = path.join(repoRoot, backupRel)

      // M29 WP-D: compute oldSha256 from the STILL-UNTOUCHED output and
      // persist OLD_OUTPUT_BACKUP_INTENT BEFORE the destructive rename. A
      // crash between this write and the rename leaves output untouched and
      // a journal that is fully valid and self-describing.
      fp('backup.intent.before')
      journal.oldSha256 = {
        zip: sha256File(path.join(outputDir, plan.zipName), deps.createHash),
        sums: sha256File(path.join(outputDir, plan.sumsName), deps.createHash),
      }
      await advance('OLD_OUTPUT_BACKUP_INTENT')

      fp('backup.rename.before')
      renameSync(outputDir, backupDir)
      // M29 WP-C: output->backup rename must be durable before we proceed.
      fsyncParentDirectorySync(repoRoot, deps)
      await advance('OLD_OUTPUT_BACKED_UP')
      fp('backup.rename.after')

      try {
        fp('promotion.before')
        renameSync(stagingDir, outputDir)
        // M29 WP-C: staging->output promotion must be durable.
        fsyncParentDirectorySync(repoRoot, deps)
        promoted = true
        fp('promotion.after')
        await advance('NEW_OUTPUT_PROMOTED')

        fp('publish.checksum')
        console.log('Verifying published checksum ...')
        verifyChecksums(sumsPath, outputDir, deps)

        fp('publish.zipverifier')
        console.log('Verifying published zip ...')
        await execFile(python3, [verifyScript, zipPath], {
          stdio: 'inherit',
          timeout: 30_000,
        })
        await checkStop(shouldStop)
        await advance('NEW_OUTPUT_VERIFIED')

        // ---- COMMIT POINT (WP-C #1) ----------------------------------
        fp('commit.journal')
        await advance('COMMITTED')
        committed = true
      } catch (e) {
        // M29 WP-C/WP-B: durability uncertainty or an observed signal must
        // never trigger rollback -- keep the on-disk state and journal for
        // explicit --recover (no new stage may be entered). M33 WP-C: when a
        // signal was observed, the controlled termination may surface as an
        // ordinary execFile rejection (helper SIGTERMed) -- that is still a
        // signal-driven stop and must preserve the journal, never roll back.
        if (
          e instanceof DurabilityError ||
          e instanceof SignalStoppedError ||
          (shouldStop && shouldStop())
        ) {
          throw e
        }
        // Pre-commit failure: rollback to the byte-identical old output.
        rollbackToOldOutput(e)
        throw e
      }

      // Post-commit: backup cleanup failure must NOT endanger the new output.
      fp('backup.remove.before')
      removeBackupEntries(backupDir, plan, fp, rmSync, existsSync)
      // M29 WP-C: backup deletion must be durable.
      fsyncParentDirectorySync(repoRoot, deps)
      backupDir = null
      backupRel = null
      await advance('BACKUP_CLEANED')

      fp('journal.delete')
      deleteJournal(repoRoot, deps.unlinkSync, existsSync, deps)
    } else {
      // First-time publish: staging -> output directly (no backup needed).
      fp('promotion.before')
      renameSync(stagingDir, outputDir)
      // M29 WP-C: staging->output promotion must be durable.
      fsyncParentDirectorySync(repoRoot, deps)
      promoted = true
      fp('promotion.after')
      await advance('NEW_OUTPUT_PROMOTED')

      fp('publish.checksum')
      console.log('Verifying published checksum ...')
      verifyChecksums(sumsPath, outputDir, deps)

      fp('publish.zipverifier')
      console.log('Verifying published zip ...')
      await execFile(python3, [verifyScript, zipPath], {
        stdio: 'inherit',
        timeout: 30_000,
      })
      await checkStop(shouldStop)
      await advance('NEW_OUTPUT_VERIFIED')

      fp('commit.journal')
      await advance('COMMITTED')
      committed = true

      // Nothing to clean up: no backup ever existed. Close out the journal.
      await advance('BACKUP_CLEANED')
      fp('journal.delete')
      deleteJournal(repoRoot, deps.unlinkSync, existsSync, deps)
    }

    // M30 WP-C: generateAssets NEVER prints the full success claim itself.
    // It only returns the committed outcome (plan, zip size, sums name,
    // committed flag); runCli prints "Done:" AFTER the final protocol
    // completed (registry empty, lock released, listeners removed, no
    // observed signal). The checkStop below keeps the pre-existing
    // stage-boundary contract (no new stage after a signal).
    await checkStop(shouldStop)
    zipSize = statSync(zipPath).size
  } catch (e) {
    // M29 WP-C/WP-B: durability cannot be proven, or a signal was observed --
    // keep the journal/backup/lock recovery information and NEVER roll back
    // or delete the journal while the on-disk state may not be durable or a
    // new stage must not be entered. Fail closed for --recover. M33 WP-C:
    // a signal-driven helper termination surfaces as an ordinary rejection;
    // while a signal is observed it must be treated as a signal stop.
    if (
      e instanceof DurabilityError ||
      e instanceof SignalStoppedError ||
      (shouldStop && shouldStop())
    ) {
      throw e
    }
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
        deleteJournal(repoRoot, deps.unlinkSync, existsSync, deps)
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

  // M30 WP-C: the return value carries the committed outcome; no stdout
  // success claim is printed here (runCli owns the final "Done:").
  return { trace, plan, zipSize, sumsName: plan.sumsName, committed }
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
 *   platform?: string,
 * }} [io]
 * @returns {Promise<number>} exit code
 */
export async function runCli(argv, io = {}) {
  const stdout = io.stdout || { write: (chunk) => process.stdout.write(chunk) }
  const stderr = io.stderr || { write: (chunk) => process.stderr.write(chunk) }
  const env = io.env || process.env
  const repoRoot = io.repoRoot || defaultRepoRoot
  const platform = io.platform || process.platform

  const args = argv.slice(2)
  let force = false
  let recoverFlag = false
  let recoverLockFlag = false
  // M34 WP-B #3: explicit audit acknowledgement -- the ONLY formal recovery
  // path for MANUAL_AUDIT_REQUIRED state (maintainers no longer hand-edit the
  // sidecar JSON). Usage: --audit-lock <nonce> <lastKnownPgid>
  /** @type {string[] | null} */
  let auditLockArgs = null

  for (const arg of args) {
    if (arg === '--force') {
      force = true
    } else if (arg === '--recover') {
      recoverFlag = true
    } else if (arg === '--recover-lock') {
      recoverLockFlag = true
    } else if (arg === '--audit-lock') {
      auditLockArgs = []
    } else if (auditLockArgs !== null) {
      // the two positional arguments following --audit-lock
      auditLockArgs.push(arg)
    } else {
      stderr.write(`unknown option: ${arg}\n`)
      stderr.write(
        'Usage: node scripts/prepare-release-assets.mjs [--force] [--recover] [--recover-lock] [--audit-lock <nonce> <lastKnownPgid>]\n',
      )
      return 2
    }
  }

  if (auditLockArgs !== null && auditLockArgs.length !== 2) {
    stderr.write('--audit-lock requires exactly two arguments: <nonce> <lastKnownPgid>\n')
    return 2
  }

  // M28 WP-F / M34 WP-B: --force, --recover, --recover-lock and --audit-lock
  // are mutually exclusive. Reject conflicts BEFORE any lock is created.
  const flagCount =
    (force ? 1 : 0) +
    (recoverFlag ? 1 : 0) +
    (recoverLockFlag ? 1 : 0) +
    (auditLockArgs !== null ? 1 : 0)
  if (flagCount > 1) {
    stderr.write('--force, --recover, --recover-lock and --audit-lock are mutually exclusive\n')
    stderr.write(
      'Usage: node scripts/prepare-release-assets.mjs [--force] [--recover] [--recover-lock] [--audit-lock <nonce> <lastKnownPgid>]\n',
    )
    return 2
  }

  const distDir = path.join(repoRoot, 'dist')
  const outputDir = path.join(repoRoot, OUTPUT_DIR)
  const python3 = env.PYTHON3 || PYTHON3

  // M31 WP-C: POSIX-only platform gate. Checked BEFORE --recover-lock and
  // before anything else that could create a lock, staging, journal, backup
  // or output -- on Windows the CLI must refuse with zero side effects.
  // Windows has no process groups, so only the direct child is killable and
  // descendants cannot be guaranteed to stop (probe P3/P4); the M30
  // "direct-child kill is fail-closed" claim is withdrawn.
  if (!isSupportedPlatform(platform)) {
    stderr.write(
      `release:prepare-assets: unsupported platform "${platform}" -- release asset generation is only supported on Linux/macOS (POSIX). Refusing to run before creating any lock, staging or output.\n`,
    )
    return 2
  }

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

  // M34 WP-B #3: --audit-lock runs OUTSIDE the lock domain (like
  // --recover-lock) and never sends signals -- it only acknowledges a
  // MANUAL_AUDIT_REQUIRED state after the operator externally confirmed the
  // last-known group is gone.
  if (auditLockArgs !== null) {
    const nonce = auditLockArgs[0]
    const lastKnownPgid = Number(auditLockArgs[1])
    const result = auditLockAcknowledgement(repoRoot, { nonce, lastKnownPgid })
    if (result.acknowledged) {
      stdout.write('Lock audit acknowledged; lock and its child-state sidecar removed.\n')
      return 0
    }
    stderr.write(`Lock audit acknowledgement failed: ${result.reason}\n`)
    return 1
  }

  // M30 WP-A: register the signal handlers BEFORE acquiring the lock so a
  // signal arriving during lock acquisition or the transaction is observed by
  // the protocol (never the default raw death). process.on (not process.once)
  // keeps BOTH listeners installed for the whole protocol: a repeated same or
  // cross signal only records "termination already in progress" and can never
  // fall through to default raw death. The listeners are removed ONLY after
  // lock.release completed (unified finally below).
  /** @type {'SIGINT' | 'SIGTERM' | null} */
  let terminating = null
  /** @type {ReturnType<typeof acquireLock> | null} */
  let lock = null
  const signalHandler = (/** @type {string} */ signal) => {
    const sig = /** @type {'SIGINT' | 'SIGTERM'} */ (signal)
    if (terminating === null) {
      terminating = sig
      handleFatalSignal(sig, lock, {
        stderr,
        exit: (code) => {
          process.exitCode = code
        },
      })
      // M34 WP-C: request every active child CONTROLLER to start its bounded
      // controlled termination NOW (SIGTERM -> escalation -> deadline ->
      // group-gone proof). runCli never reaches into a ChildProcess directly
      // -- the execFileAsync state machine owns escalation and the
      // group-gone proof; transaction stage boundaries still refuse to start
      // new stages. A signal-observed run never waits out a helper's own
      // long timeout (P1-B: the parent stayed alive >10s after one SIGTERM).
      for (const controller of activeChildren) {
        try {
          controller.requestTermination(`signal:${sig}`)
        } catch {
          // the controller's state machine owns the outcome; never crash here
        }
      }
    } else {
      // M30 WP-A #2/#3: later signals (same or different) never change the
      // first-signal exit code and never trigger default raw death.
      stderr.write(
        `release:${sig}: termination already in progress (first signal: ${terminating}); ignoring\n`,
      )
    }
  }
  process.on('SIGINT', signalHandler)
  process.on('SIGTERM', signalHandler)
  // Cooperative stop getter read at every transaction stage boundary.
  const shouldStop = () => terminating

  /** @type {'ok' | 'failed' | 'stopped'} */
  let outcome = 'failed'
  // M30 WP-C: generated outcome carried to the final success-claim site.
  /** @type {any} */
  let generatedPlan = null
  /** @type {number} */
  let generatedZipSize = 0
  /** @type {string | null} */
  let recoveredAction = null
  /** @type {boolean} */
  let lockLeaked = false
  try {
    // EVERYTHING below runs under the atomic mutex (WP-A #1).
    try {
      lock = acquireLock(repoRoot)
    } catch (e) {
      stderr.write(`release:prepare-assets: ${/** @type {Error} */ (e).message}\n`)
      return 1
    }

    /**
     * Run the locked work and classify the outcome.
     * @returns {Promise<'ok' | 'failed' | 'stopped'>}
     */
    const runLocked = async () => {
      try {
        if (recoverFlag) {
          const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
          const plan = buildReleasePlan(pkg.version)
          const result = await recoverTransaction(
            repoRoot,
            outputDir,
            plan.zipName,
            plan.sumsName,
            {
              shouldStop,
              childState: lock ? lock.childState : undefined,
            },
          )
          if (result.recovered) {
            recoveredAction = result.action ?? 'restore'
            return 'ok'
          }
          stderr.write(`Transaction recovery failed: ${result.reason}\n`)
          return 'failed'
        }
        const gen = await generateAssets(distDir, outputDir, force, python3, {
          shouldStop,
          childState: lock ? lock.childState : undefined,
        })
        generatedPlan = gen.plan
        generatedZipSize = gen.zipSize
        return 'ok'
      } catch (e) {
        if (e instanceof SignalStoppedError) {
          // M29 WP-B: the signal was observed at a stage boundary; no new
          // transaction stage was entered. Exit code comes from terminating.
          stderr.write(
            `release:${/** @type {SignalStoppedError} */ (e).signal}: stopped at the transaction stage boundary; lock stays held until all writes stop\n`,
          )
          return 'stopped'
        }
        stderr.write(`release:prepare-assets failed: ${/** @type {Error} */ (e).message}\n`)
        return 'failed'
      }
    }

    outcome = await runLocked()
  } finally {
    // M30 WP-A #4/#5/#6 + WP-C #2/#3: unified release runs ONLY after every
    // write/rename/execFile inside runLocked has stopped. The active-child
    // registry must be empty BEFORE the lock is released (WP-B #5); the
    // signal listeners are removed only AFTER lock.release completed.
    if (activeChildren.size > 0) {
      stderr.write(
        `release:prepare-assets: FATAL: ${activeChildren.size} child process(es) still active while releasing the lock -- refusing to release; state preserved for audit\n`,
      )
      lockLeaked = true
    } else if (lock && lock.childState && !lock.childState.finalize()) {
      // M33 WP-A #8: the child-state must prove QUIESCENCE (or EMPTY) before
      // the lock may be released. A persistence failure keeps the lock held.
      stderr.write(
        'release:prepare-assets: FATAL: child-state QUIESCENCE_PROVEN persistence failed -- refusing to release the lock; state preserved for audit\n',
      )
      lockLeaked = true
    } else if (lock) {
      try {
        const released = lock.release()
        if (!released.released && released.reason !== 'already-released') {
          stderr.write(`release:prepare-assets: lock release skipped (${released.reason})\n`)
          lockLeaked = true
        } else if (lock.childState) {
          // Best-effort sidecar cleanup after a successful release; a stale
          // sidecar is bound to the (now removed) lock nonce and harmless.
          lock.childState.cleanup()
        }
      } catch (e) {
        lockLeaked = true
        stderr.write(
          `release:prepare-assets: LOCK NOT RELEASED: ${/** @type {Error} */ (e).message} `,
        )
      }
    } else {
      // acquireLock failed earlier (already returned 1); nothing to release.
      lockLeaked = true
    }
    try {
      // M30 WP-A #5: listeners are removed only after lock.release completed
      // (or the release was refused); only then does the controlled signal
      // protocol end. Repeated signals before this point are always handled.
      process.removeListener('SIGINT', signalHandler)
      process.removeListener('SIGTERM', signalHandler)
    } catch {
      // best effort -- the process is about to exit with its final code
    }
    if (lockLeaked) {
      stderr.write('release:prepare-assets: lock not released -- exit 1\n')
      outcome = 'failed'
    }
  }

  // A termination request wins over any generation result; never claim a
  // full success after a signal (M28 WP-D / M29 WP-B / M30 WP-C).
  if (terminating !== null) {
    stderr.write(
      `release:${terminating}: run stopped; lock released in unified finally; final state preserved for audit\n`,
    )
    return terminating === 'SIGINT' ? 130 : 143
  }

  if (outcome === 'stopped') {
    // SignalStoppedError requires terminating != null; defensive fallback.
    stderr.write('release: run stopped at a stage boundary; final state preserved for audit\n')
    return 1
  }

  if (outcome === 'ok') {
    if (lockLeaked || activeChildren.size > 0) {
      stderr.write(
        `release:prepare-assets: ASSETS WERE GENERATED SUCCESSFULLY, but the lock was not released -- treating the run as FAILED (exit 1).\n`,
      )
      return 1
    }
    // M30 WP-C: the ONLY success claim, printed after runLocked completed,
    // the child registry is empty, the lock was released successfully, the
    // signal listeners were removed, and no signal was observed.
    if (recoveredAction !== null) {
      stdout.write(`Transaction recovered successfully (${recoveredAction}).\n`)
    } else if (generatedPlan !== null) {
      stdout.write(`\nDone: ${generatedPlan.zipName} (${generatedZipSize} bytes)\n`)
      stdout.write(`      ${generatedPlan.sumsName}\n`)
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
