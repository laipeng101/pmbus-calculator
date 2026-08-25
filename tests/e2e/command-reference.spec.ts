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

  test('STATUS_WORD 行渲染 metadata note：通常 Read Word，写 0x0100 仅清除 UNKNOWN 位', async ({
    page,
  }) => {
    await page.goto('/')
    await page.locator('#command-reference-toggle').click()
    const statusRow = page.getByRole('row', { name: /STATUS_WORD/ })
    await expect(statusRow).toContainText('通常为 Read Word')
    await expect(statusRow).toContainText('特殊写入仅用于清除 UNKNOWN 位')
    await expect(statusRow).toContainText('0x0100')
  })

  test('READ_EIN 行渲染 Block Read 与规范字节数/有效载荷冲突说明', async ({ page }) => {
    await page.goto('/')
    await page.locator('#command-reference-toggle').click()
    const einRow = page.getByRole('row', { name: /READ_EIN/ })
    await expect(einRow).toContainText('读 Block Read')
    await expect(einRow).toContainText('规范内部冲突')
    await expect(einRow).toContainText('§18.13 描述 6 个数据字节')
    await expect(einRow).toContainText('Appendix I Table 31 列为 5')
    await expect(einRow).toContainText('计算器不是 READ_EIN packet-length authority')
  })

  test('所有带 note 的命令行都实际渲染 metadata 的说明文本', async ({ page }) => {
    await page.goto('/')
    await page.locator('#command-reference-toggle').click()
    const noted = await page.locator('tr[data-command-note]:not([data-command-note=""])').count()
    expect(noted).toBeGreaterThan(0)
    for (const key of ['VOUT_COMMAND', 'STATUS_WORD', 'READ_EIN']) {
      await expect(page.locator(`tr[data-command-key="${key}"] td:last-child`)).not.toHaveText('—')
    }
  })

  test('阅读命令行不修改 DIRECT 系数', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('tab', { name: /DIRECT/ }).click()
    const mInput = page.getByLabel('DIRECT 系数 m')
    await mInput.fill('5')
    await mInput.press('Tab')

    await page.locator('#command-reference-toggle').click()
    await page.getByRole('row', { name: /READ_VIN/ }).click()
    await page.getByRole('row', { name: /STATUS_WORD/ }).click()

    await expect(mInput).toHaveValue('5')
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

  test('390px 视口展开命令参考：表格在容器内横向滚动，body 无横向溢出', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    await page.locator('#command-reference-toggle').click()
    await expect(page.getByRole('row', { name: /READ_EIN/ })).toBeVisible()

    const body = page.locator('body')
    const scrollWidth = await body.evaluate((el) => el.scrollWidth)
    const clientWidth = await body.evaluate((el) => el.clientWidth)
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth)

    const shell = page.locator('.command-ref-table-shell')
    expect(await shell.evaluate((el) => getComputedStyle(el).overflowX)).toBe('auto')
    const table = page.locator('.command-ref-table-shell table')
    expect(await table.evaluate((el) => el.scrollWidth)).toBeGreaterThan(
      await shell.evaluate((el) => el.clientWidth),
    )
  })
})
