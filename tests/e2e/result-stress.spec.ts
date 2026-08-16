import { test, expect, type Page } from '@playwright/test'

async function settle(page: Page) {
  await page.goto('/')
  await expect(page.locator('.katex').first()).toBeVisible()
  await page.evaluate(async () => {
    await document.fonts.ready
  })
  await page.waitForTimeout(80)
}

async function fillRaw(page: Page, hex: string) {
  const hexInput = page.locator('input[placeholder="0x0000"]')
  await hexInput.fill(hex)
  await hexInput.press('Tab')
}

async function switchMode(page: Page, name: RegExp) {
  await page.getByRole('tab', { name }).click()
  await expect(page.locator('.katex').first()).toBeVisible()
}

async function expectNoBodyOverflow(page: Page) {
  const result = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(result.scrollWidth).toBeLessThanOrEqual(result.clientWidth)
}

async function expectValueInsideTile(page: Page) {
  const tile = page.locator('[data-testid="result-tile"]')
  const value = page.locator('[data-testid="result-value"]')
  await expect(tile).toBeVisible()
  await expect(value).toBeVisible()

  const tileBox = await tile.boundingBox()
  const valueBox = await value.boundingBox()
  if (tileBox == null || valueBox == null) throw new Error('missing result bounding boxes')

  expect(valueBox.x).toBeGreaterThanOrEqual(tileBox.x - 0.5)
  expect(valueBox.x + valueBox.width).toBeLessThanOrEqual(tileBox.x + tileBox.width + 0.5)
  expect(valueBox.y).toBeGreaterThanOrEqual(tileBox.y - 0.5)
  expect(valueBox.y + valueBox.height).toBeLessThanOrEqual(tileBox.y + tileBox.height + 0.5)
}

test.describe('M16 result stress geometry', () => {
  test('four specified non-zero stress values decode correctly', async ({ page }) => {
    await settle(page)

    await fillRaw(page, 'A3C1')
    await expect(page.locator('#value-input')).toHaveValue('0.234619140625')
    await expect(page.locator('[data-testid="formula-line"]').first()).toContainText('961')

    await switchMode(page, /LINEAR16/)
    await page.getByLabel('VOUT_MODE').fill('13')
    await page.getByLabel('VOUT_MODE').press('Tab')
    await fillRaw(page, '8FC3')
    await expect(page.locator('#value-input')).toHaveValue('4.49255371094')

    await switchMode(page, /DIRECT/)
    await page.getByLabel('DIRECT 系数 r').fill('12')
    await page.getByLabel('DIRECT 系数 r').press('Tab')
    await fillRaw(page, '8FC3')
    await expect(page.locator('#value-input')).toHaveValue('-2.8733e-8')
    await expect(page.locator('[data-testid="formula-line"]').first()).toContainText('-28733')

    await switchMode(page, /HALF/)
    await fillRaw(page, '8FC3')
    await expect(page.locator('#value-input')).toHaveValue('-0.000473737716675')
    await expect(page.locator('[data-testid="formula-summary"]')).toHaveText(
      's = 1, E = 3, F = 963',
    )
    await expect(page.locator('[data-testid="formula-line"]').first()).not.toContainText(
      '-0.000473737716675',
    )
  })

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1280, height: 900 },
    { width: 390, height: 844 },
    { width: 360, height: 800 },
  ]) {
    test(`HALF long value stays inside tile at ${viewport.width}x${viewport.height}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport)
      await settle(page)
      await switchMode(page, /HALF/)
      await fillRaw(page, '8FC3')

      await expect(page.locator('#value-input')).toHaveValue('-0.000473737716675')
      await expectValueInsideTile(page)
      await expectNoBodyOverflow(page)
    })
  }

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1280, height: 900 },
    { width: 950, height: 304 },
    { width: 390, height: 844 },
    { width: 360, height: 800 },
  ]) {
    test(`stress viewport has no body overflow at ${viewport.width}x${viewport.height}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport)
      await settle(page)
      await switchMode(page, /HALF/)
      await fillRaw(page, '8FC3')
      await expectNoBodyOverflow(page)

      await switchMode(page, /DIRECT/)
      await page.getByLabel('DIRECT 系数 r').fill('12')
      await page.getByLabel('DIRECT 系数 r').press('Tab')
      await fillRaw(page, '8FC3')
      await expectNoBodyOverflow(page)
    })
  }

  test('desktop stress formulas do not require horizontal scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await settle(page)

    for (const mode of [/LINEAR11/, /LINEAR16/, /DIRECT/, /HALF/] as const) {
      await switchMode(page, mode)
      if (mode.source === 'LINEAR16') {
        await page.getByLabel('VOUT_MODE').fill('13')
        await page.getByLabel('VOUT_MODE').press('Tab')
      }
      if (mode.source === 'DIRECT') {
        await page.getByLabel('DIRECT 系数 r').fill('12')
        await page.getByLabel('DIRECT 系数 r').press('Tab')
      }
      await fillRaw(page, '8FC3')

      const formulaLine = page.locator('[data-testid="formula-line"]').first()
      await expect(formulaLine).toBeVisible()
      const overflow = await formulaLine.evaluate((el) => el.scrollWidth - el.clientWidth)
      expect(overflow).toBeLessThanOrEqual(1)
      await expectNoBodyOverflow(page)
    }
  })

  test('copy buttons stay single-line at 390px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await settle(page)

    const buttons = page.getByRole('button', {
      name: /Hex（LE）|LE 字节|BE 字节|物理值|C 代码/,
    })
    const count = await buttons.count()
    expect(count).toBeGreaterThanOrEqual(5)

    for (let i = 0; i < count; i++) {
      const button = buttons.nth(i)
      const box = await button.boundingBox()
      const scrollHeight = await button.evaluate((el) => el.scrollHeight)
      const clientHeight = await button.evaluate((el) => el.clientHeight)
      expect(scrollHeight).toBeLessThanOrEqual(clientHeight + 1)
      const text = await button.locator('span').textContent()
      expect(text?.trim().length).toBeGreaterThan(0)
      expect(box?.width).toBeGreaterThan(0)
    }
  })

  test('preference groups keep labels and controls in the same group', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await settle(page)

    const formatGroup = page.locator('[role="group"][aria-labelledby="copy-hex-format-label"]')
    await expect(formatGroup).toContainText('Hex 格式')
    await expect(formatGroup.getByRole('button', { name: '0x 前缀' })).toBeVisible()
    await expect(formatGroup.getByRole('button', { name: '字节空格' })).toBeVisible()

    const orderGroup = page.locator('[role="group"][aria-labelledby="copy-hex-order-label"]')
    await expect(orderGroup).toContainText('Hex 复制顺序')
    await expect(orderGroup.getByRole('button', { name: 'LE', exact: true })).toBeVisible()
    await expect(orderGroup.getByRole('button', { name: 'BE', exact: true })).toBeVisible()

    // Focus order follows DOM order: format buttons then order buttons.
    const focusables = page.locator('.copy-prefs button')
    expect(await focusables.count()).toBe(4)
    const labels = await focusables.evaluateAll((els) =>
      els.map((el) => (el as HTMLButtonElement).textContent?.trim() ?? ''),
    )
    expect(labels).toEqual(['0x 前缀', '字节空格', 'LE', 'BE'])
  })

  test('negative ordinary quantization error is not displayed as danger', async ({ page }) => {
    await settle(page)
    const valueInput = page.locator('#value-input')
    await valueInput.fill('0.999999')
    await valueInput.press('Tab')

    const errorDelta = page.locator('[data-testid="quantization-error"]')
    await expect(errorDelta).toBeVisible()
    await expect(errorDelta).toContainText('量化误差')
    await expect(errorDelta).toHaveAttribute('data-kind', 'ok')
    const color = await errorDelta.locator('span').evaluate((el) => getComputedStyle(el).color)
    const danger = await errorDelta.evaluate(() => {
      const probe = document.createElement('span')
      probe.style.color = 'var(--color-danger-text)'
      document.body.appendChild(probe)
      const color = getComputedStyle(probe).color
      probe.remove()
      return color
    })
    expect(color).not.toBe(danger)
  })

  test('copy feedback has role status and does not push layout', async ({ page }) => {
    await settle(page)
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: async () => undefined },
        configurable: true,
      })
    })

    const copyHex = page.getByRole('button', { name: 'Hex（LE）' })
    await copyHex.scrollIntoViewIfNeeded()
    const boxBefore = await copyHex.boundingBox()
    await copyHex.click()

    const feedback = page.locator('.copy-feedback')
    await expect(feedback).toBeVisible()
    await expect(feedback).toHaveAttribute('role', 'status')
    await expect(feedback).toHaveAttribute('aria-live', 'polite')

    const boxAfter = await copyHex.boundingBox()
    expect(boxBefore?.x).toBeCloseTo(boxAfter?.x ?? 0, 5)
    expect(boxBefore?.y).toBeCloseTo(boxAfter?.y ?? 0, 5)
  })
})
