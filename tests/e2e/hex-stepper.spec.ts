import { test, expect, type Page } from '@playwright/test'
import { appUrl } from './helpers/app-url'

// Hex 步进器 + 输入可发现性 + Raw Word 间距的语义回归（v3.1.0）。
//
// 覆盖任务合同 §5.3/§5.4/§5.6：Raw Word 16 位与 VOUT_MODE 8 位的 +1/-1 步进、
// 边界 clamp 永不回绕、空/非法草稿以 committed 值为基值、blur/click 竞态
// （焦点保持在输入框内）、键盘可达性、canonical state 单一来源同步、
// Raw→bit grid 净间距 >=8px、步进目标 >=24×24、360/390 无横向溢出。
// 真实触屏（coarse pointer）合同由 mobile-contract 套件承担。

const RAW_HEX_INPUT = '#raw-hex-input'
const RAW_FIELD = '[data-testid="raw-hex-input-field"]'
const STEP_UP = '[data-testid="raw-hex-input-step-up"]'
const STEP_DOWN = '[data-testid="raw-hex-input-step-down"]'
const VALUE_INPUT = '#value-input'

async function expectNoBodyOverflow(page: Page) {
  const result = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(result.scrollWidth).toBeLessThanOrEqual(result.clientWidth)
}

test.describe('Hex 步进器（Raw Word 16 位）', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(appUrl())
  })

  test('0000 +1/+1/-1 走 canonical state：bit 网格、物理值、Raw Word 展示同步', async ({
    page,
  }) => {
    const up = page.locator(STEP_UP)
    await up.click()
    await expect(page.locator(RAW_HEX_INPUT)).toHaveValue('0001')
    await expect(page.locator('#value-input')).toHaveValue('1')
    await expect(page.getByRole('button', { name: '位 0: 1' })).toBeVisible()
    await expect(page.getByTestId('result-details').getByText('0x0001')).toBeVisible()

    await up.click()
    await expect(page.locator(RAW_HEX_INPUT)).toHaveValue('0002')
    await expect(page.locator(VALUE_INPUT)).toHaveValue('2')

    await page.locator(STEP_DOWN).click()
    await expect(page.locator(RAW_HEX_INPUT)).toHaveValue('0001')
    await expect(page.locator(VALUE_INPUT)).toHaveValue('1')
  })

  test('FFFF 上界与 0000 下界：边界按钮真实 disabled，永不回绕', async ({ page }) => {
    const raw = page.locator(RAW_HEX_INPUT)
    await raw.fill('FFFF')
    await expect(raw).toHaveValue('FFFF')
    const up = page.locator(STEP_UP)
    await expect(up).toBeDisabled()
    const down = page.locator(STEP_DOWN)
    await expect(down).toBeEnabled()
    // 点击 disabled 按钮不产生任何状态变化
    await up.click({ force: true })
    await expect(raw).toHaveValue('FFFF')

    await raw.fill('0000')
    await expect(down).toBeDisabled()
    await expect(up).toBeEnabled()
    await down.click({ force: true })
    await expect(raw).toHaveValue('0000')
  })

  test('空草稿以 committed 值为步进基值并补齐规范位宽', async ({ page }) => {
    const raw = page.locator(RAW_HEX_INPUT)
    await raw.fill('00FE')
    await expect(raw).toHaveValue('00FE')
    // 清空为过渡草稿（不 blur），步进必须从 committed 0x00FE 出发
    await raw.fill('')
    await page.locator(STEP_UP).click()
    await expect(raw).toHaveValue('00FF')
  })

  test('非法草稿以 committed 值为基值，步进清除错误', async ({ page }) => {
    const raw = page.locator(RAW_HEX_INPUT)
    await raw.fill('0005')
    await raw.fill('ZZ')
    await expect(raw).toHaveAttribute('aria-invalid', 'true')
    await page.locator(STEP_UP).click()
    await expect(raw).toHaveValue('0006')
    await expect(raw).not.toHaveAttribute('aria-invalid')
  })

  test('步进点击不转移焦点：blur 提交路径不参与，每次点击只步进一次', async ({ page }) => {
    const raw = page.locator(RAW_HEX_INPUT)
    await raw.fill('0009')
    await expect(raw).toHaveValue('0009')
    await page.locator(STEP_UP).click()
    await expect(raw).toHaveValue('000A')
    // pointerdown preventDefault 的合同后果：焦点仍在文本输入框内
    const activeId = await page.evaluate(() => document.activeElement?.id ?? '')
    expect(activeId).toBe('raw-hex-input')
    // 连续第二次点击继续精确步进一次
    await page.locator(STEP_UP).click()
    await expect(raw).toHaveValue('000B')
  })

  test('键盘可达：Tab 聚焦 +1 按钮，Enter/Space 激活，focus-visible 可见', async ({ page }) => {
    const raw = page.locator(RAW_HEX_INPUT)
    await raw.fill('0000')
    // Tab：输入框 -> +1 按钮
    await page.keyboard.press('Tab')
    const up = page.locator(STEP_UP)
    await expect(up).toBeFocused()
    const outline = await up.evaluate((el) => getComputedStyle(el).outlineStyle)
    expect(outline).not.toBe('none')
    await page.keyboard.press('Enter')
    await expect(raw).toHaveValue('0001')
    await page.keyboard.press('Space')
    await expect(raw).toHaveValue('0002')
    // Shift+Tab 回输入框，再 Tab 到 +1，Tab 到 -1
    await page.keyboard.press('Shift+Tab')
    await expect(raw).toBeFocused()
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    await expect(page.locator(STEP_DOWN)).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(raw).toHaveValue('0001')
  })

  test('模式切换后步进器状态不残留（fresh mount）', async ({ page }) => {
    const raw = page.locator(RAW_HEX_INPUT)
    await raw.fill('0007')
    await page.getByRole('tab', { name: /DIRECT/ }).click()
    await page.getByRole('tab', { name: /LINEAR11/ }).click()
    await expect(raw).toHaveValue('0007')
    await page.locator(STEP_UP).click()
    await expect(raw).toHaveValue('0008')
  })
})

test.describe('Hex 步进器（VOUT_MODE 8 位）', () => {
  test('00↔01 步进、FF 上界禁用，canonical 字节与位网格同步', async ({ page }) => {
    await page.goto(appUrl())
    await page.getByRole('tab', { name: /VOUT_MODE/ }).click()
    const voutHex = page.locator('#vout-mode-input')
    await expect(voutHex).toHaveValue('18')

    // 先到下界 00
    await voutHex.fill('00')
    await expect(voutHex).toHaveValue('00')
    const down = page.locator('[data-testid="vout-mode-input-step-down"]')
    await expect(down).toBeDisabled()
    await page.locator('[data-testid="vout-mode-input-step-up"]').click()
    await expect(voutHex).toHaveValue('01')
    await expect(page.getByTestId('vout-mode-byte')).toHaveText('0x01')

    // 上界 FF
    await voutHex.fill('FF')
    await expect(page.locator('[data-testid="vout-mode-input-step-up"]')).toBeDisabled()
  })
})

test.describe('输入可发现性与几何合同', () => {
  test('Raw Word 编辑 shell 与 bit 网格净垂直间距 >= 8px', async ({ page }) => {
    await page.goto(appUrl())
    for (const width of [360, 390, 1280]) {
      await page.setViewportSize({ width, height: 844 })
      const gap = await page.evaluate(
        ([fieldSel, gridSel]) => {
          const field = document.querySelector(fieldSel as string)
          const grid = document.querySelector(gridSel as string)
          if (!field || !grid) return null
          const a = field.getBoundingClientRect()
          const b = grid.getBoundingClientRect()
          return b.top - a.bottom
        },
        [RAW_FIELD, '.bitfield'],
      )
      expect(gap, `viewport ${width}`).not.toBeNull()
      expect(gap as number, `viewport ${width}`).toBeGreaterThanOrEqual(8)
      await expectNoBodyOverflow(page)
    }
  })

  test('步进目标 >= 24×24 CSS px（WCAG 2.5.8），shell 内共享边界', async ({ page }) => {
    await page.goto(appUrl())
    await page.setViewportSize({ width: 1280, height: 844 })
    for (const sel of [STEP_UP, STEP_DOWN]) {
      const box = await page.locator(sel).boundingBox()
      expect(box).not.toBeNull()
      expect(box!.width).toBeGreaterThanOrEqual(24)
      expect(box!.height).toBeGreaterThanOrEqual(24)
    }
    // 输入框与步进按钮共享同一个 shell 边界（不产生第二层外框）
    const shellMetrics = await page.evaluate((fieldSel) => {
      const field = document.querySelector(fieldSel)
      if (!field) return null
      const cs = getComputedStyle(field)
      const input = field.querySelector('input')
      const inputCs = input ? getComputedStyle(input) : null
      return {
        shellBorder: cs.borderTopWidth,
        inputBorder: inputCs?.borderTopWidth,
        inputBg: inputCs?.backgroundColor,
      }
    }, RAW_FIELD)
    expect(shellMetrics).not.toBeNull()
    expect(shellMetrics!.shellBorder).toBe('1px')
    expect(shellMetrics!.inputBorder).toBe('0px')
    expect(shellMetrics!.inputBg).toBe('rgba(0, 0, 0, 0)')
  })

  test('静止态可编辑字段与只读展示框使用不同表面（light + dark）', async ({ page }) => {
    for (const theme of ['light', 'dark'] as const) {
      await page.addInitScript((t) => localStorage.setItem('pmbus-calculator:theme', t), theme)
      await page.goto(appUrl())
      const inputBg = await page.locator(RAW_FIELD).evaluate((el) => {
        const cs = getComputedStyle(el)
        return { bg: cs.backgroundColor, border: cs.borderTopColor }
      })
      // 辅助结果里的 Raw Word 只读展示框
      const displayBg = await page
        .getByTestId('result-details')
        .locator('div.font-mono')
        .first()
        .evaluate((el) => {
          const cs = getComputedStyle(el)
          return { bg: cs.backgroundColor, border: cs.borderTopColor }
        })
      expect(inputBg.bg, `${theme}: editable 与 display rest 背景必须不同`).not.toBe(displayBg.bg)
      expect(inputBg.border, `${theme}: editable 与 display rest 边框必须不同`).not.toBe(
        displayBg.border,
      )
    }
  })

  test('360/390 移动端：步进器完整可见、无裁切、无 body 横向溢出', async ({ page }) => {
    await page.goto(appUrl())
    for (const width of [360, 390]) {
      await page.setViewportSize({ width, height: 844 })
      const fieldBox = await page.locator(RAW_FIELD).boundingBox()
      expect(fieldBox).not.toBeNull()
      expect(fieldBox!.x).toBeGreaterThanOrEqual(0)
      expect(fieldBox!.x + fieldBox!.width).toBeLessThanOrEqual(width)
      const upBox = await page.locator(STEP_UP).boundingBox()
      expect(upBox).not.toBeNull()
      expect(upBox!.x + upBox!.width).toBeLessThanOrEqual(width)
      // 每轮从确定基线出发，跨 viewport 循环不继承上一步进状态
      await page.locator(RAW_HEX_INPUT).fill('0000')
      await page.locator(STEP_UP).click()
      await expect(page.locator(RAW_HEX_INPUT)).toHaveValue('0001')
      await expectNoBodyOverflow(page)
    }
  })
})
