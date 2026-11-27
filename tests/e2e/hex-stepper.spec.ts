import { test, expect } from '@playwright/test'
import { expectNoHorizontalOverflow } from './helpers/layout'

const RAW_HEX_INPUT = '#raw-hex-input'
const RAW_FIELD = '[data-testid="raw-hex-input-field"]'
const STEP_UP = '[data-testid="raw-hex-input-step-up"]'
const STEP_DOWN = '[data-testid="raw-hex-input-step-down"]'

test.describe('Hex 步进器（Raw Word 16 位）', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('./')
  })

  test('非法 Hex 草稿保留原字，固定前缀的空草稿可恢复为零', async ({ page }) => {
    const raw = page.locator(RAW_HEX_INPUT)
    const value = page.locator('#value-input')
    await raw.fill('0007')
    await expect(value).toHaveValue('7')

    for (const [text, error] of [
      ['1G', /仅允许十六进制数字/],
      ['12345', /最多 4 位十六进制数字/],
    ] as const) {
      await raw.fill(text)
      await raw.press('Tab')
      await expect(raw).toHaveValue(text)
      await expect(raw).toHaveAttribute('aria-invalid', 'true')
      await expect(page.getByText(error)).toBeVisible()
      await expect(value).toHaveValue('7')
    }

    await raw.fill('0x')
    await expect(raw).toHaveValue('')
    await expect(raw).not.toHaveAttribute('aria-invalid', 'true')
    await expect(value).toHaveValue('7')
    await raw.press('Tab')
    await expect(raw).toHaveValue('0000')
    await expect(value).toHaveValue('0')
  })

  test('键盘可达：Tab 聚焦 +1 按钮，Enter/Space 激活，focus-visible 可见', async ({ page }) => {
    const raw = page.locator(RAW_HEX_INPUT)
    await raw.fill('0000')
    // Tab：输入框 -> +1 按钮
    await page.keyboard.press('Tab')
    const up = page.locator(STEP_UP)
    await expect(up).toBeFocused()
    await expect(up.and(page.locator(':focus-visible'))).toBeFocused()
    await expect(up).not.toHaveCSS('outline-width', '0px')
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

  test('离开原字编辑页再返回，步进从最后有效原字开始', async ({ page }) => {
    const raw = page.locator(RAW_HEX_INPUT)
    await raw.fill('0007')
    await raw.fill('000G')
    await expect(raw).toHaveAttribute('aria-invalid', 'true')
    await page.getByRole('tab', { name: /VOUT_MODE/ }).click()
    await expect(raw).toHaveCount(0)
    await page.getByRole('tab', { name: /LINEAR11/ }).click()
    await expect(raw).toHaveValue('0007')
    await expect(raw).not.toHaveAttribute('aria-invalid', 'true')
    await page.locator(STEP_UP).click()
    await expect(raw).toHaveValue('0008')
  })
})

test.describe('Hex 步进器（VOUT_MODE 8 位）', () => {
  test('8 位配置字节步进同步位图，达到边界时禁用按钮', async ({ page }) => {
    await page.goto('./')
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
    await expect(
      page.getByRole('button', { name: '第 0 位，参数，当前为 1', exact: true }),
    ).toBeVisible()

    await down.click()
    await expect(voutHex).toHaveValue('00')
    await expect(down).toBeDisabled()

    // 上界 FF
    await voutHex.fill('FF')
    await expect(page.locator('[data-testid="vout-mode-input-step-up"]')).toBeDisabled()
  })
})

test.describe('步进器尺寸与输入外观', () => {
  test('原字输入与位映射之间至少间隔 8 px', async ({ page }) => {
    await page.goto('./')
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
      await expectNoHorizontalOverflow(page)
    }
  })

  test('步进目标 >= 24×24 CSS px（WCAG 2.5.8），shell 内共享边界', async ({ page }) => {
    await page.goto('./')
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

  for (const theme of ['light', 'dark'] as const) {
    const label = theme === 'light' ? '浅色' : '暗色'
    test(`${label}主题下原字输入与只读原字展示具有不同外观`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme })
      await page.goto('./')
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      const input = page.getByTestId('raw-hex-input-field')
      const readout = page
        .getByRole('region', { name: '辅助结果' })
        .getByText('0x0000', { exact: true })
      const colors = (locator: typeof input) =>
        locator.evaluate((element) => {
          const style = getComputedStyle(element)
          return { background: style.backgroundColor, border: style.borderTopColor }
        })
      const editable = await colors(input)
      const readonly = await colors(readout)
      expect(editable.background).not.toBe(readonly.background)
      expect(editable.border).not.toBe(readonly.border)
    })
  }

  test('360/390 px 窄屏下步进器可用且完整显示', async ({ page }) => {
    await page.goto('./')
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
      await expectNoHorizontalOverflow(page)
    }
  })
})
