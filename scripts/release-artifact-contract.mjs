// Version, asset names and ZIP entry rules shared by generation and verification.

const RELEASE_VERSION = /^[1-9][0-9]*\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/
const ZIP_PREFIX = 'pmbus-calculator-'
const ZIP_SUFFIX = '-web.zip'

/** @param {unknown} version @returns {version is string} */
export function isStableReleaseVersion(version) {
  return typeof version === 'string' && RELEASE_VERSION.test(version)
}

/** @param {unknown} tag @returns {tag is string} */
export function isStableReleaseTag(tag) {
  return typeof tag === 'string' && tag.startsWith('v') && isStableReleaseVersion(tag.slice(1))
}

/** @param {string} tag - validated stable Git tag (for example, v1.2.3) */
export function releaseAssetNames(tag) {
  return {
    zipName: `${ZIP_PREFIX}${tag}${ZIP_SUFFIX}`,
    sumsName: 'SHA256SUMS.txt',
  }
}

/** @param {string} name */
export function isReleaseZipName(name) {
  return (
    name.startsWith(ZIP_PREFIX) &&
    name.endsWith(ZIP_SUFFIX) &&
    isStableReleaseTag(name.slice(ZIP_PREFIX.length, -ZIP_SUFFIX.length))
  )
}

/** Disposable per-run staging root, relative to the repository root. */
export const STAGING_DIR = '.release-staging'

/** Published output directory, relative to the repository root. */
export const OUTPUT_DIR = 'release-output'

// ---------------------------------------------------------------------------
// ZIP entry path policy
// ---------------------------------------------------------------------------

/**
 * Rejected path-segment names (checked component-wise, not substring).
 * Directories named `node_modules` or `src` are forbidden inside the zip.
 */
const FORBIDDEN_SEGMENTS = new Set(['node_modules', 'src'])

/**
 * Rejected control characters and path separators for ZIP entry names.
 */
const FORBIDDEN_ENTRY_CHARS = /[\x00-\x1f\x7f\\]/

/** Windows drive prefixes include drive-relative paths such as `C:foo`. */
const WINDOWS_DRIVE = /^[A-Za-z]:/

/**
 * Validate a single ZIP entry path from the dist/ directory.
 *
 * Keep the path rules aligned with the Python ZIP script.
 * - Non-empty.
 * - POSIX relative (no leading `/`, no `..` components, no `.` component).
 * - No Windows drive prefix (absolute or drive-relative).
 * - No backslash, NUL, or control characters.
 * - No empty segment (`a//b`).
 * - No component named `node_modules` or `src`.
 * - No `.map` suffix.
 *
 * @param {string} entry — POSIX relative path within the zip
 * @returns {{ ok: boolean, reason?: string }}
 */
export function validateZipEntry(entry) {
  if (entry.length === 0) {
    return { ok: false, reason: 'empty zip entry' }
  }
  if (entry.startsWith('/')) {
    return { ok: false, reason: `absolute zip entry: ${entry}` }
  }
  if (WINDOWS_DRIVE.test(entry)) {
    return { ok: false, reason: `windows drive path in zip entry: ${entry}` }
  }
  const segments = entry.split('/')
  for (const segment of segments) {
    if (segment === '..') {
      return { ok: false, reason: `path traversal in zip entry: ${entry}` }
    }
    if (segment === '.') {
      return { ok: false, reason: `dot segment in zip entry: ${entry}` }
    }
    if (segment.length === 0) {
      return { ok: false, reason: `empty segment in zip entry: ${entry}` }
    }
    if (FORBIDDEN_SEGMENTS.has(segment)) {
      return { ok: false, reason: `forbidden segment "${segment}" in zip entry: ${entry}` }
    }
  }
  if (FORBIDDEN_ENTRY_CHARS.test(entry)) {
    return { ok: false, reason: `forbidden character in zip entry: ${entry}` }
  }
  if (entry.endsWith('.map')) {
    return { ok: false, reason: `source map in zip entry: ${entry}` }
  }
  return { ok: true }
}
