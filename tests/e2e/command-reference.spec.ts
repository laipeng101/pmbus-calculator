import { test, expect } from '@playwright/test'
import { COMMAND_METADATA } from '../../src/legacy/command-metadata'
import { appUrl } from './helpers/app-url'

test.describe('命令参考（只读，无副作用）', () => {
  test('默认折叠；展开后显示全部 13 条命令行', async ({ page }) => {
    await page.goto(appUrl())
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

  test('展开、阅读与收起均保留模式和 Raw Word', async ({ page }) => {
    await page.goto(appUrl())
    const toggle = page.locator('#command-reference-toggle')
    const hexInput = page.locator('input[placeholder="0000"]')
    const l11Tab = page.getByRole('tab', { name: /LINEAR11/ })
    await hexInput.fill('1234')
    await hexInput.press('Tab')

    await toggle.click()
    await page.getByRole('row', { name: /READ_VIN/ }).click()
    await expect(hexInput).toHaveValue('1234')
    await expect(l11Tab).toHaveAttribute('aria-selected', 'true')

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(hexInput).toHaveValue('1234')
    await expect(l11Tab).toHaveAttribute('aria-selected', 'true')
  })

  test('表格展示命令码、事务、单位、格式来源与规范章节', async ({ page }) => {
    await page.goto(appUrl())
    await page.locator('#command-reference-toggle').click()

    const vinRow = page.getByRole('row', { name: /READ_VIN/ })
    await expect(vinRow).toContainText('0x88')
    await expect(vinRow).toContainText('读 Read Word')
    await expect(vinRow).toContainText('V')
    await expect(vinRow).toContainText('由器件资料决定')
    await expect(vinRow).toContainText('PMBus Part II §18.1')
  })

  test('STATUS_WORD 标注状态位及清除 UNKNOWN 位的条件', async ({ page }) => {
    await page.goto(appUrl())
    await page.locator('#command-reference-toggle').click()
    const statusRow = page.getByRole('row', { name: /STATUS_WORD/ })
    await expect(statusRow).toContainText('状态位')
    await expect(statusRow).toContainText('STATUS 位')
    await expect(statusRow).toContainText('bit field')
    await expect(statusRow).toContainText('通常为 Read Word')
    await expect(statusRow).toContainText('特殊写入仅用于清除 UNKNOWN 位')
    await expect(statusRow).toContainText('0x0100')
  })

  test('READ_EIN 行渲染 Block Read 与规范字节数/有效载荷冲突说明', async ({ page }) => {
    await page.goto(appUrl())
    await page.locator('#command-reference-toggle').click()
    const einRow = page.getByRole('row', { name: /READ_EIN/ })
    await expect(einRow).toContainText('Block 块')
    await expect(einRow).toContainText('读 Block Read')
    await expect(einRow).toContainText('规范内部冲突')
    await expect(einRow).toContainText('§18.13 描述 6 个数据字节')
    await expect(einRow).toContainText('Appendix I Table 31 列为 5')
    await expect(einRow).toContainText('计算器不是 READ_EIN packet-length authority')
  })

  test('所有带 note 的命令行都实际渲染 metadata 的说明文本', async ({ page }) => {
    await page.goto(appUrl())
    await page.locator('#command-reference-toggle').click()
    for (const { label, note } of Object.values(COMMAND_METADATA)) {
      if (!note) continue
      const row = page.getByRole('row').filter({
        has: page.getByRole('cell', { name: label, exact: true }),
      })
      await expect(row.getByRole('cell', { name: note, exact: true })).toBeVisible()
    }
  })

  test('阅读命令行不修改 DIRECT 系数', async ({ page }) => {
    await page.goto(appUrl())
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
    await page.goto(appUrl())
    await page.locator('#command-reference-toggle').click()
    await expect(page.getByRole('button', { name: /应用.*预设/ })).toHaveCount(0)
    await expect(page.getByRole('combobox')).toHaveCount(0)
  })

  test('查看 VOUT_COMMAND 保留 L16 模式、配置字节与计算结果', async ({ page }) => {
    await page.goto(appUrl())
    const l16Tab = page.getByRole('tab', { name: /LINEAR16/ })
    await l16Tab.click()
    const voutModeInput = page.locator('#vout-mode-input')
    await voutModeInput.fill('17')
    await voutModeInput.press('Tab')
    const rawInput = page.locator('input[placeholder="0000"]')
    await rawInput.fill('0010')
    await rawInput.press('Tab')

    await page.locator('#command-reference-toggle').click()
    const command = page.getByRole('row', { name: /VOUT_COMMAND/ })
    await expect(command).toContainText('跟随 VOUT_MODE')
    await command.click()

    await expect(l16Tab).toHaveAttribute('aria-selected', 'true')
    await expect(voutModeInput).toHaveValue('17')
    await expect(rawInput).toHaveValue('0010')
    await expect(page.locator('#value-input')).toHaveValue('0.03125')
  })

  test('390px 视口展开命令参考：表格在容器内横向滚动，body 无横向溢出', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(appUrl())
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
