import { test, expect, type Locator, type Page } from '@playwright/test'

/**
 * M21 input & keyboard interaction reliability — bounded pairwise matrix.
 *
 * 每个非法输入场景断言：字段中的 draft、aria-invalid、错误关联 ID、
 * raw/最后有效值未被破坏、合法修正后错误清除、页面无横向 overflow、
 * 错误文本不被截断。
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

/** Field must be flagged invalid with a unique, visible, associated error node. */
async function expectFieldError(page: Page, inputId: string): Promise<Locator> {
  const input = page.locator(`#${inputId}`)
  await expect(input).toHaveAttribute('aria-invalid', 'true')
  const describedBy = await input.getAttribute('aria-describedby')
  if (describedBy == null) throw new Error(`${inputId} is missing aria-describedby`)
  const error = page.locator(`#${describedBy}`)
  expect(await page.locator(`#${describedBy}`).count(), `error id ${describedBy} unique`).toBe(1)
  await expect(error).toBeVisible()
  // The inline error must sit below its input without covering it.
  const inputBox = await input.boundingBox()
  const errorBox = await error.boundingBox()
  if (inputBox == null || errorBox == null) throw new Error('missing boxes')
  expect(errorBox.y).toBeGreaterThanOrEqual(inputBox.y + inputBox.height - 1)
  await expectErrorNotTruncated(page, describedBy)
  return error
}

async function expectNoFieldError(page: Page, inputId: string) {
  const input = page.locator(`#${inputId}`)
  await expect(input).not.toHaveAttribute('aria-invalid', 'true')
  const describedBy = await input.getAttribute('aria-describedby')
  if (describedBy) {
    expect(await page.locator(`#${describedBy}`).count()).toBe(0)
  }
}

test.describe('L11（360×800 light）：手动 Y/N 非法输入、错误关联、合法修正', () => {
  test.beforeEach(async ({ page }) => {
    await setTheme(page, 'light')
    await page.setViewportSize({ width: 360, height: 800 })
    await page.goto('/')
  })

  test('N 非法输入：draft 保留、错误关联、raw 不变、修正后清除', async ({ page }) => {
    const hexInput = page.locator('input[placeholder="0x0000"]')
    await hexInput.fill('0801')
    await hexInput.press('Tab')
    await expect(hexInput).toHaveValue('0x0801')

    // 解锁手动 N
    await page.getByRole('button', { name: 'N 已锁定（自动）' }).click()
    const nInput = page.getByLabel('N 值 (指数)')
    await expect(nInput).toBeEnabled()

    await nInput.fill('1.5')
    await expectFieldError(page, 'l11-n-input')
    await expect(nInput).toHaveValue('1.5')
    await expect(hexInput).toHaveValue('0x0801')

    // blur 后非法 draft 保留且错误仍在，不静默回滚
    await nInput.press('Tab')
    await expect(nInput).toHaveValue('1.5')
    await expectFieldError(page, 'l11-n-input')
    await expect(hexInput).toHaveValue('0x0801')

    // 合法修正：错误与旧 draft 同时清除
    await nInput.fill('3')
    await nInput.press('Tab')
    await expectNoFieldError(page, 'l11-n-input')
    await expect(nInput).toHaveValue('3')
    await expect(hexInput).toHaveValue('0x1801')

    await expectNoBodyHorizontalOverflow(page)
  })

  test('Y 非法输入：错误关联、raw 不变、修正后清除、模式切换无 stale error', async ({ page }) => {
    const hexInput = page.locator('input[placeholder="0x0000"]')
    await hexInput.fill('0801')
    await hexInput.press('Tab')

    const yInput = page.getByLabel('Y (11-bit)')
    await yInput.fill('12abc')
    await expectFieldError(page, 'l11-y-input')
    await expect(hexInput).toHaveValue('0x0801')

    await yInput.fill('25')
    await yInput.press('Tab')
    await expectNoFieldError(page, 'l11-y-input')
    await expect(hexInput).toHaveValue('0x0819')

    // 制造一个错误后切换模式再回来：不得留下与显示值矛盾的 stale error
    await yInput.fill('1e2')
    await expectFieldError(page, 'l11-y-input')
    await page.getByRole('tab', { name: /LINEAR16/ }).click()
    await page.getByRole('tab', { name: /LINEAR11/ }).click()
    await expectNoFieldError(page, 'l11-y-input')
    await expect(page.getByLabel('Y (11-bit)')).toHaveValue('25')

    await expectNoBodyHorizontalOverflow(page)
  })
})

test.describe('L16（390×844 dark）：V 非法整数、clamp 合同、无 body overflow', () => {
  test.beforeEach(async ({ page }) => {
    await setTheme(page, 'dark')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    await page.getByRole('tab', { name: /LINEAR16/ }).click()
  })

  test('V 非法整数被拒绝且 draft/错误可见，合法值照常提交', async ({ page }) => {
    const hexInput = page.locator('input[placeholder="0x0000"]')
    const vInput = page.getByLabel('V（16 位无符号，0～65535）')

    await vInput.fill('1e2')
    await expectFieldError(page, 'l16-v-input')
    await expect(vInput).toHaveValue('1e2')
    await expect(hexInput).toHaveValue('0x0000')

    await vInput.press('Tab')
    await expect(vInput).toHaveValue('1e2')
    await expectFieldError(page, 'l16-v-input')

    await vInput.fill('12')
    await vInput.press('Tab')
    await expectNoFieldError(page, 'l16-v-input')
    await expect(hexInput).toHaveValue('0x000C')

    await expectNoBodyHorizontalOverflow(page)
  })

  test('V 超范围仍采用 clamp 合同（不是 wrap 也不是拒绝）', async ({ page }) => {
    const hexInput = page.locator('input[placeholder="0x0000"]')
    const vInput = page.getByLabel('V（16 位无符号，0～65535）')

    await vInput.fill('70000')
    await vInput.press('Tab')
    await expect(vInput).toHaveValue('65535')
    await expect(hexInput).toHaveValue('0xFFFF')
    await expectNoFieldError(page, 'l16-v-input')

    await vInput.fill('-1')
    await vInput.press('Tab')
    await expect(vInput).toHaveValue('0')
    await expect(hexInput).toHaveValue('0x0000')

    await expectNoBodyHorizontalOverflow(page)
  })
})

test.describe('DIRECT（768×1024 light）：m/b/R 与 Y 字段级错误、修正、公式稳定', () => {
  test.beforeEach(async ({ page }) => {
    await setTheme(page, 'light')
    await page.setViewportSize({ width: 768, height: 1024 })
    await page.goto('/')
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

    await mInput.fill('2')
    await mInput.press('Tab')
    await expectNoFieldError(page, 'direct-coeff-m-input')
    await expectFieldError(page, 'direct-coeff-b-input')

    await bInput.fill('3')
    await bInput.press('Tab')
    await expectNoFieldError(page, 'direct-coeff-b-input')

    // raw 未被非法输入破坏
    const hexInput = page.locator('input[placeholder="0x0000"]')
    await expect(hexInput).toHaveValue('0x0000')
    await expectNoBodyHorizontalOverflow(page)
  })

  test('m=0 为显式错误状态：字段级错误且不在 InfoPanel 重复播报，Value 不编码', async ({
    page,
  }) => {
    const mInput = page.getByLabel('DIRECT 系数 m')
    const hexInput = page.locator('input[placeholder="0x0000"]')

    await mInput.fill('0')
    await mInput.press('Tab')
    await expectFieldError(page, 'direct-coeff-m-input')
    await expect(mInput).toHaveValue('0')

    // 同一错误只在内联出现一次，InfoPanel 不重复
    const inlineError = page.locator('#direct-coeff-m-input-error')
    await expect(inlineError).toContainText('m 不能为 0')
    expect(
      await page
        .locator('section[aria-label="提示信息"]')
        .getByText(/m 不能为 0/)
        .count(),
      'InfoPanel must not duplicate the inline m=0 error',
    ).toBe(0)

    await page.locator('#value-input').fill('12')
    await expect(hexInput).toHaveValue('0x0000')
  })

  test('Y 非法整数：字段级错误、raw 不变、公式稳定', async ({ page }) => {
    const hexInput = page.locator('input[placeholder="0x0000"]')
    await hexInput.fill('000A')
    await hexInput.press('Tab')

    const yInput = page.getByLabel('Y（16 位有符号，−32768～32767）')
    await yInput.fill('1e2')
    await expectFieldError(page, 'direct-y-input')
    await expect(hexInput).toHaveValue('0x000A')

    await yInput.fill('10')
    await yInput.press('Tab')
    await expectNoFieldError(page, 'direct-y-input')
    await expect(hexInput).toHaveValue('0x000A')

    // 非法输入期间公式保持渲染且无 KaTeX 错误
    await yInput.fill('0x10')
    await expectFieldError(page, 'direct-y-input')
    await expect(page.locator('.katex').first()).toBeVisible()
    await expect(page.locator('.katex-error')).toHaveCount(0)
    await expectNoBodyHorizontalOverflow(page)
  })
})

test.describe('HALF（1280×900 dark）：NaN/Infinity 合法、垃圾文本非法', () => {
  test.beforeEach(async ({ page }) => {
    await setTheme(page, 'dark')
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    await page.getByRole('tab', { name: /HALF/ }).click()
  })

  test('NaN 与 ±Infinity 是一等值，不产生错误状态', async ({ page }) => {
    const hexInput = page.locator('input[placeholder="0x0000"]')
    const valueInput = page.locator('#value-input')

    await valueInput.fill('NaN')
    await expect(hexInput).toHaveValue('0x7E00')
    await expectNoFieldError(page, 'value-input')

    await valueInput.fill('Infinity')
    await expect(hexInput).toHaveValue('0x7C00')

    await valueInput.fill('-Infinity')
    await expect(hexInput).toHaveValue('0xFC00')
  })

  test('垃圾文本非法：draft 保留、错误关联、raw 不变、修正后清除', async ({ page }) => {
    const hexInput = page.locator('input[placeholder="0x0000"]')
    const valueInput = page.locator('#value-input')

    // 先建立一个已知的最后有效状态
    await valueInput.fill('-Infinity')
    await expect(hexInput).toHaveValue('0xFC00')

    await valueInput.fill('garbage')
    await expectFieldError(page, 'value-input')
    await expect(valueInput).toHaveValue('garbage')
    await expect(hexInput).toHaveValue('0xFC00')

    await valueInput.press('Tab')
    await expect(valueInput).toHaveValue('garbage')
    await expectFieldError(page, 'value-input')

    await valueInput.fill('1.5')
    await valueInput.press('Tab')
    await expectNoFieldError(page, 'value-input')
    await expect(hexInput).toHaveValue('0x3E00')

    await expectNoBodyHorizontalOverflow(page)
  })

  test('非 HALF 模式拒绝 NaN 并给出字段级错误（在 L11 中验证）', async ({ page }) => {
    await page.getByRole('tab', { name: /LINEAR11/ }).click()
    const hexInput = page.locator('input[placeholder="0x0000"]')
    const valueInput = page.locator('#value-input')

    await valueInput.fill('NaN')
    await expectFieldError(page, 'value-input')
    await expect(hexInput).toHaveValue('0x0000')

    await valueInput.fill('12')
    await valueInput.press('Tab')
    await expectNoFieldError(page, 'value-input')
    await expect(hexInput).toHaveValue('0x000C')
  })
})

test.describe('命令参考（950×304）：只读表格无溢出', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 950, height: 304 })
    await page.goto('/')
  })

  test('展开后表格完整可读且页面不产生横向滚动', async ({ page }) => {
    await page.locator('#command-reference-toggle').click()
    await expect(page.getByRole('row', { name: /STATUS_WORD/ })).toBeVisible()
    const scrollWidth = await page.locator('body').evaluate((el) => el.scrollWidth)
    const clientWidth = await page.locator('body').evaluate((el) => el.clientWidth)
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth)
  })
})

test.describe('全局快捷键：编辑区不触发、非编辑区触发', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('焦点在物理值输入内按 Ctrl+2..4：不切换模式、不丢 draft、不抢焦点', async ({ page }) => {
    const valueInput = page.locator('#value-input')
    await valueInput.click()
    await valueInput.fill('12.5')
    await expect(page.locator('input[placeholder="0x0000"]')).toHaveValue('0xF819')

    for (const combo of ['Control+2', 'Control+3', 'Control+4']) {
      await page.keyboard.press(combo)
      await expect(page.getByRole('tab', { name: /LINEAR11/ })).toHaveAttribute(
        'aria-selected',
        'true',
      )
      await expect(valueInput).toBeFocused()
      await expect(valueInput).toHaveValue('12.5')
      await expect(page.locator('input[placeholder="0x0000"]')).toHaveValue('0xF819')
    }
  })

  test('焦点在 Hex 输入内按 Ctrl+2：不切换、不丢 draft', async ({ page }) => {
    const hexInput = page.locator('input[placeholder="0x0000"]')
    await hexInput.click()
    await page.keyboard.type('F819')
    await page.keyboard.press('Control+2')
    await expect(page.getByRole('tab', { name: /LINEAR11/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(hexInput).toBeFocused()
    await expect(hexInput).toHaveValue('F819')
  })

  test('焦点在 L16 字节序 select 内按 Ctrl+1：不切换', async ({ page }) => {
    await page.getByRole('tab', { name: /LINEAR16/ }).click()
    const endianSelect = page.getByLabel('L16 字节序')
    await endianSelect.focus()
    await endianSelect.press('Control+1')
    await expect(page.getByRole('tab', { name: /LINEAR16/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  test('焦点在 DIRECT 系数与 L11 N/Y 输入内按快捷键：不切换', async ({ page }) => {
    await page.getByRole('tab', { name: /DIRECT/ }).click()
    await page.getByLabel('DIRECT 系数 m').press('Control+2')
    await expect(page.getByRole('tab', { name: /DIRECT/ })).toHaveAttribute('aria-selected', 'true')

    await page.getByRole('tab', { name: /LINEAR11/ }).click()
    await page.getByLabel('Y (11-bit)').press('Control+3')
    await expect(page.getByRole('tab', { name: /LINEAR11/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  test('非编辑区按 Ctrl+1..4 仍切换到正确模式', async ({ page }) => {
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
