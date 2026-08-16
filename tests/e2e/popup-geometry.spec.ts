import { test, expect, type Page } from '@playwright/test'

const VIEWPORT_PADDING = 8

async function popupGeometry(page: Page) {
  const trigger = page.locator('#command-picker')
  await trigger.click()
  const listbox = page.locator('#command-picker-listbox')
  await expect(listbox).toBeVisible()
  const popup = listbox.locator('xpath=ancestor::div[contains(@class,"popover-enter")]')
  const search = page.getByPlaceholder('搜索命令...')
  await expect(search).toBeVisible()

  const triggerBox = await trigger.boundingBox()
  const popupBox = await popup.boundingBox()
  const searchBox = await search.boundingBox()
  const viewport = page.viewportSize()
  if (triggerBox == null || popupBox == null || searchBox == null || viewport == null) {
    throw new Error('missing bounding boxes')
  }

  const popupLeft = popupBox.x
  const popupTop = popupBox.y
  const popupRight = popupBox.x + popupBox.width
  const popupBottom = popupBox.y + popupBox.height
  expect(popupLeft).toBeGreaterThanOrEqual(VIEWPORT_PADDING - 0.5)
  expect(popupTop).toBeGreaterThanOrEqual(VIEWPORT_PADDING - 0.5)
  expect(popupRight).toBeLessThanOrEqual(viewport.width - VIEWPORT_PADDING + 0.5)
  expect(popupBottom).toBeLessThanOrEqual(viewport.height - VIEWPORT_PADDING + 0.5)

  const searchLeft = searchBox.x
  const searchTop = searchBox.y
  const searchRight = searchBox.x + searchBox.width
  const searchBottom = searchBox.y + searchBox.height
  expect(searchLeft).toBeGreaterThanOrEqual(popupLeft - 0.5)
  expect(searchRight).toBeLessThanOrEqual(popupRight + 0.5)
  expect(searchTop).toBeGreaterThanOrEqual(popupTop - 0.5)
  expect(searchBottom).toBeLessThanOrEqual(popupBottom + 0.5)

  expect(Math.abs(popupBox.width - triggerBox.width)).toBeLessThanOrEqual(2)

  const body = page.locator('body')
  const scrollWidth = await body.evaluate((el) => el.scrollWidth)
  const clientWidth = await body.evaluate((el) => el.clientWidth)
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth)

  return { trigger, popup, search, listbox, triggerBox, popupBox }
}

test.describe('命令下拉框 viewport-aware 几何', () => {
  const viewports = [
    { width: 1440, height: 900 },
    { width: 1036, height: 1025 },
    { width: 950, height: 304 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
    { width: 360, height: 800 },
  ]

  for (const viewport of viewports) {
    test(`${viewport.width}x${viewport.height} popup 完整位于 viewport 内`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await page.goto('/')
      const { popup, listbox } = await popupGeometry(page)

      const overflowY = await popup.evaluate((el) => getComputedStyle(el).overflowY)
      expect(overflowY).toBe('hidden')

      const listOverflowY = await listbox.evaluate((el) => getComputedStyle(el).overflowY)
      expect(listOverflowY).toBe('auto')

      if (viewport.height <= 500) {
        const listScrollable = await listbox.evaluate((el) => el.scrollHeight > el.clientHeight)
        expect(listScrollable).toBe(true)
      }
    })
  }

  test('底部空间不足时自动翻到上方', async ({ page }) => {
    await page.setViewportSize({ width: 950, height: 304 })
    await page.goto('/')
    const trigger = page.locator('#command-picker')
    await trigger.click()
    const listbox = page.locator('#command-picker-listbox')
    await expect(listbox).toBeVisible()
    const popup = listbox.locator('xpath=ancestor::div[contains(@class,"popover-enter")]')
    const triggerBox = await trigger.boundingBox()
    const popupBox = await popup.boundingBox()
    if (triggerBox == null || popupBox == null) throw new Error('missing boxes')
    const popupBottom = popupBox.y + popupBox.height
    expect(popupBottom).toBeLessThanOrEqual(triggerBox.y + 1)
  })

  test('页面滚动后打开仍贴合 trigger', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 })
    await page.goto('/')
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    const trigger = page.locator('#command-picker')
    await trigger.scrollIntoViewIfNeeded()
    await page.waitForTimeout(100)
    await trigger.click()
    const listbox = page.locator('#command-picker-listbox')
    await expect(listbox).toBeVisible()
    const triggerBox = await trigger.boundingBox()
    const popupBox = await listbox
      .locator('xpath=ancestor::div[contains(@class,"popover-enter")]')
      .boundingBox()
    if (triggerBox == null || popupBox == null) throw new Error('missing boxes')
    expect(Math.abs(popupBox.width - triggerBox.width)).toBeLessThanOrEqual(2)
  })

  test('popup 打开时 resize 后仍完整可见', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 })
    await page.goto('/')
    await page.locator('#command-picker').click()
    await expect(page.locator('#command-picker-listbox')).toBeVisible()
    await page.setViewportSize({ width: 360, height: 304 })
    await page.waitForTimeout(150)
    const listbox = page.locator('#command-picker-listbox')
    const popup = listbox.locator('xpath=ancestor::div[contains(@class,"popover-enter")]')
    const popupBox = await popup.boundingBox()
    const viewport = page.viewportSize()
    if (popupBox == null || viewport == null) throw new Error('missing boxes')
    expect(popupBox.x).toBeGreaterThanOrEqual(VIEWPORT_PADDING - 0.5)
    expect(popupBox.y).toBeGreaterThanOrEqual(VIEWPORT_PADDING - 0.5)
    expect(popupBox.x + popupBox.width).toBeLessThanOrEqual(viewport.width - VIEWPORT_PADDING + 0.5)
    expect(popupBox.y + popupBox.height).toBeLessThanOrEqual(
      viewport.height - VIEWPORT_PADDING + 0.5,
    )
  })

  test('键盘选择最后一个 option 时页面不跳动', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 })
    await page.goto('/')
    const trigger = page.locator('#command-picker')
    await trigger.click()
    const search = page.getByPlaceholder('搜索命令...')
    await expect(search).toBeVisible()
    const scrollYBefore = await page.evaluate(() => window.scrollY)
    for (let i = 0; i < 20; i++) {
      await search.press('ArrowDown')
    }
    const scrollYAfter = await page.evaluate(() => window.scrollY)
    expect(scrollYAfter).toBe(scrollYBefore)
  })
})
