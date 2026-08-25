// Deterministic, restartable release asset packaging.
//
// Generates pmbus-calculator-vX.Y.Z-web.zip and SHA256SUMS.txt from the
// final dist/ directory. Key properties:
// - Version is read from package.json (single source of truth).
// - The release plan comes exclusively from buildReleasePlan()
//   (scripts/release-artifact-contract.mjs) — no local naming templates.
// - Zip contents are sorted, timestamped at DOS epoch, no extra fields.
// - Same dist/ + same Python/zlib toolchain -- same zip bytes.
// - Fail-closed Dirent classification: no silent skip of symlinks/special files.
// - Every run uses a unique temp staging directory
//   (.release-staging/run-<uuid>/). Generation, checksum verification and the
//   ZIP verifier must ALL succeed before the result is moved into
//   release-output/. On failure the previous output is left untouched (or
//   absent) and the run can simply be re-executed — the staging directory is
//   disposable, never a persistent transaction state.
// - Concurrent generation is not a supported scenario: no lock, no journal,
//   no recovery protocol, no distributed mutex.
//
// Usage:
//   node scripts/prepare-release-assets.mjs          # normal run
//   node scripts/prepare-release-assets.mjs --force  # overwrite existing output
//   PYTHON3=/path/to/python3 node ...                # inject Python

import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import {
  OUTPUT_DIR,
  STAGING_DIR,
  buildReleasePlan,
  validateZipEntry,
} from './release-artifact-contract.mjs'

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Directory of this module -- static helper scripts ship with the module. */
const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const scriptRepoRoot = path.resolve(scriptDir, '..')

const PYTHON3 = process.env.PYTHON3 || 'python3'

/**
 * Default repository root (the checkout containing this script). runCli
 * accepts an injected repoRoot so fixtures can exercise the real CLI
 * against temporary repositories.
 */
export const defaultRepoRoot = scriptRepoRoot

/**
 * Promisified child-process runner for the Python helpers. stdout/stderr are
 * collected; any nonzero exit or spawn failure rejects with the captured
 * stderr. stdin is written explicitly (the `input` option of execFile is
 * avoided for worker-environment robustness). No process-group supervision,
 * no signal state machine — the helpers are ordinary build steps and a failed
 * run simply leaves disposable staging behind.
 *
 * @param {string} cmd
 * @param {string[]} args
 * @param {{ input?: string, timeout?: number }} [opts]
 * @returns {Promise<void>}
 */
export function runExecFile(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    let stderr = ''
    let settled = false
    const timer =
      opts.timeout !== undefined && opts.timeout > 0
        ? setTimeout(() => {
            child.kill('SIGKILL')
          }, opts.timeout)
        : null
    const finish = (/** @type {Error | null} */ err) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      if (err) reject(err)
      else resolve()
    }
    child.stderr.on('data', (d) => {
      stderr += String(d)
    })
    child.on('error', (e) => {
      finish(new Error(`${cmd} ${args.join(' ')} failed to start: ${e.message}`))
    })
    child.on('close', (code, signal) => {
      if (code !== 0) {
        const detail =
          stderr.trim() || (signal ? `killed by ${signal}` : `exit code ${String(code)}`)
        finish(new Error(`${cmd} ${args.join(' ')} failed: ${detail}`))
        return
      }
      finish()
    })
    if (opts.input !== undefined) {
      child.stdin.write(opts.input)
    }
    child.stdin.end()
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
export function validateAndCollectEntries(distDir, files) {
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
 * @param {{ execFile?: typeof runExecFile }} [deps]
 * @returns {Promise<void>}
 */
export async function createDeterministicZip(
  distDir,
  files,
  outputPath,
  python3 = PYTHON3,
  deps = {},
) {
  const execFile = deps.execFile || runExecFile
  const entries = validateAndCollectEntries(distDir, files)

  // Build manifest as JSON lines
  const manifestLines = entries.map((entry) =>
    JSON.stringify({ entry, path: path.join(distDir, entry.split('/').join(path.sep)) }),
  )
  const manifest = manifestLines.join('\n')

  const zipHelper = path.join(scriptRepoRoot, 'scripts', '_zip_helper.py')

  await execFile(python3, [zipHelper, distDir, outputPath], {
    input: manifest,
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
export function generateChecksums(filePath, sumsPath, deps) {
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
export function verifyChecksums(sumsPath, expectedDir, deps) {
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
export function verifyAssetPair(dir, zipName, sumsName, deps) {
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

// ---------------------------------------------------------------------------
// generateAssets -- build into a unique staging dir, verify, then publish
// ---------------------------------------------------------------------------

/**
 * Generate assets into a unique per-run staging directory, verify them
 * (checksums + the real ZIP verifier), and only then move the result into
 * release-output/. A failed run leaves the previous output untouched (or
 * absent) and the disposable staging directory behind; re-running the same
 * command is the recovery procedure.
 *
 * @param {string} distDir
 * @param {string} outputDir -- release-output/
 * @param {boolean} force
 * @param {string} [python3] -- injectable Python executable
 * @param {{
 *   execFile?: typeof runExecFile,
 *   mkdirSync?: typeof fs.mkdirSync,
 *   mkdtempSync?: typeof fs.mkdtempSync,
 *   renameSync?: typeof fs.renameSync,
 *   rmSync?: typeof fs.rmSync,
 *   existsSync?: typeof fs.existsSync,
 *   statSync?: typeof fs.statSync,
 *   readFileSync?: typeof fs.readFileSync,
 *   writeFileSync?: typeof fs.writeFileSync,
 *   createHash?: typeof createHash,
 *   lstatSync?: typeof fs.lstatSync,
 * }} [deps]
 * @returns {Promise<{ plan: ReturnType<typeof buildReleasePlan>, zipSize: number, sumsName: string }>}
 */
export async function generateAssets(distDir, outputDir, force, python3 = PYTHON3, deps = {}) {
  const mkdirSync = deps.mkdirSync || fs.mkdirSync
  const mkdtempSync = deps.mkdtempSync || fs.mkdtempSync
  const renameSync = deps.renameSync || fs.renameSync
  const rmSync = deps.rmSync || fs.rmSync
  const existsSync = deps.existsSync || fs.existsSync
  const statSync = deps.statSync || fs.statSync
  const readFileSync = deps.readFileSync || fs.readFileSync

  const repoRoot = path.resolve(outputDir, '..')

  // Read version from package.json and derive the ENTIRE plan from the
  // shared contract: no local naming templates here.
  const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
  const plan = buildReleasePlan(pkg.version)
  const zipPath = path.join(outputDir, plan.zipName)
  const sumsPath = path.join(outputDir, plan.sumsName)

  // Check if output already exists
  const outputExists = existsSync(zipPath) || existsSync(sumsPath)
  if (outputExists && !force) {
    throw new Error(`Assets already exist in ${outputDir}. Use --force to overwrite.`)
  }

  // If output exists, verify it's a valid asset pair before replacing it
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

  // Unique per-run staging directory inside the repo (same filesystem, so the
  // final rename is atomic). Disposable: never a transaction journal.
  const stagingRoot = path.join(repoRoot, STAGING_DIR)
  mkdirSync(stagingRoot, { recursive: true })
  const stagingDir = mkdtempSync(path.join(stagingRoot, `run-${randomUUID().split('-')[0]}-`))
  const stagingZip = path.join(stagingDir, plan.zipName)
  const stagingSums = path.join(stagingDir, plan.sumsName)

  let promoted = false
  try {
    console.log(`Creating ${plan.zipName} ...`)
    await createDeterministicZip(distDir, files, stagingZip, python3, deps)

    console.log(`Creating ${plan.sumsName} ...`)
    generateChecksums(stagingZip, stagingSums, deps)

    // Verify staging: checksum + asset pair + the real ZIP verifier. All
    // three must pass before anything touches release-output/.
    console.log('Verifying checksum ...')
    verifyChecksums(stagingSums, stagingDir, deps)
    verifyAssetPair(stagingDir, plan.zipName, plan.sumsName, {
      existsSync,
      readdirSync: fs.readdirSync,
    })

    console.log('Verifying zip with verify_release_zip.py ...')
    const verifyScript = path.join(
      scriptRepoRoot,
      '.github',
      'workflows',
      'scripts',
      'verify_release_zip.py',
    )
    const execFile = deps.execFile || runExecFile
    await execFile(python3, [verifyScript, stagingZip], { timeout: 30_000 })

    // Publish: replace the previous output only after every verification
    // passed. A failure above leaves the old output untouched.
    if (existsSync(outputDir)) {
      rmSync(outputDir, { recursive: true, force: true })
    }
    renameSync(stagingDir, outputDir)
    promoted = true

    const zipSize = statSync(zipPath).size
    return { plan, zipSize, sumsName: plan.sumsName }
  } finally {
    // Clean up disposable staging residue (never touches release-output/).
    if (!promoted && existsSync(stagingDir)) {
      try {
        rmSync(stagingDir, { recursive: true, force: true })
      } catch {
        // best effort -- disposable residue is harmless
      }
    }
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

  for (const arg of args) {
    if (arg === '--force') {
      force = true
    } else {
      stderr.write(`unknown option: ${arg}\n`)
      stderr.write('Usage: node scripts/prepare-release-assets.mjs [--force]\n')
      return 2
    }
  }

  const distDir = path.join(repoRoot, 'dist')
  const outputDir = path.join(repoRoot, OUTPUT_DIR)
  const python3 = env.PYTHON3 || PYTHON3

  try {
    const result = await generateAssets(distDir, outputDir, force, python3)
    stdout.write(`\nDone: ${result.plan.zipName} (${result.zipSize} bytes)\n`)
    stdout.write(`      ${result.sumsName}\n`)
    return 0
  } catch (e) {
    stderr.write(`release:prepare-assets failed: ${/** @type {Error} */ (e).message}\n`)
    stderr.write('Release output was left unchanged (or absent); re-run to retry.\n')
    return 1
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
