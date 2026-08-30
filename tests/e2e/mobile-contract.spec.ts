import { test, expect, type Locator, type Page } from '@playwright/test'

// Explicit mobile-contract suite (v2.5.13, touch contract tightened in
// v2.5.14). Runs ONLY under playwright.mobile.config.ts
// (chromium-mobile-contract, Pixel 7 emulation: touch, mobile UA, DPR) — the
// default desktop suite testIgnores this file.
//
// Touch semantics (Playwright contract): locator.tap()/touchscreen.tap() go
// through page.touchscreen and require hasTouch; locator.click() goes through
// page.mouse and is NOT converted to touch by mobile emulation. Everything
// that must prove touch usability here (mode tabs, term bubbles, outside
// close, outside blur) uses tap; a one-shot event probe documents that real
// touch events arrive. Keyboard-only transactions stay keyboard.
//
// Coverage rationale: the semantic per-mode suites already assert 390/360
// geometry via explicit setViewportSize inside the desktop project; what this
// file adds is the small set of contracts that need REAL mobile emulation —
// touch taps, per-format conversion smokes, error-text wrapping at the
// tightest viewports and the v2.5.14 rejected-edit touch-blur paths (raw and
// exact-provenance baselines) — kept in one auditable group instead of
// duplicating every desktop test.

const HEX_INPUT = 'input[placeholder="0000"]'
const VALUE_INPUT = '#value-input'
const RAW_HEX_INPUT = '#raw-hex-input'
const OVERLONG_ERROR = /输入过长，未提交/

async function expectNoBodyOverflow(page: Page) {
  const result = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(result.scrollWidth).toBeLessThanOrEqual(result.clientWidth)
}

/** The error element renders at least two text lines inside its container. */
async function expectWrappedInContainer(locator: Locator) {
  await expect(locator).toBeVisible()
  const box = await locator.boundingBox()
  expect(box).not.toBeNull()
  const metrics = await locator.evaluate((el) => {
    const style = window.getComputedStyle(el)
    return {
      lineHeight: Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.5,
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }
  })
  // No horizontal clipping inside the element itself.
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1)
  // Wrapped: at least two rendered lines (text-xs → 16px line-height).
  expect(box!.height).toBeGreaterThanOrEqual(metrics.lineHeight * 1.8)
}

test.describe('移动端合同：390 触摸与各格式转换 smoke（v2.5.13/v2.5.14）', () => {
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
    await page.getByRole('tab', { name: /LINEAR16/ }).tap()
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
    await page.getByRole('tab', { name: /DIRECT/ }).tap()
    await page.locator(VALUE_INPUT).fill('5')
    await expect(page.locator(HEX_INPUT)).toHaveValue('0005')
    await expect(page.getByLabel('Y（16 位有符号，−32768～32767）')).toHaveValue('5')
    await expectNoBodyOverflow(page)
  })

  test('HALF：十进制 1.5 编码 3E00', async ({ page }) => {
    await page.getByRole('tab', { name: /HALF/ }).tap()
    await page.locator(VALUE_INPUT).fill('1.5')
    await expect(page.locator(HEX_INPUT)).toHaveValue('3E00')
    await expectNoBodyOverflow(page)
  })

  test('VOUT_MODE：页面可达且配置摘要可见', async ({ page }) => {
    await page.getByRole('tab', { name: /VOUT_MODE/ }).tap()
    await expect(page.getByTestId('vout-mode-config-summary')).toBeVisible()
    await expectNoBodyOverflow(page)
  })

  test('位切换按钮可触摸点击并同步 hex', async ({ page }) => {
    // locator.tap() 走 page.touchscreen（hasTouch 是必要条件），不是
    // locator.click() 的 page.mouse 路径；移动端仿真不会把 click 变成 touch。
    await page.getByRole('button', { name: '位 0: 0' }).tap()
    await expect(page.locator(HEX_INPUT)).toHaveValue('0001')
    await expect(page.locator(VALUE_INPUT)).toHaveValue('1')
  })

  test('模式 tab 依次触摸切换保持可用且无横向溢出', async ({ page }) => {
    for (const mode of [/LINEAR16/, /DIRECT/, /HALF/, /VOUT_MODE/, /LINEAR11/]) {
      await page.getByRole('tab', { name: mode }).tap()
      await expect(page.getByRole('tab', { name: mode })).toHaveAttribute('aria-selected', 'true')
      await expectNoBodyOverflow(page)
    }
  })

  test('触摸路径观测：tab 的 tap 产生真实 touch 事件（观测探针，不改应用行为）', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const seen: string[] = []
      ;(window as unknown as { __touchProbe: string[] }).__touchProbe = seen
      document.addEventListener(
        'pointerdown',
        (event) => seen.push(`pointerdown:${(event as PointerEvent).pointerType}`),
        true,
      )
      document.addEventListener('touchstart', () => seen.push('touchstart'), true)
    })
    await page.reload()
    await page.getByRole('tab', { name: /DIRECT/ }).tap()
    const seen = await page.evaluate(
      () => (window as unknown as { __touchProbe: string[] }).__touchProbe,
    )
    expect(seen).toContain('pointerdown:touch')
    expect(seen).toContain('touchstart')
  })

  test('术语气泡：390 下可打开且不溢出，触摸外部关闭', async ({ page }) => {
    await page.getByRole('tab', { name: /VOUT_MODE/ }).tap()
    const summary = page.getByTestId('vout-mode-config-summary')
    await expect(summary).toBeVisible()
    const trigger = summary.locator('[data-testid="term-trigger-vout-mode"]')
    await trigger.tap()
    await expect(page.locator('[data-testid="term-popover-vout-mode"]')).toBeVisible()
    await expectNoBodyOverflow(page)
    // 真实触摸屏 tap（非 page.mouse.click）：应用在 document 上监听
    // pointerdown，touch tap 以 pointerType=touch 触发同一关闭合同。
    await page.touchscreen.tap(8, 8)
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

test.describe('移动端合同：被拒编辑的触摸失焦（v2.5.14，390）', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
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

  test('反例 A：fill 超长候选后 tap 其他控件失焦不提交旧显示值——raw 保持 FFFF', async ({
    page,
  }) => {
    await setDirectCoefficients(page, 1, 1, 17)
    await page.locator(RAW_HEX_INPUT).fill('FFFF')
    await page.locator(RAW_HEX_INPUT).press('Tab')
    await expect(page.getByTestId('result-value')).toHaveText('-1')
    await expect(page.getByText(/不同的请求/).first()).toBeVisible()

    await page.locator(VALUE_INPUT).fill('9'.repeat(4_097))
    await expect(page.getByText(OVERLONG_ERROR)).toBeVisible()

    // 触摸另一个真实控件（raw 输入框）触发物理值输入失焦。
    await page.locator(RAW_HEX_INPUT).tap()
    await expect(page.locator(RAW_HEX_INPUT)).toHaveValue('FFFF')
    await expect(page.getByTestId('result-value')).toHaveText('-1')
    await expect(page.getByText(OVERLONG_ERROR)).toBeVisible()
    await expect(page.getByTestId('quantization-error')).toHaveCount(0)
  })

  test('反例 B：fill 超长候选后 tap 外部失焦不改写精确请求——raw 0001、误差 +1、provenance 保持', async ({
    page,
  }) => {
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
  })
})

test.describe('移动端合同：360 错误文案换行（v2.5.13/v2.5.14）', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 })
    await page.goto('/')
  })

  test('DIRECT 超长 fill 后错误在 360 下可见并真实换行，不改 raw', async ({ page }) => {
    await page.getByRole('tab', { name: /DIRECT/ }).tap()
    await page.locator(VALUE_INPUT).fill('9'.repeat(4_097))
    const error = page.getByText(OVERLONG_ERROR)
    await expect(error).toBeVisible()
    await expectWrappedInContainer(error)
    await expect(page.locator(HEX_INPUT)).toHaveValue('0000')
    await expectNoBodyOverflow(page)
  })

  test('LINEAR16 非法 fill 后错误在 360 下可见并真实换行', async ({ page }) => {
    await page.getByRole('tab', { name: /LINEAR16/ }).tap()
    const vInput = page.getByLabel('V（16 位无符号，0～65535）')
    await vInput.fill('12abc')
    const error = page.getByText(/仅允许十进制整数/)
    await expect(error).toBeVisible()
    await expectWrappedInContainer(error)
    await expect(page.locator(HEX_INPUT)).toHaveValue('0000')
    await expectNoBodyOverflow(page)
  })
})
