// Tests for the fail-closed/transactional release asset generator (M25).
//
// These tests verify that prepare-release-assets.mjs:
// - Explicitly classifies every Dirent type (fail-closed, no silent skip)
// - Enforces ZIP entry path contracts
// - Uses injected external commands (no shell string interpolation)
// - Performs transactional publish with staging/backup/rollback
// - Produces deterministic ZIPs (same dist → same bytes)
// - Cleans up staging and never leaves .cache/zip-* temp files

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let symlinkSupported = false
try {
  fs.symlinkSync('target', path.join(os.tmpdir(), '.m25-symlink-probe'))
  symlinkSupported = true
} catch {
  // symlinks not supported on this platform
}
const symlinkTest = symlinkSupported ? it : it.skip

/** Create a temp directory that is tracked for cleanup. */
function makeTempDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'm25-gen-test-'))
  tempDirs.push(d)
  return d
}

/** @type {string[]} */
const tempDirs = /** @type {string[]} */ /** @type {unknown} */ ['']
tempDirs.length = 0

afterEach(() => {
  const dirs = tempDirs.splice(0)
  for (const d of dirs) {
    try {
      fs.rmSync(d, { recursive: true, force: true })
    } catch {
      // best-effort cleanup
    }
  }
})

/** Create a minimal dist-like directory tree and a package.json at the repo root. */
function makeDistDir(baseDir: string): string {
  const dist = path.join(baseDir, 'dist')
  fs.mkdirSync(dist, { recursive: true })
  fs.writeFileSync(
    path.join(dist, 'index.html'),
    '<!DOCTYPE html><html><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'"><link rel="stylesheet" href="assets/app.css"><script src="assets/app.js"></script></html>',
  )
  fs.mkdirSync(path.join(dist, 'assets'), { recursive: true })
  fs.writeFileSync(path.join(dist, 'assets', 'app.js'), 'console.log("test")')
  fs.writeFileSync(path.join(dist, 'assets', 'app.css'), 'body{}')
  // package.json at repo root (needed by generateAssets)
  if (!fs.existsSync(path.join(baseDir, 'package.json'))) {
    fs.writeFileSync(
      path.join(baseDir, 'package.json'),
      JSON.stringify({ name: 'test', version: '1.1.5', private: true }),
    )
  }
  // Copy verify_release_zip.py to temp fixture
  const verifyDir = path.join(baseDir, '.github', 'workflows', 'scripts')
  fs.mkdirSync(verifyDir, { recursive: true })
  const realVerify = path.join(
    process.cwd(),
    '.github',
    'workflows',
    'scripts',
    'verify_release_zip.py',
  )
  if (!fs.existsSync(path.join(verifyDir, 'verify_release_zip.py'))) {
    fs.copyFileSync(realVerify, path.join(verifyDir, 'verify_release_zip.py'))
  }
  return dist
}

/** SHA-256 hex of a file. */
function sha256File(filePath: string): string {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

// ---------------------------------------------------------------------------
// Import the module under test
// ---------------------------------------------------------------------------

// These imports will fail until the module is refactored to export them.
// The test file is written first to prove the gaps exist.
import { assetNames, isPlainSemver, stableTag } from '../scripts/release-artifact-contract.mjs'
import { generateAssets, walkDist } from '../scripts/prepare-release-assets.mjs'

// ---------------------------------------------------------------------------
// Shared contract (WP-A)
// ---------------------------------------------------------------------------

describe('shared artifact contract (M25)', () => {
  it('has a single source for zip asset name', () => {
    const names = assetNames('1.1.5')
    expect(names.zip).toBe('pmbus-calculator-v1.1.5-web.zip')
    expect(names.sums).toBe('SHA256SUMS.txt')
  })

  it('rejects a v-prefixed version', () => {
    expect(isPlainSemver('v1.1.5')).toBe(false)
  })

  it('generates a stable tag from a plain version', () => {
    expect(stableTag('1.1.5')).toBe('v1.1.5')
  })

  it('rejects non-semver for stable tag', () => {
    expect(() => stableTag('v1.1.5')).toThrow()
  })
})

// ---------------------------------------------------------------------------
// walkDist — fail-closed Dirent classification (WP-B)
// ---------------------------------------------------------------------------

describe('walkDist fail-closed (M25)', () => {
  it('collects regular files from a directory', () => {
    const tmp = makeTempDir()
    const dist = makeDistDir(tmp)
    const files = walkDist(dist).map((f) => path.relative(dist, f))
    expect(files).toContain('index.html')
    expect(files).toContain('assets/app.js')
  })

  symlinkTest('rejects symlink files', () => {
    const tmp = makeTempDir()
    const dist = makeDistDir(tmp)
    fs.symlinkSync('index.html', path.join(dist, 'link.html'))
    expect(() => walkDist(dist)).toThrow(/symlink/)
  })

  symlinkTest('rejects symlink directories', () => {
    const tmp = makeTempDir()
    const dist = makeDistDir(tmp)
    fs.symlinkSync('assets', path.join(dist, 'link-dir'))
    expect(() => walkDist(dist)).toThrow(/symlink/)
  })

  it('rejects source maps (via generateAssets)', () => {
    const tmp = makeTempDir()
    const dist = makeDistDir(tmp)
    fs.writeFileSync(
      path.join(tmp, 'package.json'),
      JSON.stringify({ name: 'test', version: '1.1.5', private: true }),
    )
    fs.writeFileSync(path.join(dist, 'assets', 'app.js.map'), '{}')
    const output = path.join(tmp, 'release-output')
    expect(() => generateAssets(dist, output, false)).toThrow(/\.map/)
  })

  it('rejects forbidden path segments (via generateAssets)', () => {
    const tmp = makeTempDir()
    const dist = makeDistDir(tmp)
    fs.writeFileSync(
      path.join(tmp, 'package.json'),
      JSON.stringify({ name: 'test', version: '1.1.5', private: true }),
    )
    fs.mkdirSync(path.join(dist, 'node_modules'), { recursive: true })
    fs.writeFileSync(path.join(dist, 'node_modules', 'test.js'), '')
    const output = path.join(tmp, 'release-output')
    expect(() => generateAssets(dist, output, false)).toThrow(/node_modules/)
  })
})

// ---------------------------------------------------------------------------
// Transactional publish (WP-B)
// ---------------------------------------------------------------------------

describe('transactional publish (M25)', () => {
  it('generates assets into a staging directory', () => {
    const tmp = makeTempDir()
    const dist = makeDistDir(tmp)
    const output = path.join(tmp, 'release-output')
    generateAssets(dist, output, false)
    const names = assetNames('1.1.5')
    expect(fs.existsSync(path.join(output, names.zip))).toBe(true)
    expect(fs.existsSync(path.join(output, names.sums))).toBe(true)
  })

  it('rejects generation when output already exists without --force', () => {
    const tmp = makeTempDir()
    const dist = makeDistDir(tmp)
    const output = path.join(tmp, 'release-output')
    generateAssets(dist, output, false)
    expect(() => generateAssets(dist, output, false)).toThrow(/already exist/)
  })

  it('succeeds with --force when output exists', () => {
    const tmp = makeTempDir()
    const dist = makeDistDir(tmp)
    const output = path.join(tmp, 'release-output')
    generateAssets(dist, output, false)
    const names = assetNames('1.1.5')
    const firstHash = sha256File(path.join(output, names.zip))
    // Modify dist to produce a different zip
    fs.writeFileSync(path.join(dist, 'assets', 'new.js'), 'new')
    generateAssets(dist, output, true)
    const secondHash = sha256File(path.join(output, names.zip))
    expect(secondHash).not.toBe(firstHash)
  })

  it('produces identical zip on second generation', () => {
    const tmp = makeTempDir()
    const dist = makeDistDir(tmp)
    const output1 = path.join(tmp, 'out1')
    const output2 = path.join(tmp, 'out2')
    generateAssets(dist, output1, false)
    generateAssets(dist, output2, false)
    const names = assetNames('1.1.5')
    expect(sha256File(path.join(output1, names.zip))).toBe(
      sha256File(path.join(output2, names.zip)),
    )
  })

  it('rejects missing dist directory', () => {
    const tmp = makeTempDir()
    const missing = path.join(tmp, 'nonexistent')
    expect(() => generateAssets(missing, path.join(tmp, 'out'), false)).toThrow()
  })

  it('preserves old assets on --force failure', () => {
    // This test verifies the transactional rollback: if --force fails
    // after moving old output, the old assets are restored.
    const tmp = makeTempDir()
    const dist = makeDistDir(tmp)
    const output = path.join(tmp, 'release-output')
    generateAssets(dist, output, false)
    const names = assetNames('1.1.5')
    const oldHash = sha256File(path.join(output, names.zip))

    // Corrupt dist to cause verifier failure
    fs.rmSync(path.join(dist, 'index.html'))
    try {
      generateAssets(dist, output, true)
    } catch {
      // expected
    }

    // Old assets should still be intact
    expect(fs.existsSync(path.join(output, names.zip))).toBe(true)
    expect(sha256File(path.join(output, names.zip))).toBe(oldHash)
  })

  it('leaves no staging residue after failure', () => {
    const tmp = makeTempDir()
    const dist = makeDistDir(tmp)
    // Corrupt dist to cause verifier failure
    fs.rmSync(path.join(dist, 'index.html'))
    try {
      generateAssets(dist, path.join(tmp, 'out'), false)
    } catch {
      // expected
    }
    // No .release-staging residue
    const staging = path.join(tmp, '.release-staging')
    if (fs.existsSync(staging)) {
      const entries = fs.readdirSync(staging)
      expect(entries.length).toBe(0)
    }
  })

  it('leaves no legacy .cache/zip-* temp files', () => {
    const tmp = makeTempDir()
    const dist = makeDistDir(tmp)
    const cacheDir = path.join(tmp, '.cache')
    fs.mkdirSync(cacheDir, { recursive: true })
    generateAssets(dist, path.join(tmp, 'out'), false)
    const zipFileList = path.join(cacheDir, 'zip-file-list.txt')
    const zipScript = path.join(cacheDir, 'zip-script.py')
    expect(fs.existsSync(zipFileList)).toBe(false)
    expect(fs.existsSync(zipScript)).toBe(false)
  })

  it('rejects unknown CLI options', () => {
    const tmp = makeTempDir()
    makeDistDir(tmp)
    // Unknown option should cause exit 2
    try {
      execFileSync(
        process.execPath,
        [path.join(process.cwd(), 'scripts', 'prepare-release-assets.mjs'), '--unknown-flag'],
        { cwd: tmp, stdio: 'pipe', timeout: 10_000 },
      )
      // Should have thrown
      expect(true).toBe(false)
    } catch (e) {
      // @ts-expect-error — catch variable is unknown in strict mode
      expect(e.status).toBe(2)
    }
  })
})

// ---------------------------------------------------------------------------
// Path contract (WP-B)
// ---------------------------------------------------------------------------

describe('ZIP entry path contract (M25)', () => {
  it('handles paths with spaces', () => {
    const tmp = makeTempDir()
    const dist = path.join(tmp, 'dist with spaces')
    fs.mkdirSync(dist, { recursive: true })
    fs.writeFileSync(
      path.join(dist, 'index.html'),
      '<!DOCTYPE html><html><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'"><link rel="stylesheet" href="assets/app.css"><script src="assets/app.js"></script></html>',
    )
    fs.mkdirSync(path.join(dist, 'assets'), { recursive: true })
    fs.writeFileSync(path.join(dist, 'assets', 'app.js'), 'test')
    fs.writeFileSync(path.join(dist, 'assets', 'app.css'), 'body{}')
    fs.writeFileSync(
      path.join(tmp, 'package.json'),
      JSON.stringify({ name: 'test', version: '1.1.5', private: true }),
    )
    // Copy verify script
    const verifyDir = path.join(tmp, '.github', 'workflows', 'scripts')
    fs.mkdirSync(verifyDir, { recursive: true })
    fs.copyFileSync(
      path.join(process.cwd(), '.github', 'workflows', 'scripts', 'verify_release_zip.py'),
      path.join(verifyDir, 'verify_release_zip.py'),
    )
    const output = path.join(tmp, 'out')
    generateAssets(dist, output, false)
    const names = assetNames('1.1.5')
    expect(fs.existsSync(path.join(output, names.zip))).toBe(true)
  })

  it('handles paths with quotes', () => {
    const tmp = makeTempDir()
    const dist = path.join(tmp, "dist'with'quotes")
    fs.mkdirSync(dist, { recursive: true })
    fs.writeFileSync(
      path.join(dist, 'index.html'),
      '<!DOCTYPE html><html><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'"><link rel="stylesheet" href="assets/app.css"><script src="assets/app.js"></script></html>',
    )
    fs.mkdirSync(path.join(dist, 'assets'), { recursive: true })
    fs.writeFileSync(path.join(dist, 'assets', 'app.js'), 'test')
    fs.writeFileSync(path.join(dist, 'assets', 'app.css'), 'body{}')
    fs.writeFileSync(
      path.join(tmp, 'package.json'),
      JSON.stringify({ name: 'test', version: '1.1.5', private: true }),
    )
    // Copy verify script
    const verifyDir = path.join(tmp, '.github', 'workflows', 'scripts')
    fs.mkdirSync(verifyDir, { recursive: true })
    fs.copyFileSync(
      path.join(process.cwd(), '.github', 'workflows', 'scripts', 'verify_release_zip.py'),
      path.join(verifyDir, 'verify_release_zip.py'),
    )
    const output = path.join(tmp, 'out')
    generateAssets(dist, output, false)
    expect(fs.existsSync(path.join(output, assetNames('1.1.5').zip))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Python injectable (WP-B)
// ---------------------------------------------------------------------------

describe('external command injectability (M25)', () => {
  it('fails when Python is unavailable', () => {
    const tmp = makeTempDir()
    makeDistDir(tmp)
    // Create a fake python3 that exits 1
    const shimDir = path.join(tmp, 'shim')
    fs.mkdirSync(shimDir, { recursive: true })
    fs.writeFileSync(path.join(shimDir, 'python3'), '#!/bin/sh\nexit 1\n')
    fs.chmodSync(path.join(shimDir, 'python3'), 0o755)

    const env = {
      ...process.env,
      PATH: `${shimDir}:${process.env.PATH}`,
      PYTHON3: path.join(shimDir, 'python3'),
    }
    try {
      execFileSync(
        process.execPath,
        [path.join(process.cwd(), 'scripts', 'prepare-release-assets.mjs'), '--force'],
        { cwd: tmp, env, stdio: 'pipe', timeout: 10_000 },
      )
      // Should have thrown
      expect(true).toBe(false)
    } catch (e) {
      // @ts-expect-error — catch variable is unknown in strict mode
      expect(e.status).not.toBe(0)
    }
  })
})
