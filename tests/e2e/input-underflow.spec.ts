import { test, expect, type Locator, type Page } from '@playwright/test'
import { appUrl } from './helpers/app-url'

/**
 * 输入下溢合同（v2.5.10）：非零十进制文本经 binary64 转换得到 ±0 时，
 * 是明确的输入范围错误——不提交、不改写旧 raw / 请求 / 标称，blur/Enter
 * 保留原始草稿与错误；真零文本与最小 subnormal（5e-324 / 3e-324）保持
 * 既有 signed-zero / 有限值合同。
 *
 * 与 v2.5.9 的派生下溢（resolveRelativeVoltage：两个非零有限数相乘为 0）
 * 是不同错误来源：本规格同时断言两者在 relative L16 页各自的表现。
 *
 * 输入路径覆盖：原子 fill、真实键盘逐键（区分合法前缀即时提交与最终
 * 下溢字符）、Enter、Tab/blur、真实剪贴板粘贴（环境不支持则显式 skip，
 * 不把 fill() 称作粘贴）、untouched focus/blur 严格 no-op。
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

async function expectErrorNotTruncated(page: Page, errorId: string) {
  const el = page.locator(`#${errorId}`)
  await expect(el).toBeVisible()
  const info = await el.evaluate((node) => {
    const cs = getComputedStyle(node)
    return {
      scrollWidth: node.scrollWidth,
      clientWidth: node.clientWidth,
      textOverflow: cs.textOverflow,
      whiteSpace: cs.whiteSpace,
    }
  })
  expect(info.scrollWidth, `error ${errorId} is clipped`).toBeLessThanOrEqual(info.clientWidth + 1)
  expect(info.textOverflow).not.toBe('ellipsis')
  expect(info.whiteSpace).not.toBe('nowrap')
}

const hexInput = (page: Page) => page.locator('#raw-hex-input')
const valueInput = (page: Page) => page.locator('#value-input')
const quantizationPanel = (page: Page) => page.getByTestId('quantization-error')
const nominalInput = (page: Page) => page.locator('#l16-nominal-vout')
const resultValue = (page: Page) => page.getByTestId('result-value')
const physicalCopyButton = (page: Page) => page.getByRole('button', { name: '物理值' })

const UNDERFLOW_FRAGMENT = '输入下溢'

async function expectUnderflowError(page: Page, errorId: string) {
  const input = page.locator(`#${errorId.replace(/-error$/, '')}`)
  await expect(input).toHaveAttribute('aria-invalid', 'true')
  await expect(page.locator(`#${errorId}`)).toContainText(UNDERFLOW_FRAGMENT)
  await expectErrorNotTruncated(page, errorId)
}

async function realKeyboardRetype(locator: Locator, text: string) {
  await locator.click()
  await locator.press('ControlOrMeta+a')
  await locator.press('Backspace')
  await locator.pressSequentially(text)
}

/** Real async-clipboard paste; false when the environment refuses permission. */
async function realClipboardPaste(page: Page, locator: Locator, text: string): Promise<boolean> {
  try {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.evaluate((t) => navigator.clipboard.writeText(t), text)
  } catch {
    return false
  }
  await locator.click()
  await locator.press('ControlOrMeta+a')
  await locator.press('ControlOrMeta+v')
  return true
}

/** Enter relative ULINEAR16 (shared byte 0x98, N=-8) with a raw word. */
async function setupRelative(page: Page, raw: string) {
  await page.getByRole('tab', { name: /LINEAR16/ }).click()
  await page.getByRole('radio', { name: '相对值' }).click()
  await expect(page.getByTestId('vout-mode-byte')).toHaveText('0x98')
  await hexInput(page).fill(raw)
  await expect(hexInput(page)).toHaveValue(raw)
}

test.describe('输入下溢：非零十进制不得静默提交为 ±0（v2.5.10，1280×900 dark）', () => {
  test.beforeEach(async ({ page }) => {
    await setTheme(page, 'dark')
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto(appUrl())
  })

  test('HALF：1e-400 fill 保留错误与旧请求，真实修复后按原合同提交', async ({ page }) => {
    await page.getByRole('tab', { name: /HALF/ }).click()

    // Establish a committed request so "nothing changed" is provable.
    await valueInput(page).fill('1')
    await valueInput(page).press('Tab')
    await expect(hexInput(page)).toHaveValue('3C00')
    await expect(resultValue(page)).toHaveText('1')
    await expect(quantizationPanel(page)).toBeVisible()

    // Atomic fill of the underflow text: explicit error, no commit.
    await valueInput(page).fill('1e-400')
    await expectUnderflowError(page, 'value-input-error')
    await expect(hexInput(page)).toHaveValue('3C00')
    await expect(resultValue(page)).toHaveText('1')

    // Blur keeps the original draft and the error (never repairs, never
    // restores the previous display value).
    await valueInput(page).press('Tab')
    await expect(valueInput(page)).toHaveValue('1e-400')
    await expectUnderflowError(page, 'value-input-error')
    await expect(hexInput(page)).toHaveValue('3C00')

    // Untouched focus/blur afterwards is still a strict no-op.
    await valueInput(page).click()
    await valueInput(page).press('Tab')
    await expect(valueInput(page)).toHaveValue('1e-400')
    await expectUnderflowError(page, 'value-input-error')
    await expect(hexInput(page)).toHaveValue('3C00')

    // Real fixes commit per the unchanged original contracts.
    await valueInput(page).fill('0')
    await expect(valueInput(page)).not.toHaveAttribute('aria-invalid', 'true')
    await expect(hexInput(page)).toHaveValue('0000')
    await valueInput(page).fill('-0')
    await expect(hexInput(page)).toHaveValue('8000')

    // True zero texts with huge exponents are legal signed zeros.
    await valueInput(page).fill('-0e400')
    await expect(hexInput(page)).toHaveValue('8000')
    await expect(valueInput(page)).not.toHaveAttribute('aria-invalid', 'true')

    // 5e-324 is a finite request: HALF encodes it to zero with a real delta.
    await valueInput(page).fill('5e-324')
    await expect(hexInput(page)).toHaveValue('0000')
    await expect(valueInput(page)).not.toHaveAttribute('aria-invalid', 'true')
    await expect(quantizationPanel(page)).toContainText('+5e-324 (100.0000%)')
  })

  test('HALF：键盘逐键输入区分合法前缀即时提交与最终下溢字符', async ({ page }) => {
    await page.getByRole('tab', { name: /HALF/ }).click()
    const input = valueInput(page)
    await input.fill('1')
    await input.press('Tab')
    await expect(hexInput(page)).toHaveValue('3C00')

    await realKeyboardRetype(input, '1e-32')
    // 1e-32 is a representable (tiny) value: the legal prefix committed.
    await expect(input).not.toHaveAttribute('aria-invalid', 'true')
    await expect(hexInput(page)).toHaveValue('0000')

    // The final character turns the draft into an underflow text: the error
    // appears and the last committed raw stays untouched.
    await input.pressSequentially('4')
    await expectUnderflowError(page, 'value-input-error')
    await expect(hexInput(page)).toHaveValue('0000')

    // Enter (blur) keeps draft + error; raw and result unchanged.
    await input.press('Enter')
    await expect(input).toHaveValue('1e-324')
    await expectUnderflowError(page, 'value-input-error')
    await expect(hexInput(page)).toHaveValue('0000')
  })

  test('L11 / L16 / DIRECT：下溢文本不提交，修复后走各自量化策略', async ({ page }) => {
    // L11 (default tab)
    await valueInput(page).fill('2')
    await valueInput(page).press('Tab')
    await expect(hexInput(page)).toHaveValue('0002')
    await valueInput(page).fill('1e-400')
    await expectUnderflowError(page, 'value-input-error')
    await expect(hexInput(page)).toHaveValue('0002')
    await valueInput(page).fill('5e-324')
    await expect(hexInput(page)).toHaveValue('0000')
    await expect(quantizationPanel(page)).toContainText('+5e-324 (100.0000%)')

    // L16 absolute LINEAR (0x18, N=-8)
    await page.getByRole('tab', { name: /LINEAR16/ }).click()
    await page.getByRole('radio', { name: '绝对值' }).click()
    await valueInput(page).fill('2')
    await valueInput(page).press('Tab')
    await expect(hexInput(page)).toHaveValue('0200')
    await valueInput(page).fill('1e-400')
    await expectUnderflowError(page, 'value-input-error')
    await expect(hexInput(page)).toHaveValue('0200')

    // DIRECT keeps its own coefficient workspace
    await page.getByRole('tab', { name: /DIRECT/ }).click()
    await valueInput(page).fill('2')
    await valueInput(page).press('Tab')
    const directRaw = await hexInput(page).inputValue()
    await valueInput(page).fill('-1e-400')
    await expectUnderflowError(page, 'value-input-error')
    await expect(hexInput(page)).toHaveValue(directRaw)
    await valueInput(page).press('Tab')
    await expect(valueInput(page)).toHaveValue('-1e-400')
    await expectUnderflowError(page, 'value-input-error')
    await expect(hexInput(page)).toHaveValue(directRaw)
  })

  test('relative L16：下溢草稿不覆盖旧标称；5e-324 走有限与派生下溢两条路径', async ({ page }) => {
    await setupRelative(page, '0200') // ratio 2
    await nominalInput(page).fill('5')
    await expect(resultValue(page)).toHaveText('10')

    // Input underflow on the nominal channel: error shown, committed
    // nominal (and the derived result) untouched.
    await nominalInput(page).fill('1e-400')
    await expectUnderflowError(page, 'l16-nominal-vout-error')
    await expect(resultValue(page)).toHaveText('10')
    await nominalInput(page).press('Tab')
    await expect(nominalInput(page)).toHaveValue('1e-400')
    await expectUnderflowError(page, 'l16-nominal-vout-error')
    await expect(resultValue(page)).toHaveText('10')

    // Real deletion still clears to null (v2.5.8 contract unchanged).
    await nominalInput(page).fill('')
    await nominalInput(page).press('Tab')
    await expect(nominalInput(page)).toHaveValue('')
    await expect(resultValue(page)).toHaveText('—')

    // Legal smallest subnormal × ratio 2 stays a finite nonzero result.
    await nominalInput(page).fill('5e-324')
    await expect(resultValue(page)).toHaveText('1e-323')

    // Ratio 2^-16 makes the product leave the double range: the DERIVATION
    // underflow diagnostic (v2.5.9) reports it on the visible InfoPanel —
    // a different error source from the input-underflow error above.
    await hexInput(page).fill('0001')
    await expect(resultValue(page)).toHaveText('—')
    await expect(
      page.locator('[role="alert"]').filter({ hasText: '计算下溢：两个非零有限数相乘' }),
    ).toBeVisible()
    await expect(physicalCopyButton(page)).toBeDisabled()
    await expect(page.locator('#physical-value-copy-reason')).toBeVisible()

    // Recovery: ratio 1 restores the finite result without reload.
    await hexInput(page).fill('0100')
    await expect(resultValue(page)).toHaveText('5e-324')
    await expect(physicalCopyButton(page)).toBeEnabled()
  })

  test('粘贴路径：真实剪贴板粘贴 1e-400 触发下溢错误（环境支持时）', async ({ page }) => {
    await valueInput(page).fill('2')
    await valueInput(page).press('Tab')
    await expect(hexInput(page)).toHaveValue('0002')

    const pasted = await realClipboardPaste(page, valueInput(page), '1e-400')
    test.skip(!pasted, '环境未授权剪贴板权限：粘贴路径未覆盖（不把 fill() 冒充粘贴）')
    await expectUnderflowError(page, 'value-input-error')
    await expect(hexInput(page)).toHaveValue('0002')
    await valueInput(page).press('Tab')
    await expect(valueInput(page)).toHaveValue('1e-400')
    await expect(hexInput(page)).toHaveValue('0002')
  })

  test('1280 / 390 / 360px：错误文案换行、关联、无横向溢出', async ({ page }) => {
    for (const width of [1280, 390, 360]) {
      await page.setViewportSize({ width, height: 800 })
      await valueInput(page).fill('2')
      await valueInput(page).press('Tab')
      await valueInput(page).fill('1e-400')
      await expectUnderflowError(page, 'value-input-error')
      await expectNoBodyHorizontalOverflow(page)
      const describedBy = await valueInput(page).getAttribute('aria-describedby')
      expect(describedBy).toBe('value-input-error')
      await expect(valueInput(page)).toBeFocused()
      await valueInput(page).press('Tab')
      // Keyboard reachability: the next Tab focus lands on a visible control.
      await page.keyboard.press('Shift+Tab')
      await expect(valueInput(page)).toBeFocused()
    }
  })
})
