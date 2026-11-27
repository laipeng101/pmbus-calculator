import { test, expect } from '@playwright/test'
import { COMMAND_METADATA } from '../../src/legacy/command-metadata'

test('打开命令参考可以读取标准定义及备注', async ({ page }) => {
  await page.goto('./')
  const reference = page.getByLabel('命令参考')
  const toggle = reference.getByRole('button', { name: '命令参考（只读）' })
  const table = reference.getByRole('table')
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(table).toHaveCount(0)

  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(table.getByRole('row')).toHaveCount(Object.keys(COMMAND_METADATA).length + 1)

  const vin = table.getByRole('row', { name: /READ_VIN/ })
  await expect(vin.getByRole('cell')).toHaveText([
    'READ_VIN',
    '0x88',
    '读 Read Word',
    '数值',
    'V',
    '器件数据手册',
    COMMAND_METADATA.READ_VIN.spec,
    COMMAND_METADATA.READ_VIN.note ?? '—',
  ])
  await expect(table.getByRole('row', { name: /STATUS_WORD/ })).toContainText('状态位')
  await expect(table.getByRole('row', { name: /VOUT_COMMAND/ })).toContainText('跟随 VOUT_MODE')
  await expect(table.getByRole('row', { name: /READ_EIN/ })).toContainText('读 Block Read')
  for (const [key, { note }] of Object.entries(COMMAND_METADATA)) {
    if (note) {
      const row = table.getByRole('row', { name: new RegExp(`^${key} `) })
      await expect(row.getByRole('cell').last()).toHaveText(note)
    }
  }
  await expect(table.locator('tbody').getByRole('button')).toHaveCount(0)
  await expect(reference.getByRole('combobox')).toHaveCount(0)
})

test('阅读和收起命令参考不改变 LINEAR16 的模式、配置字节与计算值', async ({ page }) => {
  await page.goto('./')
  const mode = page.getByRole('tab', { name: /LINEAR16/ })
  await mode.click()
  const hex = page.locator('#raw-hex-input')
  const voutMode = page.locator('#vout-mode-input')
  const value = page.locator('#value-input')
  await hex.fill('0100')
  await voutMode.fill('17')
  await voutMode.press('Tab')
  await expect(value).toHaveValue('0.5')

  const toggle = page.locator('#command-reference-toggle')
  await toggle.click()
  await page.getByRole('row', { name: /VOUT_COMMAND/ }).click()
  await toggle.click()

  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(mode).toHaveAttribute('aria-selected', 'true')
  await expect(hex).toHaveValue('0100')
  await expect(voutMode).toHaveValue('17')
  await expect(value).toHaveValue('0.5')
})

test('阅读命令参考不改写 DIRECT 系数', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('tab', { name: /DIRECT/ }).click()
  const m = page.getByLabel('DIRECT 系数 m')
  await m.fill('5')
  await m.press('Tab')

  await page.locator('#command-reference-toggle').click()
  await page.getByRole('row', { name: /READ_VIN/ }).click()
  await page.getByRole('row', { name: /STATUS_WORD/ }).click()
  await expect(m).toHaveValue('5')
})

test.describe('命令参考（950×304）：只读表格无溢出', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 950, height: 304 })
    await page.goto('./')
  })

  test('展开后表格完整可读且页面不产生横向滚动', async ({ page }) => {
    await page.locator('#command-reference-toggle').click()
    await expect(page.getByRole('row', { name: /STATUS_WORD/ })).toBeVisible()
    const scrollWidth = await page.locator('body').evaluate((el) => el.scrollWidth)
    const clientWidth = await page.locator('body').evaluate((el) => el.clientWidth)
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth)
  })
})
