import { test, expect } from '@playwright/test'

/**
 * Command reference contract:
 * - Default collapsed; expanding only shows read-only rows.
 * - Selecting/reading a row has NO side effects on mode, raw, VOUT_MODE,
 *   DIRECT coefficients or any calculation result.
 * - Shows command code, transactions, data type, units, format source and
 *   spec section.  No presets, no auto-apply, no search-driven mode switch.
 */
test.describe('命令参考（只读，无副作用）', () => {
  test('默认折叠；展开后显示全部 13 条命令行', async ({ page }) => {
    await page.goto('/')
    const toggle = page.locator('#command-reference-toggle')

    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(page.getByRole('row')).toHaveCount(0)

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByRole('row', { name: /VOUT_COMMAND/ })).toBeVisible()
    // 1 表头 + 13 条命令
    await expect(page.getByRole('row')).toHaveCount(14)
    await expect(page.getByRole('row', { name: /READ_EIN/ })).toBeVisible()
  })

  test('展开/收起可重复且不影响模式与 raw', async ({ page }) => {
    await page.goto('/')
    const toggle = page.locator('#command-reference-toggle')
    const hexInput = page.locator('input[placeholder="0x0000"]')
    const l11Tab = page.getByRole('tab', { name: /LINEAR11/ })

    await toggle.click()
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(hexInput).toHaveValue('0x0000')
    await expect(l11Tab).toHaveAttribute('aria-selected', 'true')
  })

  test('表格展示命令码、事务、单位、格式来源与规范章节', async ({ page }) => {
    await page.goto('/')
    await page.locator('#command-reference-toggle').click()

    const vinRow = page.getByRole('row', { name: /READ_VIN/ })
    await expect(vinRow).toContainText('0x88')
    await expect(vinRow).toContainText('读 Read Word')
    await expect(vinRow).toContainText('V')
    await expect(vinRow).toContainText('由器件资料决定')
    await expect(vinRow).toContainText('PMBus Part II §18.1')

    const einRow = page.getByRole('row', { name: /READ_EIN/ })
    await expect(einRow).toContainText('Block 块')
    await expect(einRow).toContainText('读 Block Read')
  })

  test('STATUS_WORD 行标注状态位且无数值转换', async ({ page }) => {
    await page.goto('/')
    await page.locator('#command-reference-toggle').click()
    const statusRow = page.getByRole('row', { name: /STATUS_WORD/ })
    await expect(statusRow).toContainText('状态位')
    await expect(statusRow).toContainText('STATUS 位')
    await expect(statusRow).toContainText('bit field')
  })

  test('不提供任何预设应用入口', async ({ page }) => {
    await page.goto('/')
    await page.locator('#command-reference-toggle').click()
    await expect(page.getByRole('button', { name: /应用.*预设/ })).toHaveCount(0)
    await expect(page.getByRole('combobox')).toHaveCount(0)
  })

  test('VOUT_COMMAND 行显示 follows_vout_mode 且模式不受影响', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('tab', { name: /LINEAR16/ }).click()
    await page.locator('#command-reference-toggle').click()

    const row = page.getByRole('row', { name: /VOUT_COMMAND/ })
    await expect(row).toContainText('跟随 VOUT_MODE')
    await expect(page.getByRole('tab', { name: /LINEAR16/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  test('L16 VOUT_MODE 不被命令参考修改', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('tab', { name: /LINEAR16/ }).click()
    const voutModeInput = page.getByLabel('VOUT_MODE')
    await voutModeInput.fill('18')
    await voutModeInput.press('Tab')

    await page.locator('#command-reference-toggle').click()
    await page.getByRole('row', { name: /VOUT_COMMAND/ }).click()

    await expect(voutModeInput).toHaveValue('0x18')
    await expect(page.locator('#value-input')).toHaveValue('0')
  })
})
