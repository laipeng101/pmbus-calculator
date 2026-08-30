import { test, expect, type Page } from '@playwright/test'
import { appUrl } from './helpers/app-url'

async function settle(page: Page) {
  await page.goto(appUrl())
  await expect(page.locator('.katex').first()).toBeVisible()
  await page.evaluate(async () => {
    await document.fonts.ready
  })
  await page.waitForTimeout(80)
}

async function switchToVoutMode(page: Page) {
  await page.getByRole('tab', { name: /VOUT_MODE/ }).click()
  await expect(page.getByTestId('vout-term-row')).toBeVisible()
}

// vout-mode / linear 术语触发器同时存在于结果面板配置摘要与工作区术语行中，
// 统一作用域到结果面板的配置摘要，保证定位器唯一。
const SUMMARY = '[data-testid="vout-mode-config-summary"]'
const VM_TRIGGER = SUMMARY + ' [data-testid="term-trigger-vout-mode"]'
const VM_POPOVER = '[data-testid="term-popover-vout-mode"]'
const LINEAR_TRIGGER = SUMMARY + ' [data-testid="term-trigger-linear"]'
const LINEAR_POPOVER = '[data-testid="term-popover-linear"]'

test.describe('M39 术语气泡（可访问点击解释）', () => {
  test('鼠标点击打开/关闭、点击另一术语只保留一个、点击气泡内不误关', async ({ page }) => {
    await settle(page)
    await switchToVoutMode(page)

    await page.locator(VM_TRIGGER).click()
    await expect(page.locator(VM_POPOVER)).toBeVisible()
    await expect(page.locator(VM_TRIGGER)).toHaveAttribute('aria-expanded', 'true')
    await expect(page.locator(VM_TRIGGER)).toHaveAttribute('aria-controls', /.+/)
    await expect(page.locator(VM_TRIGGER)).toHaveAttribute('aria-describedby', /.+/)
    await expect(page.locator(VM_POPOVER)).toContainText('输出电压格式配置字节')

    // 打开另一个术语：前一个关闭，只保留新的一个
    await page.locator(LINEAR_TRIGGER).click()
    await expect(page.locator(VM_POPOVER)).toHaveCount(0)
    await expect(page.locator(LINEAR_POPOVER)).toBeVisible()

    // 点击气泡内部（非交互说明文本）不误关
    await page.locator(LINEAR_POPOVER).click()
    await expect(page.locator(LINEAR_POPOVER)).toBeVisible()

    // 点击气泡外关闭
    await page.mouse.click(8, 8)
    await expect(page.locator(LINEAR_POPOVER)).toHaveCount(0)
  })

  test('键盘：触发器可聚焦，Enter 打开，Escape 关闭并恢复焦点', async ({ page }) => {
    await settle(page)
    await switchToVoutMode(page)

    const trigger = page.locator(VM_TRIGGER)
    await trigger.focus()
    await expect(trigger).toBeFocused()
    await trigger.press('Enter')
    await expect(page.locator(VM_POPOVER)).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(page.locator(VM_POPOVER)).toHaveCount(0)
    await expect(trigger).toBeFocused()
  })

  test('触屏 viewport（390px）点击打开且无 body 横向溢出', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await settle(page)
    await switchToVoutMode(page)

    await page.locator(VM_TRIGGER).click()
    await expect(page.locator(VM_POPOVER)).toBeVisible()

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    )
    expect(overflow).toBe(true)
  })

  test('气泡完整位于 viewport 内（flip/shift 防裁切）', async ({ page }) => {
    await settle(page)
    await switchToVoutMode(page)

    for (const sel of [VM_TRIGGER, LINEAR_TRIGGER]) {
      await page.locator(sel).click()
      const box = await page.locator(sel === VM_TRIGGER ? VM_POPOVER : LINEAR_POPOVER).boundingBox()
      expect(box).not.toBeNull()
      const viewport = page.viewportSize()!
      expect(box!.x).toBeGreaterThanOrEqual(0)
      expect(box!.y).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1)
      expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1)
      // 收起，为下一个术语腾出干净的初始状态
      await page.mouse.click(8, 8)
    }
  })

  test('术语触发器是真实 button，无嵌套交互控件', async ({ page }) => {
    await settle(page)
    await switchToVoutMode(page)

    const trigger = page.locator(VM_TRIGGER)
    await expect(trigger).toHaveCount(1)
    expect(await trigger.evaluate((el) => el.tagName)).toBe('BUTTON')
    expect(await trigger.evaluate((el) => el.getAttribute('type'))).toBe('button')
    const nestedInteractive = await trigger.evaluate(
      (el) =>
        el.querySelectorAll(
          'button, [role="tab"], [role="option"], summary, input, select, textarea',
        ).length,
    )
    expect(nestedInteractive).toBe(0)
  })
})
