import { expect, type Locator, type Page } from '@playwright/test'

export async function expectNoHorizontalOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    )
    .toBeLessThanOrEqual(0)
}

export async function expectTextInside(locator: Locator, container: Locator = locator) {
  await expect(locator).toBeVisible()
  const bounds = await container.boundingBox()
  if (bounds === null) throw new Error('Missing text container')

  const text = await locator.evaluate((element) => {
    const range = document.createRange()
    range.selectNodeContents(element)
    return Array.from(range.getClientRects(), ({ left, right, top, bottom }) => ({
      left,
      right,
      top,
      bottom,
    })).filter(({ left, right, top, bottom }) => right > left && bottom > top)
  })

  expect(text.length).toBeGreaterThan(0)
  for (const { left, right, top, bottom } of text) {
    expect(left).toBeGreaterThanOrEqual(bounds.x - 1)
    expect(right).toBeLessThanOrEqual(bounds.x + bounds.width + 1)
    expect(top).toBeGreaterThanOrEqual(bounds.y - 1)
    expect(bottom).toBeLessThanOrEqual(bounds.y + bounds.height + 1)
  }
  return text
}

export async function expectWrappedInContainer(locator: Locator) {
  // 这里检查纯文本提示。同一行混排不同字号时，矩形顶部并不代表行数。
  const text = await expectTextInside(locator)
  const lines = new Set(text.map(({ top }) => top))
  expect(lines.size).toBeGreaterThan(1)
}
