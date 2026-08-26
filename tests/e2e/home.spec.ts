import { test, expect } from '@playwright/test'

test.describe('首页可见性', () => {
  test('页面标题正确', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveTitle(/PMBus/)
  })

  test('核心组件在桌面端可见', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'PMBus' })).toBeVisible()
    await expect(page.getByLabel('模式切换')).toBeVisible()
    await expect(page.getByLabel('命令参考')).toBeVisible()
    await expect(page.getByLabel('结果面板')).toBeVisible()
  })

  test('移动端无横向滚动', async ({ page }) => {
    await page.goto('/')
    await page.setViewportSize({ width: 390, height: 844 })
    const body = page.locator('body')
    const scrollWidth = await body.evaluate((el) => el.scrollWidth)
    const clientWidth = await body.evaluate((el) => el.clientWidth)
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth)
  })

  test('调试面板可展开', async ({ page }) => {
    await page.goto('/')
    const toggle = page.getByLabel('展开调试面板')
    await expect(toggle).toBeVisible()
    await toggle.scrollIntoViewIfNeeded()
    await toggle.evaluate((el: HTMLButtonElement) => el.click())
    await expect(page.getByText(/质量门禁/)).toBeVisible()
  })
})

test.describe('响应式 viewport 轻量检查', () => {
  const widths = [1440, 1024, 768, 430, 390, 360]

  for (const width of widths) {
    test(`${width}px: 无水平溢出且主要控件可达`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await page.goto('/')

      const body = page.locator('body')
      const scrollWidth = await body.evaluate((el) => el.scrollWidth)
      const clientWidth = await body.evaluate((el) => el.clientWidth)
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth)

      await expect(page.locator('input[placeholder="0000"]')).toBeVisible()
      await expect(page.getByRole('tab', { name: /LINEAR11/ })).toBeVisible()
      await expect(page.locator('#command-reference-toggle')).toBeVisible()

      const copyHex = page.getByRole('button', { name: 'Hex（LE）' })
      await copyHex.scrollIntoViewIfNeeded()
      await expect(copyHex).toBeVisible()
    })
  }
})
