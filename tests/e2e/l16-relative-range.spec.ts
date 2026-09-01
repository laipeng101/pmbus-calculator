import { test, expect, type Page } from '@playwright/test'
import { appUrl } from './helpers/app-url'

/**
 * Relative ULINEAR16 derivation-range diagnostics (v2.5.9).
 *
 * X = V_NOM × R multiplies two finite, non-negative numbers; the product can
 * still leave the double range (+Infinity) or underflow to 0 with nonzero
 * factors. The result card, formula, calculation steps, warning and the
 * 物理值 copy answer from ONE classification (src/app/relative-voltage.ts):
 *
 * - overflow / underflow: final value '—', shared diagnostic on every
 *   surface, 物理值 copy disabled with an accessible reason, raw Hex /
 *   LE / BE copies stay enabled, C macro keeps the raw data without a fake
 *   voltage;
 * - true zeros (a zero factor) stay exact, finite and copyable;
 * - huge-but-finite and subnormal references stay fully computed;
 * - recovery is natural: fixing the inputs restores results without a
 *   reload or a mode switch.
 *
 * The inputs themselves are never rejected or clipped (v2.5.8 contract):
 * range errors belong to the derivation, not to the text syntax.
 */

async function setTheme(page: Page, theme: 'light' | 'dark') {
  await page.addInitScript((value) => {
    localStorage.setItem('pmbus-calculator:theme', value)
  }, theme)
}

async function expectNoBodyHorizontalOverflow(page: Page) {
  const { scrollWidth, clientWidth } = await page.locator('body').evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }))
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth)
}

const hexInput = (page: Page) => page.locator('#raw-hex-input')
const nominal = (page: Page) => page.locator('#l16-nominal-vout')
const resultValue = (page: Page) => page.getByTestId('result-value')
const physicalCopyButton = (page: Page) => page.getByRole('button', { name: '物理值' })

/** Enter relative ULINEAR16 (shared byte 0x98, N=-8) with a raw word. */
async function setupRelative(page: Page, raw: string) {
  await page.getByRole('tab', { name: /LINEAR16/ }).click()
  await page.getByRole('radio', { name: '相对值' }).click()
  await expect(page.getByTestId('vout-mode-byte')).toHaveText('0x98')
  await hexInput(page).fill(raw)
  await expect(hexInput(page)).toHaveValue(raw)
}

test.describe('relative ULINEAR16 derivation range（1280×900 dark）', () => {
  test.beforeEach(async ({ page }) => {
    await setTheme(page, 'dark')
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto(appUrl())
  })

  test('有限基线：98/0100 nominal 12 → ratio 1，X=12 且物理值复制可用', async ({ page }) => {
    await setupRelative(page, '0100')
    await nominal(page).fill('12')
    await expect(resultValue(page)).toHaveText('12')
    await expect(physicalCopyButton(page)).toBeEnabled()
    await expect(page.locator('#physical-value-copy-reason')).toHaveCount(0)
  })

  test('溢出：98/0200 nominal 1e308 → 结果 —、诊断出现在警告与步骤、物理值复制禁用', async ({
    page,
  }) => {
    await setupRelative(page, '0200')
    await nominal(page).fill('1e308')

    // 结果卡片：—，绝不显示 Infinity
    await expect(resultValue(page)).toHaveText('—', { timeout: 2000 })
    await expect(page.getByTestId('result-panel')).not.toContainText('Infinity')

    // 警告（InfoPanel）携带共享诊断
    const alerts = page.locator('section[aria-label="提示信息"]')
    await expect(alerts.getByText(/计算结果超出 JavaScript Number 可表示范围/)).toHaveCount(1)

    // 计算步骤：最终电压以 — 结尾，无 Infinity；标称与比值仍可见
    await page.locator('[data-testid="calculation-steps-summary"]').click()
    const steps = page.locator('[data-testid="calculation-steps"]')
    await expect(steps).toContainText(
      'X = 1e+308 × 2 = —（计算结果超出 JavaScript Number 可表示范围）',
    )
    await expect(steps).toContainText('V_NOM（VOUT_COMMAND 标称值） = 1e+308')
    await expect(steps).not.toContainText('Infinity')

    // 物理值复制禁用且有可访问原因；Hex/LE/BE 复制仍可用
    await expect(physicalCopyButton(page)).toBeDisabled()
    await expect(page.locator('#physical-value-copy-reason')).toContainText('物理值复制不可用')
    await expect(page.getByRole('button', { name: 'LE 字节' })).toBeEnabled()
    await expect(page.getByRole('button', { name: 'BE 字节' })).toBeEnabled()
    await expect(page.getByRole('button', { name: 'C 代码' })).toBeEnabled()
  })

  test('大有限值不被拒绝：98/0100 nominal 1e308 → X=1e308，复制可用', async ({ page }) => {
    await setupRelative(page, '0100')
    await nominal(page).fill('1e308')
    await expect(resultValue(page)).toHaveText('1e+308')
    await expect(physicalCopyButton(page)).toBeEnabled()
  })

  test('非零 subnormal 不被拒绝：98/0100 nominal 5e-324 → 有限结果', async ({ page }) => {
    await setupRelative(page, '0100')
    await nominal(page).fill('5e-324')
    await expect(resultValue(page)).toHaveText('5e-324')
    await expect(physicalCopyButton(page)).toBeEnabled()
  })

  test('下溢：90/0001 nominal 5e-324 → 结果 —、下溢诊断、复制禁用', async ({ page }) => {
    await setupRelative(page, '0001')
    // N=-16 → 共享字节 0x90（相对 + 参数 -16）
    await page.locator('#l16-n-input').fill('-16')
    await expect(page.getByTestId('vout-mode-byte')).toHaveText('0x90')
    await nominal(page).fill('5e-324')
    await expect(resultValue(page)).toHaveText('—', { timeout: 2000 })
    const alerts = page.locator('section[aria-label="提示信息"]')
    await expect(alerts.getByText(/计算下溢/)).toHaveCount(1)
    await expect(physicalCopyButton(page)).toBeDisabled()
    await expect(page.locator('#physical-value-copy-reason')).toContainText('计算下溢')
  })

  test('真零不是下溢：98/0000 nominal 1e308 → 0 且复制可用', async ({ page }) => {
    await setupRelative(page, '0000')
    await nominal(page).fill('1e308')
    await expect(resultValue(page)).toHaveText('0')
    await expect(physicalCopyButton(page)).toBeEnabled()
    const alerts = page.locator('section[aria-label="提示信息"]')
    await expect(alerts.getByText(/计算下溢/)).toHaveCount(0)
    // R=0 是非符合性数据（§8.5.2）：数学结果保持精确 0，但状态级告警必须出现。
    await expect(alerts.getByText(/要求相对值恒为正/)).toHaveCount(1)
  })

  test('§8.5.2 非符合性向量：98/0000 nominal 12 → X=0、R=0 告警、复制可用', async ({ page }) => {
    await setupRelative(page, '0000')
    await nominal(page).fill('12')
    // 数学结果保持精确 0 —— 不伪造饱和或错误结果。
    await expect(resultValue(page)).toHaveText('0')
    const alerts = page.locator('section[aria-label="提示信息"]')
    await expect(alerts.getByText(/要求相对值恒为正/)).toHaveCount(1)
    await expect(alerts.getByText(/§8\.5\.2/)).toHaveCount(1)
    await expect(alerts.getByText(/计算下溢/)).toHaveCount(0)
    await expect(alerts.getByText(/超出 JavaScript Number 可表示范围/)).toHaveCount(0)
    await expect(physicalCopyButton(page)).toBeEnabled()
  })

  test('nominal=0 是 decode-only 真零：98/FFFF nominal 0 → 0', async ({ page }) => {
    await setupRelative(page, 'FFFF')
    await nominal(page).fill('0')
    await expect(resultValue(page)).toHaveText('0')
    await expect(physicalCopyButton(page)).toBeEnabled()
    // ratio ≠ 0：不是 R=0 非符合性状态。
    await expect(
      page.locator('section[aria-label="提示信息"]').getByText(/要求相对值恒为正/),
    ).toHaveCount(0)
  })

  test('缺参考值：98/0200 nominal 空 → 比值可见、结果 —（既有行为）', async ({ page }) => {
    await setupRelative(page, '0200')
    await expect(resultValue(page)).toHaveText('—')
    // 缺参考值的 InfoPanel 提示保持既有文案：比值可解、最终电压缺失
    await expect(
      page
        .locator('section[aria-label="提示信息"]')
        .getByText(/需要 VOUT_COMMAND 标称参考值才能计算最终电压/),
    ).toHaveCount(1)
    // 既有行为保持：缺参考值不禁用物理值复制（复制的是 —，不是过期电压）
    await expect(physicalCopyButton(page)).toBeEnabled()
  })

  test('转换链：正常→溢出→正常→下溢→清除→重填 全程自然恢复，无需刷新', async ({ page }) => {
    await setupRelative(page, '0200')

    // 正常：12 × 2 = 24
    await nominal(page).fill('12')
    await expect(resultValue(page)).toHaveText('24')

    // 溢出：1e308 × 2
    await nominal(page).fill('1e308')
    await expect(resultValue(page)).toHaveText('—')
    await expect(physicalCopyButton(page)).toBeDisabled()

    // 正常恢复：1e307 × 2 = 2e307（有限）
    await nominal(page).fill('1e307')
    await expect(resultValue(page)).toHaveText('2e+307')
    await expect(physicalCopyButton(page)).toBeEnabled()

    // 下溢：切到 N=-16（0x90）、raw 0001、nominal 5e-324
    await page.locator('#l16-n-input').fill('-16')
    await expect(page.getByTestId('vout-mode-byte')).toHaveText('0x90')
    await hexInput(page).fill('0001')
    await nominal(page).fill('5e-324')
    await expect(resultValue(page)).toHaveText('—')
    await expect(physicalCopyButton(page)).toBeDisabled()

    // 真实键盘清空 → blur：回到缺参考值状态，比值仍显示
    await nominal(page).click()
    await nominal(page).press('ControlOrMeta+a')
    await nominal(page).press('Backspace')
    await nominal(page).press('Tab')
    await expect(nominal(page)).toHaveValue('')
    await expect(resultValue(page)).toHaveText('—')
    await expect(physicalCopyButton(page)).toBeEnabled()

    // 重填恢复有限结果：12 × 2^-16
    await nominal(page).fill('12')
    await expect(resultValue(page)).toHaveText('0.00018310546875')
    await expect(physicalCopyButton(page)).toBeEnabled()
    await expectNoBodyHorizontalOverflow(page)
  })

  test('窄屏与浅色/深色：溢出诊断与长公式在 390/360 无横向溢出', async ({ page }) => {
    await setTheme(page, 'light')
    await setupRelative(page, '0200')
    await nominal(page).fill('1e308')
    await expect(resultValue(page)).toHaveText('—')

    for (const width of [390, 360]) {
      await page.setViewportSize({ width, height: 844 })
      await expect(
        page.locator('section[aria-label="提示信息"]').getByText(/计算结果超出/),
      ).toHaveCount(1)
      await expectNoBodyHorizontalOverflow(page)
    }
  })
})
