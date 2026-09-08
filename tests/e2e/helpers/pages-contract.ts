import { expect, type Page, type Request } from '@playwright/test'
import {
  CLOUDFLARE_BEACON_URL,
  CLOUDFLARE_RUM_URL,
  PAGES_CSP,
  PAGES_REPOSITORY_NAME,
  PAGES_REPOSITORY_URL,
  isAllowedPagesRequest,
  parseCsp,
} from './pages-network-policy'

export async function stubCloudflare(page: Page): Promise<void> {
  // Only the two audited destinations are stubbed. An unexpected destination
  // still reaches the request observer and fails the origin contract.
  await page.route(CLOUDFLARE_BEACON_URL, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      headers: { 'access-control-allow-origin': '*' },
      body: 'export {}\n',
    })
  })
  await page.route(CLOUDFLARE_RUM_URL, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/plain',
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'POST',
      },
      body: '',
    })
  })
}

export function observePagesResources(page: Page, deploymentUrl: string) {
  const pageErrors: string[] = []
  const failedAssets: string[] = []
  const unexpectedExternalOrigins: string[] = []
  const observedRequests: Array<{ url: string; type: string }> = []
  const successfulAssets: Array<{ url: string; type: string }> = []

  function checkOrigin(request: Request) {
    if (
      !isAllowedPagesRequest(request.url(), request.resourceType(), request.method(), deploymentUrl)
    ) {
      unexpectedExternalOrigins.push(`${request.resourceType()} ${request.url()}`)
    }
  }

  page.on('pageerror', (error) => pageErrors.push(error.message))
  // Requests include failures and each redirect hop; response-only auditing
  // misses a forbidden third party that is blocked or never responds.
  page.on('request', (request) => {
    checkOrigin(request)
    observedRequests.push({ url: request.url(), type: request.resourceType() })
  })
  page.on('requestfailed', (request) => {
    failedAssets.push(`${request.resourceType()} ${request.url()}`)
  })
  page.on('response', (response) => {
    const request = response.request()
    checkOrigin(request)
    if (response.status() >= 400 && response.status() < 600) {
      failedAssets.push(`${response.status()} ${request.method()} ${response.url()}`)
    }
    if (response.status() >= 200 && response.status() < 400) {
      successfulAssets.push({ url: response.url(), type: request.resourceType() })
    }
  })

  return {
    pageErrors,
    failedAssets,
    unexpectedExternalOrigins,
    observedRequests,
    successfulAssets,
  }
}

export async function expectProductionCsp(
  page: Page,
  expected: Record<string, string[]>,
): Promise<void> {
  const csp = page.locator('meta[http-equiv="Content-Security-Policy" i]')
  await expect(csp).toHaveCount(1)
  // Check the browser's parsed tree, independently of the staging HTML
  // parser. Non-ASCII whitespace before <head> can move an apparently valid
  // CSP meta into body, where browsers ignore the policy altogether.
  const placement = await csp.evaluate((meta) => ({
    directChildOfHead: meta.parentElement === document.head,
    beforeResources: [...document.querySelectorAll('script, link')].every(
      (resource) =>
        (meta.compareDocumentPosition(resource) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
    ),
  }))
  expect(placement.directChildOfHead, 'CSP meta must be a direct child of HEAD').toBe(true)
  expect(placement.beforeResources, 'CSP meta must precede every script and link').toBe(true)
  expect(parseCsp((await csp.getAttribute('content')) ?? '')).toEqual(expected)
}

export async function expectPagesDomContract(page: Page): Promise<void> {
  await expectProductionCsp(page, PAGES_CSP)

  const beacon = page.locator('script[data-cf-beacon]')
  await expect(beacon).toHaveCount(1)
  await expect(page.locator(`script[src="${CLOUDFLARE_BEACON_URL}"]`)).toHaveCount(1)
  // Never place the client token in assertion diagnostics. The independent
  // staging verifier owns equality with the Environment Secret; the browser
  // independently checks that the parsed configuration contains only token.
  const beaconContract = await beacon.evaluate((element) => {
    const attributes = {
      type: element.getAttribute('type'),
      src: element.getAttribute('src'),
      integrity: element.hasAttribute('integrity'),
    }
    try {
      const data = JSON.parse(element.getAttribute('data-cf-beacon') ?? '') as unknown
      const validData =
        data !== null &&
        typeof data === 'object' &&
        Object.keys(data).length === 1 &&
        'token' in data &&
        typeof data.token === 'string' &&
        data.token.length === 32 &&
        /^[a-f0-9]{32}$/i.test(data.token)
      return { ...attributes, validData }
    } catch {
      return { ...attributes, validData: false }
    }
  })
  expect(beaconContract).toEqual({
    type: 'module',
    src: CLOUDFLARE_BEACON_URL,
    integrity: false,
    validData: true,
  })

  const repository = page.getByRole('link', { name: PAGES_REPOSITORY_NAME, exact: true })
  await expect(page.locator('[data-pages-only="repository-link"]')).toHaveCount(1)
  await expect(repository).toBeVisible()
  await expect(repository).toHaveAttribute('data-pages-only', 'repository-link')
  await expect(repository).toHaveAttribute('href', PAGES_REPOSITORY_URL)
  await expect(repository).toHaveAttribute('target', '_blank')
  await expect(repository).toHaveAttribute('rel', 'noopener noreferrer')
  expect((await repository.textContent())?.trim()).toBe('')
  await expect(repository.locator('svg')).toHaveCount(1)
  await expect(repository.locator('svg')).toHaveAttribute('aria-hidden', 'true')
  expect(
    await repository
      .locator('svg')
      .evaluate((svg) =>
        [svg.getAttribute('fill'), svg.getAttribute('stroke')].includes('currentColor'),
      ),
  ).toBe(true)
  await expect(repository.locator('svg image, svg use')).toHaveCount(0)
  await expect(page.locator('#root [data-pages-only]')).toHaveCount(0)

  const overlayCss = page.locator('link[rel="stylesheet"][href="./pages-overlay.css"]')
  await expect(overlayCss).toHaveCount(1)
  const pages = new URL(page.url())
  const runtimeSources = await page
    .locator('script[src], link[rel="stylesheet"][href], link[rel="modulepreload"][href], img[src]')
    .evaluateAll((elements) =>
      elements.map((element) => ({
        tag: element.tagName,
        url: new URL(
          element.getAttribute('src') ?? element.getAttribute('href') ?? '',
          document.baseURI,
        ).href,
      })),
    )
  expect(runtimeSources.length).toBeGreaterThan(2)
  for (const source of runtimeSources) {
    if (source.tag === 'SCRIPT' && source.url === CLOUDFLARE_BEACON_URL) continue
    expect(new URL(source.url).origin).toBe(pages.origin)
  }
}

export async function expectPagesResources(
  page: Page,
  deploymentUrl: string,
  observed: ReturnType<typeof observePagesResources>,
): Promise<void> {
  await expect(page.locator('.katex').first()).toBeVisible()
  await expect(page.locator('.katex-error')).toHaveCount(0)
  await expect(page.locator('.katex math').first()).toBeAttached()
  await page.evaluate(async () => document.fonts.ready)
  expect(
    await page
      .locator('.katex')
      .first()
      .evaluate((el) => getComputedStyle(el).fontFamily),
  ).toContain('KaTeX_Main')

  const pages = new URL(deploymentUrl)
  const basePath = `${pages.pathname.replace(/\/$/, '')}/`
  const applicationAssets = observed.successfulAssets.filter(
    ({ url }) => new URL(url).origin === pages.origin,
  )
  for (const type of ['script', 'stylesheet', 'font']) {
    expect(
      applicationAssets.some((asset) => asset.type === type),
      `${type} loads same-origin`,
    ).toBe(true)
  }
  expect(
    applicationAssets.some(
      ({ url, type }) =>
        type === 'stylesheet' && new URL(url).pathname === `${basePath}pages-overlay.css`,
    ),
    'Pages overlay stylesheet loads from the deployment prefix',
  ).toBe(true)
  for (const asset of applicationAssets) {
    expect(new URL(asset.url).pathname.startsWith(basePath)).toBe(true)
  }
  expect(observed.observedRequests.filter(({ url }) => url === CLOUDFLARE_BEACON_URL)).toHaveLength(
    1,
  )
  for (const font of observed.observedRequests.filter(({ type }) => type === 'font')) {
    expect(new URL(font.url).origin).toBe(pages.origin)
  }
  expect(observed.pageErrors).toEqual([])
  expect(observed.failedAssets).toEqual([])
  expect(observed.unexpectedExternalOrigins).toEqual([])
}
