import { test, expect, type Page } from '@playwright/test'

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

test.describe('HALF 特殊值说明', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('./')
    await page.getByRole('tab', { name: /HALF/ }).click()
  })

  test('NaN 解码分别说明写入无效数据和返回值不可用', async ({ page }) => {
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

  test('无穷值按符号说明满量程请求与饱和读数', async ({ page }) => {
    await setRaw(page, '7C00')
    const pos = page.getByTestId('half-special-semantics')
    await expect(pos).toHaveAttribute('data-kind', 'half-positive-infinity')
    await expect(pos).toContainText('正满量程')
    await expect(pos).toContainText('正方向饱和')
    await expect(page.getByTestId('result-value')).toContainText('+Infinity')

    await setValue(page, '-Infinity')
    await expect(page.locator('#raw-hex-input')).toHaveValue('FC00')
    await expect(page.locator('#value-input')).not.toHaveAttribute('aria-invalid', 'true')
    const neg = page.getByTestId('half-special-semantics')
    await expect(neg).toHaveAttribute('data-kind', 'half-negative-infinity')
    await expect(neg).toContainText('负满量程')
    await expect(neg).toContainText('负方向饱和')
    await expect(page.getByTestId('result-value')).toContainText('-Infinity')

    await setRaw(page, '3C00')
    await expect(page.getByTestId('half-special-semantics')).toHaveCount(0)
    await expect(page.getByTestId('result-value')).toHaveText('1')
  })

  test('有限输入溢出时同时显示编码告警和无穷值说明', async ({ page }) => {
    await setValue(page, '65520')

    const delta = page.getByTestId('quantization-error')
    await expect(delta).toContainText('65520')
    await expect(delta).toContainText('+Infinity')
    await expect(delta).toContainText('溢出')
    await expect(delta).toHaveAttribute('data-kind', 'error')

    const card = page.getByTestId('half-special-semantics')
    await expect(card).toHaveAttribute('data-kind', 'half-positive-infinity')
    await expect(card).toContainText('正满量程')

    // 半精度最小非零值的一半舍入为零，绝对误差仍非零。
    await setValue(page, '2.9802322387695312e-8')
    await expect(card).toHaveCount(0)
    await expect(delta).toContainText('+2.98023223877e-8 (100.0000%)')
    await expect(delta).toHaveAttribute('data-kind', 'warn')

    await setRaw(page, '3C05')
    await expect(delta).toHaveCount(0)
  })

  test('NaN 说明在桌面和窄屏内完整布局', async ({ page }) => {
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
