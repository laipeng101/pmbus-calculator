import { expect, test, type Page } from '@playwright/test'
import { expectNoHorizontalOverflow } from './helpers/layout'

async function openRelativeL16(page: Page, raw = '0100') {
  await page.goto('./')
  await page.getByRole('tab', { name: /LINEAR16/ }).click()
  await page.locator('#raw-hex-input').fill(raw)
  await page.getByRole('radio', { name: '相对值', exact: true }).click()
  await expect(page.getByTestId('vout-mode-byte')).toHaveText('0x98')
}

test('相对 ULINEAR16 标称缺失或为零时，结果和复制状态随数据解释变化', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.setViewportSize({ width: 360, height: 800 })
  await openRelativeL16(page)
  const raw = page.locator('#raw-hex-input')
  const nominal = page.locator('#l16-nominal-vout')
  const payload = page.locator('#l16-payload-kind')
  const value = page.locator('#value-input')
  const result = page.getByTestId('result-value')
  const copy = page.getByRole('button', { name: '物理值', exact: true })

  await expect(value).toHaveCount(0)
  await expect(nominal).toBeVisible()
  await expect(result).toHaveText('—')
  await expect(copy).toBeDisabled()
  await expect(copy).toHaveAttribute('aria-describedby', 'physical-value-copy-reason')
  await expect(page.locator('#physical-value-copy-reason')).toContainText('标称参考值')

  await nominal.fill('0')
  await nominal.press('Tab')
  await expect(result).toHaveText('0')
  await expect(page.getByText(/要求相对值大于 0/)).toHaveCount(0)
  await copy.click()
  await expect(page.getByText('已复制: 物理值', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('0')

  await nominal.fill('')
  await nominal.press('Tab')
  await expect(result).toHaveText('—')
  await expect(copy).toBeDisabled()

  await payload.selectOption('slinear16-offset')
  await expect(nominal).toHaveCount(0)
  await expect(value).toBeVisible()
  await expect(page.locator('#l16-v-input')).toHaveAttribute('aria-label', /Y_s/)
  await expect(page.locator('.workspace-l16-block')).toHaveCount(0)
  await expect(result).toHaveText('1')
  await expect(copy).toBeEnabled()
  await page.getByText(/^说明（\d+）$/).click()
  await expect(page.getByText('第 7 位不影响电压偏移')).toBeVisible()

  await payload.selectOption('ulinear16')
  await expect(result).toHaveText('—')
  await expect(copy).toBeDisabled()
  await nominal.fill('12')
  await expect(result).toHaveText('12')
  await expect(copy).toBeEnabled()
  await expect(raw).toHaveValue('0100')
  await expect(page.getByTestId('vout-mode-byte')).toHaveText('0x98')
  await expectNoHorizontalOverflow(page)
})

test('相对配置下可编码 SLINEAR16 偏移，编辑 Y_s 清除编码请求', async ({ page }) => {
  await openRelativeL16(page)
  await page.locator('#l16-payload-kind').selectOption('slinear16-offset')
  const value = page.locator('#value-input')
  const raw = page.locator('#raw-hex-input')
  const result = page.getByTestId('result-value')
  const panel = page.getByTestId('quantization-error')
  const ys = page.getByLabel('Y_s（16 位二补码偏移，−32768～32767）')

  await expect(page.getByText('-128 ~ 127.99609375')).toBeVisible()
  await value.fill('200')
  await expect(raw).toHaveValue('7FFF')
  await expect(panel).toHaveAttribute('data-kind', 'error')
  await expect(panel).toContainText('饱和')

  await value.fill('3.3')
  await value.press('Tab')
  await expect(raw).toHaveValue('034D')
  await expect(result).toHaveText('3.30078125')
  await expect(panel).toHaveAttribute('data-kind', 'warn')
  await expect(panel).toContainText('-0.000781 (-0.0237%)')

  await ys.click()
  await ys.press('Tab')
  await expect(raw).toHaveValue('034D')
  await expect(panel).toBeVisible()

  await ys.fill('-1')
  await ys.press('Tab')
  await expect(raw).toHaveValue('FFFF')
  await expect(result).toHaveText('-0.00390625')
  await expect(panel).toHaveCount(0)
  await expect(page.getByTestId('calculation-steps-disclosure')).toHaveCount(0)
  await expect(page.getByTestId('vout-mode-byte')).toHaveText('0x98')
})

test('相对 ULINEAR16 的结果、说明和复制随计算范围恢复', async ({ page }) => {
  await openRelativeL16(page, '0200')
  const raw = page.locator('#raw-hex-input')
  const nominal = page.locator('#l16-nominal-vout')
  const result = page.getByTestId('result-value')
  const copy = page.getByRole('button', { name: '物理值', exact: true })
  const copyReason = page.locator('#physical-value-copy-reason')
  const alerts = page.getByRole('region', { name: '提示信息' })

  await nominal.fill('12')
  await expect(result).toHaveText('24')

  await nominal.fill('1e308')
  await expect(result).toHaveText('—')
  await expect(page.getByTestId('result-panel')).not.toContainText('Infinity')
  const overflow = '计算结果太大，超出可表示范围'
  await expect(alerts.getByText(overflow, { exact: false })).toHaveCount(1)
  await expect(copy).toBeDisabled()
  await expect(copyReason).toContainText(overflow)
  await page.getByTestId('calculation-steps-summary').click()
  await expect(page.getByTestId('calculation-steps')).toContainText(
    '用标称电压 1e+308 V 乘以比值 R',
  )
  await expect(page.getByTestId('calculation-steps')).toContainText(overflow)
  await expect(page.getByTestId('calculation-steps')).not.toContainText('Infinity')
  for (const label of ['Raw Word Hex', 'Wire 字节', 'MSB-first 字节', 'C 代码']) {
    await expect(page.getByRole('button', { name: label, exact: true })).toBeEnabled()
  }

  await raw.fill('0100')
  await expect(result).toHaveText('1e+308')
  await expect(copy).toBeEnabled()

  await nominal.fill('5e-324')
  await expect(result).toHaveText('5e-324')
  await raw.fill('0001')
  await expect(result).toHaveText('—')
  await expect(alerts.getByText(/计算下溢/)).toHaveCount(1)
  await expect(copy).toBeDisabled()
  await expect(copyReason).toContainText('计算下溢')

  await nominal.fill('')
  await nominal.press('Tab')
  await expect(result).toHaveText('—')
  await expect(copyReason).toContainText('标称参考值')
  await nominal.fill('12')
  await expect(result).toHaveText('0.046875')
  await expect(copy).toBeEnabled()
  await expect(copyReason).toHaveCount(0)
})

test('零比值保留零读数、规范提示和物理值复制', async ({ page }) => {
  await openRelativeL16(page, '0000')
  await page.locator('#l16-nominal-vout').fill('12')
  await expect(page.getByTestId('result-value')).toHaveText('0')
  const alerts = page.getByRole('region', { name: '提示信息' })
  await expect(alerts.getByText(/要求相对值大于 0.*§8\.5\.2/)).toBeVisible()
  await expect(alerts.getByText(/计算下溢|超出可表示范围/)).toHaveCount(0)
  await expect(page.getByRole('button', { name: '物理值', exact: true })).toBeEnabled()
})

for (const theme of ['light', 'dark'] as const) {
  test(`相对 ULINEAR16 溢出说明在 ${theme} 主题的窄屏内完整布局`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme })
    await page.setViewportSize({ width: 360, height: 800 })
    await openRelativeL16(page, '0200')
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    await page.locator('#l16-nominal-vout').fill('1e308')
    await expect(page.getByTestId('result-value')).toHaveText('—')
    await expect(
      page.getByRole('region', { name: '提示信息' }).getByText('超出可表示范围'),
    ).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    await expectNoHorizontalOverflow(page)
  })
}
