import { expect, type Page, type Request } from '@playwright/test'

const applicationAssetMimes = new Map([
  [
    'script',
    ['text/javascript', 'application/javascript', 'text/ecmascript', 'application/ecmascript'],
  ],
  ['stylesheet', ['text/css']],
  [
    'font',
    ['font/woff', 'font/woff2', 'font/ttf', 'application/font-woff', 'application/font-sfnt'],
  ],
])

export function isApplicationAsset(type: string): boolean {
  return applicationAssetMimes.has(type)
}

export function observeBrowserResources(
  page: Page,
  isAllowedRequest: (request: Request) => boolean,
) {
  const pageErrors: string[] = []
  const failedAssets: string[] = []
  const unexpectedRequests: string[] = []
  const requestedUrls: string[] = []
  const successfulAssets: Array<{ url: string; type: string; status: number; mime: string }> = []

  page.on('pageerror', (error) => pageErrors.push(error.message))
  // A request event also records failed requests and every redirect hop.
  page.on('request', (request) => {
    if (!isAllowedRequest(request)) {
      unexpectedRequests.push(`${request.resourceType()} ${request.url()}`)
    }
    requestedUrls.push(request.url())
  })
  page.on('requestfailed', (request) => {
    failedAssets.push(`${request.resourceType()} ${request.url()}`)
  })
  page.on('response', (response) => {
    const request = response.request()
    const status = response.status()
    if (status >= 400) {
      failedAssets.push(`${status} ${request.method()} ${response.url()}`)
    }
    if (response.ok()) {
      successfulAssets.push({
        url: response.url(),
        type: request.resourceType(),
        status,
        mime: response.headers()['content-type'] ?? '',
      })
    }
  })

  return { pageErrors, failedAssets, unexpectedRequests, requestedUrls, successfulAssets }
}

export type BrowserResources = ReturnType<typeof observeBrowserResources>

export function expectNoResourceErrors(observed: BrowserResources): void {
  expect(observed.pageErrors).toEqual([])
  expect(observed.failedAssets).toEqual([])
  expect(observed.unexpectedRequests).toEqual([])
}

export async function expectApplicationAssets(
  page: Page,
  origin: string,
  observed: BrowserResources,
) {
  const formula = page.locator('.katex').first()
  await expect(formula).toBeVisible()
  await expect(formula.locator('math')).toBeAttached()
  await expect(page.locator('.katex-error')).toHaveCount(0)
  await page.evaluate(async () => document.fonts.ready)
  expect(await formula.evaluate((element) => getComputedStyle(element).fontFamily)).toContain(
    'KaTeX_Main',
  )

  const sameOriginAssets = observed.successfulAssets.filter(
    ({ url }) => new URL(url).origin === origin,
  )
  for (const [type, allowedMimes] of applicationAssetMimes) {
    const assets = sameOriginAssets.filter((asset) => asset.type === type)
    expect(assets.length, `${type} loads same-origin`).toBeGreaterThan(0)
    for (const { url, status, mime } of assets) {
      expect(status, url).toBe(200)
      expect(allowedMimes, `${url} returned Content-Type: ${mime}`).toContain(
        mime.split(';', 1)[0].trim().toLowerCase(),
      )
    }
  }
  return sameOriginAssets
}
