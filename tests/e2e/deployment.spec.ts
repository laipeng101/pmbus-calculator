import { test, expect } from '@playwright/test'

const deploymentUrl = process.env.DEPLOYMENT_URL

test.skip(!deploymentUrl, 'DEPLOYMENT_URL is required for remote deployment smoke')

const requiredResourceTypes = new Set([
  'document',
  'script',
  'stylesheet',
  'font',
  'image',
  'fetch',
])

test.describe('GitHub Pages production deployment', () => {
  test('HTTPS page loads with title and core controls', async ({ page }) => {
    const response = await page.goto(deploymentUrl!)
    expect(response.status()).toBe(200)
    expect(page.url().startsWith('https://')).toBeTruthy()

    await expect(page).toHaveTitle(/PMBus/)
    await expect(page.getByRole('heading', { name: 'PMBus' })).toBeVisible()
    await expect(page.getByLabel('模式切换')).toBeVisible()
    await expect(page.getByLabel('PMBus 命令')).toBeVisible()
    await expect(page.getByLabel('结果面板')).toBeVisible()

    const csp = page.locator('meta[http-equiv="Content-Security-Policy"]')
    await expect(csp).toHaveCount(1)
    await expect(csp).toHaveAttribute('content', /default-src 'self'/)
  })

  test('no page errors and every resource loads from the Pages origin', async ({ page }) => {
    const pageErrors: string[] = []
    const failedAssets: string[] = []
    const offOriginResources: string[] = []
    const observedResources: string[] = []
    const observedFonts: string[] = []

    page.on('pageerror', (error) => {
      pageErrors.push(error.message)
    })

    page.on('response', (response) => {
      const type = response.request().resourceType()
      if (!requiredResourceTypes.has(type)) {
        return
      }
      const url = response.url()
      observedResources.push(url)
      if (response.status() >= 400 && response.status() < 600) {
        failedAssets.push(`${response.status()} ${response.request().method()} ${url}`)
      }
      if (new URL(url).origin !== new URL(deploymentUrl!).origin) {
        offOriginResources.push(url)
      }
      if (type === 'font') {
        observedFonts.push(url)
      }
    })

    await page.goto(deploymentUrl!)
    await expect(page.getByLabel('结果面板')).toBeVisible()

    await expect(page.locator('.katex').first()).toBeVisible()
    await expect(page.locator('.katex-error')).toHaveCount(0)
    await expect(page.locator('.katex math').first()).toBeAttached()

    await page.evaluate(async () => {
      await document.fonts.ready
    })

    const katexFontFamily = await page
      .locator('.katex')
      .first()
      .evaluate((el) => getComputedStyle(el).fontFamily)
    expect(katexFontFamily).toContain('KaTeX_Main')
    expect(observedFonts.length).toBeGreaterThan(0)

    expect(pageErrors).toEqual([])
    expect(failedAssets).toEqual([])
    expect(offOriginResources).toEqual([])
    expect(observedResources.length).toBeGreaterThanOrEqual(3)

    const pagesUrl = new URL(deploymentUrl!)
    const basePath = pagesUrl.pathname.replace(/\/$/, '')
    for (const url of observedResources) {
      const parsed = new URL(url)
      expect(parsed.origin).toBe(pagesUrl.origin)
      expect(parsed.pathname).toMatch(new RegExp(`^${basePath}/`))
    }
  })

  test('390px viewport has no horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(deploymentUrl!)

    const body = page.locator('body')
    const scrollWidth = await body.evaluate((el) => el.scrollWidth)
    const clientWidth = await body.evaluate((el) => el.clientWidth)
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth)
  })

  test('L11 closed loop: hex input decodes and value input encodes back', async ({ page }) => {
    await page.goto(deploymentUrl!)
    const hexInput = page.locator('input[placeholder="0x0000"]')
    const valueInput = page.locator('#value-input')

    await hexInput.fill('F819')
    await hexInput.press('Tab')
    await expect(valueInput).toHaveValue('12.5')
    await expect(hexInput).toHaveValue('0xF819')

    await valueInput.fill('12.5')
    await expect(hexInput).toHaveValue('0xF819')
  })
})
