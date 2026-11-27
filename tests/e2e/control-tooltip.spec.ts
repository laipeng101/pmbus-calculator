import { test, expect, type Page } from '@playwright/test'
import { tabTo } from './helpers/keyboard'

const THEME_TOOLTIP = '[data-testid="control-tooltip-theme-toggle"]'
const THEME_BUTTON = 'header button[aria-label^="当前主题"]'

async function settle(page: Page) {
  await page.goto('./')
  await expect(page.locator('.katex').first()).toBeVisible()
  await page.evaluate(async () => {
    await document.fonts.ready
  })
}

test.describe('控件操作说明', () => {
  test('悬停打开说明，指针移入说明时保持可见', async ({ page }) => {
    await page.clock.install()
    await settle(page)

    const button = page.locator(THEME_BUTTON)
    await button.hover()
    const tooltip = page.locator(THEME_TOOLTIP)
    await expect(tooltip).toBeVisible()
    await expect(tooltip).toHaveAttribute('role', 'tooltip')
    const tooltipId = await tooltip.getAttribute('id')
    if (tooltipId == null) throw new Error('Missing control tooltip ID')
    await expect(button).toHaveAttribute('aria-describedby', tooltipId)
    await expect(button).not.toHaveAttribute('aria-expanded')
    await expect(button).not.toHaveAttribute('title')
    await expect(tooltip).toContainText('当前主题')

    // WCAG 2.2 SC 1.4.13：指针从触发器移入浮层（跨过 8px offset 间隙），
    // 浮层保持可见、可悬停，触发器 aria-describedby 不变。
    await tooltip.hover()
    // 指针停在说明上时，让虚拟时钟跨过关闭宽限。
    await page.clock.runFor(200)
    await expect(tooltip).toBeVisible()
    await expect(button).toHaveAttribute('aria-describedby', tooltipId)

    // 返回路径：从浮层移回触发器同样保持打开。
    await button.hover()
    await expect(tooltip).toBeVisible()

    // 指针同时离开触发器与浮层后才关闭（确定性短 grace，覆盖间隙穿越）。
    await page.mouse.move(8, 300)
    await expect(tooltip).toHaveCount(0)
    await expect(button).not.toHaveAttribute('aria-describedby')
  })

  test('说明打开时点击仍只切换一次主题', async ({ page }) => {
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

  test('键盘聚焦打开说明，Tab 和 Escape 可关闭', async ({ page }) => {
    await settle(page)

    // 真实键盘 Tab 进入页头：v2.6.0 起页头术语触发器在主题按钮之前，用有界
    // Tab 循环前进到主题按钮，focus-visible 路径打开 tooltip。
    const button = page.locator(THEME_BUTTON)
    const tooltip = page.locator(THEME_TOOLTIP)
    await tabTo(page, button)
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

  test('悬停打开控件说明时关闭原有术语气泡', async ({ page }) => {
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

  test('键盘打开控件说明时关闭原有术语气泡', async ({ page }) => {
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
    await tabTo(page, button, 'Shift+Tab', 40)
    await expect(page.locator(THEME_TOOLTIP)).toBeVisible()
    await expect(page.locator('[data-testid="term-popover-vout-mode"]')).toHaveCount(0)
    await expect(page.locator('[role="tooltip"]')).toHaveCount(1)
  })

  test('模式标签说明展示快捷键，点击切换模式', async ({ page }) => {
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

  test('指数锁定按钮的说明随锁定状态更新', async ({ page }) => {
    await settle(page)

    const lock = page.locator('.n-lock-button')
    await expect(lock).not.toHaveAttribute('title')
    await lock.hover()
    const tooltip = page.getByTestId('control-tooltip-l11-n-lock')
    await expect(tooltip).toBeVisible()
    await expect(tooltip).toContainText('自动')

    // Wait for the replacement state before moving off the hover target.
    await lock.click()
    await expect(lock).toHaveAccessibleName('N 已解锁（手动）')
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

  test('复制工具显示操作说明和禁用原因', async ({ page }) => {
    await settle(page)

    const rawCopy = page.getByRole('button', { name: 'Raw Word Hex' })
    await rawCopy.hover()
    await expect(page.getByTestId('control-tooltip-copy-raw-word')).toContainText(
      '复制当前数据字的 4 位十六进制文本',
    )

    const wireCopy = page.getByRole('button', { name: 'Wire 字节' })
    await wireCopy.hover()
    await expect(page.getByTestId('control-tooltip-copy-wire-bytes')).toContainText('低字节在前')

    const prefix = page.getByRole('button', { name: '0x 前缀' })
    await prefix.hover()
    const prefixTooltip = page.getByTestId('control-tooltip-copy-pref-prefix')
    await expect(prefixTooltip).toBeVisible()
    await expect(prefixTooltip).toContainText('当前开启')

    // click 原动作不受影响：偏好真实翻转。
    await prefix.click()
    await expect(prefix).toHaveAttribute('aria-pressed', 'false')
  })

  test('位按钮可查看位号和当前值，点击翻转位', async ({ page }) => {
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

  test('计算过程与命令参考的说明保留展开和收起操作', async ({ page }) => {
    await settle(page)

    // The first screen already carries the complete equation; a committed
    // encode request adds the supplemental quantization diagnostic.
    const valueInput = page.locator('#value-input')
    await valueInput.fill('0.999999')
    await valueInput.press('Tab')

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
