import { test, expect, type Page } from '@playwright/test'
import { appUrl } from './helpers/app-url'

/**
 * v2.6.0 控件 tooltip 合同：按钮/按钮型控件悬停即显示、移开即消失、键盘
 * focus-visible 打开、click 原动作只执行一次、与术语气泡共享全局单开。
 */

const THEME_TOOLTIP = '[data-testid="control-tooltip-theme-toggle"]'
const THEME_BUTTON = 'header button[aria-label^="当前主题"]'

async function settle(page: Page) {
  await page.goto(appUrl())
  await expect(page.locator('.katex').first()).toBeVisible()
  await page.evaluate(async () => {
    await document.fonts.ready
  })
  await page.waitForTimeout(80)
}

test.describe('v2.6.0 控件 tooltip（悬停/键盘焦点说明）', () => {
  test('hover 打开、指针移开立即关闭、tooltip 为非交互 role=tooltip', async ({ page }) => {
    await settle(page)

    const button = page.locator(THEME_BUTTON)
    await button.hover()
    const tooltip = page.locator(THEME_TOOLTIP)
    await expect(tooltip).toBeVisible()
    await expect(tooltip).toHaveAttribute('role', 'tooltip')
    await expect(button).toHaveAttribute('aria-describedby', /.+/)
    await expect(tooltip).toContainText('当前主题')

    // 指针移开即消失，不要求点击、不要求移入气泡。
    await page.mouse.move(8, 300)
    await expect(tooltip).toHaveCount(0)
    await expect(button).not.toHaveAttribute('aria-describedby')
  })

  test('click 原动作只执行一次，不被 tooltip 抢占或二次触发', async ({ page }) => {
    await settle(page)

    const button = page.locator(THEME_BUTTON)
    // 默认主题为「跟随系统」；点击序列 system → 亮色 → 暗色，每步恰好一次。
    await expect(button).toHaveAttribute('aria-label', /跟随系统/)
    // hover 打开 tooltip 后再点击：tooltip 不拦截，动作恰好发生一次。
    await button.hover()
    await expect(page.locator(THEME_TOOLTIP)).toBeVisible()
    await button.click()
    await expect(button).toHaveAttribute('aria-label', /亮色/)

    // 再点击一次恰好再切换一步（不被上一动作合并或重复）。
    await button.click()
    await expect(button).toHaveAttribute('aria-label', /暗色/)
  })

  test('键盘 focus-visible 打开，blur（Tab 离开）关闭；Escape 关闭并恢复焦点', async ({ page }) => {
    await settle(page)

    // 真实键盘 Tab 进入页头：v2.6.0 起页头术语触发器在主题按钮之前，用有界
    // Tab 循环前进到主题按钮，focus-visible 路径打开 tooltip。
    const button = page.locator(THEME_BUTTON)
    const tooltip = page.locator(THEME_TOOLTIP)
    for (let i = 0; i < 20; i++) {
      if (await button.evaluate((el) => el.matches(':focus'))) break
      await page.keyboard.press('Tab')
    }
    await expect(button).toBeFocused()
    await expect(tooltip).toBeVisible()

    // Tab 离开（blur）关闭。
    await page.keyboard.press('Tab')
    await expect(tooltip).toHaveCount(0)

    // 回到按钮再 Escape：关闭且焦点恢复在触发器上。
    await page.keyboard.press('Shift+Tab')
    await expect(tooltip).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(tooltip).toHaveCount(0)
    await expect(button).toBeFocused()
  })

  test('跨类型单开：术语气泡开着时 hover 控件，全局只剩控件 tooltip', async ({ page }) => {
    await settle(page)
    await page.getByRole('tab', { name: /VOUT_MODE/ }).click()

    const termTrigger = page.locator(
      '[data-testid="vout-term-row"] [data-testid="term-trigger-vout-mode"]',
    )
    await termTrigger.click()
    await expect(page.locator('[data-testid="term-popover-vout-mode"]')).toBeVisible()

    await page.locator(THEME_BUTTON).hover()
    await expect(page.locator(THEME_TOOLTIP)).toBeVisible()
    await expect(page.locator('[data-testid="term-popover-vout-mode"]')).toHaveCount(0)
    await expect(page.locator('[role="tooltip"]')).toHaveCount(1)
  })

  test('术语气泡开着时键盘聚焦控件也互斥（focus 打开关闭术语气泡）', async ({ page }) => {
    await settle(page)
    await page.getByRole('tab', { name: /VOUT_MODE/ }).click()

    const termTrigger = page.locator(
      '[data-testid="vout-term-row"] [data-testid="term-trigger-vout-mode"]',
    )
    await termTrigger.click()
    await expect(page.locator('[data-testid="term-popover-vout-mode"]')).toBeVisible()

    // 纯键盘反向 Tab（有界循环到主题按钮）：focus-visible 打开控件 tooltip
    // 并按单开合同关闭术语气泡。
    const button = page.locator(THEME_BUTTON)
    for (let i = 0; i < 40; i++) {
      if (await button.evaluate((el) => el.matches(':focus'))) break
      await page.keyboard.press('Shift+Tab')
    }
    await expect(button).toBeFocused()
    await expect(page.locator(THEME_TOOLTIP)).toBeVisible()
    await expect(page.locator('[data-testid="term-popover-vout-mode"]')).toHaveCount(0)
    await expect(page.locator('[role="tooltip"]')).toHaveCount(1)
  })

  test('控件触发器不是 disclosure：无 aria-expanded，且无原生 title 帮助', async ({ page }) => {
    await settle(page)

    const button = page.locator(THEME_BUTTON)
    await expect(button).not.toHaveAttribute('aria-expanded')
    await expect(button).not.toHaveAttribute('title')
  })
})
