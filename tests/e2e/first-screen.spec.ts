import { expect, test, type Locator, type Page } from '@playwright/test'
import { appUrl } from './helpers/app-url'

async function expectInsideViewport(locator: Locator, page: Page) {
  const box = await locator.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height)
}

test('首次键盘操作在 6 次 Tab 内到达 Raw，主输入保持 focus-visible', async ({ page }) => {
  await page.goto(appUrl())
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab')
    if (await page.locator('#raw-hex-input').evaluate((el) => el === document.activeElement)) break
  }
  await expect(page.locator('#raw-hex-input')).toBeFocused()
  expect(await page.locator('#raw-hex-input').evaluate((el) => el.matches(':focus-visible'))).toBe(
    true,
  )
})

for (const width of [1280, 1440]) {
  test(`${width}×900：Raw、物理值和必要数值参数完整位于首屏`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto(appUrl())
    await page.evaluate(() => document.fonts.ready)
    for (const mode of ['LINEAR11', 'LINEAR16', 'DIRECT', 'HALF']) {
      await page.getByRole('tab', { name: new RegExp(mode) }).click()
      await page.evaluate(() => window.scrollTo(0, 0))
      await expectInsideViewport(page.locator('#raw-hex-input'), page)
      await expectInsideViewport(page.locator('#value-input'), page)
      if (mode === 'DIRECT') {
        for (const name of ['m', 'b', 'r']) {
          await expectInsideViewport(page.locator(`#direct-coeff-${name}-input`), page)
        }
      } else if (mode === 'LINEAR16') {
        await expectInsideViewport(page.locator('#l16-payload-kind'), page)
        await expectInsideViewport(page.locator('#l16-n-input'), page)
      }
    }
  })
}

for (const width of [360, 390]) {
  test(`${width}px：主要输入先于位网格，相对 L16 参考值可达且无横向溢出`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await page.goto(appUrl())
    for (const mode of ['LINEAR11', 'LINEAR16', 'DIRECT', 'HALF']) {
      await page.getByRole('tab', { name: new RegExp(mode) }).click()
      const value = page.locator('#value-input')
      const bitGrid = page.getByRole('group', { name: '16 位编辑器', exact: true })
      const boxes = await Promise.all([value.boundingBox(), bitGrid.boundingBox()])
      expect(boxes[0]!.y + boxes[0]!.height).toBeLessThanOrEqual(boxes[1]!.y)
      await page.evaluate(() => window.scrollTo(0, 0))
      await expectInsideViewport(page.locator('#raw-hex-input'), page)
      expect(await page.evaluate(() => document.body.scrollWidth <= innerWidth)).toBe(true)
    }
    await page.getByRole('tab', { name: /LINEAR16/ }).click()
    await page.getByRole('radio', { name: '相对值', exact: true }).click()
    await page.evaluate(() => window.scrollTo(0, 0))
    await expectInsideViewport(page.locator('#l16-nominal-vout'), page)
    await expect(page.getByTestId('result-context')).toContainText('待填标称参考值')
  })
}

test('结果旁的 raw、参数来源与状态跟随配置变化，不借用 LINEAR 默认解释', async ({ page }) => {
  await page.goto(appUrl())
  const context = page.getByTestId('result-context')
  await page.locator('#value-input').fill('12.5')
  await expect(context).toContainText('0xF819')
  await expect(context).toContainText('N = -1')
  await page.getByRole('tab', { name: /DIRECT/ }).click()
  await page.locator('#direct-coeff-r-input').fill('12')
  await page.locator('#direct-coeff-r-input').press('Tab')
  await expect(context).toContainText('R = 12')
  await expect(context).toContainText('器件数据手册')
  await page.getByRole('tab', { name: /LINEAR16/ }).click()
  await page.locator('#vout-mode-input').fill('20')
  await page.locator('#vout-mode-input').press('Tab')
  await expect(context).toContainText('0x20')
  await expect(context).toContainText('未按 LINEAR16 解释')
  await expect(context).not.toContainText('N =')
  await page.getByRole('tab', { name: /VOUT_MODE/ }).click()
  await page.locator('#vout-mode-input').fill('18')
  await page.locator('#vout-mode-input').press('Tab')
  await expect(context).toContainText('N = -8')
})
