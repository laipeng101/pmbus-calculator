import { test, expect, type Page } from '@playwright/test'
import { appUrl } from './helpers/app-url'

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

test.describe('HALF special values in PMBus', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(appUrl())
    await page.getByRole('tab', { name: /HALF/ }).click()
  })

  test('NaN via raw decode: card lists invalid-data write and unavailable read', async ({
    page,
  }) => {
    await setRaw(page, '7E00')

    const card = page.getByRole('note', { name: 'NaN（非数值）' })
    await expect(card).toBeVisible()
    await expect(card).toHaveAttribute('data-kind', 'half-nan')
    await expect(card).toContainText('无效数据')
    await expect(card).toContainText('通信故障')
    await expect(card).toContainText('§10.8')
    await expect(card).toContainText('值不可用')
    await expect(card).toContainText('写入设备时')
    await expect(card).toContainText('设备返回时')
    await expect(card).toContainText('§7.6.2')
    await expect(card).toContainText('须保留原始 IEEE 754 编码')

    await expect(page.getByTestId('result-value')).toContainText('NaN')
    await expandDetails(page)
    await expect(page.getByTestId('calculation-steps')).toContainText('NaN')
  })

  test('NaN via value encode: same card on the value path, raw canonical 0x7E00', async ({
    page,
  }) => {
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
    await setRaw(page, '7E00')
    await expect(page.getByTestId('half-special-semantics')).toBeVisible()

    await setRaw(page, '3C00')
    await expect(page.getByTestId('half-special-semantics')).toHaveCount(0)
    await expect(page.getByTestId('result-value')).toContainText('1')

    await setValue(page, '2')
    await expect(page.getByTestId('half-special-semantics')).toHaveCount(0)
  })

  test('finite 65520 keeps its overflow/error readout beside the encoded-word card', async ({
    page,
  }) => {
    await setValue(page, '65520')

    const delta = page.getByTestId('quantization-error')
    await expect(delta).toContainText('65520')
    await expect(delta).toContainText('+Infinity')
    await expect(delta).toContainText('溢出')

    const card = page.getByTestId('half-special-semantics')
    await expect(card).toHaveAttribute('data-kind', 'half-positive-infinity')
    await expect(card).toContainText('正满量程')
  })

  test('no horizontal overflow at 1280/390/360 with the NaN card active', async ({ page }) => {
    await setRaw(page, '7E00')
    await expandDetails(page)
    for (const viewport of [
      { width: 1280, height: 900 },
      { width: 390, height: 844 },
      { width: 360, height: 800 },
    ]) {
      await page.setViewportSize(viewport)
      await expect
        .poll(async () =>
          page.evaluate(async () => {
            await document.fonts.ready
            return document.documentElement.scrollWidth - document.documentElement.clientWidth
          }),
        )
        .toBeLessThanOrEqual(0)
      await expect(page.getByTestId('half-special-semantics')).toBeVisible()
    }
  })
})
