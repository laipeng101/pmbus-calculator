import { test, expect, type Page } from '@playwright/test'

/**
 * Physical-value input blur transaction contract (v2.5.6):
 *
 * - 只 focus 后 blur（未发生任何编辑）是严格 no-op：不改写 raw、不派发
 *   value/set、不伪造格式编码量化误差请求来源（DOMAIN_MODEL §6.1）；
 * - 真实编辑（fill / 键入）仍按既有合同提交，包括 HALF 显式重输 NaN
 *   得到 canonical 0x7E00 与 special/warn provenance；
 * - Part II §7.6.2：设备读回必须返回主机写入的精确 IEEE 编码——
 *   0x7C01 与 0x7E00 都是 NaN，但 raw word 不同，不得因显示层往返合并。
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

const hexInput = (page: Page) => page.locator('input[placeholder="0000"]')
const valueInput = (page: Page) => page.locator('#value-input')
const quantizationPanel = (page: Page) => page.getByTestId('quantization-error')
const halfSpecialCard = (page: Page) => page.getByTestId('half-special-semantics')

test.describe('HALF untouched blur（1280×900 dark）', () => {
  test.beforeEach(async ({ page }) => {
    await setTheme(page, 'dark')
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    await page.getByRole('tab', { name: /HALF/ }).click()
  })

  test('raw 7C01（非规范 NaN）无操作 focus/blur 后 raw 不变、误差隐藏、特殊值卡仍在', async ({
    page,
  }) => {
    await hexInput(page).fill('7C01')
    await hexInput(page).press('Tab')
    await expect(valueInput(page)).toHaveValue('NaN')
    await expect(halfSpecialCard(page)).toHaveCount(1)
    await expect(quantizationPanel(page)).toHaveCount(0)

    // 未编辑任何字符：focus -> blur
    await valueInput(page).click()
    await valueInput(page).press('Tab')
    await expect(hexInput(page)).toHaveValue('7C01')
    await expect(valueInput(page)).toHaveValue('NaN')
    await expect(quantizationPanel(page)).toHaveCount(0)
    await expect(halfSpecialCard(page)).toHaveCount(1)
    await expectNoBodyHorizontalOverflow(page)
  })

  test('raw FC01（负号非规范 NaN）无操作 blur 后 raw 不变', async ({ page }) => {
    await hexInput(page).fill('FC01')
    await hexInput(page).press('Tab')
    await expect(valueInput(page)).toHaveValue('NaN')

    await valueInput(page).click()
    await valueInput(page).press('Tab')
    await expect(hexInput(page)).toHaveValue('FC01')
    await expect(quantizationPanel(page)).toHaveCount(0)
  })

  test('显式重输 NaN 仍 canonical 化为 7E00 并出现 special provenance', async ({ page }) => {
    await hexInput(page).fill('7C01')
    await hexInput(page).press('Tab')
    await expect(valueInput(page)).toHaveValue('NaN')
    await expect(quantizationPanel(page)).toHaveCount(0)

    // 真实用户重输：先清空（过渡态，不提交）再输入 NaN。字段已显示 NaN 时
    // 同值 fill 不触发 React onChange，必须经过真实编辑事务。
    await valueInput(page).fill('')
    await valueInput(page).fill('NaN')
    await expect(hexInput(page)).toHaveValue('7E00')
    await expect(quantizationPanel(page)).toHaveCount(1)
    await expect(quantizationPanel(page)).toContainText('NaN → NaN')
    await expect(quantizationPanel(page)).toHaveAttribute('data-kind', 'warn')
    await expect(halfSpecialCard(page)).toHaveCount(1)
  })

  test('Enter 触发的 untouched blur 同样是 no-op', async ({ page }) => {
    await hexInput(page).fill('7C01')
    await hexInput(page).press('Tab')
    await expect(valueInput(page)).toHaveValue('NaN')

    await valueInput(page).click()
    await valueInput(page).press('Enter')
    await expect(hexInput(page)).toHaveValue('7C01')
    await expect(quantizationPanel(page)).toHaveCount(0)
  })
})

test.describe('LINEAR11 untouched blur（360×800 light）', () => {
  test.beforeEach(async ({ page }) => {
    await setTheme(page, 'light')
    await page.setViewportSize({ width: 360, height: 800 })
    await page.goto('/')
  })

  test('raw 0801（N=1,Y=1）无操作 focus/blur 后 raw、N、Y 不变、误差隐藏', async ({ page }) => {
    await hexInput(page).fill('0801')
    await hexInput(page).press('Tab')
    await expect(valueInput(page)).toHaveValue('2')
    await expect(quantizationPanel(page)).toHaveCount(0)

    await valueInput(page).click()
    await valueInput(page).press('Tab')
    await expect(hexInput(page)).toHaveValue('0801')
    await expect(valueInput(page)).toHaveValue('2')
    await expect(page.getByLabel('N 值 (指数)')).toHaveValue('1')
    await expect(page.getByLabel('Y（11 位有符号整数）')).toHaveValue('1')
    await expect(quantizationPanel(page)).toHaveCount(0)
    await expectNoBodyHorizontalOverflow(page)
  })

  test('显式编辑物理值仍提交（0801 -> 输入 2 -> canonical 0002 且 provenance 出现）', async ({
    page,
  }) => {
    await hexInput(page).fill('0801')
    await hexInput(page).press('Tab')
    await expect(quantizationPanel(page)).toHaveCount(0)

    // 显式请求走 findBestLinear11 的 canonical 编码（N=0,Y=2 -> 0002），
    // 请求与表示值相等（exact: +0.000000）；provenance 必须来自用户事务
    // 而非 blur 伪造——这是与 untouched blur 相反的路径。字段已显示 2，
    // 同值 fill 不触发 React onChange，先清空再输入。
    await valueInput(page).fill('')
    await valueInput(page).fill('2')
    await expect(quantizationPanel(page)).toHaveCount(1)
    await expect(quantizationPanel(page)).toContainText('+0.000000')
    await expect(hexInput(page)).toHaveValue('0002')
  })
})
