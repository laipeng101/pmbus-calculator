import { test, expect, type Page } from '@playwright/test'
import { appUrl } from './helpers/app-url'

/**
 * v2.6.0 控件 tooltip 合同：按钮/按钮型控件悬停即显示、键盘 focus-visible
 * 打开、click 原动作只执行一次、与术语气泡共享全局单开；v2.6.2 起满足
 * WCAG 2.2 SC 1.4.13——指针移入浮层保持可见，同时离开触发器与浮层才关闭。
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
  test('hover 打开、指针移入 tooltip 保持（SC 1.4.13 Hoverable）、离开两者后关闭', async ({
    page,
  }) => {
    await settle(page)

    const button = page.locator(THEME_BUTTON)
    await button.hover()
    const tooltip = page.locator(THEME_TOOLTIP)
    await expect(tooltip).toBeVisible()
    await expect(tooltip).toHaveAttribute('role', 'tooltip')
    await expect(button).toHaveAttribute('aria-describedby', /.+/)
    await expect(tooltip).toContainText('当前主题')

    // WCAG 2.2 SC 1.4.13：指针从触发器移入浮层（跨过 8px offset 间隙），
    // 浮层保持可见、可悬停，触发器 aria-describedby 不变。
    await tooltip.hover()
    await expect(tooltip).toBeVisible()
    await expect(button).toHaveAttribute('aria-describedby', /.+/)

    // 返回路径：从浮层移回触发器同样保持打开。
    await button.hover()
    await expect(tooltip).toBeVisible()

    // 指针同时离开触发器与浮层后才关闭（确定性短 grace，覆盖间隙穿越）。
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

  test('模式 tab：hover 打开说明（含 Ctrl 快捷键），click 只切换模式', async ({ page }) => {
    await settle(page)

    const tab = page.getByRole('tab', { name: /LINEAR16/ })
    await tab.hover()
    const tooltip = page.getByTestId('control-tooltip-mode-tab-linear16')
    await expect(tooltip).toBeVisible()
    await expect(tooltip).toContainText('切换到 LINEAR16 换算器')
    await expect(tooltip).toContainText('Ctrl+2')

    // hover 后 click：模式切换恰好发生一次，tooltip 不劫持。
    await tab.click()
    await expect(page.getByRole('tab', { name: /LINEAR16/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(page.locator('#mode-panel')).toContainText(/LINEAR16/)
  })

  test('N 锁定按钮：hover 说明随锁定状态变化，原生 title 已移除', async ({ page }) => {
    await settle(page)

    const lock = page.locator('.n-lock-button')
    await expect(lock).not.toHaveAttribute('title')
    await lock.hover()
    const tooltip = page.getByTestId('control-tooltip-l11-n-lock')
    await expect(tooltip).toBeVisible()
    await expect(tooltip).toContainText('自动')

    // click 切换状态后说明跟随（先离开再 hover，触发新的 hover 打开）。
    // click 会原地替换图标节点，Chromium 可能在旧坐标补发一次 phantom
    // pointerenter；等一帧让该伪事件先落地再移开指针，避免误判为悬停不关。
    await lock.click()
    await page.waitForTimeout(120)
    await page.mouse.move(8, 300)
    await expect(tooltip).toHaveCount(0)
    await lock.hover()
    await expect(page.getByTestId('control-tooltip-l11-n-lock')).toContainText('手动')
  })

  test('VID 下相对值禁用原因有可见路径，且全部交互控件无原生 title', async ({ page }) => {
    await settle(page)
    await page.getByRole('tab', { name: /VOUT_MODE/ }).click()

    await page.getByRole('radio', { name: 'VID' }).click()
    const relRadio = page.getByRole('radio', { name: '相对值' })
    await expect(relRadio).toBeDisabled()
    // 键盘/触屏可达的可见禁用原因（原生 title 已删除）。
    await expect(page.getByTestId('vout-rel-disabled-reason')).toContainText(
      '相对值不适用于 VID（Part II §8.5.3）',
    )

    // 运行时全量扫描：生产交互控件不携带原生 title 帮助。
    const titled = await page.evaluate(() => {
      const controls = document.querySelectorAll(
        'button, [role="tab"], [role="radio"], summary, a[href]',
      )
      return Array.from(controls)
        .filter((el) => el.hasAttribute('title'))
        .map((el) => el.textContent?.slice(0, 24) ?? el.tagName)
    })
    expect(titled).toEqual([])
  })

  test('复制工具与偏好按钮：hover 说明存在且物理值禁用原因来自同一模板', async ({ page }) => {
    await settle(page)

    const hexCopy = page.getByRole('button', { name: /Hex（LE）/ })
    await hexCopy.hover()
    await expect(page.getByTestId('control-tooltip-copy-hex')).toContainText('复制顺序')

    const prefix = page.getByRole('button', { name: '0x 前缀' })
    await prefix.hover()
    const prefixTooltip = page.getByTestId('control-tooltip-copy-pref-prefix')
    await expect(prefixTooltip).toBeVisible()
    await expect(prefixTooltip).toContainText('当前开启')

    // click 原动作不受影响：偏好真实翻转。
    await prefix.click()
    await expect(prefix).toHaveAttribute('aria-pressed', 'false')
  })

  test('位编辑按钮：hover 显示动态位号/区域/当前值，点击仍翻转', async ({ page }) => {
    await settle(page)

    // bit 15（原始数据位网格首位）。
    const bit = page.locator('.bitfield-bit').first()
    await bit.hover()
    const tooltip = page.getByTestId('control-tooltip-bit-toggle').first()
    await expect(tooltip).toBeVisible()
    await expect(tooltip).toContainText('第 15 位')
    await expect(tooltip).toContainText('当前为 0')

    await bit.click()
    await expect(bit).toHaveAttribute('aria-pressed', 'true')
  })

  test('disclosure 控件：计算过程/命令参考 hover 有说明，展开收起不受影响', async ({ page }) => {
    await settle(page)

    const steps = page.getByTestId('calculation-steps-summary')
    await steps.hover()
    const stepsTooltip = page.getByTestId('control-tooltip-steps-toggle')
    await expect(stepsTooltip).toBeVisible()
    await expect(stepsTooltip).toContainText('计算过程')

    const commandRef = page.locator('#command-reference-toggle')
    await commandRef.hover()
    await expect(page.getByTestId('control-tooltip-command-ref-toggle')).toBeVisible()
    // 命令参考 section（data-testid=command-reference）始终渲染，展开态看
    // aria-expanded 与表格容器，不能对 section 断言 unmount。
    await commandRef.click()
    await expect(commandRef).toHaveAttribute('aria-expanded', 'true')
    const tableShell = page.locator('.command-ref-table-shell')
    await expect(tableShell).toBeVisible()
    await commandRef.click()
    await expect(commandRef).toHaveAttribute('aria-expanded', 'false')
    await expect(tableShell).toHaveCount(0)
  })
})
