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
  test(`${width}×900：Raw、默认展开的位映射和物理值完整位于首屏`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto(appUrl())
    await page.evaluate(() => document.fonts.ready)
    for (const mode of ['LINEAR11', 'LINEAR16', 'DIRECT', 'HALF']) {
      await page.getByRole('tab', { name: new RegExp(mode) }).click()
      await page.evaluate(() => window.scrollTo(0, 0))
      await expectInsideViewport(page.locator('#raw-hex-input'), page)
      await expectInsideViewport(
        page.getByRole('group', { name: '16 位编辑器', exact: true }),
        page,
      )
      await expectInsideViewport(page.locator('#value-input'), page)
      if (mode === 'DIRECT') {
        for (const name of ['m', 'b', 'r']) {
          await expectInsideViewport(page.locator(`#direct-coeff-${name}-input`), page)
        }
      } else if (mode === 'LINEAR16') {
        await expectInsideViewport(page.locator('#l16-payload-kind'), page)
        await expect(page.locator('#l16-n-input')).toBeVisible()
      }
    }
  })
}

for (const width of [360, 390]) {
  test(`${width}px：位映射紧邻 Raw，收起后相对 L16 参考值可达且无横向溢出`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await page.goto(appUrl())
    for (const mode of ['LINEAR11', 'LINEAR16', 'DIRECT', 'HALF']) {
      await page.getByRole('tab', { name: new RegExp(mode) }).click()
      const value = page.locator('#value-input')
      const bitGrid = page.getByRole('group', { name: '16 位编辑器', exact: true })
      const boxes = await Promise.all([value.boundingBox(), bitGrid.boundingBox()])
      expect(boxes[1]!.y + boxes[1]!.height).toBeLessThanOrEqual(boxes[0]!.y)
      await page.evaluate(() => window.scrollTo(0, 0))
      await expectInsideViewport(page.locator('#raw-hex-input'), page)
      await expectInsideViewport(page.getByTestId('bit-mapping-raw-word-toggle'), page)
      expect(await page.evaluate(() => document.body.scrollWidth <= innerWidth)).toBe(true)
    }
    await page.getByRole('tab', { name: /LINEAR16/ }).click()
    await page.getByTestId('bit-mapping-raw-word-toggle').click()
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

for (const width of [360, 390, 960]) {
  test(`${width}px：DIRECT 系数标签换行和报错时三列输入保持对齐`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto(appUrl())
    await page.getByRole('tab', { name: /DIRECT/ }).click()
    await page.evaluate(() => document.fonts.ready)
    const fields = ['m', 'b', 'r'].map((name) => page.locator(`#direct-coeff-${name}-input`))
    const expectAligned = async () => {
      const boxes = await Promise.all(fields.map((field) => field.boundingBox()))
      const tops = boxes.map((box) => box!.y)
      expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(1)
    }
    await expectAligned()

    await fields[0].fill('32768')
    await fields[0].press('Tab')
    await expect(fields[0]).toHaveAttribute('aria-invalid', 'true')
    await expectAligned()
    await expect(page.locator('#raw-hex-input')).toHaveValue('0000')

    await page.locator('label[for="direct-coeff-r-input"]').click()
    await expect(fields[2]).toBeFocused()
    await expect(fields[0]).toHaveAttribute('aria-invalid', 'true')
  })
}
