// @vitest-environment jsdom
// Offline tests only: browser operations are faked; no real Cloudflare network.
import { EventEmitter } from 'node:events'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import type { Browser } from '@playwright/test'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AnalyticsError,
  ATTEMPT_BUDGET_MS,
  BACKOFF_MS,
  CLEANUP_BUDGET_MS,
  DEPLOYMENT_URL,
  MAX_ATTEMPTS,
  TOTAL_BUDGET_MS,
  WATCHDOG_MS,
  WORK_BUDGET_MS,
  attemptAcceptance,
  classifyConsole,
  classifyNetworkFailure,
  isBeaconInitiator,
  observeLiveNetwork,
  parseInputs,
  readLiveDom,
  validateLiveDom,
  verifyLiveAnalytics,
  within,
} from '../scripts/verify-live-analytics.mjs'
import {
  CLOUDFLARE_BEACON_URL,
  CLOUDFLARE_RUM_URL,
  PAGES_CSP,
  PAGES_REPOSITORY_NAME,
  PAGES_REPOSITORY_URL,
} from '../scripts/pages-network-policy.mjs'

const inputs = { deploymentUrl: DEPLOYMENT_URL, expectedTag: 'v3.3.1' }
const browserArguments = {
  beaconUrl: CLOUDFLARE_BEACON_URL,
  repositoryUrl: PAGES_REPOSITORY_URL,
  repositoryName: PAGES_REPOSITORY_NAME,
}
const csp = Object.entries(PAGES_CSP)
  .map(([key, values]) => `${key} ${values.join(' ')}`)
  .join('; ')
const facts = {
  version: '3.3.1',
  csp,
  cspPlacement: true,
  beaconValid: true,
  repositoryValid: true,
  assetsSameOrigin: true,
  overlayCssPresent: true,
}
const beaconInitiator = { type: 'script', stack: { callFrames: [{ url: CLOUDFLARE_BEACON_URL }] } }

function request(url: string, type: string, method = 'GET') {
  return {
    url: () => url,
    resourceType: () => type,
    method: () => method,
    failure: () => ({ errorText: 'net::ERR_FAILED' }),
  }
}

function harness() {
  const context = new EventEmitter()
  const page = new EventEmitter()
  const session = new EventEmitter()
  const observer = observeLiveNetwork(context, page, session, DEPLOYMENT_URL)
  const beacon = request(CLOUDFLARE_BEACON_URL, 'script')
  const rum = request(CLOUDFLARE_RUM_URL, 'fetch', 'POST')
  const respond = (req: ReturnType<typeof request>, status: number) => {
    context.emit('response', { request: () => req, status: () => status })
  }
  const complete = (req: ReturnType<typeof request>, status: number) => {
    context.emit('request', req)
    respond(req, status)
    context.emit('requestfinished', req)
  }
  const initiate = (initiator = beaconInitiator) =>
    session.emit('Network.requestWillBeSent', {
      request: { url: CLOUDFLARE_RUM_URL, method: 'POST' },
      initiator,
    })
  const success = () => {
    complete(beacon, 200)
    initiate()
    complete(rum, 204)
  }
  return { context, page, session, observer, beacon, rum, respond, complete, initiate, success }
}

afterEach(() => {
  vi.useRealTimers()
  document.head.innerHTML = ''
  document.body.innerHTML = ''
})

describe('live Analytics controlled input and safe diagnostics', () => {
  it('requires the exact official HTTPS URL and binds the expected tag to the checkout', () => {
    expect(parseInputs({ DEPLOYMENT_URL }, '3.3.1')).toEqual(inputs)
    expect(parseInputs({ DEPLOYMENT_URL, EXPECTED_RELEASE_TAG: 'v3.3.1' }, '3.3.1')).toEqual(inputs)
    expect(() => parseInputs({ DEPLOYMENT_URL, EXPECTED_RELEASE_TAG: 'v3.3.0' }, '3.3.1')).toThrow(
      'CONFIGURATION_ERROR',
    )
    expect(() => parseInputs({ DEPLOYMENT_URL }, '3.3.1-rc.1')).toThrow('CONFIGURATION_ERROR')
    expect(() => parseInputs({ DEPLOYMENT_URL }, '3.3.1', ['--anything'])).toThrow(
      'CONFIGURATION_ERROR',
    )
  })

  it.each([
    undefined,
    '',
    'http://laipeng101.github.io/pmbus-calculator/',
    'https://laipeng101.github.io/',
    'https://laipeng101.github.io:443/pmbus-calculator/',
    'https://laipeng101.github.io:444/pmbus-calculator/',
    `${DEPLOYMENT_URL}?x=1`,
    `${DEPLOYMENT_URL}#x`,
    'https://user@laipeng101.github.io/pmbus-calculator/',
    'https://laipeng101.github.io.evil.example/pmbus-calculator/',
    'https://laipeng101.github.io/other/../pmbus-calculator/',
  ])('rejects a noncanonical deployment URL without echoing it', (deploymentUrl) => {
    expect(() => parseInputs({ DEPLOYMENT_URL: deploymentUrl }, '3.3.1')).toThrow(
      'CONFIGURATION_ERROR',
    )
  })

  it.each([
    'ERR_BLOCKED_BY_CLIENT',
    'ERR_BLOCKED_BY_ADMINISTRATOR',
    'ERR_PROXY_CONNECTION_FAILED',
    'ERR_TUNNEL_CONNECTION_FAILED',
    'ERR_NAME_NOT_RESOLVED',
    'ERR_NAME_RESOLUTION_FAILED',
  ])('classifies %s as ENVIRONMENT_BLOCKED, never PASS or an application defect', (code) => {
    const result = classifyNetworkFailure(`net::${code}`)
    expect(result.classification).toBe('ENVIRONMENT_BLOCKED')
    expect(result.retryable).toBe(false)
  })

  it('does not treat TLS or a transient network error as success', () => {
    expect(classifyNetworkFailure('net::ERR_CERT_AUTHORITY_INVALID').classification).toBe(
      'TLS_ERROR',
    )
    expect(classifyNetworkFailure('net::ERR_CONNECTION_RESET').retryable).toBe(true)
  })

  it.each([
    ['blocked by CORS policy', 'CORS_ERROR'],
    ['Access-Control-Allow-Origin mismatch', 'CORS_ERROR'],
    ['site hostname mismatch', 'HOSTNAME_MISMATCH'],
    ['Content Security Policy script-src', 'CSP_ERROR'],
  ])('makes configuration diagnosis %s non-retryable', (text, classification) => {
    const result = classifyConsole(text)
    expect(result?.classification).toBe(classification)
    expect(result?.retryable).toBe(false)
  })

  it('CLI rejects arbitrary inputs without launching a browser or leaking their text', () => {
    const sensitive = 'private-' + 'a'.repeat(32)
    const result = spawnSync(
      process.execPath,
      [path.resolve('scripts/verify-live-analytics.mjs'), sensitive],
      {
        encoding: 'utf8',
        timeout: 5_000,
        env: { ...process.env, DEPLOYMENT_URL: `https://example.test/?${sensitive}` },
      },
    )
    expect(result.status).toBe(1)
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      classification: 'CONFIGURATION_ERROR',
      attemptCount: 0,
    })
    expect(result.stdout + result.stderr).not.toContain(sensitive)
    expect(result.stdout + result.stderr).not.toContain('Pages deployed')
  })
})

describe('production page facts without client token output', () => {
  function fixture() {
    document.head.innerHTML = `<meta http-equiv="Content-Security-Policy" content="${csp}">
      <script type="module" src="./assets/app.js"></script>
      <link rel="stylesheet" href="./assets/app.css"><link rel="stylesheet" href="./pages-overlay.css">`
    document.body.innerHTML = `<div id="root"><span data-testid="version-badge">App v3.3.1</span></div>
      <a data-pages-only="repository-link" href="${PAGES_REPOSITORY_URL}" aria-label="${PAGES_REPOSITORY_NAME}" target="_blank" rel="noopener noreferrer"></a>
      <script type="module" src="${CLOUDFLARE_BEACON_URL}" data-cf-beacon='{"token":"${'a'.repeat(32)}"}'></script>`
  }

  it('checks the actual parsed DOM and returns only non-token facts', () => {
    fixture()
    const result = readLiveDom(browserArguments)
    expect(result).toEqual(facts)
    expect(JSON.stringify(result)).not.toContain('a'.repeat(32))
    expect(() => validateLiveDom(result, inputs.expectedTag)).not.toThrow()
  })

  it.each([
    ['version', '3.3.0', 'VERSION_MISMATCH'],
    ['csp', 'script-src https:', 'CSP_ERROR'],
    ['cspPlacement', false, 'CSP_ERROR'],
    ['beaconValid', false, 'PAGE_CONTRACT_ERROR'],
    ['repositoryValid', false, 'PAGE_CONTRACT_ERROR'],
    ['overlayCssPresent', false, 'PAGE_CONTRACT_ERROR'],
    ['assetsSameOrigin', false, 'UNEXPECTED_EXTERNAL_REQUEST'],
  ])('rejects bad %s before accepting Analytics', (key, value, classification) => {
    expect(() => validateLiveDom({ ...facts, [String(key)]: value }, inputs.expectedTag)).toThrow(
      String(classification),
    )
  })

  it.each([
    ['App v3.3.1', '3.3.1'],
    ['  App v3.3.1  ', '3.3.1'],
  ])('parses the supported version badge %j', (text, expected) => {
    document.body.innerHTML = `<span data-testid="version-badge">${text}</span>`
    expect(readLiveDom(browserArguments).version).toBe(expected)
  })

  it.each([
    'v3.3.1',
    'App 3.3.1',
    'App v3.3.1 v3.3.0',
    'App v3.3.1 (build v9.9.9)',
    'App vX.Y.Z',
    'App v3.3',
    '',
  ])('fails closed on a missing, malformed or ambiguous badge %j', (text) => {
    document.body.innerHTML = text === '' ? '' : `<span data-testid="version-badge">${text}</span>`
    const result = readLiveDom(browserArguments)
    expect(result.version).toBe('')
    expect(() => validateLiveDom(result, inputs.expectedTag)).toThrow('VERSION_MISMATCH')
  })

  it('fails closed when the badge is missing or duplicated', () => {
    document.body.innerHTML = ''
    expect(() => validateLiveDom(readLiveDom(browserArguments), inputs.expectedTag)).toThrow(
      'VERSION_MISMATCH',
    )
    document.body.innerHTML = `<span data-testid="version-badge">App v3.3.1</span>
      <span data-testid="version-badge">App v3.3.1</span>`
    expect(() => validateLiveDom(readLiveDom(browserArguments), inputs.expectedTag)).toThrow(
      'VERSION_MISMATCH',
    )
  })

  it('rejects a different deployed version with the supported badge shape', () => {
    document.body.innerHTML = `<span data-testid="version-badge">App v3.3.0</span>`
    expect(() => validateLiveDom(readLiveDom(browserArguments), inputs.expectedTag)).toThrow(
      'VERSION_MISMATCH',
    )
  })

  it('rejects duplicate or misplaced CSP and an altered repository link', () => {
    fixture()
    document.body.append(document.querySelector('meta')!)
    document.querySelector('a')!.setAttribute('rel', 'opener')
    expect(readLiveDom(browserArguments)).toMatchObject({
      cspPlacement: false,
      repositoryValid: false,
    })
  })

  it('rejects extra beacon options, duplicate modules and unknown external resources', () => {
    fixture()
    document
      .querySelector('[data-cf-beacon]')!
      .setAttribute('data-cf-beacon', JSON.stringify({ token: 'a'.repeat(32), extra: true }))
    const extra = document.createElement('script')
    extra.src = 'https://unknown.example/script.js'
    document.body.append(extra)
    expect(readLiveDom(browserArguments)).toMatchObject({
      beaconValid: false,
      assetsSameOrigin: false,
    })
  })
})

describe('real browser observation contract (offline events)', () => {
  it('requires both successful responses AND completion, not just 2xx headers', () => {
    const h = harness()
    h.complete(h.beacon, 200)
    h.initiate()
    h.context.emit('request', h.rum)
    h.respond(h.rum, 204)
    expect(h.observer.ready()).toBe(false)
    h.context.emit('requestfinished', h.rum)
    expect(h.observer.ready()).toBe(true)
    expect(h.observer.summary()).toEqual({
      beacon: { status: 200, completed: true },
      rum: { status: 204, completed: true },
      cors: 'pass',
      unexpectedExternalOrigin: 'pass',
      pageErrors: 'pass',
    })
  })

  it('never accepts a CORS failure after apparently successful response headers', () => {
    const h = harness()
    h.success()
    h.context.emit('requestfailed', h.rum)
    h.page.emit('console', {
      type: () => 'error',
      text: () => 'blocked by CORS policy with secret-' + 'a'.repeat(32),
    })
    expect(h.observer.ready()).toBe(false)
    expect(h.observer.failure()?.classification).toBe('CORS_ERROR')
    expect(h.observer.summary().cors).toBe('fail')
    expect(JSON.stringify(h.observer.summary())).not.toContain('a'.repeat(32))
  })

  it.each([
    ['beacon', 404, false],
    ['beacon', 503, true],
    ['rum', 429, true],
    ['rum', 400, false],
    ['rum', 302, false],
  ])('fails %s HTTP %i with bounded retry eligibility %s', (kind, status, retryable) => {
    const h = harness()
    h.complete(kind === 'beacon' ? h.beacon : h.rum, Number(status))
    expect(h.observer.failure()).toMatchObject({
      classification: 'THIRD_PARTY_HTTP_ERROR',
      retryable,
    })
    expect(h.observer.ready()).toBe(false)
  })

  it('preserves transient HTTP retry eligibility when Chromium also emits its resource diagnostic', () => {
    const h = harness()
    h.complete(h.beacon, 503)
    h.page.emit('console', {
      type: () => 'error',
      text: () => 'Failed to load resource: the server responded with a status of 503 ()',
    })
    expect(h.observer.failure()).toMatchObject({
      classification: 'THIRD_PARTY_HTTP_ERROR',
      retryable: true,
    })
    expect(h.observer.ready()).toBe(false)
  })

  it.each([
    [`${CLOUDFLARE_BEACON_URL}?extra=1`, 'script', 'GET'],
    ['https://static.cloudflareinsights.com.evil.example/beacon.min.js', 'script', 'GET'],
    [`${CLOUDFLARE_RUM_URL}/extra`, 'fetch', 'POST'],
    [CLOUDFLARE_RUM_URL, 'script', 'POST'],
    [CLOUDFLARE_RUM_URL, 'fetch', 'GET'],
    ['https://unknown.example/resource', 'font', 'GET'],
  ])('rejects every unaudited request even if it never responds: %s', (url, type, method) => {
    const h = harness()
    h.success()
    h.context.emit('request', request(url, type, method))
    expect(h.observer.ready()).toBe(false)
    expect(h.observer.failure()?.classification).toBe('UNEXPECTED_EXTERNAL_REQUEST')
  })

  it('requires a beacon initiator, not a manually submitted successful POST', () => {
    const h = harness()
    h.complete(h.beacon, 200)
    h.initiate({
      type: 'script',
      stack: { callFrames: [{ url: `${DEPLOYMENT_URL}assets/app.js` }] },
    })
    h.complete(h.rum, 204)
    expect(h.observer.failure()?.classification).toBe('RUM_INITIATOR_MISMATCH')
    expect(h.observer.ready()).toBe(false)
    expect(
      isBeaconInitiator({
        type: 'script',
        stack: { callFrames: [], parent: beaconInitiator.stack },
      }),
    ).toBe(true)
  })

  it('fails missing beacon, missing RUM, page errors and duplicate beacon requests', () => {
    const h = harness()
    expect(h.observer.missing()).toBe('BEACON_GET_MISSING')
    h.complete(h.beacon, 200)
    expect(h.observer.missing()).toBe('RUM_POST_MISSING')
    h.page.emit('pageerror', new Error('sensitive browser diagnostic'))
    expect(h.observer.failure()?.classification).toBe('PAGE_ERROR')
    const duplicate = harness()
    duplicate.complete(duplicate.beacon, 200)
    duplicate.context.emit('request', request(CLOUDFLARE_BEACON_URL, 'script'))
    expect(duplicate.observer.failure()?.classification).toBe('PAGE_CONTRACT_ERROR')
  })
})

describe('bounded independent attempts', () => {
  const browser = () => ({ close: vi.fn(async () => {}) }) as unknown as Browser
  const failure = (classification = 'NETWORK_ERROR', retryable = true) => ({
    ok: false,
    classification,
    retryable,
    elapsedMs: 1,
  })

  it('makes at most three independent attempts with short bounded backoff', async () => {
    const instance = browser()
    const attempt = vi.fn(async () => failure())
    const pause = vi.fn(async () => {})
    const result = await verifyLiveAnalytics(inputs, {
      browserType: { launch: async () => instance },
      attempt,
      pause,
    })
    expect(result).toMatchObject({ ok: false, classification: 'NETWORK_ERROR', attemptCount: 3 })
    expect(attempt).toHaveBeenCalledTimes(3)
    expect(pause.mock.calls).toEqual([[500], [1_000]])
    expect(instance.close).toHaveBeenCalledOnce()
  })

  it.each([
    'ENVIRONMENT_BLOCKED',
    'CSP_ERROR',
    'CORS_ERROR',
    'HOSTNAME_MISMATCH',
    'UNEXPECTED_EXTERNAL_REQUEST',
    'VERSION_MISMATCH',
  ])('never retries or accepts %s', async (classification) => {
    const attempt = vi.fn(async () => failure(classification, false))
    const result = await verifyLiveAnalytics(inputs, {
      browserType: { launch: async () => browser() },
      attempt,
    })
    expect(result).toMatchObject({ ok: false, classification, attemptCount: 1 })
    expect(attempt).toHaveBeenCalledOnce()
  })

  it('stops on the first passing attempt after a transient failure', async () => {
    const attempt = vi
      .fn()
      .mockResolvedValueOnce(failure())
      .mockResolvedValueOnce({ ok: true, classification: 'PASS', retryable: false })
    const result = await verifyLiveAnalytics(inputs, {
      browserType: { launch: async () => browser() },
      attempt,
      pause: async () => {},
    })
    expect(result).toMatchObject({ ok: true, attemptCount: 2 })
  })

  it('never allows launch or cleanup to hold the gate past its budget', async () => {
    vi.useFakeTimers()
    const never = () => new Promise<never>(() => {})
    const launch = verifyLiveAnalytics(inputs, { browserType: { launch: never } })
    await vi.advanceTimersByTimeAsync(4_001)
    expect(await launch).toMatchObject({ ok: false, classification: 'BROWSER_ERROR' })
    const cleanup = verifyLiveAnalytics(inputs, {
      browserType: { launch: async () => ({ close: never }) as unknown as Browser },
      attempt: async () => ({ ok: true, classification: 'PASS' }),
    })
    await vi.advanceTimersByTimeAsync(CLEANUP_BUDGET_MS + 1)
    expect(await cleanup).toMatchObject({ ok: false, classification: 'BROWSER_CLEANUP_ERROR' })
    expect(WATCHDOG_MS).toBeLessThan(TOTAL_BUDGET_MS)
    expect(WORK_BUDGET_MS + 2 * CLEANUP_BUDGET_MS).toBeLessThanOrEqual(WATCHDOG_MS)
    expect(TOTAL_BUDGET_MS).toBeLessThanOrEqual(45_000)
    expect(MAX_ATTEMPTS).toBe(3)
    expect(MAX_ATTEMPTS * ATTEMPT_BUDGET_MS + BACKOFF_MS.reduce((a, b) => a + b, 0)).toBeLessThan(
      WORK_BUDGET_MS,
    )
  })

  it('bounds an unresolved operation and preserves a fixed error classification', async () => {
    vi.useFakeTimers()
    const result = within(new Promise(() => {}), 10).catch((error) => error)
    await vi.advanceTimersByTimeAsync(11)
    expect(await result).toBeInstanceOf(AnalyticsError)
    expect(await result).toMatchObject({ classification: 'NETWORK_TIMEOUT' })
  })

  it('enforces the shared total deadline even when an attempt never settles', async () => {
    vi.useFakeTimers()
    const result = verifyLiveAnalytics(inputs, {
      browserType: { launch: async () => browser() },
      attempt: () => new Promise<never>(() => {}),
    })
    await vi.advanceTimersByTimeAsync(WORK_BUDGET_MS + CLEANUP_BUDGET_MS + 1)
    expect(await result).toMatchObject({
      ok: false,
      classification: 'TOTAL_BUDGET_EXHAUSTED',
      attemptCount: 0,
    })
  })

  it('uses fresh contexts, accepts natural RUM, and fails missing RUM without manufacturing navigation', async () => {
    const contexts: EventEmitter[] = []
    const navigations: string[] = []
    let createRum = true
    const instance = {
      newContext: vi.fn(async () => {
        const context = new EventEmitter()
        const page = Object.assign(new EventEmitter(), {
          url: () => DEPLOYMENT_URL,
          evaluate: async () => facts,
          getByTestId: () => ({ waitFor: async () => {} }),
          getByRole: () => ({ isVisible: async () => true }),
          goto: async (url: string) => {
            navigations.push(url)
            const beacon = request(CLOUDFLARE_BEACON_URL, 'script')
            const rum = request(CLOUDFLARE_RUM_URL, 'fetch', 'POST')
            for (const req of createRum ? [beacon, rum] : [beacon]) {
              if (req === rum)
                session.emit('Network.requestWillBeSent', {
                  request: { url: CLOUDFLARE_RUM_URL, method: 'POST' },
                  initiator: beaconInitiator,
                })
              context.emit('request', req)
              context.emit('response', { request: () => req, status: () => 200 })
              context.emit('requestfinished', req)
            }
            return { status: () => 200 }
          },
        })
        const session = Object.assign(new EventEmitter(), { send: async () => {} })
        const fake = Object.assign(context, {
          newPage: async () => page,
          newCDPSession: async () => session,
          close: vi.fn(async () => {}),
        })
        contexts.push(fake)
        return fake
      }),
    }
    for (let index = 0; index < 2; index++) {
      const result = await attemptAcceptance(
        instance as unknown as Browser,
        inputs,
        performance.now() + 2_000,
      )
      expect(result).toMatchObject({ ok: true, classification: 'PASS' })
    }
    createRum = false
    // Cross the former 4s unload-trigger threshold without a real-time delay.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
    const missing = attemptAcceptance(
      instance as unknown as Browser,
      inputs,
      performance.now() + 4_500,
    )
    await vi.advanceTimersByTimeAsync(4_501)
    expect(await missing).toMatchObject({ ok: false, classification: 'RUM_POST_MISSING' })
    expect(contexts).toHaveLength(3)
    expect(contexts[0]).not.toBe(contexts[1])
    expect(navigations).toEqual([DEPLOYMENT_URL, DEPLOYMENT_URL, DEPLOYMENT_URL])
    for (const context of contexts) expect(Reflect.get(context, 'close')).toHaveBeenCalledOnce()
  })
})
