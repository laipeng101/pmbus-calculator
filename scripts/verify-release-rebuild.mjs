#!/usr/bin/env node
/**
 * Tag-rebuild equality gate (release provenance).
 *
 * Mechanically binds the deployed Release zip to the tagged source: the
 * Pages workflow builds the checked-out annotated tag fresh, generates the
 * deterministic release assets from that build, and this gate requires the
 * rebuilt zip to be BYTE-IDENTICAL to the downloaded, previously verified
 * release zip. A zip that is well-formed, safely packaged and
 * checksum-consistent but was not produced from the tagged source fails
 * here — with its first differing byte offset — before extraction or
 * deployment.
 *
 * This script owns no naming facts: both paths are passed in explicitly.
 * The workflow derives them from the resolved tag and the deterministic
 * generator's output directory (scripts/prepare-release-assets.mjs), whose
 * naming plan is the shared contract in scripts/release-artifact-contract.mjs.
 *
 * Checks (in order, each failure class with its own exit code):
 *   - usage (exit 2): unknown flag, duplicate flag, missing value,
 *     unexpected positional, missing required paths.
 *   - presence (exit 3): each path exists and is a regular file
 *     (symlinks, directories and other non-regular types fail).
 *   - size (exit 4): byte sizes differ.
 *   - content (exit 5): a streamed byte comparison found a difference;
 *     the diagnostic names the first differing offset.
 *
 * Output contract (data-not-code, same as verify-downloaded-assets.mjs):
 * stdout carries ONE JSON object
 *   {"expected":{"path","size","sha256"},"actual":{"path","size","sha256"},"equal":true}
 * and ALL diagnostics go to stderr. SHA-256 is computed with node:crypto
 * while streaming; it is reported data, never the equality authority —
 * the byte comparison is.
 */

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

/** Comparison window per read: large enough to be fast, small enough to
 * bound memory regardless of asset size. */
const CHUNK_SIZE = 1024 * 1024

const USAGE = 'usage: verify-release-rebuild.mjs --expected <release-zip> --actual <rebuilt-zip>'

/** Rebuild-equality failure carrying its documented exit code. */
class RebuildVerifyError extends Error {
  /**
   * @param {number} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message)
    this.name = 'RebuildVerifyError'
    this.code = code
  }
}

/**
 * @param {number} code
 * @param {string} message
 * @returns {never}
 */
function fail(code, message) {
  console.error(`error: ${message}`)
  process.exit(code)
}

/**
 * @param {string[]} argv
 * @returns {{ expected: string | null, actual: string | null, help: boolean }}
 */
function parseArgs(argv) {
  /** @type {{ expected: string | null, actual: string | null, help: boolean }} */
  const args = { expected: null, actual: null, help: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--expected') {
      args.expected = argv[++i]
    } else if (arg === '--actual') {
      args.actual = argv[++i]
    } else if (arg === '--help' || arg === '-h') {
      args.help = true
    } else if (arg.startsWith('--')) {
      fail(2, `unknown option: ${arg}\n${USAGE}`)
    } else {
      fail(2, `unexpected positional argument: ${arg}\n${USAGE}`)
    }
  }
  return args
}

/**
 * Resolve a gate input as a regular file, fail-closed on every other type.
 *
 * @param {string} kind human-readable role ("expected" / "actual")
 * @param {string} filePath
 * @returns {number} the file's byte size
 */
function regularFileSize(kind, filePath) {
  let stats
  try {
    stats = fs.lstatSync(filePath)
  } catch {
    throw new RebuildVerifyError(3, `${kind} file is missing: ${filePath}`)
  }
  if (!stats.isFile()) {
    throw new RebuildVerifyError(3, `${kind} path is not a regular file: ${filePath}`)
  }
  return stats.size
}

/**
 * Streamed byte comparison with simultaneous SHA-256 digests. Sizes must be
 * verified equal before calling; reads advance both descriptors in lockstep.
 *
 * @param {string} expectedPath
 * @param {string} actualPath
 * @returns {{ expectedSha256: string, actualSha256: string }}
 */
function compareFiles(expectedPath, actualPath) {
  const expectedFd = fs.openSync(expectedPath, 'r')
  const actualFd = fs.openSync(actualPath, 'r')
  const expectedHash = createHash('sha256')
  const actualHash = createHash('sha256')
  const expectedChunk = Buffer.allocUnsafe(CHUNK_SIZE)
  const actualChunk = Buffer.allocUnsafe(CHUNK_SIZE)
  let offset = 0
  try {
    for (;;) {
      const expectedRead = fs.readSync(expectedFd, expectedChunk, 0, CHUNK_SIZE, offset)
      const actualRead = fs.readSync(actualFd, actualChunk, 0, CHUNK_SIZE, offset)
      if (expectedRead !== actualRead) {
        // Sizes are equal up front, so reads must advance in lockstep.
        throw new RebuildVerifyError(
          5,
          `read length divergence at offset ${offset} (${expectedRead} vs ${actualRead})`,
        )
      }
      if (expectedRead === 0) break
      const expectedSlice = expectedChunk.subarray(0, expectedRead)
      const actualSlice = actualChunk.subarray(0, actualRead)
      expectedHash.update(expectedSlice)
      actualHash.update(actualSlice)
      if (!expectedSlice.equals(actualSlice)) {
        let byteIndex = 0
        while (expectedSlice[byteIndex] === actualSlice[byteIndex]) byteIndex++
        throw new RebuildVerifyError(
          5,
          `files differ at byte offset ${offset + byteIndex}: ` +
            `expected 0x${expectedSlice[byteIndex].toString(16).padStart(2, '0')}, ` +
            `got 0x${actualSlice[byteIndex].toString(16).padStart(2, '0')}`,
        )
      }
      offset += expectedRead
    }
  } finally {
    fs.closeSync(expectedFd)
    fs.closeSync(actualFd)
  }
  return {
    expectedSha256: expectedHash.digest('hex'),
    actualSha256: actualHash.digest('hex'),
  }
}

/**
 * Core rebuild-equality verification, shared by runCli and tests.
 *
 * @param {string} expectedPath downloaded (already verified) release zip
 * @param {string} actualPath rebuilt zip from the tagged source
 * @returns {{ expected: {path: string, size: number, sha256: string}, actual: {path: string, size: number, sha256: string}, equal: boolean }}
 */
export function verifyReleaseRebuild(expectedPath, actualPath) {
  const expectedSize = regularFileSize('expected', expectedPath)
  const actualSize = regularFileSize('actual', actualPath)
  if (expectedSize !== actualSize) {
    throw new RebuildVerifyError(
      4,
      `size mismatch: expected ${expectedSize} bytes (${expectedPath}), got ${actualSize} bytes (${actualPath})`,
    )
  }
  const { expectedSha256, actualSha256 } = compareFiles(expectedPath, actualPath)
  return {
    expected: { path: path.resolve(expectedPath), size: expectedSize, sha256: expectedSha256 },
    actual: { path: path.resolve(actualPath), size: actualSize, sha256: actualSha256 },
    equal: true,
  }
}

/**
 * CLI entry: returns via process.exit codes; stdout is data-only JSON.
 *
 * @param {string[]} argv
 */
export function runCli(argv) {
  const args = parseArgs(argv)
  if (args.help) {
    console.log(USAGE)
    process.exit(0)
  }
  for (const [flag, value] of [
    ['--expected', args.expected],
    ['--actual', args.actual],
  ]) {
    if (!value) fail(2, `${flag} is required\n${USAGE}`)
  }
  try {
    const result = verifyReleaseRebuild(
      /** @type {string} */ (args.expected),
      /** @type {string} */ (args.actual),
    )
    console.log(JSON.stringify(result))
    console.error(
      `ok: rebuilt zip is byte-identical to the release zip ` +
        `(${result.expected.size} bytes, sha256 ${result.expected.sha256})`,
    )
  } catch (error) {
    if (error instanceof RebuildVerifyError) fail(error.code, error.message)
    throw error
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) {
  runCli(process.argv.slice(2))
}
