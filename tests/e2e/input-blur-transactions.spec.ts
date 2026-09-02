import { test, expect, type Locator, type Page } from '@playwright/test'
import { appUrl } from './helpers/app-url'

/**
 * Shared-input blur transaction contract (v2.5.7, extended v2.5.8):
 *
 * v2.5.6 只把 untouched-blur 事务化带到物理值输入；本规格把同一合同推广到
 * HexInput / IntegerInput / DecimalInput / NominalVoutInput 的所有实例：
 *
 * - 当前 focus 会话内没有任何真实 onChange 时，blur/Enter 必须严格 no-op：
 *   不派发 commit、不改写 raw/参数、不清除 provenance（quantization panel）、
 *   不清除仍然存在的字段错误（DOMAIN_MODEL §6.1 / UI_CONVENTIONS §8）；
 * - dirty 依据真实编辑事务，不以解析数值相等判断；
 * - 显式清空后 blur、显式重输相同值、非法文本修复都是真实事务，仍按既有
 *   合同提交。同值重输的真实性由真实键盘事务（选中全部 → 删除 → 逐键
 *   重输 → Tab）证明：fill() 在字段已显示相同值时不触发 React onChange，
 *   因此不得用作同值提交的证据；
 * - 粘贴路径使用真实异步剪贴板 API（授权后 writeText + Ctrl/Cmd+V）；
 *   fill() 只是单次 onChange，不被称作粘贴。环境不支持剪贴板权限时该用例
 *   显式 skip 并注明「未覆盖」，不冒充；
 * - 断言最终 raw / 参数 / 错误 / 结果 / provenance，而不只是输入框外观。
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

/**
 * Real keyboard re-entry: click, select all, delete, retype the text
 * key-by-key, then blur with Tab.  Always produces real keydown/input/blur
 * events even when the field already shows the same value — the transaction
 * source is the keyboard, never a value diff.
 */
async function realKeyboardRetype(locator: Locator, text: string) {
  await locator.click()
  await locator.press('ControlOrMeta+a')
  await locator.press('Backspace')
  await locator.pressSequentially(text)
  await locator.press('Tab')
}

/**
 * Real clipboard paste through the async Clipboard API: select all, then
 * Ctrl/Cmd+V replaces the displayed content.  Returns false when the
 * environment refuses clipboard access — the caller must skip with an
 * explicit "not covered" annotation instead of presenting fill() as paste.
 */
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

test.describe('L11 untouched blur（1280×900 dark）', () => {
  test.beforeEach(async ({ page }) => {
    await setTheme(page, 'dark')
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto(appUrl())
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

  test('同值真实键盘重输重建请求来源，并断言 raw 与 provenance（v2.5.8）', async ({ page }) => {
    await valueInput(page).fill('2')
    await expect(hexInput(page)).toHaveValue('0002')
    await expect(quantizationPanel(page)).toHaveCount(1)

    // raw 路径编辑清除旧 provenance
    await hexInput(page).fill('0003')
    await expect(quantizationPanel(page)).toHaveCount(0)

    // 字段此时显示 3 而请求值是 3 的误差未知；真实键盘重输相同值 3：
    // 选中全部 → 删除 → 逐键输入 → Tab。每个事件都真实发生，提交来源
    // 是键盘事务而非 fill 的值差异。
    await realKeyboardRetype(valueInput(page), '3')
    await expect(hexInput(page)).toHaveValue('0003')
    await expect(quantizationPanel(page)).toHaveCount(1)
    await expect(quantizationPanel(page)).toHaveAttribute('data-kind', 'ok')

    // 再对已显示 2 的字段真实重输 2：证明同值请求被重新建立而非沿用
    await hexInput(page).fill('0004')
    await expect(quantizationPanel(page)).toHaveCount(0)
    await valueInput(page).fill('2')
    await realKeyboardRetype(valueInput(page), '2')
    await expect(hexInput(page)).toHaveValue('0002')
    await expect(quantizationPanel(page)).toHaveCount(1)
    await expectNoBodyHorizontalOverflow(page)
  })

  test('真实剪贴板粘贴是显式编辑事务（不支持时如实标记未覆盖）', async ({ page }) => {
    await valueInput(page).fill('7')
    await expect(hexInput(page)).toHaveValue('0007')
    await hexInput(page).fill('0003')
    await expect(quantizationPanel(page)).toHaveCount(0)

    const pasted = await realClipboardPaste(page, valueInput(page), '2')
    if (!pasted) {
      test.skip(true, '此环境不支持剪贴板权限——真实粘贴路径未覆盖，不以 fill 冒充')
    }
    await valueInput(page).press('Tab')
    await expect(hexInput(page)).toHaveValue('0002')
    await expect(quantizationPanel(page)).toHaveCount(1)
    await expect(quantizationPanel(page)).toHaveAttribute('data-kind', 'ok')
  })
})

test.describe('L16 untouched blur（390×844 dark）', () => {
  test.beforeEach(async ({ page }) => {
    await setTheme(page, 'dark')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(appUrl())
    await page.getByRole('tab', { name: /LINEAR16/ }).click()
  })

  test('provenance 存在时，raw Hex / V / N 的 untouched blur 全部保持', async ({ page }) => {
    const vInput = page.locator('#l16-v-input')
    const nInput = page.locator('#l16-n-input')

    await valueInput(page).fill('1')
    await expect(hexInput(page)).toHaveValue('0001')
    await expect(quantizationPanel(page)).toHaveCount(1)

    await untouchedFocusBlur(hexInput(page))
    await expect(hexInput(page)).toHaveValue('0001')
    await expect(quantizationPanel(page)).toHaveCount(1)

    await untouchedFocusBlur(vInput)
    await expect(hexInput(page)).toHaveValue('0001')
    await expect(vInput).toHaveValue('256')
    await expect(quantizationPanel(page)).toHaveCount(1)

    await untouchedFocusBlur(nInput)
    await expect(hexInput(page)).toHaveValue('0001')
    await expect(page.getByTestId('vout-mode-byte')).toHaveText('0x18')
    await expect(quantizationPanel(page)).toHaveCount(1)
    await expectNoBodyHorizontalOverflow(page)
  })

  test('已选中的「绝对值」radio 点击是 no-op；实际切换仍使旧 provenance 失效', async ({ page }) => {
    const absolute = page.getByRole('radio', { name: '绝对值' })
    const relative = page.getByRole('radio', { name: '相对值' })

    await valueInput(page).fill('1')
    await expect(hexInput(page)).toHaveValue('0001')
    await expect(quantizationPanel(page)).toHaveCount(1)

    // 点击当前已选中的「绝对值」：不得清除 provenance（v2.5.7）
    await absolute.click()
    await expect(absolute).toHaveAttribute('aria-checked', 'true')
    await expect(hexInput(page)).toHaveValue('0001')
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

    // v2.5.8：对已显示 257 的 Y_s 同值真实键盘重输——raw 路径合同下这仍
    // 是一次真实编辑事务，提交后 provenance 保持失效（无数值去重），
    // raw 不变；断言最终 raw 与面板而非字段外观。
    await realKeyboardRetype(ysInput, '257')
    await expect(hexInput(page)).toHaveValue('0101')
    await expect(quantizationPanel(page)).toHaveCount(0)
  })

  test('V 编辑器走 raw 路径：同值键盘重输不重建请求；物理值重输才重建（v2.5.8）', async ({
    page,
  }) => {
    const vInput = page.locator('#l16-v-input')
    await valueInput(page).fill('1')
    // raw word 0x0100；字段显示所选序（默认 LE）的字节流。
    await expect(hexInput(page)).toHaveValue('0001')
    await expect(quantizationPanel(page)).toHaveCount(1)

    // Hex 编辑清除 provenance；此时 V 字段显示 259（raw 0x0103，输入其 LE 字节流 0301）
    await hexInput(page).fill('0301')
    await expect(quantizationPanel(page)).toHaveCount(0)
    await expect(vInput).toHaveValue('259')

    // V 编辑器经 raw/set 提交（raw 路径）：真实键盘重输 256 是真实事务，
    // raw 回到 0100，但请求来源已被 raw 路径清除，面板保持隐藏
    await realKeyboardRetype(vInput, '256')
    await expect(hexInput(page)).toHaveValue('0001')
    await expect(quantizationPanel(page)).toHaveCount(0)

    // 对照路径：物理值输入的显式重输重新建立编码请求（ValueInput 的
    // 显式请求语义不被数值去重破坏）
    await realKeyboardRetype(valueInput(page), '1')
    await expect(hexInput(page)).toHaveValue('0001')
    await expect(quantizationPanel(page)).toHaveCount(1)
    await expect(quantizationPanel(page)).toHaveAttribute('data-kind', 'ok')
    await expectNoBodyHorizontalOverflow(page)
  })

  test('relative ULINEAR16：nominal untouched blur no-op；真实清空后 blur 提交 null（v2.5.8）', async ({
    page,
  }) => {
    const nominal = page.locator('#l16-nominal-vout')
    await page.getByRole('radio', { name: '相对值' }).click()
    await expect(page.getByTestId('vout-mode-byte')).toHaveText('0x98')
    await expect(nominal).toBeVisible()

    // 先建立 ratio=1 的 raw：word 0x0100 → R = 256×2^-8 = 1（输入其 LE 字节流
    // 0001；relative 页无物理值输入，fail-closed；此后 result-value 是「标称值 × 1」）
    await hexInput(page).fill('0001')
    await expect(hexInput(page)).toHaveValue('0001')

    await nominal.fill('5')
    await expect(nominal).toHaveValue('5')
    await expect(page.getByTestId('result-value')).toHaveText('5')

    // untouched blur：严格 no-op
    await untouchedFocusBlur(nominal)
    await expect(nominal).toHaveValue('5')
    await expect(page.getByTestId('result-value')).toHaveText('5')

    // 真实清空后 blur：提交 null（v2.5.8）——字段保持空、结果为 '—'，
    // raw 与 VOUT_MODE 不受影响；绝不静默恢复旧值，也不把清除混同于 0。
    // v2.5.9：真实键盘删除（全选 → Backspace），先读到真实删除后的空
    // draft 再触发 blur——不依赖任何自动化封装的 fill('') 行为。
    await nominal.click()
    await nominal.press('ControlOrMeta+a')
    await nominal.press('Backspace')
    await expect(nominal).toHaveValue('')
    await nominal.press('Tab')
    await expect(nominal).toHaveValue('')
    await expect(page.getByTestId('result-value')).toHaveText('—')
    await expect(hexInput(page)).toHaveValue('0001')
    await expect(page.getByTestId('vout-mode-byte')).toHaveText('0x98')

    // 重新输入合法值后恢复计算（5 × ratio 1 → 5）
    await nominal.fill('5')
    await expect(page.getByTestId('result-value')).toHaveText('5')

    // v2.5.8 键盘可达性：全程键盘事务在 0 ↔ 5 之间切换结果
    // （0 是 decode-only 合法值，与清除后的 null 不同）
    await realKeyboardRetype(nominal, '0')
    await expect(page.getByTestId('result-value')).toHaveText('0')
    await realKeyboardRetype(nominal, '5')
    await expect(page.getByTestId('result-value')).toHaveText('5')
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
    await page.goto(appUrl())
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

  test('系数同值真实键盘重输仍使旧请求失效（direct/set-coeff 无数值去重，v2.5.8）', async ({
    page,
  }) => {
    const mInput = page.locator('#direct-coeff-m-input')
    await valueInput(page).fill('5')
    await expect(hexInput(page)).toHaveValue('0005')
    await expect(quantizationPanel(page)).toHaveCount(1)

    // 字段已显示 1（当前 m）；真实键盘重输相同值 1 是一次真实提交事务，
    // 系数通道按既有合同使请求失效，raw 不变。
    await realKeyboardRetype(mInput, '1')
    await expect(hexInput(page)).toHaveValue('0005')
    await expect(quantizationPanel(page)).toHaveCount(0)
    await expectNoBodyHorizontalOverflow(page)
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
    await page.goto(appUrl())
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

  test('同值真实键盘重输 NaN：7C01 → canonical 7E00 + special provenance（v2.5.8）', async ({
    page,
  }) => {
    await valueInput(page).fill('NaN')
    await expect(hexInput(page)).toHaveValue('7E00')
    await expect(quantizationPanel(page)).toHaveCount(1)

    // raw Hex 编辑：7C01 是非规范 NaN，raw-lossless，provenance 失效
    await hexInput(page).fill('7C01')
    await expect(quantizationPanel(page)).toHaveCount(0)
    await expect(page.getByTestId('half-special-semantics')).toHaveCount(1)

    // 值字段此时显示 NaN——真实键盘重输相同文本仍是一次真实编辑事务：
    // 显式 NaN 请求 canonical 化为 0x7E00 并重建 special/warn provenance
    await realKeyboardRetype(valueInput(page), 'NaN')
    await expect(hexInput(page)).toHaveValue('7E00')
    await expect(quantizationPanel(page)).toHaveCount(1)
    await expect(quantizationPanel(page)).toHaveAttribute('data-kind', 'warn')
    await expect(page.getByTestId('half-special-semantics')).toHaveCount(1)
    await expectNoBodyHorizontalOverflow(page)
  })
})

test.describe('VOUT_MODE untouched blur（1280×900 light）', () => {
  test.beforeEach(async ({ page }) => {
    await setTheme(page, 'light')
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto(appUrl())
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

  test('expert Hex 同值真实键盘重输是幂等 no-op（同字节写入不产生新状态，v2.5.8）', async ({
    page,
  }) => {
    const hex = page.locator('#vout-mode-input')
    await hex.fill('3E')
    await expect(page.getByTestId('vout-mode-byte')).toHaveText('0x3E')

    // 字段已显示 3E：真实键盘重输相同字节——vout-mode/set-byte 的同字节
    // 写入是幂等 no-op，字节保持 0x3E（语义控件幂等合同，非数值去重）
    await realKeyboardRetype(hex, '3E')
    await expect(page.getByTestId('vout-mode-byte')).toHaveText('0x3E')
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

test.describe('invalid draft blur 事务（v2.5.9）', () => {
  /**
   * v2.5.9 invalid-blur defect contract: blur normalization used to run
   * BEFORE classification, repairing invalid drafts into commits —
   * `NaN.` became NaN (raw 7E00), `NaNe` became NaN, `Infinitye` became
   * +Infinity (7C00), `2..` became 2, and a pasted nominal `12..` committed
   * 12. The fixed contract: an invalid draft keeps its error through blur
   * and Enter, the last legally committed state stays untouched, and a
   * second untouched blur still keeps both (§6.2 reference time: only the
   * invalid event's blur is asserted, never a session rollback).
   */

  async function expectKeptInvalidDraft(
    page: Page,
    inputId: string,
    draft: string,
    errorText: string,
  ) {
    const input = page.locator(`#${inputId}`)
    await expect(input).toHaveValue(draft)
    await expect(input).toHaveAttribute('aria-invalid', 'true')
    const describedBy = await input.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    if (describedBy) {
      await expect(page.locator(`#${describedBy}`)).toHaveText(errorText)
    }
  }

  test.beforeEach(async ({ page }) => {
    await setTheme(page, 'dark')
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto(appUrl())
  })

  test('HALF：NaN./NaNe/Infinitye/2.. 失焦与 Enter 都保留草稿与错误，raw 不变（3C00 起点）', async ({
    page,
  }) => {
    await page.getByRole('tab', { name: /HALF/ }).click()
    await hexInput(page).fill('3C00')
    await hexInput(page).press('Tab')
    await expect(valueInput(page)).toHaveValue('1')

    // 参照时点（§6.2）：逐键输入时合法前缀（NaN / Infinity / 2.）按既有
    // 合同即时提交；断言的是「非法事件及其失焦不提交」，不是整个会话回滚。
    const prefixCommit: Record<string, string> = {
      'NaN.': '7E00',
      NaNe: '7E00',
      Infinitye: '7C00',
      '2..': '4000',
    }

    // 路径一：一次替换（fill 是单次 onChange 编辑事务），没有合法前缀提交
    for (const draft of ['NaN.', 'NaNe', 'Infinitye', '2..']) {
      await hexInput(page).fill('3C00')
      await hexInput(page).press('Tab')
      await valueInput(page).fill(draft)
      await expect(valueInput(page)).toHaveAttribute('aria-invalid', 'true', { timeout: 2000 })
      await expect(hexInput(page), `${draft} onChange 后 raw 仍为 3C00`).toHaveValue('3C00')

      // 失焦：草稿与错误保留，raw 不因失焦改写，结果仍显示旧值 1
      await valueInput(page).press('Tab')
      await expectKeptInvalidDraft(
        page,
        'value-input',
        draft,
        '物理值输入无效：仅支持十进制数字（可含小数与科学计数法）',
      )
      await expect(hexInput(page), `${draft} blur 后 raw 不变`).toHaveValue('3C00')
      await expect(page.getByTestId('result-value')).toHaveText('1')
      await expect(quantizationPanel(page)).toHaveCount(0)
    }

    // 路径二：真实键盘逐键 + Enter——前缀的合法即时提交之后，末尾碎片
    // 报错，Enter 失焦不提交、不清错，raw 保持最后合法提交值
    for (const draft of ['NaN.', 'NaNe', 'Infinitye', '2..']) {
      await hexInput(page).fill('3C00')
      await hexInput(page).press('Tab')
      await valueInput(page).click()
      await valueInput(page).press('ControlOrMeta+a')
      await valueInput(page).pressSequentially(draft)
      await valueInput(page).press('Enter')
      await expectKeptInvalidDraft(
        page,
        'value-input',
        draft,
        '物理值输入无效：仅支持十进制数字（可含小数与科学计数法）',
      )
      await expect(hexInput(page), `${draft} Enter 后 raw 保持前缀提交值`).toHaveValue(
        prefixCommit[draft]!,
      )
    }

    // 对照：合法特殊值仍工作（NaN → 7E00；Infinity → 7C00）
    await valueInput(page).fill('')
    await valueInput(page).pressSequentially('NaN')
    await expect(hexInput(page)).toHaveValue('7E00')
    await valueInput(page).fill('')
    await valueInput(page).pressSequentially('Infinity')
    await expect(hexInput(page)).toHaveValue('7C00')
    await expectNoBodyHorizontalOverflow(page)
  })

  test('HALF：非法草稿报错 → blur 保持 → 未编辑再次 blur 保持 → 真实修复后清错', async ({
    page,
  }) => {
    await page.getByRole('tab', { name: /HALF/ }).click()
    await hexInput(page).fill('3C00')
    await hexInput(page).press('Tab')

    await valueInput(page).fill('2..')
    await expect(valueInput(page)).toHaveAttribute('aria-invalid', 'true')

    await valueInput(page).press('Tab')
    await expectKeptInvalidDraft(
      page,
      'value-input',
      '2..',
      '物理值输入无效：仅支持十进制数字（可含小数与科学计数法）',
    )

    // 未编辑再次 blur：仍是严格 no-op，错误不被吞掉
    await untouchedFocusBlur(valueInput(page))
    await expectKeptInvalidDraft(
      page,
      'value-input',
      '2..',
      '物理值输入无效：仅支持十进制数字（可含小数与科学计数法）',
    )
    await expect(hexInput(page)).toHaveValue('3C00')

    // 真实修复事务（真实键盘：全选 → 删除 → 逐键输入 → Tab）：错误清除
    await realKeyboardRetype(valueInput(page), '2')
    await expect(valueInput(page)).not.toHaveAttribute('aria-invalid', 'true')
    await expect(hexInput(page)).toHaveValue('4000')
    await expect(quantizationPanel(page)).toHaveCount(1)
    await expectNoBodyHorizontalOverflow(page)
  })

  test('HALF：真实剪贴板粘贴非法草稿，失焦后 raw 与错误保持（真实粘贴路径）', async ({ page }) => {
    await page.getByRole('tab', { name: /HALF/ }).click()
    await hexInput(page).fill('3C00')
    await hexInput(page).press('Tab')

    const pasted = await realClipboardPaste(page, valueInput(page), 'Infinitye')
    if (!pasted) {
      test.skip(true, '此环境不支持剪贴板权限——真实粘贴路径未覆盖，不以 fill 冒充')
    }
    await expect(valueInput(page)).toHaveAttribute('aria-invalid', 'true')
    await valueInput(page).press('Tab')
    await expectKeptInvalidDraft(
      page,
      'value-input',
      'Infinitye',
      '物理值输入无效：仅支持十进制数字（可含小数与科学计数法）',
    )
    await expect(hexInput(page)).toHaveValue('3C00')
    await expect(page.getByTestId('result-value')).toHaveText('1')
  })

  test('L11 / absolute L16 / DIRECT：2.. 失焦保留错误与旧 raw', async ({ page }) => {
    // L11
    await hexInput(page).fill('0002')
    await hexInput(page).press('Tab')
    await valueInput(page).fill('2..')
    await expect(valueInput(page)).toHaveAttribute('aria-invalid', 'true')
    await valueInput(page).press('Tab')
    await expectKeptInvalidDraft(
      page,
      'value-input',
      '2..',
      '物理值输入无效：仅支持十进制数字（可含小数与科学计数法）',
    )
    await expect(hexInput(page)).toHaveValue('0002')

    // absolute L16
    await page.getByRole('tab', { name: /LINEAR16/ }).click()
    await hexInput(page).fill('0100')
    await hexInput(page).press('Tab')
    await valueInput(page).fill('2..')
    await expect(valueInput(page)).toHaveAttribute('aria-invalid', 'true')
    await valueInput(page).press('Tab')
    await expectKeptInvalidDraft(
      page,
      'value-input',
      '2..',
      '物理值输入无效：仅支持十进制数字（可含小数与科学计数法）',
    )
    await expect(hexInput(page)).toHaveValue('0100')

    // DIRECT
    await page.getByRole('tab', { name: /DIRECT/ }).click()
    await hexInput(page).fill('000A')
    await hexInput(page).press('Tab')
    await valueInput(page).fill('2..')
    await expect(valueInput(page)).toHaveAttribute('aria-invalid', 'true')
    await valueInput(page).press('Tab')
    await expectKeptInvalidDraft(
      page,
      'value-input',
      '2..',
      '物理值输入无效：仅支持十进制数字（可含小数与科学计数法）',
    )
    await expect(hexInput(page)).toHaveValue('000A')
    await expect(page.getByTestId('result-value')).toHaveText('10')
  })

  test('L11：1ee 等指数碎片失焦不变成 0/1，错误保持', async ({ page }) => {
    await hexInput(page).fill('0002')
    await hexInput(page).press('Tab')
    for (const draft of ['1ee', 'e', '.e', '-e+']) {
      await valueInput(page).fill(draft)
      await expect(valueInput(page)).toHaveAttribute('aria-invalid', 'true', { timeout: 2000 })
      await valueInput(page).press('Tab')
      await expectKeptInvalidDraft(
        page,
        'value-input',
        draft,
        '物理值输入无效：仅支持十进制数字（可含小数与科学计数法）',
      )
      await expect(hexInput(page), `${draft} blur 后 raw 不变`).toHaveValue('0002')
    }
    await expectNoBodyHorizontalOverflow(page)
  })

  test('relative nominal：粘贴 12.. 失焦后 nominal 保持 5 并保留错误', async ({ page }) => {
    await page.getByRole('tab', { name: /LINEAR16/ }).click()
    const nominal = page.locator('#l16-nominal-vout')
    await page.getByRole('radio', { name: '相对值' }).click()
    await expect(page.getByTestId('vout-mode-byte')).toHaveText('0x98')
    await hexInput(page).fill('0001')
    await expect(hexInput(page)).toHaveValue('0001')

    await nominal.fill('5')
    await expect(page.getByTestId('result-value')).toHaveText('5')

    // 一次粘贴完整 12..：没有合法前缀提交，nominal=5 不变（§6.2）
    const pasted = await realClipboardPaste(page, nominal, '12..')
    if (!pasted) {
      test.skip(true, '此环境不支持剪贴板权限——真实粘贴路径未覆盖，不以 fill 冒充')
    }
    await expect(nominal).toHaveAttribute('aria-invalid', 'true')
    await nominal.press('Tab')
    await expectKeptInvalidDraft(
      page,
      'l16-nominal-vout',
      '12..',
      '标称值无效：仅支持十进制非负数（可含小数与科学计数法）',
    )
    await expect(page.getByTestId('result-value')).toHaveText('5')
    await expect(hexInput(page)).toHaveValue('0001')
    await expect(page.getByTestId('vout-mode-byte')).toHaveText('0x98')
  })

  test('relative nominal：逐键 12.. 按参照时点断言——前缀合法提交、末点报错、blur 保持最后合法状态', async ({
    page,
  }) => {
    await page.getByRole('tab', { name: /LINEAR16/ }).click()
    const nominal = page.locator('#l16-nominal-vout')
    await page.getByRole('radio', { name: '相对值' }).click()
    await expect(page.getByTestId('vout-mode-byte')).toHaveText('0x98')
    await hexInput(page).fill('0001')

    await nominal.click()
    await nominal.press('ControlOrMeta+a')
    await nominal.press('Backspace')
    // 空草稿只是过渡态：nominal 状态仍为 5，结果仍显示 5（真实清空的
    // null 提交发生在 blur/Enter，这里不触发）
    await expect(nominal).toHaveValue('')

    // 逐键：'1'、'12'、'12.' 都是完整合法值，即时提交（§6.1.9）
    await nominal.pressSequentially('1')
    await expect(page.getByTestId('result-value')).toHaveText('1')
    await nominal.pressSequentially('2')
    await expect(page.getByTestId('result-value')).toHaveText('12')
    await nominal.pressSequentially('.')
    await expect(page.getByTestId('result-value')).toHaveText('12')

    // 末点：错误出现，最后合法状态 12 保持
    await nominal.pressSequentially('.')
    await expect(nominal).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByTestId('result-value')).toHaveText('12')

    // 失焦：保留错误草稿与最后合法提交（12），不回到 focus 开始时的 5
    await nominal.press('Tab')
    await expectKeptInvalidDraft(
      page,
      'l16-nominal-vout',
      '12..',
      '标称值无效：仅支持十进制非负数（可含小数与科学计数法）',
    )
    await expect(page.getByTestId('result-value')).toHaveText('12')

    // 未编辑再次 blur：保持
    await untouchedFocusBlur(nominal)
    await expectKeptInvalidDraft(
      page,
      'l16-nominal-vout',
      '12..',
      '标称值无效：仅支持十进制非负数（可含小数与科学计数法）',
    )

    // 真实修复：错误清除，新值提交
    await realKeyboardRetype(nominal, '13')
    await expect(nominal).not.toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByTestId('result-value')).toHaveText('13')
    await expectNoBodyHorizontalOverflow(page)
  })
})
