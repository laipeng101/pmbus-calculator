import { test, expect } from '@playwright/test'

const RAW_HEX = '#raw-hex-input'
const VALUE = '#value-input'
const STEP_UP = '[data-testid="raw-hex-input-step-up"]'
const STEP_DOWN = '[data-testid="raw-hex-input-step-down"]'
const VOUT_HEX = '#vout-mode-input'
const SUMMARY = '[data-testid="vout-mode-config-summary"]'
const VM_TRIGGER = `${SUMMARY} [data-testid="term-trigger-vout-mode"]`
const VM_POPOVER = '[data-testid="term-popover-vout-mode"]'

test.describe('浏览器核心流程', () => {
  test('加载默认为 LINEAR11，切换换算模式保留原字', { tag: '@browser-smoke' }, async ({ page }) => {
    await page.goto('./')
    const linear11 = page.getByRole('tab', { name: /LINEAR11/ })
    const raw = page.locator(RAW_HEX)
    await expect(linear11).toHaveAttribute('aria-selected', 'true')
    await expect(raw).toHaveValue('0000')
    await expect(page.getByTestId('result-value')).toHaveText('0')
    await raw.fill('0007')

    await page.getByRole('tab', { name: /LINEAR16/ }).click()
    await expect(page.getByLabel('V（16 位无符号，0～65535）')).toHaveValue('7')
    await expect(raw).toHaveValue('0007')

    await page.getByRole('tab', { name: /DIRECT/ }).click()
    await expect(page.locator(RAW_HEX)).toHaveValue('0007')
    await expect(page.getByLabel('Y（16 位有符号，−32768～32767）')).toHaveValue('7')

    const half = page.getByRole('tab', { name: /HALF/ })
    await half.click()
    await expect(half).toHaveAttribute('aria-selected', 'true')
    await expect(raw).toHaveValue('0007')

    await page.getByRole('tab', { name: /VOUT_MODE/ }).click()
    await page.getByRole('radio', { name: '相对值', exact: true }).click()
    await expect(page.getByTestId('vout-mode-byte')).toHaveText('0x98')

    await linear11.click()
    await expect(linear11).toHaveAttribute('aria-selected', 'true')
    await expect(raw).toHaveValue('0007')
    await expect(page.getByTestId('result-value')).toHaveText('7')
  })

  test('位映射默认展开，键盘收起后刷新记忆，重新展开仍可编辑', async ({ page }) => {
    await page.goto('./')
    const toggle = page.getByTestId('bit-mapping-raw-word-toggle')
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await toggle.focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('#bit-mapping-raw-word-content')).toBeHidden()
    await page.reload()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await toggle.focus()
    await page.keyboard.press('Space')
    await page.getByRole('button', { name: '位 0: 0', exact: true }).click()
    await expect(page.locator(RAW_HEX)).toHaveValue('0001')
    await page.getByRole('tab', { name: /VOUT_MODE/ }).click()
    await expect(page.getByTestId('bit-mapping-vout-mode-toggle')).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })

  test('L11：12.5 编码 F819，再由 C100 解码为 1', { tag: '@browser-smoke' }, async ({ page }) => {
    await page.goto('./')
    const value = page.locator(VALUE)
    const hex = page.locator(RAW_HEX)

    await value.fill('12.5')
    await expect(hex).toHaveValue('F819')

    // Use a different word: refilling F819 would leave the input untouched
    // and could pass even if the raw-to-value transaction never ran.
    await hex.fill('C100')
    await hex.press('Tab')
    await expect(value).toHaveValue('1')
    await expect(page.getByTestId('result-value')).toHaveText('1')
    await expect(page.locator('.katex').first()).toBeVisible()
    await expect(page.locator('.katex-error')).toHaveCount(0)
  })

  test('DIRECT 原字、位按钮、Y 和物理值同步', { tag: '@browser-smoke' }, async ({ page }) => {
    await page.goto('./')
    await page.getByRole('tab', { name: /DIRECT/ }).click()
    const hex = page.locator(RAW_HEX)
    const y = page.getByLabel('Y（16 位有符号，−32768～32767）')
    const value = page.locator(VALUE)

    await hex.fill('8000')
    await expect(y).toHaveValue('-32768')
    await expect(value).toHaveValue('-32768')

    await y.fill('10')
    await expect(hex).toHaveValue('000A')
    await expect(value).toHaveValue('10')

    await value.fill('5')
    await expect(hex).toHaveValue('0005')
    await expect(y).toHaveValue('5')

    await page.getByRole('button', { name: '位 0: 1', exact: true }).click()
    await expect(hex).toHaveValue('0004')
    await expect(y).toHaveValue('4')
    await expect(value).toHaveValue('4')
  })

  test(
    'HALF：3C00 解码 1，再编码 2 → 4000、位 15 切换到 −2',
    { tag: '@browser-smoke' },
    async ({ page }) => {
      await page.goto('./')
      await page.getByRole('tab', { name: /HALF/ }).click()
      const hex = page.locator(RAW_HEX)
      const value = page.locator(VALUE)

      await hex.fill('3C00')
      await expect(value).toHaveValue('1')

      await value.fill('2')
      await expect(hex).toHaveValue('4000')
      await expect(page.getByTestId('result-value')).toHaveText('2')

      await page.getByRole('button', { name: '位 15: 0' }).click()
      await expect(hex).toHaveValue('C000')
      await expect(value).toHaveValue('-2')
    },
  )

  test('LINEAR16 整数 V 提交后可继续编码和解码', { tag: '@browser-smoke' }, async ({ page }) => {
    await page.goto('./')
    await page.getByRole('tab', { name: /LINEAR16/ }).click()
    const v = page.getByLabel('V（16 位无符号，0～65535）')

    await v.fill('+12')
    await v.press('Tab')
    await expect(v).toHaveValue('12')
    await expect(page.locator(RAW_HEX)).toHaveValue('000C')
    await expect(page.getByTestId('vout-mode-byte')).toHaveText('0x18')

    await page.locator(VALUE).fill('1.5')
    await expect(page.locator(RAW_HEX)).toHaveValue('0180')
    await expect(v).toHaveValue('384')

    await page.locator(RAW_HEX).fill('0300')
    await page.locator(RAW_HEX).press('Tab')
    await expect(page.locator(VALUE)).toHaveValue('3')
    await expect(page.getByTestId('result-value')).toHaveText('3')
    await expect(v).toHaveValue('768')
  })

  test(
    'LINEAR16 遇到非 LINEAR 配置暂停换算，应用示例后恢复',
    { tag: '@browser-smoke' },
    async ({ page }) => {
      await page.goto('./')
      await page.getByRole('tab', { name: /LINEAR16/ }).click()
      const vout = page.locator(VOUT_HEX)
      await vout.fill('20')
      await vout.press('Tab')

      // §8.4 fail-closed：显示真实字节 0x20（无 0x18 交换），物理输入消失，
      // 结果不可计算。
      await expect(page.locator(VALUE)).toHaveCount(0)
      await expect(page.getByTestId('result-value')).toHaveText('—')
      await expect(page.getByTestId('vout-mode-byte')).toHaveText('0x20')
      await expect(page.getByTestId('vout-mode-source')).toHaveText('非 LINEAR')

      await page.getByRole('button', { name: '应用计算器 LINEAR 示例 0x18' }).click()
      await expect(page.getByTestId('vout-mode-byte')).toHaveText('0x18')
      await page.locator(VALUE).fill('0.005')
      await expect(page.locator(RAW_HEX)).toHaveValue('0001')
      await expect(page.getByTestId('quantization-error')).toContainText('+0.001094 (21.8750%)')
    },
  )

  test(
    '位编辑更新原字，Wire 与 MSB-first 分别按顺序复制',
    { tag: '@browser-smoke' },
    async ({ page, context, browserName }) => {
      if (browserName === 'chromium') {
        await context.grantPermissions(['clipboard-read', 'clipboard-write'])
      } else if (browserName === 'webkit') {
        await context.grantPermissions(['clipboard-read'])
      }
      await page.goto('./')
      const hex = page.locator(RAW_HEX)

      await page.getByRole('button', { name: '位 0: 0' }).click()
      await expect(hex).toHaveValue('0001')
      await expect(page.locator(VALUE)).toHaveValue('1')

      const wireBtn = page.getByRole('button', { name: 'Wire 字节' })
      await wireBtn.click()
      await expect(page.getByText('已复制: Wire 字节')).toBeVisible()
      // Linux WebKit 只稳定支持写入，写入成功后显示复制反馈。
      if (browserName !== 'webkit') {
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('0x 01 00')
      }

      const msbBtn = page.getByRole('button', { name: 'MSB-first 字节' })
      await msbBtn.click()
      await expect(page.getByText('已复制: MSB-first 字节')).toBeVisible()
      if (browserName !== 'webkit') {
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('0x 00 01')
      }
    },
  )

  test(
    '点击 Hex 步进按钮只变动一格，焦点留在输入框',
    { tag: '@browser-smoke' },
    async ({ page }) => {
      await page.goto('./')
      const hex = page.locator(RAW_HEX)
      await hex.fill('0009')
      await expect(hex).toHaveValue('0009')

      await page.locator(STEP_UP).click()
      await expect(hex).toHaveValue('000A')
      // pointerdown preventDefault 的合同后果：焦点仍在文本输入框内。
      await expect(hex).toBeFocused()
      await expect(page.getByRole('button', { name: '位 1: 1', exact: true })).toBeVisible()
      await expect(page.locator(VALUE)).toHaveValue('10')

      await page.locator(STEP_UP).click()
      await expect(hex).toHaveValue('000B')
      await page.locator(STEP_DOWN).click()
      await expect(hex).toHaveValue('000A')
    },
  )

  test('键盘可激活 Hex 步进按钮，边界禁用增量', { tag: '@browser-smoke' }, async ({ page }) => {
    await page.goto('./')
    const hex = page.locator(RAW_HEX)
    await hex.fill('0000')

    // macOS WebKit 默认（未开 Full Keyboard Access）Tab 会跳过 button、直达
    // 下一个文本框（探针：Tab 从 Raw Word 输入落到 #l11-y-input）；Firefox/
    // Chromium 则聚焦按钮。Tab 目标属于平台键盘导航约定，不属于引擎敏感
    // 合同，故本套件以程序化 focus 断言键盘激活；Tab 进按钮的完整合同仍由
    // chromium 深度套件覆盖（hex-stepper.spec.ts）。
    const up = page.locator(STEP_UP)
    await up.focus()
    await expect(up).toBeFocused()

    await page.keyboard.press('Enter')
    await expect(hex).toHaveValue('0001')
    await page.keyboard.press('Space')
    await expect(hex).toHaveValue('0002')

    // 文本控件在所有引擎都参与 Tab 序列：Shift+Tab 应回输入框。
    await page.keyboard.press('Shift+Tab')
    await expect(hex).toBeFocused()

    await page.locator(STEP_DOWN).focus()
    await page.keyboard.press('Enter')
    await expect(hex).toHaveValue('0001')

    // 边界真实 disabled：FFFF 上界按钮不可激活，永不回绕。
    await hex.fill('FFFF')
    await expect(page.locator(STEP_UP)).toBeDisabled()
  })

  test('术语气泡：点击打开、Escape 关闭并恢复焦点', { tag: '@browser-smoke' }, async ({ page }) => {
    await page.goto('./')
    await page.getByRole('tab', { name: /VOUT_MODE/ }).click()
    await expect(page.getByTestId('vout-term-row')).toBeVisible()

    const trigger = page.locator(VM_TRIGGER)
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await trigger.click()
    await expect(page.locator(VM_POPOVER)).toBeVisible()
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await expect(page.locator(VM_POPOVER)).toContainText('输出电压格式配置字节')

    await page.keyboard.press('Escape')
    await expect(page.locator(VM_POPOVER)).toHaveCount(0)
    await expect(trigger).toBeFocused()
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  test('命令参考：展开后只读显示且不影响模式与 raw', async ({ page }) => {
    await page.goto('./')
    const hex = page.locator(RAW_HEX)
    const toggle = page.locator('#command-reference-toggle')

    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(page.getByRole('row', { name: /VOUT_COMMAND/ })).toHaveCount(0)

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByRole('row', { name: /VOUT_COMMAND/ })).toBeVisible()
    await expect(page.getByRole('row', { name: /READ_VIN/ })).toContainText('器件数据手册')

    // 只读：模式与 raw 完全不受影响，也没有预设按钮。
    await expect(hex).toHaveValue('0000')
    await expect(page.getByRole('tab', { name: /LINEAR11/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(page.getByRole('button', { name: /应用.*预设/ })).toHaveCount(0)
  })
})
