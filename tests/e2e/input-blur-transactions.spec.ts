import { test, expect, type Locator, type Page } from '@playwright/test'

const raw = (page: Page) => page.locator('#raw-hex-input')
const value = (page: Page) => page.locator('#value-input')
const quantization = (page: Page) => page.getByTestId('quantization-error')
const result = (page: Page) => page.getByTestId('result-value')

async function blurWithKey(input: Locator, key: 'Tab' | 'Enter' = 'Tab') {
  await expect(input).toBeFocused()
  await input.press(key)
  await expect(input).not.toBeFocused()
}

async function focusAndBlur(input: Locator, key: 'Tab' | 'Enter' = 'Tab') {
  await input.click()
  await blurWithKey(input, key)
}

async function replaceWithKeys(input: Locator, text: string) {
  await input.click()
  await input.press('ControlOrMeta+a')
  await input.press('Backspace')
  await input.pressSequentially(text)
}

async function retype(input: Locator, text: string) {
  await replaceWithKeys(input, text)
  await blurWithKey(input)
}

async function paste(page: Page, input: Locator, text: string) {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.evaluate((draft) => navigator.clipboard.writeText(draft), text)
  await input.click()
  await input.press('ControlOrMeta+a')
  await input.press('ControlOrMeta+v')
}

async function expectInvalidDraft(page: Page, id: string, text: string, error: RegExp) {
  const input = page.locator(`#${id}`)
  await expect(input).toHaveValue(text)
  await expect(input).toHaveAttribute('aria-invalid', 'true')
  await expect(input).toHaveAttribute('aria-describedby', `${id}-error`)
  await expect(page.locator(`#${id}-error`)).toContainText(error)
}

async function enterRelativeL16(page: Page) {
  await page.getByRole('tab', { name: /LINEAR16/ }).click()
  await page.getByRole('radio', { name: '相对值', exact: true }).click()
  await expect(page.getByTestId('vout-mode-byte')).toHaveText('0x98')
  await raw(page).fill('0100')
  return page.locator('#l16-nominal-vout')
}

test.beforeEach(async ({ page }) => {
  await page.goto('./')
})

test('LINEAR11 聚焦再离开不改写原字，真实编辑按入口更新请求来源', async ({ page }) => {
  const hex = raw(page)
  const input = value(page)
  const panel = quantization(page)
  await hex.fill('0801')
  await expect(input).toHaveValue('2')
  await focusAndBlur(input)
  await expect(hex).toHaveValue('0801')
  await expect(panel).toHaveCount(0)

  // Re-enter the same displayed value with an actual keyboard edit.
  await retype(input, '2')
  await expect(hex).toHaveValue('0002')
  await expect(panel).toHaveAttribute('data-kind', 'ok')

  await page.getByRole('button', { name: 'N 已锁定（自动）' }).click()
  const y = page.locator('#l11-y-input')
  const n = page.locator('#l11-n-input')
  for (const field of [hex, y, n]) {
    await focusAndBlur(field)
    await expect(hex).toHaveValue('0002')
    await expect(panel).toHaveAttribute('data-kind', 'ok')
  }

  await y.fill('3')
  await expect(hex).toHaveValue('0003')
  await expect(panel).toHaveCount(0)
  await paste(page, input, '7')
  await input.press('Tab')
  await expect(hex).toHaveValue('0007')
  await expect(panel).toHaveAttribute('data-kind', 'ok')

  await hex.fill('0005')
  await expect(hex).toHaveValue('0005')
  await expect(panel).toHaveCount(0)
})

test('LINEAR16 原字入口和物理值入口分别清除及建立编码请求', async ({ page }) => {
  await page.getByRole('tab', { name: /LINEAR16/ }).click()
  const hex = raw(page)
  const input = value(page)
  const panel = quantization(page)
  const vu = page.locator('#l16-v-input')
  const n = page.locator('#l16-n-input')

  await hex.fill('0100')
  await expect(input).toHaveValue('1')
  await focusAndBlur(input, 'Enter')
  await expect(hex).toHaveValue('0100')
  await expect(panel).toHaveCount(0)

  await retype(input, '1')
  await expect(panel).toHaveAttribute('data-kind', 'ok')
  for (const field of [vu, n]) {
    await focusAndBlur(field)
    await expect(hex).toHaveValue('0100')
    await expect(panel).toHaveAttribute('data-kind', 'ok')
  }

  await retype(vu, '256')
  await expect(hex).toHaveValue('0100')
  await expect(panel).toHaveCount(0)
  await retype(input, '1')
  await expect(panel).toHaveAttribute('data-kind', 'ok')

  await n.fill('-9')
  await expect(page.getByTestId('vout-mode-byte')).toHaveText('0x17')
  await expect(panel).toHaveCount(0)
})

test('LINEAR16 重选当前配置保留来源，实际切换相对值清除来源', async ({ page }) => {
  await page.getByRole('tab', { name: /LINEAR16/ }).click()
  const absolute = page.getByRole('radio', { name: '绝对值', exact: true })
  const relative = page.getByRole('radio', { name: '相对值', exact: true })
  await value(page).fill('1')
  await expect(raw(page)).toHaveValue('0100')
  await expect(quantization(page)).toHaveAttribute('data-kind', 'ok')

  await absolute.click()
  await expect(page.getByTestId('vout-mode-byte')).toHaveText('0x18')
  await expect(quantization(page)).toBeVisible()

  await relative.click()
  await expect(relative).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByTestId('vout-mode-byte')).toHaveText('0x98')
  await expect(raw(page)).toHaveValue('0100')
  await expect(quantization(page)).toHaveCount(0)
})

test('标称电压清空在失焦时提交缺失，显式零仍可计算', async ({ page }) => {
  const nominal = await enterRelativeL16(page)
  await nominal.fill('5')
  await expect(result(page)).toHaveText('5')

  await focusAndBlur(nominal)
  await expect(nominal).toHaveValue('5')
  await expect(result(page)).toHaveText('5')

  await replaceWithKeys(nominal, '')
  await expect(nominal).toHaveValue('')
  await expect(result(page)).toHaveText('5')
  await nominal.press('Tab')
  await expect(result(page)).toHaveText('—')
  await expect(raw(page)).toHaveValue('0100')
  await expect(page.getByTestId('vout-mode-byte')).toHaveText('0x98')

  await retype(nominal, '0')
  await expect(result(page)).toHaveText('0')
  await retype(nominal, '5')
  await expect(result(page)).toHaveText('5')
})

test('DIRECT 系数仅聚焦后失焦保留请求，同值键入清除请求', async ({ page }) => {
  await page.getByRole('tab', { name: /DIRECT/ }).click()
  const panel = quantization(page)
  const m = page.locator('#direct-coeff-m-input')
  await value(page).fill('5')
  await expect(panel).toHaveAttribute('data-kind', 'ok')

  for (const input of [
    page.locator('#direct-y-input'),
    m,
    page.locator('#direct-coeff-b-input'),
    page.locator('#direct-coeff-r-input'),
  ]) {
    await focusAndBlur(input)
    await expect(raw(page)).toHaveValue('0005')
    await expect(panel).toHaveAttribute('data-kind', 'ok')
  }

  await retype(m, '1')
  await expect(raw(page)).toHaveValue('0005')
  await expect(panel).toHaveCount(0)
})

test(
  'HALF 非规范 NaN 失焦保留位模式，真实重输规范化并生成请求',
  { tag: '@browser-smoke' },
  async ({ page }) => {
    await page.getByRole('tab', { name: /HALF/ }).click()
    const hex = raw(page)
    const input = value(page)
    const panel = quantization(page)
    const card = page.getByTestId('half-special-semantics')

    for (const [word, commit] of [
      ['7C01', 'Tab'],
      ['FC01', 'Enter'],
    ] as const) {
      await hex.fill(word)
      await expect(input).toHaveValue('NaN')
      await focusAndBlur(input, commit)
      await expect(hex).toHaveValue(word)
      await expect(card).toBeVisible()
      await expect(panel).toHaveCount(0)
    }

    await retype(input, 'NaN')
    await expect(hex).toHaveValue('7E00')
    await expect(panel).toContainText('NaN → NaN')
    await expect(panel).toHaveAttribute('data-kind', 'warn')
    await focusAndBlur(hex)
    await expect(hex).toHaveValue('7E00')
    await expect(card).toBeVisible()
    await expect(panel).toHaveAttribute('data-kind', 'warn')
  },
)

test('HALF 过渡文本保持原字，失焦规范化负零和未完成的指数', async ({ page }) => {
  await page.getByRole('tab', { name: /HALF/ }).click()
  const input = value(page)
  const hex = raw(page)
  await hex.fill('7C01')

  await replaceWithKeys(input, '-.')
  await expect(input).toHaveValue('-.')
  await expect(hex).toHaveValue('7C01')
  await expect(input).not.toHaveAttribute('aria-invalid', 'true')
  await input.press('Tab')
  await expect(input).toHaveValue('-0')
  await expect(hex).toHaveValue('8000')
  await expect(quantization(page)).toHaveAttribute('data-kind', 'ok')

  await replaceWithKeys(input, '1e-')
  await expect(input).toHaveValue('1e-')
  await expect(hex).toHaveValue('3C00')
  await input.press('Enter')
  await expect(input).toHaveValue('1')
  await expect(hex).toHaveValue('3C00')
  await expect(input).not.toHaveAttribute('aria-invalid', 'true')
})

test('HALF 非法粘贴和非法键入尾部保留错误及最后一次合法状态', async ({ page }) => {
  await page.getByRole('tab', { name: /HALF/ }).click()
  const hex = raw(page)
  const input = value(page)
  const error = /物理值输入无效/
  await hex.fill('3C00')

  await paste(page, input, 'Infinitye')
  await input.press('Tab')
  await expectInvalidDraft(page, 'value-input', 'Infinitye', error)
  await expect(hex).toHaveValue('3C00')
  await expect(quantization(page)).toHaveCount(0)
  await focusAndBlur(input)
  await expectInvalidDraft(page, 'value-input', 'Infinitye', error)

  await replaceWithKeys(input, 'NaN')
  await expect(hex).toHaveValue('7E00')
  await expect(input).not.toHaveAttribute('aria-invalid', 'true')
  await input.pressSequentially('e')
  await input.press('Enter')
  await expectInvalidDraft(page, 'value-input', 'NaNe', error)
  await expect(hex).toHaveValue('7E00')
  await expect(quantization(page)).toContainText('NaN → NaN')

  await retype(input, '2')
  await expect(input).not.toHaveAttribute('aria-invalid', 'true')
  await expect(hex).toHaveValue('4000')
})

test('LINEAR11 非法指数碎片失焦保留草稿且不生成请求', async ({ page }) => {
  await raw(page).fill('0002')
  await value(page).fill('1ee')
  await value(page).press('Tab')
  await expectInvalidDraft(page, 'value-input', '1ee', /物理值输入无效/)
  await expect(raw(page)).toHaveValue('0002')
  await expect(quantization(page)).toHaveCount(0)
})

test('标称电压一次粘贴和逐键输入分别保留各自的最后合法结果', async ({ page }) => {
  const nominal = await enterRelativeL16(page)
  await nominal.fill('5')
  await expect(result(page)).toHaveText('5')

  await paste(page, nominal, '12..')
  await nominal.press('Tab')
  await expectInvalidDraft(page, 'l16-nominal-vout', '12..', /标称值无效/)
  await expect(result(page)).toHaveText('5')

  await replaceWithKeys(nominal, '12.')
  await expect(result(page)).toHaveText('12')
  await nominal.pressSequentially('.')
  await nominal.press('Tab')
  await expectInvalidDraft(page, 'l16-nominal-vout', '12..', /标称值无效/)
  await expect(result(page)).toHaveText('12')
  await expect(raw(page)).toHaveValue('0100')

  await page.keyboard.press('Escape')
  await retype(nominal, '6')
  await expect(nominal).not.toHaveAttribute('aria-invalid', 'true')
  await expect(result(page)).toHaveText('6')
})

test('VOUT_MODE 专家字节与指数失焦保持配置和独立的错误', async ({ page }) => {
  await page.getByRole('tab', { name: /VOUT_MODE/ }).click()
  const expert = page.locator('#vout-mode-input')
  const exponent = page.locator('#vout-mode-n-input')
  const byte = page.getByTestId('vout-mode-byte')
  await expert.fill('3E')
  await expect(byte).toHaveText('0x3E')
  await focusAndBlur(expert)
  await expect(byte).toHaveText('0x3E')
  await retype(expert, '3E')
  await expect(byte).toHaveText('0x3E')

  const linear = page.getByRole('radio', { name: 'LINEAR', exact: true })
  await linear.click()
  await expect(byte).toHaveText('0x1E')
  await linear.click()
  await focusAndBlur(exponent)
  await expect(byte).toHaveText('0x1E')

  await expert.fill('ZZ')
  await focusAndBlur(exponent)
  await expectInvalidDraft(page, 'vout-mode-input', 'ZZ', /仅允许十六进制数字/)
  await expect(byte).toHaveText('0x1E')
})
