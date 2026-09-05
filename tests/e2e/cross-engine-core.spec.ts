import { test, expect } from '@playwright/test'
import { appUrl } from './helpers/app-url'

// Cross-engine core smoke（Firefox + WebKit 验收底线）。
//
// 目标：为桌面/移动 Chromium 深度语义套件之外的两个引擎建立小型、失败闭合的
// 核心用户合同证据；不复制完整语义套件，也不重复领域 golden 向量。每条用例
// 只保留「跨引擎最容易回归」的核心交互链，断言语义与既有 chromium 套件一致
// （calculator.spec / hex-stepper.spec / terminology-popover.spec），数值全部
// 来自已验证向量：
//   1. boot + 模式切换 + canonical raw 跨模式保持；
//   2. L11/L16/DIRECT/HALF 各一条 encode/decode 旅程（运行时/事件回归探针）；
//   3. L16 非 LINEAR 共享字节 fail closed（不伪造物理结果）；
//   4. canonical raw ↔ 位网格 ↔ wire 字节同步 + 复制反馈 + 剪贴板内容；
//   5. Hex 步进器 pointer + keyboard 激活：精确单次提交与焦点保持；
//   6. 术语气泡浮层（点击/Escape/焦点恢复）与只读命令参考。
// 移动端触屏与视觉合同不在此套件范围（mobile-contract / visual 套件负责）。

const RAW_HEX = '#raw-hex-input'
const VALUE = '#value-input'
const STEP_UP = '[data-testid="raw-hex-input-step-up"]'
const STEP_DOWN = '[data-testid="raw-hex-input-step-down"]'
const VOUT_HEX = '#vout-mode-input'
const SUMMARY = '[data-testid="vout-mode-config-summary"]'
const VM_TRIGGER = `${SUMMARY} [data-testid="term-trigger-vout-mode"]`
const VM_POPOVER = '[data-testid="term-popover-vout-mode"]'

test.describe('cross-engine core smoke（Firefox + WebKit）', () => {
  test('boot：应用加载、L11 默认模式、结果面板就绪', async ({ page }) => {
    await page.goto(appUrl())
    await expect(page.getByRole('tab', { name: /LINEAR11/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(page.locator(RAW_HEX)).toHaveValue('0000')
    await expect(page.locator(VALUE)).toHaveValue('0')
    await expect(page.getByTestId('result-value')).toBeVisible()
  })

  test('模式切换：canonical raw 跨模式保持且各模式控件就绪', async ({ page }) => {
    await page.goto(appUrl())
    await page.locator(RAW_HEX).fill('0007')

    await page.getByRole('tab', { name: /DIRECT/ }).click()
    await expect(page.locator(RAW_HEX)).toHaveValue('0007')
    await expect(page.getByLabel('Y（16 位有符号，−32768～32767）')).toHaveValue('7')

    await page.getByRole('tab', { name: /HALF/ }).click()
    await expect(page.locator(RAW_HEX)).toHaveValue('0007')

    await page.getByRole('tab', { name: /LINEAR11/ }).click()
    await expect(page.locator(RAW_HEX)).toHaveValue('0007')
    await expect(page.locator(VALUE)).toBeVisible()
  })

  test('L11：value 编码 + hex 解码双向闭环（F819 ↔ 12.5）', async ({ page }) => {
    await page.goto(appUrl())
    const value = page.locator(VALUE)
    const hex = page.locator(RAW_HEX)

    await value.fill('12.5')
    await expect(hex).toHaveValue('F819')

    await hex.fill('F819')
    await hex.press('Tab')
    await expect(value).toHaveValue('12.5')
    await expect(page.locator('.katex').first()).toBeVisible()
    await expect(page.locator('.katex-error')).toHaveCount(0)
  })

  test('DIRECT：hex/Y/value 三向同步（含 8000 → −32768 解码）', async ({ page }) => {
    await page.goto(appUrl())
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
  })

  test('HALF：3C00 ↔ 1 双向闭环 + 位 15 切换到 −1', async ({ page }) => {
    await page.goto(appUrl())
    await page.getByRole('tab', { name: /HALF/ }).click()
    const hex = page.locator(RAW_HEX)
    const value = page.locator(VALUE)

    await hex.fill('3C00')
    await expect(value).toHaveValue('1')

    await value.fill('1')
    await expect(hex).toHaveValue('3C00')

    await page.getByRole('button', { name: '位 15: 0' }).click()
    await expect(hex).toHaveValue('BC00')
    await expect(value).toHaveValue('-1')
  })

  test('L16：LINEAR 0x18 下 V=12 编码为 canonical raw 000C', async ({ page }) => {
    await page.goto(appUrl())
    await page.getByRole('tab', { name: /LINEAR16/ }).click()
    const v = page.getByLabel('V（16 位无符号，0～65535）')

    await v.fill('+12')
    await v.press('Tab')
    await expect(v).toHaveValue('12')
    await expect(page.locator(RAW_HEX)).toHaveValue('000C')
    await expect(page.getByTestId('vout-mode-byte')).toHaveText('0x18')
  })

  test('L16：非 LINEAR 共享字节 0x20 fail closed（无物理输入、无伪结果）', async ({ page }) => {
    await page.goto(appUrl())
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
  })

  test('canonical raw ↔ 位网格 ↔ wire 字节同步 + 复制反馈与剪贴板内容', async ({
    page,
    context,
    browserName,
  }) => {
    // WebKit 走 grantPermissions；Firefox 不支持 clipboard 权限名，改由
    // firefox-core 项目的 dom.events.testing.asyncClipboard 官方测试偏好启用。
    if (browserName !== 'firefox') {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    }
    await page.goto(appUrl())
    const hex = page.locator(RAW_HEX)

    await page.getByRole('button', { name: '位 0: 0' }).click()
    await expect(hex).toHaveValue('0001')
    await expect(page.locator(VALUE)).toHaveValue('1')

    const wireBtn = page.getByRole('button', { name: 'Wire 字节' })
    await wireBtn.scrollIntoViewIfNeeded()
    await wireBtn.evaluate((el: HTMLButtonElement) => el.click())
    await expect(page.getByText('已复制: Wire 字节')).toBeVisible()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('0x 01 00')

    const msbBtn = page.getByRole('button', { name: 'MSB-first 字节' })
    await msbBtn.scrollIntoViewIfNeeded()
    await msbBtn.evaluate((el: HTMLButtonElement) => el.click())
    await expect(page.getByText('已复制: MSB-first 字节')).toBeVisible()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('0x 00 01')
  })

  test('Hex 步进器 pointer：每次点击精确单次提交且焦点保持在输入框', async ({ page }) => {
    await page.goto(appUrl())
    const hex = page.locator(RAW_HEX)
    await hex.fill('0009')
    await expect(hex).toHaveValue('0009')

    await page.locator(STEP_UP).click()
    await expect(hex).toHaveValue('000A')
    // pointerdown preventDefault 的合同后果：焦点仍在文本输入框内。
    expect(await page.evaluate(() => document.activeElement?.id ?? '')).toBe('raw-hex-input')

    await page.locator(STEP_UP).click()
    await expect(hex).toHaveValue('000B')
    await page.locator(STEP_DOWN).click()
    await expect(hex).toHaveValue('000A')
  })

  test('Hex 步进器 keyboard：Tab 聚焦、Enter/Space 激活、边界禁用', async ({ page }) => {
    await page.goto(appUrl())
    const hex = page.locator(RAW_HEX)
    await hex.fill('0000')

    await page.keyboard.press('Tab')
    const up = page.locator(STEP_UP)
    await expect(up).toBeFocused()
    const outline = await up.evaluate((el) => getComputedStyle(el).outlineStyle)
    expect(outline).not.toBe('none')

    await page.keyboard.press('Enter')
    await expect(hex).toHaveValue('0001')
    await page.keyboard.press('Space')
    await expect(hex).toHaveValue('0002')

    await page.keyboard.press('Shift+Tab')
    await expect(hex).toBeFocused()
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    await expect(page.locator(STEP_DOWN)).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(hex).toHaveValue('0001')
  })

  test('术语气泡：点击打开、Escape 关闭并恢复焦点', async ({ page }) => {
    await page.goto(appUrl())
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
    await page.goto(appUrl())
    const hex = page.locator(RAW_HEX)
    const toggle = page.locator('#command-reference-toggle')

    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(page.getByRole('row', { name: /VOUT_COMMAND/ })).toHaveCount(0)

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByRole('row', { name: /VOUT_COMMAND/ })).toBeVisible()
    await expect(page.getByRole('row', { name: /READ_VIN/ })).toContainText('由器件资料决定')

    // 只读：模式与 raw 完全不受影响，也没有预设按钮。
    await expect(hex).toHaveValue('0000')
    await expect(page.getByRole('tab', { name: /LINEAR11/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(page.getByRole('button', { name: /应用.*预设/ })).toHaveCount(0)
  })
})
