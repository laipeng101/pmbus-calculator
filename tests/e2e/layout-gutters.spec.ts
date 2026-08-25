import { test, expect, type Page } from '@playwright/test'

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

test.describe('gutter alignment', () => {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1280, height: 900 },
    { width: 1036, height: 1025 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
  ]) {
    test(`${viewport.width}px gutter aligns header, command reference and primary panel`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport)
      await page.goto('/')
      await assertGutters(page)
    })
  }

  test('copy toolbar buttons do not wrap at 1280 and 390', async ({ page }) => {
    for (const viewport of [
      { width: 1280, height: 900 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport)
      await page.goto('/')
      const buttons = page.getByRole('button', { name: /Hex|LE 字节|BE 字节|物理值|C 代码/ })
      const count = await buttons.count()
      expect(count).toBeGreaterThanOrEqual(5)
      for (let i = 0; i < count; i++) {
        const button = buttons.nth(i)
        const fits = await button.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)
        expect(fits).toBe(true)
      }
    }
  })

  test('copy toolbar uses balanced 6-column rows', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    const first = page.getByRole('button', { name: 'Hex（LE）' })
    const le = page.getByRole('button', { name: 'LE 字节' })
    const be = page.getByRole('button', { name: 'BE 字节' })
    const value = page.getByRole('button', { name: '物理值' })
    const c = page.getByRole('button', { name: 'C 代码' })

    const boxes = {
      first: await first.boundingBox(),
      le: await le.boundingBox(),
      be: await be.boundingBox(),
      value: await value.boundingBox(),
      c: await c.boundingBox(),
    }
    for (const [name, box] of Object.entries(boxes)) {
      if (box == null) throw new Error(`${name} missing box`)
    }
    expect(Math.abs((boxes.first as DOMRect).y - (boxes.le as DOMRect).y)).toBeLessThanOrEqual(1)
    expect(Math.abs((boxes.first as DOMRect).y - (boxes.be as DOMRect).y)).toBeLessThanOrEqual(1)
    expect(Math.abs((boxes.value as DOMRect).y - (boxes.c as DOMRect).y)).toBeLessThanOrEqual(1)
    expect((boxes.value as DOMRect).y).toBeGreaterThan((boxes.first as DOMRect).y)
  })
})
