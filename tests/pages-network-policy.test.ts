import { describe, expect, it } from 'vitest'
import {
  CLOUDFLARE_BEACON_URL,
  CLOUDFLARE_RUM_URL,
  isAllowedPagesRequest,
  parseCsp,
} from './e2e/helpers/pages-network-policy'

const deployment = 'https://laipeng101.github.io/pmbus-calculator/'

describe('Pages smoke exact external request allowlist', () => {
  it.each(['document', 'script', 'stylesheet', 'font', 'image', 'fetch', 'xhr'])(
    'continues to allow same-origin %s resources',
    (type) => {
      expect(isAllowedPagesRequest(`${deployment}assets/resource`, type, 'GET', deployment)).toBe(
        true,
      )
    },
  )

  it('allows only the exact Cloudflare module script URL', () => {
    expect(isAllowedPagesRequest(CLOUDFLARE_BEACON_URL, 'script', 'GET', deployment)).toBe(true)
    for (const url of [
      `${CLOUDFLARE_BEACON_URL}?extra=1`,
      `${CLOUDFLARE_BEACON_URL}?`,
      `${CLOUDFLARE_BEACON_URL}#fragment`,
      `${CLOUDFLARE_BEACON_URL}/extra`,
      'https://static.cloudflareinsights.com/other.js',
      'https://static.cloudflareinsights.com.evil.example/beacon.min.js',
      'https://user@static.cloudflareinsights.com/beacon.min.js',
      'http://static.cloudflareinsights.com/beacon.min.js',
      'https://static.cloudflareinsights.com:444/beacon.min.js',
      'https://static.cloudflareinsights.com:443/beacon.min.js',
      'https://static.cloudflareinsights.com/a/../beacon.min.js',
    ]) {
      expect(isAllowedPagesRequest(url, 'script', 'GET', deployment), url).toBe(false)
    }
    expect(isAllowedPagesRequest(CLOUDFLARE_BEACON_URL, 'fetch', 'GET', deployment)).toBe(false)
    expect(isAllowedPagesRequest(CLOUDFLARE_BEACON_URL, 'script', 'POST', deployment)).toBe(false)
  })

  it.each(['fetch', 'xhr', 'ping', 'other'])('allows Cloudflare RUM %s POST only', (type) => {
    expect(isAllowedPagesRequest(CLOUDFLARE_RUM_URL, type, 'POST', deployment)).toBe(true)
    expect(isAllowedPagesRequest(CLOUDFLARE_RUM_URL, type, 'GET', deployment)).toBe(false)
  })

  it.each(['document', 'script', 'stylesheet', 'font', 'image', 'media'])(
    'never treats the Cloudflare RUM endpoint as a permitted %s source',
    (type) => {
      expect(isAllowedPagesRequest(CLOUDFLARE_RUM_URL, type, 'POST', deployment)).toBe(false)
    },
  )

  it.each([
    'https://cloudflareinsights.com/other',
    `${CLOUDFLARE_RUM_URL}/extra`,
    `${CLOUDFLARE_RUM_URL}?unexpected=1`,
    `${CLOUDFLARE_RUM_URL}?`,
    `${CLOUDFLARE_RUM_URL}#fragment`,
    'http://cloudflareinsights.com/cdn-cgi/rum',
    'https://cloudflareinsights.com:444/cdn-cgi/rum',
    'https://cloudflareinsights.com:443/cdn-cgi/rum',
    'https://user@cloudflareinsights.com/cdn-cgi/rum',
    'https://user:password@cloudflareinsights.com/cdn-cgi/rum',
    'https://@cloudflareinsights.com/cdn-cgi/rum',
    'https://cloudflareinsights.com.evil.example/cdn-cgi/rum',
    'https://cloudflareinsights.com/cdn-cgi/other/../rum',
  ])('rejects noncanonical RUM URL %s for every permitted POST transport', (url) => {
    for (const type of ['fetch', 'xhr', 'ping', 'other']) {
      expect(isAllowedPagesRequest(url, type, 'POST', deployment)).toBe(false)
    }
  })

  it('rejects arbitrary, lookalike, alternate-protocol and redirect destinations', () => {
    for (const url of [
      'https://example.com/resource',
      'https://cdn.cloudflareinsights.com/cdn-cgi/rum',
      'https://cloudflareinsights.com.evil.example/cdn-cgi/rum',
      'https://cloudflareinsights.com:444/cdn-cgi/rum',
      'https://user@cloudflareinsights.com/cdn-cgi/rum',
      'http://cloudflareinsights.com/cdn-cgi/rum',
      'data:text/javascript,export{}',
      'not a URL',
    ]) {
      expect(isAllowedPagesRequest(url, 'fetch', 'POST', deployment), url).toBe(false)
    }
  })

  it('does not silently accept duplicate CSP directives', () => {
    expect(() => parseCsp("script-src 'self'; script-src https:")).toThrow(/duplicate/)
  })

  it('rejects Unicode separators and control characters before tokenizing CSP', () => {
    for (const separator of ['\u00a0', '\u2003', '\ufeff', '\t', '\n', '\r']) {
      for (const content of [`script-src${separator}'self'`, `script-src 'self'${separator}`]) {
        expect(() => parseCsp(content)).toThrow('CSP contains non-ASCII or control characters')
      }
    }
    expect(parseCsp("  script-src  'self'; ")).toEqual({ 'script-src': ["'self'"] })
  })
})
