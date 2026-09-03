import { test, expect } from '@playwright/test'
import { appUrl } from './helpers/app-url'

test.describe('首页可见性', () => {
  test('页面标题正确', async ({ page }) => {
    await page.goto(appUrl())
    await expect(page).toHaveTitle(/PMBus/)
  })

  test('核心组件在桌面端可见', async ({ page }) => {
    await page.goto(appUrl())
    await expect(page.getByRole('heading', { name: 'PMBus' })).toBeVisible()
    await expect(page.getByLabel('模式切换')).toBeVisible()
    await expect(page.getByLabel('命令参考')).toBeVisible()
    await expect(page.getByLabel('结果面板')).toBeVisible()
  })

  test('移动端无横向滚动', async ({ page }) => {
    await page.goto(appUrl())
    await page.setViewportSize({ width: 390, height: 844 })
    const body = page.locator('body')
    const scrollWidth = await body.evaluate((el) => el.scrollWidth)
    const clientWidth = await body.evaluate((el) => el.clientWidth)
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth)
  })

  // 调试面板合同：DebugDrawer 仅在 dev 构建或显式 ?debug 时渲染
  //（src/components/debug/DebugDrawer.tsx）。canonical 入口是显式 ?debug；
  // 普通 URL 的默认行为按目标构建判别：dev 自动渲染是开发契约，
  // production 默认关闭是产品契约。两种目标都必须通过本测试。
  test('?debug 显式入口可展开调试面板', async ({ page }) => {
    await page.goto(appUrl('/', 'debug'))
    const toggle = page.getByLabel('展开调试面板')
    await expect(toggle).toBeVisible()
    await toggle.scrollIntoViewIfNeeded()
    await toggle.click()
    await expect(page.getByText(/质量门禁/)).toBeVisible()
  })

  test('普通 URL 的调试面板可见性符合目标构建契约', async ({ page }) => {
    await page.goto(appUrl())
    // dev server 注入 /@vite/client；production dist 没有。用它判别目标构建。
    const isDevServer = await page.evaluate(() =>
      [...document.querySelectorAll('script')].some((script) => script.src.includes('/@vite/')),
    )
    const toggle = page.getByLabel('展开调试面板')
    if (isDevServer) {
      await expect(toggle).toBeVisible()
    } else {
      await expect(toggle).toHaveCount(0)
    }

    // ?debug 查询参数在两种目标下都显式启用。
    await page.goto(appUrl('/', 'debug'))
    await expect(page.getByLabel('展开调试面板')).toBeVisible()
  })
})

test.describe('响应式 viewport 轻量检查', () => {
  const widths = [1440, 1024, 768, 430, 390, 360]

  for (const width of widths) {
    test(`${width}px: 无水平溢出且主要控件可达`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await page.goto(appUrl())

      const body = page.locator('body')
      const scrollWidth = await body.evaluate((el) => el.scrollWidth)
      const clientWidth = await body.evaluate((el) => el.clientWidth)
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth)

      await expect(page.locator('input[placeholder="0000"]')).toBeVisible()
      await expect(page.getByRole('tab', { name: /LINEAR11/ })).toBeVisible()
      await expect(page.locator('#command-reference-toggle')).toBeVisible()

      const copyRaw = page.getByRole('button', { name: 'Raw Word Hex' })
      await copyRaw.scrollIntoViewIfNeeded()
      await expect(copyRaw).toBeVisible()
    })
  }
})
