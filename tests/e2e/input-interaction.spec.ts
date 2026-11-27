import { test, expect, type Page } from '@playwright/test'
import { expectNoHorizontalOverflow, expectTextInside } from './helpers/layout'

async function expectFieldError(page: Page, inputId: string) {
  const input = page.locator(`#${inputId}`)
  const errorId = `${inputId}-error`
  const error = page.locator(`#${errorId}`)
  await expect(input).toHaveAttribute('aria-invalid', 'true')
  await expect(input).toHaveAttribute('aria-describedby', errorId)
  await expect(error).toHaveCount(1)
  await expectTextInside(error)

  const inputBox = await input.boundingBox()
  const errorBox = await error.boundingBox()
  if (inputBox == null || errorBox == null)
    throw new Error('Missing input or inline error geometry')
  expect(errorBox.y).toBeGreaterThanOrEqual(inputBox.y + inputBox.height - 1)
}

async function expectNoFieldError(page: Page, inputId: string) {
  await expect(page.locator(`#${inputId}`)).not.toHaveAttribute('aria-invalid', 'true')
  await expect(page.locator(`#${inputId}-error`)).toHaveCount(0)
}

test.describe('LINEAR11 的指数和尾数输入', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await page.setViewportSize({ width: 360, height: 800 })
    await page.goto('./')
  })

  test('指数格式无效时保留草稿，修正后更新原字', async ({ page }) => {
    const hexInput = page.locator('#raw-hex-input')
    await hexInput.fill('0801')
    await hexInput.press('Tab')
    await expect(hexInput).toHaveValue('0801')

    // 解锁手动 N
    await page.getByRole('button', { name: 'N 已锁定（自动）' }).click()
    const nInput = page.getByLabel('N 值 (指数)')
    await expect(nInput).toBeEnabled()

    await nInput.fill('1.5')
    await expectFieldError(page, 'l11-n-input')
    await expect(nInput).toHaveValue('1.5')
    await expect(hexInput).toHaveValue('0801')

    // blur 后非法 draft 保留且错误仍在，不静默回滚
    await nInput.press('Tab')
    await expect(nInput).toHaveValue('1.5')
    await expectFieldError(page, 'l11-n-input')
    await expect(hexInput).toHaveValue('0801')

    // 合法修正：错误与旧 draft 同时清除
    await nInput.fill('3')
    await nInput.press('Tab')
    await expectNoFieldError(page, 'l11-n-input')
    await expect(nInput).toHaveValue('3')
    await expect(hexInput).toHaveValue('1801')

    await expectNoHorizontalOverflow(page)
  })

  test('尾数错误与输入框关联，修正或切换模式后清除', async ({ page }) => {
    const hexInput = page.locator('#raw-hex-input')
    await hexInput.fill('0801')
    await hexInput.press('Tab')

    const yInput = page.getByLabel('Y（11 位有符号整数）')
    await yInput.fill('12abc')
    await expectFieldError(page, 'l11-y-input')
    await expect(hexInput).toHaveValue('0801')

    await yInput.fill('25')
    await yInput.press('Tab')
    await expectNoFieldError(page, 'l11-y-input')
    await expect(hexInput).toHaveValue('0819')

    // 制造一个错误后切换模式再回来：不得留下与显示值矛盾的 stale error
    await yInput.fill('1e2')
    await expectFieldError(page, 'l11-y-input')
    await page.getByRole('tab', { name: /LINEAR16/ }).click()
    await page.getByRole('tab', { name: /LINEAR11/ }).click()
    await expectNoFieldError(page, 'l11-y-input')
    await expect(page.getByLabel('Y（11 位有符号整数）')).toHaveValue('25')

    await expectNoHorizontalOverflow(page)
  })
})

test.describe('LINEAR16 的无符号整数输入', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('./')
    await page.getByRole('tab', { name: /LINEAR16/ }).click()
  })

  test('V 拒绝非整数并保留草稿，修正后更新原字', async ({ page }) => {
    const hexInput = page.locator('#raw-hex-input')
    const vInput = page.getByLabel('V（16 位无符号，0～65535）')

    await vInput.fill('1e2')
    await expectFieldError(page, 'l16-v-input')
    await expect(vInput).toHaveValue('1e2')
    await expect(hexInput).toHaveValue('0000')

    await vInput.press('Tab')
    await expect(vInput).toHaveValue('1e2')
    await expectFieldError(page, 'l16-v-input')

    await vInput.fill('12')
    await vInput.press('Tab')
    await expectNoFieldError(page, 'l16-v-input')
    // raw word 0x000C；Raw Word 字段始终显示 canonical 数值原字。
    await expect(hexInput).toHaveValue('000C')

    await expectNoHorizontalOverflow(page)
  })

  test('V 超出范围时取边界值', async ({ page }) => {
    const hexInput = page.locator('#raw-hex-input')
    const vInput = page.getByLabel('V（16 位无符号，0～65535）')

    await vInput.fill('70000')
    await vInput.press('Tab')
    await expect(vInput).toHaveValue('65535')
    await expect(hexInput).toHaveValue('FFFF')
    await expectNoFieldError(page, 'l16-v-input')

    await vInput.fill('-1')
    await vInput.press('Tab')
    await expect(vInput).toHaveValue('0')
    await expect(hexInput).toHaveValue('0000')

    await expectNoHorizontalOverflow(page)
  })
})

test.describe('DIRECT 的系数和整数输入', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await page.setViewportSize({ width: 768, height: 1024 })
    await page.goto('./')
    await page.getByRole('tab', { name: /DIRECT/ }).click()
  })

  test('m/b 字段级错误相互独立，修正只清除对应字段', async ({ page }) => {
    const mInput = page.getByLabel('DIRECT 系数 m')
    const bInput = page.getByLabel('DIRECT 系数 b')

    await mInput.fill('2.5')
    await expectFieldError(page, 'direct-coeff-m-input')
    await expect(mInput).toHaveValue('2.5')
    await expectNoFieldError(page, 'direct-coeff-b-input')

    // 另一个字段出错时不覆盖、不清除 m 的错误
    await bInput.fill('1.5')
    await expectFieldError(page, 'direct-coeff-m-input')
    await expectFieldError(page, 'direct-coeff-b-input')

    const linear = page.getByRole('tab', { name: /LINEAR11/ })
    const direct = page.getByRole('tab', { name: /DIRECT/ })
    await linear.click()
    await expect(page.locator('#direct-coeff-m-input-error')).toHaveCount(0)
    await direct.click()
    await expectFieldError(page, 'direct-coeff-m-input')
    await expectFieldError(page, 'direct-coeff-b-input')

    await mInput.fill('2')
    await mInput.press('Tab')
    await expectNoFieldError(page, 'direct-coeff-m-input')
    await expectFieldError(page, 'direct-coeff-b-input')

    await bInput.fill('3')
    await bInput.press('Tab')
    await expectNoFieldError(page, 'direct-coeff-b-input')

    // raw 未被非法输入破坏
    const hexInput = page.locator('#raw-hex-input')
    await expect(hexInput).toHaveValue('0000')
    await expectNoHorizontalOverflow(page)
  })

  test('m 为零时只显示字段错误，暂停换算及物理值复制', async ({ page }) => {
    const mInput = page.getByLabel('DIRECT 系数 m')
    const hexInput = page.locator('#raw-hex-input')

    await mInput.fill('0')
    const inlineError = page.locator('#direct-coeff-m-input-error')
    await expect(mInput).toBeFocused()
    await expect(inlineError).toBeVisible()
    await expect(inlineError).toHaveText('DIRECT 系数 m 不能为 0')
    await mInput.press('Tab')
    await expectFieldError(page, 'direct-coeff-m-input')
    await expect(mInput).toHaveValue('0')

    // 同一错误只在内联出现一次，InfoPanel 不重复
    expect(
      await page
        .locator('section[aria-label="提示信息"]')
        .getByText(/m 不能为 0/)
        .count(),
      'InfoPanel must not duplicate the inline m=0 error',
    ).toBe(0)

    await page.locator('#value-input').fill('12')
    await expect(hexInput).toHaveValue('0000')
    await expect(page.getByTestId('result-value')).toHaveText('—')
    const copy = page.getByRole('button', { name: '物理值', exact: true })
    await expect(copy).toBeDisabled()
    await expect(copy).toHaveAttribute('aria-describedby', 'physical-value-copy-reason')
    await expect(page.locator('#physical-value-copy-reason')).toContainText('m=0')
  })

  test('Y 拒绝非整数，原字和公式保持', async ({ page }) => {
    const hexInput = page.locator('#raw-hex-input')
    await hexInput.fill('000A')
    await hexInput.press('Tab')

    const yInput = page.getByLabel('Y（16 位有符号，−32768～32767）')
    await yInput.fill('1e2')
    await expectFieldError(page, 'direct-y-input')
    await expect(hexInput).toHaveValue('000A')

    await yInput.fill('10')
    await yInput.press('Tab')
    await expectNoFieldError(page, 'direct-y-input')
    await expect(hexInput).toHaveValue('000A')

    // 非法输入期间公式保持渲染且无 KaTeX 错误
    await yInput.fill('0x10')
    await expectFieldError(page, 'direct-y-input')
    await expect(page.locator('.katex').first()).toBeVisible()
    await expect(page.locator('.katex-error')).toHaveCount(0)
    await expectNoHorizontalOverflow(page)
  })
})

test('非 HALF 模式拒绝 NaN 并保持原字，修正后正常提交', async ({ page }) => {
  await page.goto('./')
  const raw = page.locator('#raw-hex-input')
  const value = page.locator('#value-input')
  await raw.fill('0007')

  await value.fill('NaN')
  await value.press('Tab')
  await expectFieldError(page, 'value-input')
  await expect(raw).toHaveValue('0007')

  await value.fill('12')
  await value.press('Tab')
  await expectNoFieldError(page, 'value-input')
  await expect(raw).toHaveValue('000C')
})

test.describe('模式切换快捷键', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('./')
  })

  test('物理值和原字输入中的快捷键保留焦点、草稿及最后有效值', async ({ page }) => {
    const value = page.locator('#value-input')
    const raw = page.locator('#raw-hex-input')
    const linear11 = page.getByRole('tab', { name: /LINEAR11/ })
    await value.fill('12.5')
    await expect(raw).toHaveValue('F819')

    await value.fill('12.5e-')
    await page.keyboard.press('Control+2')
    await expect(linear11).toHaveAttribute('aria-selected', 'true')
    await expect(value).toBeFocused()
    await expect(value).toHaveValue('12.5e-')
    await expect(raw).toHaveValue('F819')

    await raw.fill('F81G')
    await page.keyboard.press('Control+3')
    await expect(linear11).toHaveAttribute('aria-selected', 'true')
    await expect(raw).toBeFocused()
    await expect(raw).toHaveValue('F81G')
    await expect(raw).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByTestId('result-value')).toHaveText('12.5')
  })

  test('数据解释选择框捕获焦点时快捷键不会切换模式', async ({ page }) => {
    const l16 = page.getByRole('tab', { name: /LINEAR16/ })
    await l16.click()
    const payload = page.getByRole('combobox', { name: 'L16 数据解释类型' })
    await payload.focus()
    await page.keyboard.press('Control+1')
    await expect(l16).toHaveAttribute('aria-selected', 'true')
    await expect(payload).toBeFocused()
    await expect(payload).toHaveValue('ulinear16')
  })

  test('非编辑区按 Ctrl+1..5 仍切换到正确模式', async ({ page }) => {
    await page.locator('h1').first().click()
    const expectMode = async (tab: RegExp) => {
      await expect(page.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true')
    }

    await page.keyboard.press('Control+2')
    await expectMode(/LINEAR16/)
    await page.keyboard.press('Control+3')
    await expectMode(/DIRECT/)
    await page.keyboard.press('Control+4')
    await expectMode(/HALF/)
    await page.keyboard.press('Control+5')
    await expectMode(/VOUT_MODE/)
    await page.keyboard.press('Control+1')
    await expectMode(/LINEAR11/)
  })

  test('Meta/Ctrl+Alt/Ctrl+Shift 组合不被当作快捷键', async ({ page }) => {
    await page.locator('h1').first().click()
    for (const combo of ['Control+Alt+2', 'Control+Shift+2', 'Meta+2']) {
      await page.keyboard.press(combo)
      await expect(page.getByRole('tab', { name: /LINEAR11/ })).toHaveAttribute(
        'aria-selected',
        'true',
      )
    }
  })
})
