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
    await expect(page.getByLabel('PMBus 命令')).toBeVisible()
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
    await toggle.click()
    await expect(page.getByText('测试回归通过：51 / 51')).toBeVisible()
  })
})
