import { test, expect, type Page } from '@playwright/test'
import { expectNoHorizontalOverflow, expectTextInside } from './helpers/layout'

async function settle(page: Page) {
  await page.goto('./')
  await expect(page.locator('.katex').first()).toBeVisible()
  await page.evaluate(async () => {
    await document.fonts.ready
  })
}

async function fillRaw(page: Page, hex: string) {
  const hexInput = page.locator('#raw-hex-input')
  await hexInput.fill(hex)
  await hexInput.press('Tab')
}

async function switchMode(page: Page, name: RegExp) {
  await page.getByRole('tab', { name }).click()
  await expect(page.locator('.katex').first()).toBeVisible()
}

test.describe('结果数值、误差和复制反馈', () => {
  test('各数值换算页显示非零原字的读数和公式字段', async ({ page }) => {
    await settle(page)

    await fillRaw(page, 'A3C1')
    await expect(page.locator('#value-input')).toHaveValue('0.234619140625')
    await expect(page.locator('[data-testid="result-row-substitution"]').first()).toContainText(
      '961',
    )

    await switchMode(page, /LINEAR16/)
    await page.locator('#vout-mode-input').fill('13')
    await page.locator('#vout-mode-input').press('Tab')
    // word 0x8FC3（canonical 原字直接输入）。
    await fillRaw(page, '8FC3')
    await expect(page.locator('#value-input')).toHaveValue('4.49255371094')

    await switchMode(page, /DIRECT/)
    await page.getByLabel('DIRECT 系数 r').fill('12')
    await page.getByLabel('DIRECT 系数 r').press('Tab')
    await fillRaw(page, '8FC3')
    await expect(page.locator('#value-input')).toHaveValue('-2.8733e-8')
    await expect(page.locator('[data-testid="result-row-substitution"]').first()).toContainText(
      '-28733',
    )

    await switchMode(page, /HALF/)
    await fillRaw(page, '8FC3')
    await expect(page.locator('#value-input')).toHaveValue('-0.000473737716675')
    const halfFields = page.locator('[data-testid="result-row-fields"] .result-field')
    await expect(halfFields.nth(0)).toHaveText('s1')
    await expect(halfFields.nth(1)).toHaveText('E3')
    await expect(halfFields.nth(2)).toHaveText('F963')
    await expect(page.locator('[data-testid="result-row-substitution"]').first()).toContainText(
      '-0.000473737716675',
    )
  })

  test('HALF 长读数在桌面和窄屏的结果卡内完整显示', async ({ page }) => {
    await settle(page)
    await switchMode(page, /HALF/)
    await fillRaw(page, '8FC3')
    const result = page.getByTestId('result-value')
    await expect(result).toHaveText('-0.000473737716675')

    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 360, height: 800 },
    ]) {
      await page.setViewportSize(viewport)
      await page.evaluate(() => document.fonts.ready)
      await expectTextInside(result, page.getByTestId('result-tile'))
      await expectNoHorizontalOverflow(page)
    }
  })

  test('十六进制格式偏好按组呈现', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await settle(page)

    const formatGroup = page.locator('[role="group"][aria-labelledby="copy-hex-format-label"]')
    await expect(formatGroup).toContainText('Hex 格式')
    await expect(formatGroup.getByRole('button', { name: '0x 前缀' })).toBeVisible()
    await expect(formatGroup.getByRole('button', { name: '字节空格' })).toBeVisible()

    // v3.0.0: the endian order group is gone — explicit copy actions replaced it.
    await expect(
      page.locator('[role="group"][aria-labelledby="copy-hex-order-label"]'),
    ).toHaveCount(0)

    const focusables = page.locator('.copy-prefs button')
    expect(await focusables.count()).toBe(2)
    const labels = await focusables.evaluateAll((els) =>
      els.map((el) => (el as HTMLButtonElement).textContent?.trim() ?? ''),
    )
    expect(labels).toEqual(['0x 前缀', '字节空格'])
  })

  test('普通负向量化误差使用提示样式', async ({ page }) => {
    await settle(page)
    const valueInput = page.locator('#value-input')
    await valueInput.fill('0.999999')
    await valueInput.press('Tab')

    const errorDelta = page.locator('[data-testid="quantization-error"]')
    await expect(errorDelta).toBeVisible()
    await expect(errorDelta).toContainText('量化误差')
    // Severity follows the outcome class (quantized → warn): the negative
    // sign must never escalate to danger.
    await expect(errorDelta).toHaveAttribute('data-kind', 'warn')
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

  test('物理值编码显示量化误差，原字编辑清除误差', async ({ page }) => {
    await settle(page)

    // LINEAR16, clean entry: no provenance → no fabricated zero.
    await switchMode(page, /LINEAR16/)
    const panel = page.locator('[data-testid="quantization-error"]')
    await expect(panel).toHaveCount(0)

    // N=-8 (0x18): 0.005 → Y=1 → represented 0.00390625.
    const valueInput = page.locator('#value-input')
    await valueInput.fill('0.005')
    await valueInput.press('Tab')
    await expect(panel).toContainText('+0.001094 (21.8750%)')
    await expect(panel).toHaveAttribute('data-kind', 'warn')

    // Manual raw edit invalidates provenance — the panel must disappear,
    // not fall back to a fabricated zero.
    await fillRaw(page, 'ABCD')
    await expect(panel).toHaveCount(0)

    // Re-encoding restores the readout.
    await valueInput.fill('0.005')
    await valueInput.press('Tab')
    await expect(panel).toContainText('+0.001094 (21.8750%)')

    // Re-selecting the active mode keeps the provenance (same-mode click).
    await page.getByRole('tab', { name: /LINEAR16/ }).click()
    await expect(panel).toContainText('+0.001094 (21.8750%)')
  })

  test('DIRECT 零请求显示绝对误差，相对误差显示为 —', async ({ page }) => {
    await settle(page)
    await switchMode(page, /DIRECT/)

    // m=1, b=1, R=-1: X=0 → Y=round((0+1)×10⁻¹)=0 → decode −1.
    await page.locator('#direct-coeff-b-input').fill('1')
    await page.locator('#direct-coeff-b-input').press('Tab')
    await page.locator('#direct-coeff-r-input').fill('-1')
    await page.locator('#direct-coeff-r-input').press('Tab')

    const panel = page.locator('[data-testid="quantization-error"]')
    await expect(panel).toHaveCount(0)

    const valueInput = page.locator('#value-input')
    await valueInput.fill('0')
    await valueInput.press('Tab')
    // v2.5.12 exact contract: the delta renders from the exact rational
    // (integer +1) and the relative percent stays undefined (—) for an
    // exactly-zero request; the note keeps the committed request lexeme.
    await expect(panel).toContainText('+1（约 —）')
    await expect(panel).toContainText('用户请求 0')
    await expect(panel).toContainText('raw 精确表示 -1')
    await expect(panel).toHaveAttribute('data-kind', 'warn')
  })

  test('复制反馈可播报且不推移按钮', async ({ page }) => {
    await settle(page)
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: async () => undefined },
        configurable: true,
      })
    })

    const copyRaw = page.getByRole('button', { name: 'Raw Word Hex' })
    await copyRaw.scrollIntoViewIfNeeded()
    const boxBefore = await copyRaw.boundingBox()
    await copyRaw.click()

    const feedback = page.locator('.copy-feedback')
    await expect(feedback).toBeVisible()
    await expect(feedback).toHaveAttribute('role', 'status')
    await expect(feedback).toHaveAttribute('aria-live', 'polite')

    const boxAfter = await copyRaw.boundingBox()
    expect(boxBefore?.x).toBeCloseTo(boxAfter?.x ?? 0, 5)
    expect(boxBefore?.y).toBeCloseTo(boxAfter?.y ?? 0, 5)
  })
})
