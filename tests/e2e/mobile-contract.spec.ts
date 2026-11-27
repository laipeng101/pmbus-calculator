import { test, expect, type Page } from '@playwright/test'
import {
  expectNoHorizontalOverflow,
  expectTextInside,
  expectWrappedInContainer,
} from './helpers/layout'

// Pixel 7 仿真用于验证触摸交互。Playwright 的 click() 使用鼠标，
// 需要触发触摸事件时用 locator.tap() 或 page.touchscreen.tap()。

const VALUE_INPUT = '#value-input'
const RAW_HEX_INPUT = '#raw-hex-input'
const OVERLONG_ERROR = /输入过长，未提交/

test.describe('390 px 触摸交互', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('./')
  })

  test(
    'L16：触摸切换相对值后禁用无结果复制，标称零可触摸复制',
    { tag: '@browser-smoke' },
    async ({ page, context }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'])
      await page.getByRole('tab', { name: /LINEAR16/ }).tap()
      await page.locator(RAW_HEX_INPUT).fill('0100')
      await page.getByRole('radio', { name: '相对值', exact: true }).tap()
      const copy = page.getByRole('button', { name: '物理值', exact: true })
      await expect(copy).toBeDisabled()
      const reason = page.locator('#physical-value-copy-reason')
      await expect(reason).toContainText('标称参考值')
      await expectTextInside(reason)
      await page.locator('#l16-nominal-vout').fill('0')
      await page.locator('#l16-nominal-vout').press('Tab')
      await expect(copy).toBeEnabled()
      await copy.tap()
      await expect(page.getByText('已复制: 物理值', { exact: true })).toBeVisible()
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('0')
      await expectNoHorizontalOverflow(page)
    },
  )

  test(
    '位映射支持触摸收起、刷新记忆与展开后继续配置',
    { tag: '@browser-smoke' },
    async ({ page }) => {
      const toggle = page.getByTestId('bit-mapping-raw-word-toggle')
      await expect(toggle).toHaveAttribute('aria-expanded', 'true')
      await toggle.tap()
      await expect(page.locator('#bit-mapping-raw-word-content')).toBeHidden()
      await page.reload()
      await expect(toggle).toHaveAttribute('aria-expanded', 'false')
      await toggle.tap()
      await page.getByRole('button', { name: '位 0: 0', exact: true }).tap()
      await expect(page.locator(RAW_HEX_INPUT)).toHaveValue('0001')
      await expect(page.locator(VALUE_INPUT)).toHaveValue('1')
      await expectNoHorizontalOverflow(page)
    },
  )

  test(
    'Hex 步进器可触摸单次增减，且触摸目标足够大',
    { tag: '@browser-smoke' },
    async ({ page }) => {
      // coarse-pointer 几何合同：步进区宽 >=44px、单按钮高 >=28px、shell 高 >=66px
      //（文档 ~66px 的下界，代码 min-height 4.125rem）。
      const field = page.locator('[data-testid="raw-hex-input-field"]')
      const up = page.locator('[data-testid="raw-hex-input-step-up"]')
      const down = page.locator('[data-testid="raw-hex-input-step-down"]')
      const metrics = await field.evaluate((el) => {
        const fieldRect = el.getBoundingClientRect()
        const upRect = el
          .querySelector('[data-testid="raw-hex-input-step-up"]')
          ?.getBoundingClientRect()
        return {
          shellHeight: fieldRect.height,
          stepperWidth: upRect ? fieldRect.right - upRect.left : 0,
          upHeight: upRect?.height ?? 0,
        }
      })
      expect(metrics.shellHeight).toBeGreaterThanOrEqual(66)
      expect(metrics.stepperWidth).toBeGreaterThanOrEqual(44)
      expect(metrics.upHeight).toBeGreaterThanOrEqual(28)

      // 真实触摸屏 tap 驱动同一 canonical state：0000 -> 0001 -> 0000。
      await up.tap()
      await expect(page.locator(RAW_HEX_INPUT)).toHaveValue('0001')
      await expect(page.locator(VALUE_INPUT)).toHaveValue('1')
      await down.tap()
      await expect(page.locator(RAW_HEX_INPUT)).toHaveValue('0000')
      // 触摸 tap 全程无 blur 提交副作用：本测试未先聚焦输入框（activeElement 是
      // body，焦点保持合同由桌面 hex-stepper 套件的 activeElement 断言承担），
      // 这里验证步进后输入框仍可用且 canonical 状态一致。
      await expect(page.locator(RAW_HEX_INPUT)).toBeEnabled()
    },
  )

  test('轻触各模式标签后页面完整显示', { tag: '@browser-smoke' }, async ({ page }) => {
    for (const mode of [/LINEAR16/, /DIRECT/, /HALF/, /VOUT_MODE/, /LINEAR11/]) {
      const tab = page.getByRole('tab', { name: mode })
      await tab.tap()
      await expect(tab).toHaveAttribute('aria-selected', 'true')
      await expect(page.getByTestId('result-panel')).toBeVisible()
      if (mode.source === 'VOUT_MODE')
        await expect(page.getByTestId('vout-mode-config-summary')).toBeVisible()
      await expectNoHorizontalOverflow(page)
    }
  })

  test('轻触 N 打开术语说明，轻触外部关闭', { tag: '@browser-smoke' }, async ({ page }) => {
    // v2.6.7：独立术语行的 exponent（N）触发器 hitbox 修复后，真实触摸路径
    // 必须保持同一开/关合同（tap 走 touchscreen，不是 click 的 mouse 路径）。
    await page.getByRole('tab', { name: /VOUT_MODE/ }).tap()
    const nTrigger = page
      .getByTestId('vout-term-row')
      .locator('[data-testid="term-trigger-exponent"]')
    await nTrigger.tap()
    await expect(page.locator('[data-testid="term-popover-exponent"]')).toBeVisible()
    await expectNoHorizontalOverflow(page)
    await page.touchscreen.tap(8, 8)
    await expect(page.locator('[data-testid="term-popover-exponent"]')).toHaveCount(0)
  })

  test(
    '命令参考：390 下展开可读、表格在容器内横向滚动',
    { tag: '@browser-smoke' },
    async ({ page }) => {
      const toggle = page.locator('#command-reference-toggle')
      await toggle.tap()
      await expect(toggle).toHaveAttribute('aria-expanded', 'true')
      await expect(page.getByRole('row', { name: /VOUT_COMMAND/ })).toBeVisible()
      await expectNoHorizontalOverflow(page)
      const shell = page.locator('.command-ref-table-shell')
      await expect(shell).toHaveCSS('overflow-x', 'auto')
      expect(await shell.evaluate((el) => el.scrollWidth)).toBeGreaterThan(
        await shell.evaluate((el) => el.clientWidth),
      )
      await shell.evaluate((el) => (el.scrollLeft = el.scrollWidth))
      expect(await shell.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)
    },
  )

  test('轻触偏好或位按钮立即生效，悬停说明不残留', { tag: '@browser-smoke' }, async ({ page }) => {
    await page.getByRole('tab', { name: /LINEAR11/ }).tap()

    // 带 tooltip 的偏好按钮：第一次 tap 必须直接执行切换动作。
    const prefix = page.getByRole('button', { name: '0x 前缀' })
    await prefix.scrollIntoViewIfNeeded()
    await expect(prefix).toHaveAttribute('aria-pressed', 'true')
    await prefix.tap()
    await expect(prefix).toHaveAttribute('aria-pressed', 'false')

    // coarse pointer 不产生 hover 浮层（pointerType 过滤 + matchMedia 门禁）。
    await expect(page.getByTestId('control-tooltip-copy-pref-prefix')).toHaveCount(0)

    // 位按钮第一次 tap 同样直接翻转。
    const bit = page.locator('.bitfield-bit').first()
    await bit.tap()
    await expect(bit).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('control-tooltip-bit-toggle')).toHaveCount(0)
  })
})

test.describe('DIRECT 超长输入与触摸失焦', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('./')
    await page.getByRole('tab', { name: /DIRECT/ }).tap()
  })

  async function setDirectCoefficients(page: Page, m: number, b: number, r: number) {
    await page.locator('#direct-coeff-m-input').fill(String(m))
    await page.locator('#direct-coeff-m-input').press('Tab')
    await page.locator('#direct-coeff-b-input').fill(String(b))
    await page.locator('#direct-coeff-b-input').press('Tab')
    await page.locator('#direct-coeff-r-input').fill(String(r))
    await page.locator('#direct-coeff-r-input').press('Tab')
  }

  test('360 px：超长提示换行，触摸失焦后原字仍为 FFFF', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 })
    await setDirectCoefficients(page, 1, 1, 17)
    await page.locator(RAW_HEX_INPUT).fill('FFFF')
    await page.locator(RAW_HEX_INPUT).press('Tab')
    await expect(page.getByTestId('result-value')).toHaveText('-1')
    await expect(page.getByRole('alert').filter({ hasText: '重新输入显示值' })).toBeVisible()

    await page.locator(VALUE_INPUT).fill('9'.repeat(4_097))
    await expectWrappedInContainer(page.getByText(OVERLONG_ERROR))
    await expectNoHorizontalOverflow(page)

    // 触摸另一个真实控件（raw 输入框）触发物理值输入失焦。
    await page.locator(RAW_HEX_INPUT).tap()
    await expect(page.locator(RAW_HEX_INPUT)).toHaveValue('FFFF')
    await expect(page.getByTestId('result-value')).toHaveText('-1')
    await expect(page.getByText(OVERLONG_ERROR)).toBeVisible()
    await expect(page.getByTestId('quantization-error')).toHaveCount(0)
  })

  test(
    '390 px：超长输入后触摸失焦保留精确请求和 +1 误差',
    { tag: '@browser-smoke' },
    async ({ page }) => {
      await setDirectCoefficients(page, 1, 0, -17)
      await page.locator(VALUE_INPUT).fill('100000000000000001')
      await page.locator(VALUE_INPUT).press('Enter')
      await expect(page.locator(RAW_HEX_INPUT)).toHaveValue('0001')
      await expect(page.getByTestId('quantization-error')).toContainText(
        '用户请求 100000000000000001',
      )

      await page.locator(VALUE_INPUT).fill('9'.repeat(4_097))
      await expect(page.getByText(OVERLONG_ERROR)).toBeVisible()

      await page.locator(RAW_HEX_INPUT).tap()
      await expect(page.locator(RAW_HEX_INPUT)).toHaveValue('0001')
      await expect(page.getByText(OVERLONG_ERROR)).toBeVisible()
      await expect(page.getByTestId('quantization-error')).toContainText(
        '用户请求 100000000000000001',
      )
      await expect(page.getByTestId('quantization-error')).toContainText(
        'raw 精确表示 100000000000000000',
      )
      await expect(page.getByTestId('quantization-error')).toContainText('+1（约 1e-15%）')
    },
  )
})

test.describe('360 px 错误提示换行', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 })
    await page.goto('./')
  })

  test('360 px 下 LINEAR16 整数输入错误完整换行', async ({ page }) => {
    await page.getByRole('tab', { name: /LINEAR16/ }).tap()
    const vInput = page.getByLabel('V（16 位无符号，0～65535）')
    await vInput.fill('12abc')
    const error = page.getByText(/仅允许十进制整数/)
    await expect(error).toBeVisible()
    await expectWrappedInContainer(error)
    await expect(page.locator(RAW_HEX_INPUT)).toHaveValue('0000')
    await expectNoHorizontalOverflow(page)
  })
})
