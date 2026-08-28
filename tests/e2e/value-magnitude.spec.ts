import { test, expect, type Page } from '@playwright/test'

/**
 * v2.5.8 — 解析层不再静默限幅（DOMAIN_MODEL §6.1 / float-parse 合同）：
 *
 * - 语法完整且可由 JavaScript Number 表示的有限值按真实值提交，任何模式
 *   下解析层都不得改写数量级（旧 ±1e20 clamp 已移除）；
 * - DIRECT m=1,b=0,R=-21：1e21 → raw 0001、-1e21 → raw FFFF，
 *   raw 0001 解码回 1e+21；
 * - 完整但溢出为 ±Infinity 的十进制文本（±1e400）显示明确的数值范围
 *   错误，保留旧 committed raw / 请求，不生成新请求；
 * - HALF 显式字面量 NaN / ±Infinity 与十进制溢出必须区分：字面量仍是
 *   一等特殊值，1e400 在 HALF 也报范围错误。
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

const valueInput = (page: Page) => page.locator('#value-input')
const hexInput = (page: Page) => page.locator('#raw-hex-input')
const quantizationPanel = (page: Page) => page.getByTestId('quantization-error')
const VALUE_ERROR_ID = 'value-input-error'
const RANGE_MESSAGE = /数值超出可表示范围/

test.describe('DIRECT 大值请求按真实值提交（1280×900 dark）', () => {
  test.beforeEach(async ({ page }) => {
    await setTheme(page, 'dark')
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    await page.getByRole('tab', { name: /DIRECT/ }).click()
    // 计算器示例向量：m=1、b=0、R=-21
    await page.locator('#direct-coeff-r-input').fill('-21')
  })

  test('1e21 → raw 0001，误差读数 exact；raw 0001 解码回 1e+21', async ({ page }) => {
    await valueInput(page).fill('1e21')
    await expect(hexInput(page)).toHaveValue('0001')
    // 请求 1e21 与 raw 0001 表示值是同一个 double → exact
    await expect(quantizationPanel(page)).toHaveCount(1)
    await expect(quantizationPanel(page)).toHaveAttribute('data-kind', 'ok')

    // 对照路径：直接输入 raw 0001 解码为 1e+21
    await hexInput(page).fill('0001')
    await expect(valueInput(page)).toHaveValue('1e+21')
    await expectNoBodyHorizontalOverflow(page)
  })

  test('-1e21 → raw FFFF', async ({ page }) => {
    await valueInput(page).fill('-1e21')
    await expect(hexInput(page)).toHaveValue('FFFF')
  })

  test('大有限饱和请求保留原始误差基线（1e30 → 7FFF）', async ({ page }) => {
    await valueInput(page).fill('1e30')
    await expect(hexInput(page)).toHaveValue('7FFF')
    await expect(quantizationPanel(page)).toHaveCount(1)
    await expect(quantizationPanel(page)).toHaveAttribute('data-kind', 'error')
  })

  test('±1e400 报范围错误：旧 raw 与 provenance 保持，不生成新请求', async ({ page }) => {
    await valueInput(page).fill('1e21')
    await expect(hexInput(page)).toHaveValue('0001')
    await expect(quantizationPanel(page)).toHaveCount(1)

    await valueInput(page).fill('1e400')
    await expect(valueInput(page)).toHaveAttribute('aria-invalid', 'true')
    await expect(page.locator(`#${VALUE_ERROR_ID}`)).toContainText(RANGE_MESSAGE)
    // 旧 committed raw / 请求不动：面板仍是 1e21 请求的读数
    await expect(hexInput(page)).toHaveValue('0001')
    await expect(quantizationPanel(page)).toHaveCount(1)
    await expect(quantizationPanel(page)).toHaveAttribute('data-kind', 'ok')

    await valueInput(page).fill('-1e400')
    await expect(page.locator(`#${VALUE_ERROR_ID}`)).toContainText(RANGE_MESSAGE)
    await expect(hexInput(page)).toHaveValue('0001')
    await expectNoBodyHorizontalOverflow(page)

    // 合法修正后错误清除并提交
    await valueInput(page).fill('2e21')
    await expect(valueInput(page)).not.toHaveAttribute('aria-invalid', 'true')
    await expect(hexInput(page)).toHaveValue('0002')
  })
})

test.describe('HALF 字面量与十进制溢出区分（1280×900 dark）', () => {
  test.beforeEach(async ({ page }) => {
    await setTheme(page, 'dark')
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    await page.getByRole('tab', { name: /HALF/ }).click()
  })

  test('显式 Infinity 字面量仍编码 7C00 并出现 §7.6.2 卡', async ({ page }) => {
    await valueInput(page).fill('Infinity')
    await expect(hexInput(page)).toHaveValue('7C00')
    await expect(page.getByTestId('half-special-semantics')).toHaveCount(1)
    await expect(quantizationPanel(page)).toHaveAttribute('data-kind', 'warn')
  })

  test('1e400 在 HALF 也报范围错误，不改写旧 raw、不伪造特殊值请求', async ({ page }) => {
    await valueInput(page).fill('1')
    await expect(hexInput(page)).toHaveValue('3C00')

    await valueInput(page).fill('1e400')
    await expect(valueInput(page)).toHaveAttribute('aria-invalid', 'true')
    await expect(page.locator(`#${VALUE_ERROR_ID}`)).toContainText(RANGE_MESSAGE)
    await expect(hexInput(page)).toHaveValue('3C00')
    await expect(page.getByTestId('half-special-semantics')).toHaveCount(0)
    await expect(quantizationPanel(page)).toHaveAttribute('data-kind', 'ok')
    await expectNoBodyHorizontalOverflow(page)
  })
})

test.describe('新错误文案与极值在 360×800 的排版与键盘可达性（v2.5.8）', () => {
  test.beforeEach(async ({ page }) => {
    await setTheme(page, 'light')
    await page.setViewportSize({ width: 360, height: 800 })
    await page.goto('/')
    await page.getByRole('tab', { name: /DIRECT/ }).click()
  })

  async function expectErrorNotClipped(page: Page, errorId: string) {
    const el = page.locator(`#${errorId}`)
    await expect(el).toBeVisible()
    const info = await el.evaluate((node) => {
      const cs = getComputedStyle(node)
      return {
        scrollWidth: node.scrollWidth,
        clientWidth: node.clientWidth,
        whiteSpace: cs.whiteSpace,
      }
    })
    expect(info.scrollWidth).toBeLessThanOrEqual(info.clientWidth + 1)
    expect(info.whiteSpace).not.toBe('nowrap')
  }

  test('1e400 范围错误在 360px 可见、换行、无横向溢出；键盘修复恢复提交', async ({ page }) => {
    await page.locator('#direct-coeff-r-input').fill('-21')
    await valueInput(page).fill('1e21')
    await expect(hexInput(page)).toHaveValue('0001')

    await valueInput(page).fill('1e400')
    await expect(valueInput(page)).toHaveAttribute('aria-invalid', 'true')
    await expect(page.locator(`#${VALUE_ERROR_ID}`)).toContainText(RANGE_MESSAGE)
    await expectErrorNotClipped(page, VALUE_ERROR_ID)
    await expectNoBodyHorizontalOverflow(page)

    // 键盘可达的恢复路径：选中全部 → 删除 → 逐键重输 → Tab
    await valueInput(page).click()
    await valueInput(page).press('ControlOrMeta+a')
    await valueInput(page).press('Backspace')
    await valueInput(page).pressSequentially('2e21')
    await valueInput(page).press('Tab')
    await expect(valueInput(page)).not.toHaveAttribute('aria-invalid', 'true')
    await expect(hexInput(page)).toHaveValue('0002')
  })

  test('极小数 1e-127（R=127）与极大数 1e128（R=-128）的显示与恢复无溢出', async ({ page }) => {
    await page.locator('#direct-coeff-r-input').fill('127')
    await valueInput(page).fill('1e-127')
    await expect(hexInput(page)).toHaveValue('0001')
    await expect(page.getByTestId('result-value')).toHaveText('1e-127')
    await expectNoBodyHorizontalOverflow(page)

    await page.locator('#direct-coeff-r-input').fill('-128')
    await valueInput(page).fill('1e128')
    await expect(hexInput(page)).toHaveValue('0001')
    await expectNoBodyHorizontalOverflow(page)
  })
})
