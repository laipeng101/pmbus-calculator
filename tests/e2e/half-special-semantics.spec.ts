import { test, expect, type Page } from '@playwright/test'

/**
 * v2.5.5: HALF NaN / ±Infinity words carry PMBus Part II §7.6.2 operational
 * semantics — as written data (NaN → invalid data + communications fault,
 * +Inf/-Inf → ±full scale) and as read-back values (NaN → value unavailable,
 * ±Inf → measurement-channel saturation). The notice appears on BOTH real user
 * paths (raw Hex decode and physical-value encode), never shows for finite
 * values, and never claims a bus transaction has actually happened. The
 * binary16 math display stays untouched.
 */

async function settle(page: Page) {
  await page.goto('/')
  await page.evaluate(async () => {
    await document.fonts.ready
  })
  await page.waitForTimeout(80)
}

async function switchToHalf(page: Page) {
  await page.getByRole('tab', { name: /HALF/ }).click()
  await expect(page.locator('#raw-hex-input')).toBeVisible()
}

async function setRaw(page: Page, hex: string) {
  const input = page.locator('#raw-hex-input')
  await input.fill(hex)
  await input.press('Tab')
  await expect(page.locator('#raw-hex-input')).toHaveValue(hex.toUpperCase())
}

async function setValue(page: Page, text: string) {
  const input = page.locator('#value-input')
  await input.fill(text)
  await input.press('Tab')
}

async function expandDetails(page: Page) {
  const details = page.locator('[data-testid="calculation-steps-disclosure"]')
  const open = await details.evaluate((el) => (el as HTMLDetailsElement).open)
  if (!open) await details.locator('summary').click()
  await expect(page.getByTestId('calculation-steps')).toBeVisible()
}

const SCOPE_LINE = '不代表本页已发生任何总线通信'

test.describe('v2.5.5 HALF special-value §7.6.2 semantics card', () => {
  test('NaN via raw decode: card lists invalid-data write and unavailable read', async ({
    page,
  }) => {
    await settle(page)
    await switchToHalf(page)
    await setRaw(page, '7E00')

    const card = page.getByTestId('half-special-semantics')
    await expect(card).toBeVisible()
    await expect(card).toHaveAttribute('data-kind', 'half-nan')
    await expect(card).toHaveAttribute('role', 'note')
    await expect(card).toContainText('invalid data')
    await expect(card).toContainText('communications fault')
    await expect(card).toContainText('§10.8')
    await expect(card).toContainText('值不可用')
    await expect(card).toContainText('作为写入数据')
    await expect(card).toContainText('作为设备读回值')
    await expect(card).toContainText('§7.6.2')
    await expect(card).toContainText(SCOPE_LINE)

    // Math display unchanged: value + canonical raw + steps still shown.
    await expect(page.getByTestId('result-value')).toContainText('NaN')
    await expandDetails(page)
    await expect(page.getByTestId('calculation-steps')).toContainText('NaN')
  })

  test('NaN via value encode: same card on the value path, raw canonical 0x7E00', async ({
    page,
  }) => {
    await settle(page)
    await switchToHalf(page)
    await setValue(page, 'NaN')

    const card = page.getByTestId('half-special-semantics')
    await expect(card).toBeVisible()
    await expect(card).toHaveAttribute('data-kind', 'half-nan')
    await expect(page.getByTestId('result-value')).toContainText('NaN')
    await expect(page.locator('#raw-hex-input')).toHaveValue('7E00')
  })

  test('+Infinity / -Infinity: full-scale write and saturation read semantics', async ({
    page,
  }) => {
    await settle(page)
    await switchToHalf(page)

    await setRaw(page, '7C00')
    const pos = page.getByTestId('half-special-semantics')
    await expect(pos).toHaveAttribute('data-kind', 'half-positive-infinity')
    await expect(pos).toContainText('正满量程')
    await expect(pos).toContainText('正方向饱和')
    await expect(page.getByTestId('result-value')).toContainText('+Infinity')

    await setRaw(page, 'FC00')
    const neg = page.getByTestId('half-special-semantics')
    await expect(neg).toHaveAttribute('data-kind', 'half-negative-infinity')
    await expect(neg).toContainText('负满量程')
    await expect(neg).toContainText('负方向饱和')
    await expect(page.getByTestId('result-value')).toContainText('-Infinity')
  })

  test('finite values never show the card, and a raw edit clears it without staleness', async ({
    page,
  }) => {
    await settle(page)
    await switchToHalf(page)
    await setRaw(page, '7E00')
    await expect(page.getByTestId('half-special-semantics')).toBeVisible()

    // Raw edit back to finite 1.0 removes the notice — the card is derived
    // from the live raw word and can never go stale.
    await setRaw(page, '3C00')
    await expect(page.getByTestId('half-special-semantics')).toHaveCount(0)
    await expect(page.getByTestId('result-value')).toContainText('1')

    // Default finite input on the value path likewise shows nothing.
    await setValue(page, '2')
    await expect(page.getByTestId('half-special-semantics')).toHaveCount(0)
  })

  test('finite 65520 keeps its overflow/error readout beside the encoded-word card', async ({
    page,
  }) => {
    await settle(page)
    await switchToHalf(page)
    await setValue(page, '65520')

    // The finite request overflows the binary16 range: the quantization
    // readout must stay the overflow/error classification…
    const delta = page.getByTestId('quantization-error')
    await expect(delta).toContainText('65520')
    await expect(delta).toContainText('+Infinity')
    await expect(delta).toContainText('溢出')

    // …and because the encoded word is now +Inf, the §7.6.2 card correctly
    // describes what a device does with THAT word. The two surfaces answer
    // different questions and must not be conflated into one state.
    const card = page.getByTestId('half-special-semantics')
    await expect(card).toHaveAttribute('data-kind', 'half-positive-infinity')
    await expect(card).toContainText('正满量程')
  })

  test('no horizontal overflow at 1280/390/360 with the NaN card active', async ({ page }) => {
    await settle(page)
    await switchToHalf(page)
    await setRaw(page, '7E00')
    await expandDetails(page)
    for (const viewport of [
      { width: 1280, height: 900 },
      { width: 390, height: 844 },
      { width: 360, height: 800 },
    ]) {
      await page.setViewportSize(viewport)
      await page.waitForTimeout(60)
      const result = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }))
      expect(result.scrollWidth, `viewport ${viewport.width}`).toBeLessThanOrEqual(
        result.clientWidth,
      )
      await expect(page.getByTestId('half-special-semantics')).toBeVisible()
    }
  })
})
