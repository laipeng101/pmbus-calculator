import { test, expect, type Page } from '@playwright/test'
import { expectTextInside } from './helpers/layout'

async function assertGutters(page: Page) {
  const title = page.getByRole('heading', { name: 'PMBus' })
  const header = page.locator('header').first()
  const trigger = page.locator('#command-reference-toggle')

  const triggerContainer = trigger.locator('..')
  const workspace = page.locator('.workspace-layout')
  const primary = page.locator('.primary-panel')

  const titleBox = await title.boundingBox()
  const headerBox = await header.boundingBox()
  const triggerBox = await trigger.boundingBox()
  const triggerContainerBox = await triggerContainer.boundingBox()
  const workspaceBox = await workspace.boundingBox()
  const primaryBox = await primary.boundingBox()
  if (
    titleBox == null ||
    headerBox == null ||
    triggerBox == null ||
    triggerContainerBox == null ||
    workspaceBox == null ||
    primaryBox == null
  ) {
    throw new Error('missing bounding boxes')
  }

  expect(Math.abs(titleBox.x - triggerBox.x)).toBeLessThanOrEqual(1)
  expect(Math.abs(titleBox.x - primaryBox.x)).toBeLessThanOrEqual(1)

  const headerRight = headerBox.x + headerBox.width
  const triggerContainerRight = triggerContainerBox.x + triggerContainerBox.width
  const workspaceRight = workspaceBox.x + workspaceBox.width
  expect(Math.abs(headerRight - triggerContainerRight)).toBeLessThanOrEqual(1)
  expect(Math.abs(headerRight - workspaceRight)).toBeLessThanOrEqual(1)
}

test.describe('页面边距与复制工具栏', () => {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1280, height: 900 },
    { width: 1036, height: 1025 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
  ]) {
    test(`${viewport.width} px 下页头、命令参考和输入区边缘对齐`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await page.goto('./')
      await assertGutters(page)
    })
  }

  test('复制按钮标签完整显示，桌面分为三列与两列', async ({ page }) => {
    await page.goto('./')

    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 })
      await page.evaluate(() => document.fonts.ready)
      const tops: number[] = []
      for (const label of ['Raw Word Hex', 'Wire 字节', 'MSB-first 字节', '物理值', 'C 代码']) {
        const button = page.getByRole('button', { name: label, exact: true })
        const text = await expectTextInside(button.getByText(label, { exact: true }), button)
        expect(new Set(text.map(({ top }) => top)).size, label).toBe(1)
        const box = await button.boundingBox()
        if (box == null) throw new Error(`Missing copy button geometry: ${label}`)
        tops.push(box.y)
      }

      if (width === 1280) {
        const [raw, wire, msb, physical, macro] = tops
        expect(Math.abs(raw - wire)).toBeLessThanOrEqual(1)
        expect(Math.abs(raw - msb)).toBeLessThanOrEqual(1)
        expect(Math.abs(physical - macro)).toBeLessThanOrEqual(1)
        expect(physical).toBeGreaterThan(raw)
      }
    }
  })
})
