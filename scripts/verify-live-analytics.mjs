#!/usr/bin/env node
/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
// Explicit post-deploy entry, never a Playwright-discovered spec. Observe the
// published page's real network; do not fetch a beacon or submit a RUM ourselves.
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'
import {
  CLOUDFLARE_BEACON_URL,
  CLOUDFLARE_RUM_URL,
  PAGES_CSP,
  PAGES_REPOSITORY_NAME,
  PAGES_REPOSITORY_URL,
  isAllowedPagesRequest,
  parseCsp,
} from './pages-network-policy.mjs'

export const DEPLOYMENT_URL = 'https://laipeng101.github.io/pmbus-calculator/'
export const TOTAL_BUDGET_MS = 45_000
// Leave a margin for process startup and forced exit, and reserve cleanup time.
export const WATCHDOG_MS = 44_000
export const WORK_BUDGET_MS = 42_000
export const ATTEMPT_BUDGET_MS = 11_000
export const CLEANUP_BUDGET_MS = 1_000
export const MAX_ATTEMPTS = 3
export const BACKOFF_MS = [500, 1_000]

/** @typedef {{deploymentUrl: string, expectedTag: string}} Inputs */
/** @typedef {{callFrames?: Array<{url: string}>, parent?: InitiatorStack}} InitiatorStack */
/** @typedef {{type: string, stack?: InitiatorStack}} Initiator */
/** @typedef {Pick<import('@playwright/test').Request, 'url' | 'resourceType' | 'method' | 'failure'>} RequestLike */
/** @typedef {{category: string, status: number | null, finished: boolean}} RequestEntry */
// Playwright's three emitters have different event-name overloads. This small
// subscription adapter erases only those overloads; request data is typed below.
/** @typedef {{on: (event: any, listener: (...args: any[]) => void) => unknown,
 * off: (event: any, listener: (...args: any[]) => void) => unknown}} EventSource */
/** @typedef {{ok: boolean, classification: string, retryable?: boolean, elapsedMs?: number}} AttemptResult */
/** @typedef {{browserType?: Pick<import('@playwright/test').BrowserType, 'launch'>,
 * attempt?: (browser: import('@playwright/test').Browser, inputs: Inputs, deadline: number) => Promise<AttemptResult>,
 * pause?: (ms: number) => Promise<unknown>}} Dependencies */

export class AnalyticsError extends Error {
  /** @param {string} classification @param {boolean} [retryable] */
  constructor(classification, retryable = false) {
    // Only internally chosen classifications enter diagnostics, never a URL,
    // browser exception, console message, HTML, header or request body.
    super(classification)
    this.classification = classification
    this.retryable = retryable
  }
}

/** @param {NodeJS.ProcessEnv} env @param {string} version @param {string[]} [argv] */
export function parseInputs(env, version, argv = []) {
  const tag = `v${version}`
  if (
    argv.length !== 0 ||
    env.DEPLOYMENT_URL !== DEPLOYMENT_URL ||
    !/^v[1-9][0-9]*\.[0-9]+\.[0-9]+$/.test(tag) ||
    (env.EXPECTED_RELEASE_TAG !== undefined && env.EXPECTED_RELEASE_TAG !== tag)
  ) {
    throw new AnalyticsError('CONFIGURATION_ERROR')
  }
  return { deploymentUrl: DEPLOYMENT_URL, expectedTag: tag }
}

/** Interpret text in memory only. Callers must never log the original text.
 * @param {string} text */
export function classifyNetworkFailure(text) {
  if (
    /ERR_(?:BLOCKED_BY_CLIENT|BLOCKED_BY_ADMINISTRATOR|PROXY_CONNECTION_FAILED|TUNNEL_CONNECTION_FAILED|NO_SUPPORTED_PROXIES|NAME_NOT_RESOLVED|NAME_RESOLUTION_FAILED)/i.test(
      text,
    )
  ) {
    return new AnalyticsError('ENVIRONMENT_BLOCKED')
  }
  if (/ERR_CERT_|ERR_SSL_/i.test(text)) return new AnalyticsError('TLS_ERROR')
  return new AnalyticsError('NETWORK_ERROR', true)
}

/** @param {string} text */
export function classifyConsole(text) {
  if (/content.security.policy|\bCSP\b/i.test(text)) return new AnalyticsError('CSP_ERROR')
  if (/\bCORS\b|access-control-allow-origin|cross-origin.*(?:blocked|denied)/i.test(text)) {
    return new AnalyticsError('CORS_ERROR')
  }
  if (/hostname.*(?:mismatch|invalid|match)|(?:invalid|mismatch).*hostname/i.test(text)) {
    return new AnalyticsError('HOSTNAME_MISMATCH')
  }
  if (/ERR_/i.test(text)) return classifyNetworkFailure(text)
  // Chromium also emits this console diagnostic for an HTTP response already
  // handled by the network observer. Do not turn a retryable 503 into a fatal
  // generic console error; the response/missing-request gates still fail closed.
  if (/Failed to load resource: the server responded with a status of [45][0-9]{2}\b/i.test(text)) {
    return null
  }
  return new AnalyticsError('CONSOLE_ERROR')
}

/** Executed in the browser. Return facts without exporting the client token.
 * @param {{beaconUrl: string, repositoryUrl: string, repositoryName: string}} options */
export function readLiveDom({ beaconUrl, repositoryUrl, repositoryName }) {
  const metas = [...document.querySelectorAll('meta[http-equiv="Content-Security-Policy" i]')]
  const meta = metas[0]
  const beacons = [...document.querySelectorAll('script[data-cf-beacon]')]
  const beacon = beacons[0]
  let beaconDataValid = false
  try {
    const data = JSON.parse(beacon?.getAttribute('data-cf-beacon') ?? '')
    beaconDataValid =
      data !== null &&
      typeof data === 'object' &&
      Object.keys(data).length === 1 &&
      typeof data.token === 'string' &&
      /^[a-f0-9]{32}$/i.test(data.token)
  } catch {
    /* Invalid configuration is reported without its contents. */
  }
  const links = [...document.querySelectorAll('[data-pages-only="repository-link"]')]
  const link = links[0]
  const sources = [
    ...document.querySelectorAll(
      'script[src], link[rel="stylesheet"][href], link[rel="modulepreload"][href], img[src]',
    ),
  ]
  return {
    version: document.querySelector('[data-testid="version-badge"]')?.textContent?.trim(),
    csp: meta?.getAttribute('content') ?? '',
    cspPlacement:
      metas.length === 1 &&
      meta.parentElement === document.head &&
      [...document.querySelectorAll('script, link')].every(
        (resource) =>
          (meta.compareDocumentPosition(resource) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
      ),
    beaconValid:
      beacons.length === 1 &&
      beaconDataValid &&
      beacon.getAttribute('src') === beaconUrl &&
      beacon.getAttribute('type') === 'module' &&
      !beacon.hasAttribute('integrity') &&
      beacon.parentElement === document.body &&
      document.querySelectorAll(`script[src="${beaconUrl}"]`).length === 1,
    repositoryValid:
      links.length === 1 &&
      link.tagName === 'A' &&
      link.parentElement === document.body &&
      link.getAttribute('href') === repositoryUrl &&
      link.getAttribute('aria-label') === repositoryName &&
      link.getAttribute('target') === '_blank' &&
      link.getAttribute('rel') === 'noopener noreferrer',
    assetsSameOrigin:
      sources.length > 2 &&
      sources.every((element) => {
        const url = new URL(
          element.getAttribute('src') ?? element.getAttribute('href') ?? '',
          document.baseURI,
        )
        return (
          (element.tagName === 'SCRIPT' && url.href === beaconUrl) || url.origin === location.origin
        )
      }),
    overlayCssPresent:
      document.querySelectorAll('link[rel="stylesheet"][href="./pages-overlay.css"]').length === 1,
  }
}

/** @param {ReturnType<typeof readLiveDom>} facts @param {string} expectedTag */
export function validateLiveDom(facts, expectedTag) {
  if (facts.version !== expectedTag) throw new AnalyticsError('VERSION_MISMATCH')
  let validCsp = false
  try {
    validCsp = isDeepStrictEqual(parseCsp(facts.csp), PAGES_CSP)
  } catch {
    /* Fail closed. */
  }
  if (!validCsp || !facts.cspPlacement) throw new AnalyticsError('CSP_ERROR')
  if (!facts.beaconValid || !facts.repositoryValid || !facts.overlayCssPresent) {
    throw new AnalyticsError('PAGE_CONTRACT_ERROR')
  }
  if (!facts.assetsSameOrigin) throw new AnalyticsError('UNEXPECTED_EXTERNAL_REQUEST')
}

/** Chromium's initiator stack ties the observed POST to the loaded beacon.
 * @param {Initiator | null | undefined} initiator */
export function isBeaconInitiator(initiator) {
  if (initiator?.type !== 'script') return false
  let stack = initiator.stack
  for (let depth = 0; stack && depth < 20; depth++, stack = stack.parent) {
    if (stack.callFrames?.some((frame) => frame.url === CLOUDFLARE_BEACON_URL)) return true
  }
  return false
}

/** Keep only request identities, endpoint categories and status/completion.
 * @param {EventSource} context
 * @param {EventSource} page
 * @param {EventSource} session
 * @param {string} deploymentUrl */
export function observeLiveNetwork(context, page, session, deploymentUrl) {
  /** @type {Array<() => unknown>} */
  const subscriptions = []
  /** @param {EventSource} source
   * @param {string} event @param {(...args: any[]) => void} handler */
  const listen = (source, event, handler) => {
    source.on(event, handler)
    subscriptions.push(() => source.off(event, handler))
  }
  /** @type {Map<RequestLike, RequestEntry>} */
  const requests = new Map()
  /** @type {RequestEntry[]} */
  const beacons = []
  /** @type {RequestEntry[]} */
  const rums = []
  /** @type {AnalyticsError | null} */
  let failure = null
  let initiatedByBeacon = false
  let cors = true
  let origins = true
  let pageErrors = false
  /** @param {AnalyticsError} error */
  const fail = (error) => {
    // A deterministic browser diagnosis takes precedence over a transport error.
    if (!failure || (failure.retryable && !error.retryable)) failure = error
  }
  /** @param {string} url */
  const category = (url) =>
    url === CLOUDFLARE_BEACON_URL ? 'beacon' : url === CLOUDFLARE_RUM_URL ? 'rum' : 'application'
  listen(context, 'request', (request) => {
    if (
      !isAllowedPagesRequest(request.url(), request.resourceType(), request.method(), deploymentUrl)
    ) {
      origins = false
      fail(new AnalyticsError('UNEXPECTED_EXTERNAL_REQUEST'))
    }
    const kind = category(request.url())
    /** @type {RequestEntry} */
    const entry = { category: kind, status: null, finished: false }
    requests.set(request, entry)
    if (kind === 'beacon') beacons.push(entry)
    if (kind === 'rum') rums.push(entry)
    if (beacons.length > 1) fail(new AnalyticsError('PAGE_CONTRACT_ERROR'))
  })
  listen(
    context,
    'response',
    /** @param {import('@playwright/test').Response} response */ (response) => {
      const entry = requests.get(response.request())
      if (!entry) return fail(new AnalyticsError('NETWORK_OBSERVATION_ERROR'))
      entry.status = response.status()
      if (entry.status < 200 || entry.status >= 300) {
        const retryable =
          entry.category !== 'application' &&
          (entry.status === 408 || entry.status === 429 || entry.status >= 500)
        fail(
          new AnalyticsError(
            entry.category === 'application' ? 'APPLICATION_HTTP_ERROR' : 'THIRD_PARTY_HTTP_ERROR',
            retryable,
          ),
        )
      }
    },
  )
  listen(context, 'requestfinished', (request) => {
    const entry = requests.get(request)
    if (entry) entry.finished = true
  })
  listen(context, 'requestfailed', (request) =>
    fail(classifyNetworkFailure(request.failure()?.errorText ?? '')),
  )
  listen(page, 'console', (message) => {
    if (
      message.type() !== 'error' &&
      !/CORS|hostname.*mismatch|content.security.policy/i.test(message.text())
    )
      return
    const error = classifyConsole(message.text())
    if (!error) return
    if (error.classification === 'CORS_ERROR' || error.classification === 'HOSTNAME_MISMATCH')
      cors = false
    fail(error)
  })
  listen(page, 'pageerror', () => {
    pageErrors = true
    fail(new AnalyticsError('PAGE_ERROR'))
  })
  listen(page, 'websocket', () => {
    origins = false
    fail(new AnalyticsError('UNEXPECTED_EXTERNAL_REQUEST'))
  })
  listen(session, 'Network.requestWillBeSent', ({ request, initiator }) => {
    // Never retain/log the protocol event (it can carry headers/postData).
    if (request.url === CLOUDFLARE_RUM_URL && request.method === 'POST') {
      if (isBeaconInitiator(initiator)) initiatedByBeacon = true
      else fail(new AnalyticsError('RUM_INITIATOR_MISMATCH'))
    }
  })
  /** @param {RequestEntry} entry */
  const complete = (entry) =>
    entry.finished && entry.status !== null && entry.status >= 200 && entry.status < 300
  return {
    dispose: () => subscriptions.forEach((remove) => remove()),
    failure: () => failure,
    ready: () =>
      !failure &&
      beacons.length === 1 &&
      beacons.every(complete) &&
      rums.length > 0 &&
      rums.every(complete) &&
      initiatedByBeacon,
    hasRum: () => rums.length > 0,
    missing: () =>
      beacons.length === 0
        ? 'BEACON_GET_MISSING'
        : rums.length === 0
          ? 'RUM_POST_MISSING'
          : 'NETWORK_TIMEOUT',
    summary: () => ({
      beacon: {
        status: beacons[0]?.status ?? null,
        completed: beacons.length === 1 && beacons.every(complete),
      },
      rum: { status: rums[0]?.status ?? null, completed: rums.length > 0 && rums.every(complete) },
      cors: cors ? 'pass' : 'fail',
      unexpectedExternalOrigin: origins ? 'pass' : 'fail',
      pageErrors: pageErrors ? 'fail' : 'pass',
    }),
  }
}

/** Every browser operation, including cleanup, is bounded; the CLI additionally
 * has a final watchdog so a stuck close/launch cannot keep this step alive.
 * @template T
 * @param {Promise<T>} promise @param {number} milliseconds @param {string} [classification]
 * @returns {Promise<T>} */
export async function within(promise, milliseconds, classification = 'NETWORK_TIMEOUT') {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer
  try {
    return await Promise.race([
      promise,
      /** @type {Promise<never>} */ (
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new AnalyticsError(classification, classification === 'NETWORK_TIMEOUT')),
            Math.max(0, milliseconds),
          )
        })
      ),
    ])
  } finally {
    clearTimeout(timer)
  }
}

/** @param {import('@playwright/test').Browser} browser @param {Inputs} inputs @param {number} deadline */
export async function attemptAcceptance(browser, inputs, deadline) {
  const started = performance.now()
  let context
  let observed
  let summary
  /** @type {AnalyticsError | null} */
  let error = null
  const remaining = () => Math.max(0, deadline - performance.now())
  /** @template T @param {Promise<T>} promise */
  const bounded = (promise) => within(promise, remaining())
  try {
    context = await bounded(browser.newContext({ viewport: { width: 1440, height: 900 } }))
    const page = await bounded(context.newPage())
    const session = await bounded(context.newCDPSession(page))
    observed = observeLiveNetwork(context, page, session, inputs.deploymentUrl)
    await bounded(session.send('Network.enable'))
    const response = await bounded(
      page.goto(inputs.deploymentUrl, { waitUntil: 'load', timeout: remaining() }),
    )
    if (page.url() !== inputs.deploymentUrl) throw new AnalyticsError('DEPLOYMENT_URL_MISMATCH')
    if (response?.status() !== 200) throw new AnalyticsError('APPLICATION_HTTP_ERROR')
    await bounded(
      page.getByTestId('version-badge').waitFor({
        state: 'visible',
        timeout: Math.min(3_000, remaining()),
      }),
    )
    validateLiveDom(
      await bounded(
        page.evaluate(readLiveDom, {
          beaconUrl: CLOUDFLARE_BEACON_URL,
          repositoryUrl: PAGES_REPOSITORY_URL,
          repositoryName: PAGES_REPOSITORY_NAME,
        }),
      ),
      inputs.expectedTag,
    )
    if (
      !(await bounded(
        page.getByRole('link', { name: PAGES_REPOSITORY_NAME, exact: true }).isVisible(),
      ))
    ) {
      throw new AnalyticsError('PAGE_CONTRACT_ERROR')
    }
    while (remaining() > 0) {
      if (observed.failure()) {
        // Let a related CORS console diagnosis supersede a generic ERR_FAILED.
        await bounded(delay(100))
        throw observed.failure()
      }
      if (observed.ready()) {
        await bounded(delay(100))
        if (observed.ready()) break
      }
      // Observe the page's own load-time beacon through completion. Navigating
      // away to provoke an unload beacon can abort its in-flight response and
      // conceal a missing natural POST; neither is evidence of acceptance.
      await bounded(delay(50))
    }
    if (!observed.ready()) throw observed.failure() ?? new AnalyticsError(observed.missing(), true)
  } catch (cause) {
    error = cause instanceof AnalyticsError ? cause : classifyNetworkFailure(String(cause))
    if (error.classification === 'NETWORK_TIMEOUT' && observed) {
      error = observed.failure() ?? new AnalyticsError(observed.missing(), true)
    }
  } finally {
    // End the observation window before closing an accepted page: teardown can
    // itself send a page-hidden beacon, which is not an extra acceptance probe.
    if (observed) {
      error ??= observed.failure()
      summary = observed.summary()
      observed.dispose()
    }
    if (context) {
      try {
        await within(context.close(), CLEANUP_BUDGET_MS, 'BROWSER_CLEANUP_ERROR')
      } catch {
        error = new AnalyticsError('BROWSER_CLEANUP_ERROR')
      }
    }
  }
  return {
    ok: error === null,
    classification: error?.classification ?? 'PASS',
    retryable: error?.retryable ?? false,
    elapsedMs: Math.round(performance.now() - started),
    ...summary,
  }
}

/** Dependencies are injectable only for offline unit tests, never CLI inputs.
 * @param {Inputs} inputs @param {Dependencies} [dependencies] */
export async function verifyLiveAnalytics(inputs, dependencies = {}) {
  const started = performance.now()
  const deadline = started + WORK_BUDGET_MS
  const attempt = dependencies.attempt ?? attemptAcceptance
  const pause = dependencies.pause ?? delay
  const attempts = []
  let browser
  let classification = 'BROWSER_ERROR'
  try {
    const browserType = dependencies.browserType ?? (await import('@playwright/test')).chromium
    browser = await within(browserType.launch({ timeout: 4_000 }), 4_000, 'BROWSER_ERROR')
    for (let index = 0; index < MAX_ATTEMPTS && performance.now() < deadline; index++) {
      const result = await within(
        attempt(browser, inputs, Math.min(deadline, performance.now() + ATTEMPT_BUDGET_MS)),
        Math.max(0, deadline - performance.now()) + CLEANUP_BUDGET_MS,
        'TOTAL_BUDGET_EXHAUSTED',
      )
      attempts.push({ attempt: index + 1, ...result })
      classification = result.classification
      if (result.ok || !result.retryable || index === MAX_ATTEMPTS - 1) break
      await within(
        pause(BACKOFF_MS[index]),
        Math.max(0, deadline - performance.now()),
        'TOTAL_BUDGET_EXHAUSTED',
      )
    }
  } catch (cause) {
    classification = cause instanceof AnalyticsError ? cause.classification : 'BROWSER_ERROR'
  } finally {
    if (browser) {
      try {
        await within(browser.close(), CLEANUP_BUDGET_MS, 'BROWSER_CLEANUP_ERROR')
      } catch {
        classification = 'BROWSER_CLEANUP_ERROR'
      }
    }
  }
  return {
    ok: classification === 'PASS',
    classification,
    attemptCount: attempts.length,
    attempts,
    elapsedMs: Math.round(performance.now() - started),
  }
}

export async function runCli(argv = process.argv.slice(2), env = process.env) {
  const started = performance.now()
  const watchdog = setTimeout(() => {
    // No third-party data or exception text is ever written, even on timeout.
    fs.writeSync(
      1,
      `${JSON.stringify({ ok: false, classification: 'TOTAL_BUDGET_EXHAUSTED', elapsedMs: Math.round(performance.now() - started) })}\n`,
    )
    process.exit(1)
  }, WATCHDOG_MS)
  let result
  try {
    const { version } = JSON.parse(
      fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    )
    result = await verifyLiveAnalytics(parseInputs(env, version, argv))
  } catch {
    result = {
      ok: false,
      classification: 'CONFIGURATION_ERROR',
      attemptCount: 0,
      elapsedMs: Math.round(performance.now() - started),
    }
  }
  clearTimeout(watchdog)
  fs.writeSync(1, `${JSON.stringify(result)}\n`)
  // The probe itself cannot assert that a deployment happened (for example,
  // local ENVIRONMENT_BLOCKED or rejected inputs). The Pages job supplies that
  // post-deploy context; keep CLI diagnostics neutral and classification-only.
  return result.ok ? 0 : result.classification === 'ENVIRONMENT_BLOCKED' ? 3 : 1
}

if (
  process.argv[1] &&
  fs.existsSync(process.argv[1]) &&
  fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))
) {
  // A timed-out browser close may still own open pipe handles. Always finish
  // the CLI explicitly after synchronous, sanitized output (also on failure).
  process.exit(await runCli())
}
