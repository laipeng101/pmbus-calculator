import { test, expect } from '@playwright/test'

test.describe('production build smoke', () => {
  test('生产构建加载正常：标题、核心控件、CSP 与静态资源', async ({ page }) => {
    const pageErrors: string[] = []
    const failedAssets: string[] = []
    const fontResponses: string[] = []

    page.on('pageerror', (error) => {
      pageErrors.push(error.message)
    })

    page.on('response', (response) => {
      const type = response.request().resourceType()
      const status = response.status()
      if (type === 'font' && status >= 200 && status < 400) {
        fontResponses.push(response.url())
      }
      if (
        status >= 400 &&
        status < 600 &&
        ['document', 'script', 'stylesheet', 'font', 'image', 'media', 'xhr', 'fetch'].includes(
          type,
        )
      ) {
        failedAssets.push(`${status} ${response.request().method()} ${response.url()}`)
      }
    })

    await page.goto('/')

    await expect(page).toHaveTitle(/PMBus/)
    await expect(page.getByRole('heading', { name: 'PMBus' })).toBeVisible()
    await expect(page.getByLabel('模式切换')).toBeVisible()
    await expect(page.getByLabel('PMBus 命令')).toBeVisible()
    await expect(page.getByLabel('结果面板')).toBeVisible()

    const csp = page.locator('meta[http-equiv="Content-Security-Policy"]')
    await expect(csp).toHaveCount(1)
    await expect(csp).toHaveAttribute('content', /default-src 'self'/)

    await expect(page.locator('.katex').first()).toBeVisible()
    await expect(page.locator('.katex-error')).toHaveCount(0)
    await expect(page.locator('.katex math').first()).toBeAttached()

    const katexFontFamily = await page
      .locator('.katex')
      .first()
      .evaluate((el) => getComputedStyle(el).fontFamily)
    expect(katexFontFamily).toContain('KaTeX_Main')

    const previewOrigin = new URL(page.url()).origin
    expect(fontResponses.length).toBeGreaterThan(0)
    for (const fontUrl of fontResponses) {
      expect(new URL(fontUrl).origin).toBe(previewOrigin)
    }

    expect(pageErrors).toEqual([])
    expect(failedAssets).toEqual([])
  })
})
