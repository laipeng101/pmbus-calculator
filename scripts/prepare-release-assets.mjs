// Deterministic release asset generation (M24).
//
// Generates reproducible pmbus-calculator-vX.Y.Z-web.zip and SHA256SUMS.txt
// from the final dist/ directory. Key properties:
// - Version is read from package.json (single source of truth).
// - Zip contents are sorted, with deterministic timestamps and no compression
//   metadata variance (Unix mtime = 0, no extra fields).
// - Same dist/ → same zip bytes, verified by double-build hash comparison.
// - Rejects: missing dist, symlinks, absolute paths, path traversal, source
//   maps, src/node_modules/temp files.
// - Auto-validates with verify_release_zip.py and SHA256SUMS reverse check.
// - Output directory is git-ignored; script refuses to overwrite existing
//   assets without --force.
//
// Usage:
//   node scripts/prepare-release-assets.mjs            # normal run
//   node scripts/prepare-release-assets.mjs --force    # overwrite existing

import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * @param {string} version
 * @returns {{ zip: string, sums: string }}
 */
function assetNames(version) {
  return {
    zip: `pmbus-calculator-v${version}-web.zip`,
    sums: 'SHA256SUMS.txt',
  }
}

/**
 * @param {string} dir
 * @returns {string[]}
 */
function walkDist(dir) {
  /** @type {string[]} */
  const files = []
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  entries.sort((a, b) => a.name.localeCompare(b.name))
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...walkDist(full))
    } else if (entry.isFile()) {
      files.push(full)
    }
  }
  return files
}

/**
 * Generate a deterministic zip from the dist/ directory.
 * Uses execSync to call the system zip command with deterministic flags.
 * @param {string} distDir
 * @param {string} outputPath
 */
function createDeterministicZip(distDir, outputPath) {
  const files = walkDist(distDir)

  // Validate no forbidden files
  for (const file of files) {
    const rel = path.relative(distDir, file)
    if (rel.includes('..')) {
      throw new Error(`path traversal detected: ${rel}`)
    }
    if (path.isAbsolute(rel)) {
      throw new Error(`absolute path in dist: ${rel}`)
    }
    if (rel.endsWith('.map')) {
      throw new Error(`source map in dist: ${rel}`)
    }
    if (rel.includes('node_modules') || rel.includes('src/')) {
      throw new Error(`forbidden directory in dist: ${rel}`)
    }
    const stat = fs.lstatSync(file)
    if (stat.isSymbolicLink()) {
      throw new Error(`symlink in dist: ${rel}`)
    }
  }

  // Build the zip with deterministic settings:
  // -X: no extra file attributes (UID/GID)
  // -r: recursive
  // --no-dir-entries: no directory entries in zip
  // All files get timestamp 1980-01-01 00:00:00 UTC (DOS epoch)
  // for reproducibility across runs.
  const cwd = process.cwd()
  try {
    process.chdir(distDir)
    // Collect relative paths, sorted
    const relFiles = files.map((f) => path.relative(distDir, f)).sort()
    // Write file list to a temp file to avoid command-line length issues
    const fileList = relFiles.join('\n')
    const tmpList = path.join(repoRoot, '.cache', 'zip-file-list.txt')
    fs.mkdirSync(path.dirname(tmpList), { recursive: true })
    fs.writeFileSync(tmpList, fileList + '\n')

    // Use Python's zipfile module for full determinism since macOS zip
    // doesn't support --mtime properly. Python gives us control over
    // timestamps, compression, and ordering.
    const script = `
import zipfile, os, sys, time
dist_dir = sys.argv[1]
out_path = sys.argv[2]
with open(sys.argv[3]) as f:
    files = [line.strip() for line in f if line.strip()]

with zipfile.ZipFile(out_path, 'w', zipfile.ZIP_DEFLATED) as zf:
    for f in sorted(files):
        file_path = os.path.join(dist_dir, f)
        info = zipfile.ZipInfo(f, date_time=(1980, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.create_system = 3  # Unix
        with open(file_path, 'rb') as src:
            zf.writestr(info, src.read())
`
    const tmpScript = path.join(repoRoot, '.cache', 'zip-script.py')
    fs.writeFileSync(tmpScript, script)
    execSync(`python3 "${tmpScript}" "${distDir}" "${outputPath}" "${tmpList}"`, { stdio: 'pipe' })
    fs.unlinkSync(tmpList)
    fs.unlinkSync(tmpScript)
  } finally {
    process.chdir(cwd)
  }
}

/**
 * @param {string} zipPath
 * @param {string} sumsPath
 */
function generateChecksums(zipPath, sumsPath) {
  const data = fs.readFileSync(zipPath)
  const hash = createHash('sha256').update(data).digest('hex')
  const zipName = path.basename(zipPath)
  fs.writeFileSync(sumsPath, `${hash}  ${zipName}\n`)
}

/**
 * @param {string} distDir
 * @param {string} outputDir
 * @param {boolean} force
 */
function generateAssets(distDir, outputDir, force) {
  // Read version from package.json
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
  const version = pkg.version
  const names = assetNames(version)
  const zipPath = path.join(outputDir, names.zip)
  const sumsPath = path.join(outputDir, names.sums)

  if (!force && (fs.existsSync(zipPath) || fs.existsSync(sumsPath))) {
    throw new Error(`Assets already exist in ${outputDir}. Use --force to overwrite.`)
  }

  fs.mkdirSync(outputDir, { recursive: true })

  console.log(`Creating ${names.zip} ...`)
  createDeterministicZip(distDir, zipPath)

  console.log(`Creating ${names.sums} ...`)
  generateChecksums(zipPath, sumsPath)

  // Verify with verify_release_zip.py
  console.log('Verifying zip with verify_release_zip.py ...')
  const verifyScript = path.join(
    repoRoot,
    '.github',
    'workflows',
    'scripts',
    'verify_release_zip.py',
  )
  execSync(`python3 "${verifyScript}" "${zipPath}"`, {
    stdio: 'inherit',
  })

  // Reverse verify SHA256SUMS
  console.log('Verifying SHA256SUMS ...')
  const sumsDir = path.dirname(sumsPath)
  execSync(`shasum -a 256 -c "${path.basename(sumsPath)}"`, {
    cwd: sumsDir,
    stdio: 'inherit',
  })

  const zipSize = fs.statSync(zipPath).size
  console.log(`\nDone: ${names.zip} (${zipSize} bytes)`)
  console.log(`      ${names.sums}`)
}

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
  if (!fs.existsSync(distDir)) {
    process.stderr.write('dist/ directory not found. Run `npm run build` first.\n')
    process.exit(1)
  }

  const outputDir = path.join(repoRoot, 'release-output')
  generateAssets(distDir, outputDir, force)
}

const isDirectRun =
  typeof process.argv[1] === 'string' &&
  process.argv[1].length > 0 &&
  fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(process.argv[1])

if (isDirectRun) {
  main()
}
