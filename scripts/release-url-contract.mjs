/**
 * Shared release-asset URL/name contract (v2.5.9).
 *
 * Release metadata is DATA, never a shell program. Both consumers —
 * `scripts/release-assets-verify.mjs` (metadata gate) and
 * `scripts/download-release-assets.mjs` (Pages workflow downloader) — validate
 * asset URLs through this module instead of a bare `startsWith('https://')`:
 *
 * - the only accepted form is the canonical public GitHub
 *   `browser_download_url` for the expected repository, tag and asset name:
 *   `https://github.com/<owner>/<repo>/releases/download/<tag>/<name>`;
 * - usernames/passwords, non-HTTPS schemes, foreign hosts, query strings,
 *   fragments, whitespace/control characters and any non-canonical encoding
 *   (path escape, percent-encoded segments, command-substitution text) fail
 *   with a descriptive error;
 * - asset names must be safe basenames, so no path or shell fragment can
 *   travel through `--zip-name` / `--sums-name` or the metadata itself.
 *
 * Legitimate GitHub download redirects (the CDN hop after an asset GET) are a
 * transport-level behavior of the DOWNLOAD step, not a property of the
 * metadata URL: the canonical metadata URL is stored and consumed verbatim.
 */

const REPO_SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/
const SAFE_ASSET_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const CONTROL_OR_WHITESPACE = /[\u0000-\u001f\u007f\s]/

/**
 * Parse and validate an `owner/repo` repository slug (trusted CLI config).
 * @param {string} repo
 * @param {string} [label]
 * @returns {{ owner: string, name: string }}
 */
export function assertValidRepoSlug(repo, label = '--repo') {
  if (typeof repo !== 'string' || !REPO_SLUG_PATTERN.test(repo)) {
    throw new Error(
      `${label} must be a GitHub repository slug like owner/repo (got: ${JSON.stringify(repo)})`,
    )
  }
  const [owner, name] = repo.split('/')
  if (name === '.' || name === '..') {
    throw new Error(`${label} repository name must not be a path segment alias`)
  }
  return { owner, name }
}

/**
 * Validate that an asset name is a safe basename (no path, no shell text).
 * @param {string} name
 * @param {string} [label]
 * @returns {string}
 */
export function assertSafeAssetName(name, label = 'asset name') {
  if (typeof name !== 'string' || !SAFE_ASSET_NAME_PATTERN.test(name)) {
    throw new Error(
      `${label} must be a safe basename of [A-Za-z0-9._-] (got: ${JSON.stringify(name)})`,
    )
  }
  return name
}

/**
 * Validate one `browser_download_url` against the canonical public GitHub
 * form for `/{owner}/{repo}/releases/download/{tag}/{name}`. Throws an Error
 * describing the violated rule; callers map that onto their exit contract.
 * @param {string} url
 * @param {{ repo: string, tag: string, name: string }} expected
 * @returns {URL}
 */
export function assertCanonicalAssetDownloadUrl(url, { repo, tag, name }) {
  if (typeof url !== 'string' || url.length === 0) {
    throw new Error('browser_download_url is missing or not a string')
  }
  if (CONTROL_OR_WHITESPACE.test(url)) {
    throw new Error('browser_download_url contains whitespace or control characters')
  }
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`browser_download_url is not a valid URL: ${JSON.stringify(url)}`)
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`browser_download_url must use https (got: ${parsed.protocol})`)
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw new Error('browser_download_url must not carry userinfo')
  }
  if (parsed.host !== 'github.com') {
    throw new Error(`browser_download_url host must be github.com (got: ${parsed.host})`)
  }
  if (parsed.search !== '' || parsed.hash !== '') {
    throw new Error('browser_download_url must not carry a query string or fragment')
  }
  const { owner, name: repoName } = assertValidRepoSlug(repo, 'repository slug')
  const expectedPath = `/${owner}/${repoName}/releases/download/${tag}/${name}`
  if (parsed.pathname !== expectedPath) {
    throw new Error(
      `browser_download_url must be the canonical https://github.com/${owner}/${repoName}/releases/download/... path ` +
        `(expected ${expectedPath}, got ${parsed.pathname})`,
    )
  }
  return parsed
}
