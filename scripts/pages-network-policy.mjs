// Shared by deterministic browser smoke and hosted real Analytics acceptance.
// This module is never imported by the application or the ordinary build.
export const CLOUDFLARE_BEACON_URL = 'https://static.cloudflareinsights.com/beacon.min.js'
export const CLOUDFLARE_RUM_URL = 'https://cloudflareinsights.com/cdn-cgi/rum'
export const CLOUDFLARE_RUM_ORIGIN = new URL(CLOUDFLARE_RUM_URL).origin
export const PAGES_REPOSITORY_URL = 'https://github.com/laipeng101/pmbus-calculator'
export const PAGES_REPOSITORY_NAME = '在 GitHub 查看项目源码'

export const RELEASE_CSP = {
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  'style-src': ["'self'", "'unsafe-inline'"],
  'img-src': ["'self'", 'data:'],
  'font-src': ["'self'", 'data:'],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'self'"],
}

export const PAGES_CSP = {
  ...RELEASE_CSP,
  'script-src': ["'self'", CLOUDFLARE_BEACON_URL],
  'connect-src': ["'self'", CLOUDFLARE_RUM_ORIGIN],
}

/** @param {string} content @returns {Record<string, string[]>} */
export function parseCsp(content) {
  if (/[^\x20-\x7e]/.test(content)) {
    throw new Error('CSP contains non-ASCII or control characters')
  }
  const directives = new Map()
  for (const part of content.split(';')) {
    if (part.trim() === '') continue
    const [name, ...sources] = part.trim().split(/ +/)
    if (!name || directives.has(name)) {
      throw new Error('CSP contains a missing or duplicate directive')
    }
    directives.set(name, sources)
  }
  return Object.fromEntries(directives)
}

// Keep original-string equality: no alternate path/query/protocol/port/userinfo,
// lookalike hostname or redirect destination. The audited RUM transport types
// never become a second source of scripts, styles, fonts or images.
/** @param {string} requestUrl @param {string} resourceType
 * @param {string} method @param {string} deploymentUrl */
export function isAllowedPagesRequest(requestUrl, resourceType, method, deploymentUrl) {
  let url
  let pages
  try {
    url = new URL(requestUrl)
    pages = new URL(deploymentUrl)
  } catch {
    return false
  }
  if (url.username || url.password) return false
  if (url.origin === pages.origin) return true
  if (requestUrl === CLOUDFLARE_BEACON_URL) {
    return resourceType === 'script' && method === 'GET'
  }
  return (
    requestUrl === CLOUDFLARE_RUM_URL &&
    ['fetch', 'xhr', 'ping', 'other'].includes(resourceType) &&
    method === 'POST'
  )
}
