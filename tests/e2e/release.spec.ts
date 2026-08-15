import { test, expect } from '@playwright/test'

test.describe('production build smoke', () => {
  test('生产构建加载正常：标题、核心控件、CSP 与静态资源', async ({ page }) => {
    const pageErrors: string[] = []
    const failedAssets: string[] = []

    page.on('pageerror', (error) => {
      pageErrors.push(error.message)
    })

    page.on('response', (response) => {
      const type = response.request().resourceType()
      const status = response.status()
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

    expect(pageErrors).toEqual([])
    expect(failedAssets).toEqual([])
  })
})
