// Single source of truth for release artifact naming and ZIP entry policy (M25).
//
// Every surface that needs to know the artifact zip name, SHA256SUMS name,
// or stable tag format must import from this module. No other file may
// duplicate these definitions.
//
// Used by:
// - prepare-release-assets.mjs  (generates the assets)
// - check-release-contract.mjs  (validates cross-file consistency)

// ---------------------------------------------------------------------------
// Version helpers
// ---------------------------------------------------------------------------

const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/

/**
 * @param {string} version
 * @returns {boolean}
 */
export function isPlainSemver(version) {
  return SEMVER_PATTERN.test(version)
}

/**
 * @param {string} version — plain semver (no "v" prefix)
 * @returns {string} — stable Git tag, e.g. "v1.1.6"
 */
export function stableTag(version) {
  if (!isPlainSemver(version)) {
    throw new Error(`stable tag requires plain semver, got: ${version}`)
  }
  return `v${version}`
}

// ---------------------------------------------------------------------------
// Asset names
// ---------------------------------------------------------------------------

/**
 * @param {string} version — plain semver
 * @returns {string}
 */
export function assetZipName(version) {
  return `pmbus-calculator-v${version}-web.zip`
}

/**
 * @returns {string}
 */
export function assetSumsName() {
  return 'SHA256SUMS.txt'
}

/**
 * @param {string} version — plain semver
 * @returns {{ zip: string, sums: string }}
 */
export function assetNames(version) {
  return {
    zip: assetZipName(version),
    sums: assetSumsName(),
  }
}

// ---------------------------------------------------------------------------
// Pages workflow template
// ---------------------------------------------------------------------------

/**
 * The template used in .github/workflows/pages.yml to construct the zip
 * download name. `${RELEASE_TAG}` is substituted at workflow runtime.
 */
export const PAGES_ZIP_TEMPLATE = 'pmbus-calculator-${RELEASE_TAG}-web.zip'

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

/**
 * Validate a single ZIP entry path from the dist/ directory.
 *
 * Rules:
 * - Non-empty.
 * - POSIX relative (no leading `/`, no `..` components).
 * - No backslash, NUL, or control characters.
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
  const segments = entry.split('/')
  for (const segment of segments) {
    if (segment === '..') {
      return { ok: false, reason: `path traversal in zip entry: ${entry}` }
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
