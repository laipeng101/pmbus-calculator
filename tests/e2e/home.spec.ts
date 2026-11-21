import { test, expect } from '@playwright/test'
import { appUrl } from './helpers/app-url'

test.describe('响应式 viewport 轻量检查', () => {
  const widths = [1440, 1024, 768, 430, 390, 360]

  for (const width of widths) {
    test(`${width}px: 无水平溢出且主要控件可达`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
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
