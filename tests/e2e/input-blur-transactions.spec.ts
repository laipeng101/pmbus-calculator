import { test, expect, type Page } from '@playwright/test'

/**
 * Shared-input blur transaction contract (v2.5.7):
 *
 * v2.5.6 只把 untouched-blur 事务化带到物理值输入；本规格把同一合同推广到
 * HexInput / IntegerInput / DecimalInput / NominalVoutInput 的所有实例：
 *
 * - 当前 focus 会话内没有任何真实 onChange 时，blur/Enter 必须严格 no-op：
 *   不派发 commit、不改写 raw/参数、不清除 provenance（quantization panel）、
 *   不清除仍然存在的字段错误（DOMAIN_MODEL §6.1 / UI_CONVENTIONS §8）；
 * - dirty 依据真实编辑事务，不以解析数值相等判断；
 * - 显式清空后 blur、显式重输相同值、粘贴（fill 单次 onChange）、非法文本
 *   修复都是真实事务，仍按既有合同提交。
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

const hexInput = (page: Page) => page.locator('#raw-hex-input')
const valueInput = (page: Page) => page.locator('#value-input')
const quantizationPanel = (page: Page) => page.getByTestId('quantization-error')

async function untouchedFocusBlur(locator: ReturnType<Page['locator']>) {
  await locator.click()
  await locator.press('Tab')
}

test.describe('L11 untouched blur（1280×900 dark）', () => {
  test.beforeEach(async ({ page }) => {
    await setTheme(page, 'dark')
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    // 解锁 N（手动指数），使 N 编辑器可交互。
    await page.getByRole('button', { name: 'N 已锁定（自动）' }).click()
  })

  test('物理值 provenance 存在时，raw Hex / Y / N 的 untouched blur 全部保持', async ({ page }) => {
    const yInput = page.locator('#l11-y-input')
    const nInput = page.locator('#l11-n-input')

    await valueInput(page).fill('2')
    await expect(hexInput(page)).toHaveValue('0002')
    await expect(quantizationPanel(page)).toHaveCount(1)

    await untouchedFocusBlur(hexInput(page))
    await expect(hexInput(page)).toHaveValue('0002')
    await expect(quantizationPanel(page)).toHaveCount(1)

    await untouchedFocusBlur(yInput)
    await expect(hexInput(page)).toHaveValue('0002')
    await expect(yInput).toHaveValue('2')
    await expect(quantizationPanel(page)).toHaveCount(1)

    await untouchedFocusBlur(nInput)
    await expect(hexInput(page)).toHaveValue('0002')
    await expect(quantizationPanel(page)).toHaveCount(1)
    await expectNoBodyHorizontalOverflow(page)
  })

  test('显式 raw Hex 编辑仍清除旧 provenance', async ({ page }) => {
    await valueInput(page).fill('2')
    await expect(quantizationPanel(page)).toHaveCount(1)

    await hexInput(page).fill('0003')
    await expect(quantizationPanel(page)).toHaveCount(0)
    await expect(hexInput(page)).toHaveValue('0003')
  })

  test('显式 Y 编辑与显式重输相同值都清除/提交（真实事务）', async ({ page }) => {
    await valueInput(page).fill('2')
    await expect(quantizationPanel(page)).toHaveCount(1)

    // 显式编辑 Y：raw 路径事务，清除旧 provenance
    await page.locator('#l11-y-input').fill('3')
    await expect(quantizationPanel(page)).toHaveCount(0)

    // 显式重输相同物理值：真实 onChange 事务，重新建立 provenance
    await valueInput(page).fill('')
    await valueInput(page).fill('2')
    await expect(hexInput(page)).toHaveValue('0002')
    await expect(quantizationPanel(page)).toHaveCount(1)
  })
})

test.describe('L16 untouched blur（390×844 dark）', () => {
  test.beforeEach(async ({ page }) => {
    await setTheme(page, 'dark')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    await page.getByRole('tab', { name: /LINEAR16/ }).click()
  })

  test('provenance 存在时，raw Hex / V / N 的 untouched blur 全部保持', async ({ page }) => {
    const vInput = page.locator('#l16-v-input')
    const nInput = page.locator('#l16-n-input')

    await valueInput(page).fill('1')
    await expect(hexInput(page)).toHaveValue('0100')
    await expect(quantizationPanel(page)).toHaveCount(1)

    await untouchedFocusBlur(hexInput(page))
    await expect(hexInput(page)).toHaveValue('0100')
    await expect(quantizationPanel(page)).toHaveCount(1)

    await untouchedFocusBlur(vInput)
    await expect(hexInput(page)).toHaveValue('0100')
    await expect(vInput).toHaveValue('256')
    await expect(quantizationPanel(page)).toHaveCount(1)

    await untouchedFocusBlur(nInput)
    await expect(hexInput(page)).toHaveValue('0100')
    await expect(page.getByTestId('vout-mode-byte')).toHaveText('0x18')
    await expect(quantizationPanel(page)).toHaveCount(1)
    await expectNoBodyHorizontalOverflow(page)
  })

  test('已选中的「绝对值」radio 点击是 no-op；实际切换仍使旧 provenance 失效', async ({ page }) => {
    const absolute = page.getByRole('radio', { name: '绝对值' })
    const relative = page.getByRole('radio', { name: '相对值' })

    await valueInput(page).fill('1')
    await expect(hexInput(page)).toHaveValue('0100')
    await expect(quantizationPanel(page)).toHaveCount(1)

    // 点击当前已选中的「绝对值」：不得清除 provenance（v2.5.7）
    await absolute.click()
    await expect(absolute).toHaveAttribute('aria-checked', 'true')
    await expect(hexInput(page)).toHaveValue('0100')
    await expect(page.getByTestId('vout-mode-byte')).toHaveText('0x18')
    await expect(quantizationPanel(page)).toHaveCount(1)

    // 相反路径：真实切换到相对值 → 字节 0x98，旧 provenance 失效
    await relative.click()
    await expect(relative).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByTestId('vout-mode-byte')).toHaveText('0x98')
    await expect(quantizationPanel(page)).toHaveCount(0)

    // 再次点击已选中的「相对值」同样 no-op；真实切回绝对值恢复 LINEAR 编码
    await relative.click()
    await expect(page.getByTestId('vout-mode-byte')).toHaveText('0x98')
    await expect(quantizationPanel(page)).toHaveCount(0)
    await absolute.click()
    await expect(page.getByTestId('vout-mode-byte')).toHaveText('0x18')
    await expectNoBodyHorizontalOverflow(page)
  })

  test('SLINEAR16 Y_s 的 untouched blur 不改写 raw、不清除 provenance', async ({ page }) => {
    const ysInput = page.getByLabel('Y_s（16 位二补码偏移，−32768～32767）')
    await page.getByLabel('L16 数据解释类型').selectOption('slinear16-offset')

    await valueInput(page).fill('1')
    await expect(quantizationPanel(page)).toHaveCount(1)
    const rawBefore = await hexInput(page).inputValue()

    await untouchedFocusBlur(ysInput)
    await expect(hexInput(page)).toHaveValue(rawBefore)
    await expect(quantizationPanel(page)).toHaveCount(1)

    // 显式 Y_s 编辑是真实 raw 事务：清除旧 provenance（字段已显示 256，
    // 同值 fill 不触发 React onChange，必须改为不同值）
    await ysInput.fill('257')
    await expect(quantizationPanel(page)).toHaveCount(0)
    await expect(hexInput(page)).toHaveValue('0101')
  })

  test('relative ULINEAR16：nominal untouched blur 不重置标称值；显式重输仍提交', async ({
    page,
  }) => {
    const nominal = page.locator('#l16-nominal-vout')
    await page.getByRole('radio', { name: '相对值' }).click()
    await expect(page.getByTestId('vout-mode-byte')).toHaveText('0x98')
    await expect(nominal).toBeVisible()

    await nominal.fill('5')
    await expect(nominal).toHaveValue('5')

    // untouched blur：严格 no-op
    await untouchedFocusBlur(nominal)
    await expect(nominal).toHaveValue('5')

    // 显式清空后 blur：空串不是合法标称，blur 恢复已提交值 5（定义的完成态）
    await nominal.fill('')
    await nominal.press('Tab')
    await expect(nominal).toHaveValue('5')

    // 显式重输相同值（粘贴路径）：真实事务仍提交
    await nominal.fill('5')
    await expect(nominal).toHaveValue('5')
  })

  test('显式 N 编辑清除 provenance 并改写 VOUT_MODE', async ({ page }) => {
    await valueInput(page).fill('1')
    await expect(quantizationPanel(page)).toHaveCount(1)

    await page.locator('#l16-n-input').fill('-9')
    await expect(page.getByTestId('vout-mode-byte')).toHaveText('0x17')
    await expect(quantizationPanel(page)).toHaveCount(0)
  })
})

test.describe('DIRECT untouched blur（1280×900 light）', () => {
  test.beforeEach(async ({ page }) => {
    await setTheme(page, 'light')
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    await page.getByRole('tab', { name: /DIRECT/ }).click()
  })

  test('provenance 存在时，raw Hex / Y / m / b / R 的 untouched blur 全部保持', async ({
    page,
  }) => {
    const yInput = page.locator('#direct-y-input')
    const mInput = page.locator('#direct-coeff-m-input')
    const bInput = page.locator('#direct-coeff-b-input')
    const rInput = page.locator('#direct-coeff-r-input')

    await valueInput(page).fill('5')
    await expect(hexInput(page)).toHaveValue('0005')
    await expect(quantizationPanel(page)).toHaveCount(1)

    for (const input of [hexInput(page), yInput, mInput, bInput, rInput]) {
      await untouchedFocusBlur(input)
      await expect(hexInput(page)).toHaveValue('0005')
      await expect(quantizationPanel(page)).toHaveCount(1)
    }
    await expectNoBodyHorizontalOverflow(page)
  })

  test('显式系数编辑清除 provenance', async ({ page }) => {
    await valueInput(page).fill('5')
    await expect(quantizationPanel(page)).toHaveCount(1)

    await page.locator('#direct-coeff-m-input').fill('2')
    await expect(quantizationPanel(page)).toHaveCount(0)
  })

  test('非法系数错误在无关字段 untouched blur 后保持；修复后清除', async ({ page }) => {
    const mInput = page.locator('#direct-coeff-m-input')
    const yInput = page.locator('#direct-y-input')

    await mInput.fill('2.5')
    await expect(mInput).toHaveAttribute('aria-invalid', 'true')

    // 无关字段（Y）untouched blur：不得清除 m 的字段错误，也不得改写 raw
    const rawBefore = await hexInput(page).inputValue()
    await untouchedFocusBlur(yInput)
    await expect(mInput).toHaveAttribute('aria-invalid', 'true')
    await expect(hexInput(page)).toHaveValue(rawBefore)

    // 真实修复事务：错误清除
    await mInput.fill('2')
    await expect(mInput).not.toHaveAttribute('aria-invalid', 'true')
  })
})

test.describe('HALF untouched blur（360×800 dark）', () => {
  test.beforeEach(async ({ page }) => {
    await setTheme(page, 'dark')
    await page.setViewportSize({ width: 360, height: 800 })
    await page.goto('/')
    await page.getByRole('tab', { name: /HALF/ }).click()
  })

  test('provenance 存在时，raw Hex 的 untouched blur 保持 7E00 与 special 卡', async ({ page }) => {
    await valueInput(page).fill('NaN')
    await expect(hexInput(page)).toHaveValue('7E00')
    await expect(quantizationPanel(page)).toHaveCount(1)
    await expect(page.getByTestId('half-special-semantics')).toHaveCount(1)

    await untouchedFocusBlur(hexInput(page))
    await expect(hexInput(page)).toHaveValue('7E00')
    await expect(quantizationPanel(page)).toHaveCount(1)
    await expect(page.getByTestId('half-special-semantics')).toHaveCount(1)
    await expectNoBodyHorizontalOverflow(page)
  })
})

test.describe('VOUT_MODE untouched blur（1280×900 light）', () => {
  test.beforeEach(async ({ page }) => {
    await setTheme(page, 'light')
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    await page.getByRole('tab', { name: /VOUT_MODE/ }).click()
  })

  test('expert Hex 与 LINEAR N 的 untouched blur 不改写字节', async ({ page }) => {
    // expert Hex 写入一个结构合法但非默认的字节
    await page.locator('#vout-mode-input').fill('3E')
    await expect(page.getByTestId('vout-mode-byte')).toHaveText('0x3E')

    await untouchedFocusBlur(page.locator('#vout-mode-input'))
    await expect(page.getByTestId('vout-mode-byte')).toHaveText('0x3E')

    // 切回 LINEAR 格式后（parameter 位保留：0x3E -> 0x1E），N untouched blur 同样 no-op
    await page.getByRole('radio', { name: 'LINEAR' }).click()
    await expect(page.getByTestId('vout-mode-byte')).toHaveText('0x1E')
    await untouchedFocusBlur(page.locator('#vout-mode-n-input'))
    await expect(page.getByTestId('vout-mode-byte')).toHaveText('0x1E')
    await expectNoBodyHorizontalOverflow(page)
  })

  test('已选中的格式 radio 点击幂等：字节与状态不变', async ({ page }) => {
    // 默认字节 0x18（LINEAR）：重复点击 LINEAR 不产生任何状态写入
    const linear = page.getByRole('radio', { name: 'LINEAR' })
    await expect(linear).toHaveAttribute('aria-checked', 'true')
    await linear.click()
    await expect(page.getByTestId('vout-mode-byte')).toHaveText('0x18')
    await expect(page.getByTestId('vout-mode-status')).toBeVisible()

    // 真实切换到 DIRECT 后再点一次 DIRECT（已选中），字节保持 0x40
    await page.getByRole('radio', { name: 'DIRECT' }).click()
    await expect(page.getByTestId('vout-mode-byte')).toHaveText('0x40')
    await page.getByRole('radio', { name: 'DIRECT' }).click()
    await expect(page.getByTestId('vout-mode-byte')).toHaveText('0x40')
    await expectNoBodyHorizontalOverflow(page)
  })

  test('expert Hex 非法草稿错误在 N untouched blur 后保持', async ({ page }) => {
    const hex = page.locator('#vout-mode-input')
    await hex.fill('ZZ')
    await expect(hex).toHaveAttribute('aria-invalid', 'true')

    await untouchedFocusBlur(page.locator('#vout-mode-n-input'))
    await expect(hex).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByTestId('vout-mode-byte')).toHaveText('0x18')
  })
})
