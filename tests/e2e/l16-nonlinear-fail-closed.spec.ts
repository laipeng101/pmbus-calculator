import { test, expect, type Page } from '@playwright/test'
import { tabTo } from './helpers/keyboard'
import { expectNoHorizontalOverflow } from './helpers/layout'

async function setByte(page: Page, hex: string) {
  const input = page.locator('#vout-mode-input')
  await input.fill(hex)
  await input.press('Tab')
  await expect(page.getByTestId('vout-mode-byte')).toHaveText(`0x${hex}`)
}

test.beforeEach(async ({ page }) => {
  await page.goto('./')
  await page.getByRole('tab', { name: /LINEAR16/ }).click()
  await page.locator('#raw-hex-input').fill('0100')
})

test('非 LINEAR 时保留原字，只在用户明确应用 LINEAR 配置后恢复换算和复制', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.setViewportSize({ width: 360, height: 800 })
  const payload = page.locator('#l16-payload-kind')
  const apply = page.getByRole('button', { name: '应用计算器 LINEAR 示例 0x18' })
  const raw = page.locator('#raw-hex-input')
  const value = page.locator('#value-input')
  const result = page.getByTestId('result-value')
  const panel = page.getByTestId('quantization-error')
  const copy = page.getByRole('button', { name: '物理值', exact: true })
  const reason = page.locator('#physical-value-copy-reason')
  const card = page.locator('.workspace-l16-block')
  const legend = page.locator('.bitfield[data-bit-count="16"] .bitfield-legend')

  await value.fill('1.25')
  await value.press('Tab')
  await expect(raw).toHaveValue('0140')
  await expect(panel).toBeVisible()
  await setByte(page, '20')
  await expect(card).toContainText('此 VID 代码类型没有可用的电压映射')
  await expect(legend).toContainText('未按 LINEAR16 解释')
  await expect(legend).not.toContainText('数值 V [15:0]')

  await payload.selectOption('slinear16-offset')
  await expect(card).toContainText('VID 格式下不能使用 VOUT_TRIM / VOUT_CAL_OFFSET')
  await expect(card).toContainText('§13.3 / §13.4')
  const offsetAlert = page.getByRole('alert').filter({ hasText: '§13.3 / §13.4' })
  await expect(offsetAlert.first()).toHaveAttribute('data-level', 'error')
  await expect(value).toHaveCount(0)
  await expect(page.locator('#l16-nominal-vout')).toHaveCount(0)
  await expect(page.getByText(/可表示范围/)).toHaveCount(0)
  await expect(panel).toHaveCount(0)
  await expect(result).toHaveText('—')
  await expect(raw).toHaveValue('0140')
  await expect(legend).toContainText('未按 LINEAR16 解释')
  await expect(legend).not.toContainText('数值 V [15:0]')
  await expect(legend).not.toContainText('有符号值 Y [15:0]')
  await expect(copy).toBeDisabled()
  await expect(copy).toHaveAttribute('aria-describedby', 'physical-value-copy-reason')
  await expect(reason).toContainText('VOUT_MODE 0x20')
  for (const label of ['Raw Word Hex', 'Wire 字节', 'MSB-first 字节', 'C 代码']) {
    await expect(page.getByRole('button', { name: label, exact: true })).toBeEnabled()
  }
  await page.evaluate(() => document.fonts.ready)
  await expectNoHorizontalOverflow(page)

  // 示例按钮位于配置字节输入和步进按钮之后。
  await page.locator('#vout-mode-input').click()
  await tabTo(page, apply, 'Tab', 4)
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('vout-mode-byte')).toHaveText('0x18')
  await expect(page.getByTestId('vout-mode-source')).toHaveText('已关联')
  await expect(card).toHaveCount(0)
  await expect(legend).toContainText('有符号值 Y [15:0]')
  await expect(value).toBeVisible()
  await expect(page.getByText('-128 ~ 127.99609375')).toBeVisible()
  await expect(raw).toHaveValue('0140')
  await expect(panel).toHaveCount(0)

  await value.fill('1')
  await value.press('Tab')
  await expect(raw).toHaveValue('0100')
  await expect(panel).toContainText('0.000000 (0.0000%)')
  await expect(result).toHaveText('1')
  await expect(copy).toBeEnabled()
  await expect(reason).toHaveCount(0)
  // 键盘操作引起的滚动可能把悬停说明移到指针下方。移开指针后再点击复制。
  await page.mouse.move(0, 0)
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  await copy.click()
  await expect(page.getByText('已复制: 物理值', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('1')
})

test('合法的 VID、DIRECT、IEEE Half 各显示适用的格式指引', async ({ page }) => {
  const card = page.locator('.workspace-l16-block')
  const copy = page.getByRole('button', { name: '物理值', exact: true })
  for (const [byte, hint] of [
    ['3E', '器件资料中的 VID 码表'],
    ['60', '切换到 HALF 页'],
    ['40', 'm、b、R 系数'],
  ]) {
    await setByte(page, byte)
    await expect(card).toContainText(hint)
    await expect(page.locator('#value-input')).toHaveCount(0)
    await expect(page.getByTestId('result-value')).toHaveText('—')
    await expect(page.locator('#raw-hex-input')).toHaveValue('0100')
    await expect(copy).toBeDisabled()
  }

  await page.getByTestId('calculation-steps-summary').click()
  const steps = page.getByTestId('calculation-steps')
  await expect(steps).toContainText('当前为 DIRECT')
  await expect(steps).toContainText('§8.4')
  await expect(steps).not.toContainText('格式编码量化误差')
})

test('无效非 LINEAR 参数及相对 VID 的错误在切换数据解释后仍然可见', async ({ page }) => {
  const card = page.locator('.workspace-l16-block')
  const value = page.locator('#value-input')
  const result = page.getByTestId('result-value')

  await setByte(page, '61')
  await expect(card).toContainText('的参数无效')
  await expect(
    page.getByRole('alert').filter({ hasText: '参数必须为 00000b' }).first(),
  ).toHaveAttribute('data-level', 'error')
  await expect(value).toHaveCount(0)
  await expect(result).toHaveText('—')

  await setByte(page, 'A0')
  await expect(card).toContainText('相对值和 VID 组合无效')
  await expect(page.getByRole('alert').filter({ hasText: '§8.5.3' }).first()).toHaveAttribute(
    'data-level',
    'error',
  )
  await page.locator('#l16-payload-kind').selectOption('slinear16-offset')
  await expect(card).toContainText('相对值和 VID 组合无效')
  await expect(value).toHaveCount(0)
  await expect(result).toHaveText('—')
  await expect(page.locator('#raw-hex-input')).toHaveValue('0100')
})
