import { test, expect, type Page } from '@playwright/test'

// Explicit mobile-contract suite (v2.5.13). Runs ONLY under
// playwright.mobile.config.ts (chromium-mobile-contract, Pixel 7 emulation:
// touch, mobile UA, DPR) — the default desktop suite testIgnores this file.
// Coverage rationale: the semantic per-mode suites already assert 390/360
// geometry via explicit setViewportSize inside the desktop project; what this
// file adds is the small set of contracts that need REAL mobile emulation —
// touch taps, per-format conversion smokes and error-text wrapping at the
// tightest viewports — kept in one auditable group instead of duplicating
// every desktop test.

const HEX_INPUT = 'input[placeholder="0000"]'
const VALUE_INPUT = '#value-input'

async function expectNoBodyOverflow(page: Page) {
  const result = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(result.scrollWidth).toBeLessThanOrEqual(result.clientWidth)
}

test.describe('移动端合同：390 触摸与各格式转换 smoke（v2.5.13）', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
  })

  test('LINEAR11：value 编码 hex，页面无横向溢出', async ({ page }) => {
    await page.locator(VALUE_INPUT).fill('12.5')
    await expect(page.locator(HEX_INPUT)).toHaveValue('F819')
    await expectNoBodyOverflow(page)
  })

  test('LINEAR16：整数 V 提交与饱和，页面无横向溢出', async ({ page }) => {
    await page.getByRole('tab', { name: /LINEAR16/ }).click()
    const vInput = page.getByLabel('V（16 位无符号，0～65535）')
    await vInput.fill('+12')
    await vInput.press('Tab')
    await expect(page.locator(HEX_INPUT)).toHaveValue('000C')
    await vInput.fill('70000')
    await vInput.press('Tab')
    await expect(vInput).toHaveValue('65535')
    await expect(page.locator(HEX_INPUT)).toHaveValue('FFFF')
    await expectNoBodyOverflow(page)
  })

  test('DIRECT：value 编码 hex 且 Y 同步', async ({ page }) => {
    await page.getByRole('tab', { name: /DIRECT/ }).click()
    await page.locator(VALUE_INPUT).fill('5')
    await expect(page.locator(HEX_INPUT)).toHaveValue('0005')
    await expect(page.getByLabel('Y（16 位有符号，−32768～32767）')).toHaveValue('5')
    await expectNoBodyOverflow(page)
  })

  test('HALF：十进制 1.5 编码 3E00', async ({ page }) => {
    await page.getByRole('tab', { name: /HALF/ }).click()
    await page.locator(VALUE_INPUT).fill('1.5')
    await expect(page.locator(HEX_INPUT)).toHaveValue('3E00')
    await expectNoBodyOverflow(page)
  })

  test('VOUT_MODE：页面可达且配置摘要可见', async ({ page }) => {
    await page.getByRole('tab', { name: /VOUT_MODE/ }).click()
    await expect(page.getByTestId('vout-mode-config-summary')).toBeVisible()
    await expectNoBodyOverflow(page)
  })

  test('位切换按钮可触摸点击并同步 hex', async ({ page }) => {
    // Pixel 7 仿真带 hasTouch：click 走真实触摸路径。
    await page.getByRole('button', { name: '位 0: 0' }).tap()
    await expect(page.locator(HEX_INPUT)).toHaveValue('0001')
    await expect(page.locator(VALUE_INPUT)).toHaveValue('1')
  })

  test('模式 tab 依次切换保持可用且无横向溢出', async ({ page }) => {
    for (const mode of [/LINEAR16/, /DIRECT/, /HALF/, /VOUT_MODE/, /LINEAR11/]) {
      await page.getByRole('tab', { name: mode }).click()
      await expect(page.getByRole('tab', { name: mode })).toHaveAttribute('aria-selected', 'true')
      await expectNoBodyOverflow(page)
    }
  })

  test('术语气泡：390 下可打开且不溢出，点击外部关闭', async ({ page }) => {
    await page.getByRole('tab', { name: /VOUT_MODE/ }).click()
    const summary = page.getByTestId('vout-mode-config-summary')
    await expect(summary).toBeVisible()
    const trigger = summary.locator('[data-testid="term-trigger-vout-mode"]')
    await trigger.tap()
    await expect(page.locator('[data-testid="term-popover-vout-mode"]')).toBeVisible()
    await expectNoBodyOverflow(page)
    await page.mouse.click(8, 8)
    await expect(page.locator('[data-testid="term-popover-vout-mode"]')).toHaveCount(0)
  })

  test('命令参考：390 下展开可读、表格在容器内横向滚动', async ({ page }) => {
    const toggle = page.locator('#command-reference-toggle')
    await toggle.tap()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByRole('row', { name: /VOUT_COMMAND/ })).toBeVisible()
    await expectNoBodyOverflow(page)
  })
})

test.describe('移动端合同：360 错误文案换行（v2.5.13）', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 })
    await page.goto('/')
  })

  test('DIRECT 超长输入错误在 360 下可见并换行，不改 raw', async ({ page }) => {
    await page.getByRole('tab', { name: /DIRECT/ }).click()
    await page.locator(VALUE_INPUT).fill('9'.repeat(4_097))
    await expect(page.getByText(/输入过长，未提交/)).toBeVisible()
    await expect(page.locator(HEX_INPUT)).toHaveValue('0000')
    await expectNoBodyOverflow(page)
  })

  test('LINEAR16 非法输入错误在 360 下可见并换行', async ({ page }) => {
    await page.getByRole('tab', { name: /LINEAR16/ }).click()
    const vInput = page.getByLabel('V（16 位无符号，0～65535）')
    await vInput.fill('12abc')
    await expect(page.getByText(/仅允许十进制整数/)).toBeVisible()
    await expect(page.locator(HEX_INPUT)).toHaveValue('0000')
    await expectNoBodyOverflow(page)
  })
})
