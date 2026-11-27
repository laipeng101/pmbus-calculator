import { test, expect, type Page } from '@playwright/test'
import { GLOSSARY_TERM_IDS } from '../../src/app/terminology'
import { tabTo } from './helpers/keyboard'
import { expectNoHorizontalOverflow } from './helpers/layout'

async function settle(page: Page) {
  await page.goto('./')
  await expect(page.locator('.katex').first()).toBeVisible()
  await page.evaluate(async () => {
    await document.fonts.ready
  })
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

test.describe('术语气泡', () => {
  test('鼠标点击打开/关闭、点击另一术语只保留一个、点击气泡内不误关', async ({ page }) => {
    await settle(page)
    await switchToVoutMode(page)

    const vmTrigger = page.locator(VM_TRIGGER)

    // v2.6.1 disclosure 关闭态合同：collapsed 携带 aria-expanded="false"，
    // aria-controls/aria-describedby 只在打开时存在。
    await expect(vmTrigger).toHaveAttribute('aria-expanded', 'false')
    expect(await vmTrigger.getAttribute('aria-controls')).toBeNull()
    expect(await vmTrigger.getAttribute('aria-describedby')).toBeNull()

    await vmTrigger.click()
    await expect(page.locator(VM_POPOVER)).toBeVisible()
    await expect(page.locator(VM_TRIGGER)).toHaveAttribute('aria-expanded', 'true')
    const popoverId = await page.locator(VM_POPOVER).getAttribute('id')
    if (popoverId == null) throw new Error('Missing glossary popover ID')
    await expect(vmTrigger).toHaveAttribute('aria-controls', popoverId)
    await expect(vmTrigger).toHaveAttribute('aria-describedby', popoverId)
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
    // 关闭后 disclosure 属性回到收起态合同。
    const linearTrigger = page.locator(LINEAR_TRIGGER)
    await expect(linearTrigger).toHaveAttribute('aria-expanded', 'false')
    expect(await linearTrigger.getAttribute('aria-controls')).toBeNull()
    expect(await linearTrigger.getAttribute('aria-describedby')).toBeNull()
  })

  test('键盘：触发器可聚焦，Enter 打开，Escape 关闭并恢复焦点', async ({ page }) => {
    await settle(page)
    await switchToVoutMode(page)

    const trigger = page.locator(VM_TRIGGER)
    await tabTo(page, trigger)
    await trigger.press('Enter')
    await expect(page.locator(VM_POPOVER)).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(page.locator(VM_POPOVER)).toHaveCount(0)
    await expect(trigger).toBeFocused()
    // Escape 关闭后同样回到 aria-expanded="false" 的收起态。
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(await trigger.getAttribute('aria-controls')).toBeNull()
    expect(await trigger.getAttribute('aria-describedby')).toBeNull()
  })

  test('键盘连续打开第二个术语时全局最多一个浮层（无 pointerdown 也单开）', async ({ page }) => {
    await settle(page)
    await switchToVoutMode(page)

    // 纯键盘路径：Enter 打开 A（摘要配置字节），Tab 到 B（当前格式）再 Enter。
    const triggerA = page.locator(VM_TRIGGER)
    await tabTo(page, triggerA)
    await triggerA.press('Enter')
    await expect(page.locator(VM_POPOVER)).toBeVisible()

    await triggerA.press('Tab')
    const triggerB = page.locator(LINEAR_TRIGGER)
    await expect(triggerB).toBeFocused()
    await triggerB.press('Enter')

    // 修复的缺陷：键盘激活不产生 pointerdown，旧实现允许两个浮层同时保持。
    await expect(page.locator(VM_POPOVER)).toHaveCount(0)
    await expect(page.locator(LINEAR_POPOVER)).toBeVisible()
    await expect(page.locator('[data-testid^="term-popover-"]')).toHaveCount(1)

    // Escape 由协调层单一监听器处理：焦点确定恢复到最后激活的触发器。
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-testid^="term-popover-"]')).toHaveCount(0)
    await expect(triggerB).toBeFocused()
  })

  test('气泡完整位于视口内', async ({ page }) => {
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

  test('不同视口下术语目标至少 24×24 px 且互不遮挡', async ({ page }) => {
    await settle(page)
    await switchToVoutMode(page)
    for (const viewport of [
      { width: 360, height: 800 },
      { width: 390, height: 844 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(viewport)
      await page.evaluate(() => document.fonts.ready)

      const rects = await page.locator('.vout-term-row .term-trigger').evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect()
          return {
            testid: el.getAttribute('data-testid'),
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
          }
        }),
      )

      // LINEAR 默认状态：VOUT_MODE / Absolute-Relative / N / LINEAR。
      expect(rects.length, `term count at ${viewport.width}px`).toBe(4)
      for (const r of rects) {
        expect(r.width, `${r.testid} width at ${viewport.width}px`).toBeGreaterThanOrEqual(24)
        expect(r.height, `${r.testid} height at ${viewport.width}px`).toBeGreaterThanOrEqual(24)
        expect(r.x, `${r.testid} left edge at ${viewport.width}px`).toBeGreaterThanOrEqual(0)
        expect(r.x + r.width, `${r.testid} right edge at ${viewport.width}px`).toBeLessThanOrEqual(
          viewport.width,
        )
      }

      // 两两不重叠（getBoundingClientRect 交集判定；flex gap 行合同）。
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const a = rects[i]!
          const b = rects[j]!
          const overlaps =
            a.x < b.x + b.width &&
            b.x < a.x + a.width &&
            a.y < b.y + b.height &&
            b.y < a.y + a.height
          expect(overlaps, `${a.testid} overlaps ${b.testid} at ${viewport.width}px`).toBe(false)
        }
      }

      await expectNoHorizontalOverflow(page)
    }
  })

  test('每个注册术语都有可达按钮，触发器与其他控件独立', async ({ page }) => {
    await settle(page)
    const seen = new Set<string>()
    const triggers = page.getByRole('button').and(page.getByTestId(/^term-trigger-/))

    const collect = async () => {
      const controls = await triggers.evaluateAll((elements) => {
        const interactive =
          'button, a[href], input, select, textarea, summary, [role="button"], [role="radio"], [role="tab"]'

        return elements.map((element) => ({
          id: element.getAttribute('data-testid')!.slice('term-trigger-'.length),
          tabbableButton:
            element instanceof HTMLButtonElement &&
            element.type === 'button' &&
            element.tabIndex === 0,
          hasNestedInteraction:
            element.parentElement?.closest(interactive) != null ||
            element.querySelector(interactive) != null,
        }))
      })
      for (const { id, tabbableButton, hasNestedInteraction } of controls) {
        expect(tabbableButton, id).toBe(true)
        expect(hasNestedInteraction, id).toBe(false)
        seen.add(id)
      }
    }

    // 默认 L11：页头（PMBus/SMBus/副标题格式 token）+ L11 工作区 + 结果区。
    await collect()

    // quantization 只随显式编码请求（provenance）渲染。
    const valueInput = page.locator('#value-input')
    await valueInput.fill('0.999999')
    await valueInput.press('Tab')
    await expect(page.getByTestId('quantization-error')).toBeVisible()
    await collect()

    // L16 / DIRECT / HALF 工作区。
    await page.getByRole('tab', { name: /LINEAR16/ }).click()
    await collect()

    // L16 数据解释类型分支：SLINEAR16 offset 与 relative ULINEAR16 各自的
    // 字段术语（Y_s / Y_u / V_NOM）只在对应分支出现。
    await page.locator('#l16-payload-kind').selectOption('slinear16-offset')
    await collect()
    await page.locator('#l16-payload-kind').selectOption('ulinear16')
    await page.locator('#vout-mode-input').fill('98')
    await page.locator('#vout-mode-input').press('Tab')
    await collect()
    await page.locator('#vout-mode-input').fill('18')
    await page.locator('#vout-mode-input').press('Tab')

    await page.getByRole('tab', { name: /^DIRECT/ }).click()
    await collect()
    await page.getByRole('tab', { name: /^HALF/ }).click()
    await collect()

    // VOUT_MODE LINEAR：术语行 + 配置摘要。
    await switchToVoutMode(page)
    await collect()

    // relative 说明行的 VOUT_COMMAND 术语（bit7=1 且非 offset payload）。
    await page.getByRole('radio', { name: '相对值' }).click()
    await collect()

    // VID 格式：VID + VID Code Type。
    await page.getByRole('radio', { name: '绝对值' }).click()
    await page.getByRole('radio', { name: 'VID' }).click()
    await collect()

    // 命令参考：事务列表头 + VOUT_MODE 提示。
    await page.locator('#command-reference-toggle').click()
    await collect()

    expect([...seen].sort()).toEqual([...GLOSSARY_TERM_IDS].sort())
  })

  test('LINEAR16 气泡使用 PMBus 的 ULINEAR16 和 SLINEAR16 正式命名', async ({ page }) => {
    await settle(page)
    await page.getByRole('tab', { name: /LINEAR16/ }).click()
    const workspace = page.getByRole('tabpanel')
    const uTrigger = workspace.getByTestId('term-trigger-ulinear16')
    await expect(uTrigger).toBeVisible()
    await uTrigger.click()
    const uPopover = page.locator('[data-testid="term-popover-ulinear16"]')
    await expect(uPopover).toContainText('1.3.1 正式格式名')
    await expect(uPopover).toContainText('§8.4.1.1')
    await expect(uPopover).toContainText('16 位无符号整数')
    await expect(uPopover).not.toContainText('非 PMBus 规范命名')
    await page.keyboard.press('Escape')

    const sTrigger = workspace.getByTestId('term-trigger-slinear16')
    await expect(sTrigger).toBeVisible()
    await sTrigger.click()
    const sPopover = page.locator('[data-testid="term-popover-slinear16"]')
    await expect(sPopover).toContainText('1.3.1 正式格式名')
    await expect(sPopover).toContainText('§8.4.1.2')
    await expect(sPopover).toContainText('16 位二补码')
    await expect(sPopover).toContainText('VOUT_TRIM')
    await expect(sPopover).not.toContainText('非 PMBus 规范命名')
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-testid^="term-popover-"]')).toHaveCount(0)
  })

  test('LINEAR11 与 VOUT_MODE 的 N 分别解释相应字段', async ({ page }) => {
    await settle(page)

    // L11 的 N：主断言是 LINEAR11 word bits[15:11]（§7.3）。结果工作区字段
    // 行是 L11 专属放置，作用域化以避开同名 N 的其他触发器。
    const l11n = page
      .locator('[data-testid="result-row-fields"]')
      .getByTestId('term-trigger-linear11-exponent')
    await expect(l11n).toBeVisible()
    await l11n.click()
    const l11Popover = page.locator('[data-testid="term-popover-linear11-exponent"]')
    await expect(l11Popover).toContainText('LINEAR11 指数')
    await expect(l11Popover).toContainText('bits[15:11]')
    await expect(l11Popover).toContainText('§7.3')
    await page.keyboard.press('Escape')

    // VOUT_MODE 页术语行的 N：主断言是 VOUT_MODE bits[4:0]（§8.3/§8.4.1）。
    await switchToVoutMode(page)
    const vmN = page.locator('[data-testid="vout-term-row"] [data-testid="term-trigger-exponent"]')
    await vmN.click()
    const vmPopover = page.locator('[data-testid="term-popover-exponent"]')
    await expect(vmPopover).toContainText('VOUT_MODE 指数')
    await expect(vmPopover).toContainText('VOUT_MODE bits[4:0] 的 5 位二补码值')
    await page.keyboard.press('Escape')

    // 两个气泡的主张互不越界：VOUT_MODE N 的气泡不把 LINEAR11 word 位域当作主解释。
    await vmN.click()
    await expect(vmPopover).not.toContainText('位于两字节 word 的 bits[15:11]')
  })

  // v2.6.1 卸载状态合同（应用级）：只有 L11 渲染的术语随 Ctrl+2 模式切换被
  // 条件渲染卸载时，provider 的 active surface 必须同步清理——无残留 portal、
  // 切回 L11 无 stale 自动重开、新浮层全局仍恰好一个、Escape 恢复到当前有效
  // 触发器（绝不尝试恢复到已卸载元素）。provider 状态本身由
  // src/components/help/help-overlay.test.tsx 的 jsdom 合同守护。
  test('切换模式关闭已离开的气泡，Escape 恢复到当前触发器', async ({ page }) => {
    await settle(page)

    // 打开只属于 L11 的术语（结果工作区字段行的 LINEAR11 N）。
    const l11n = page
      .locator('[data-testid="result-row-fields"]')
      .getByTestId('term-trigger-linear11-exponent')
    await l11n.click()
    await expect(page.locator('[data-testid="term-popover-linear11-exponent"]')).toBeVisible()

    // 真实键盘 Ctrl+2 切到 L16：该触发器被条件渲染卸载。
    await page.keyboard.press('Control+2')
    await expect(
      page.locator('[data-testid="result-panel"]').getByTestId('term-trigger-ulinear16'),
    ).toBeVisible()
    await expect(page.locator('[data-testid="term-popover-linear11-exponent"]')).toHaveCount(0)

    // 切回 L11 也不得出现 stale 自动重开的浮层。
    await page.keyboard.press('Control+1')
    await expect(page.locator('[data-testid^="term-popover-"]')).toHaveCount(0)

    // 打开新的帮助浮层后全局仍恰好一个（v3.0.0：hex 触发器随主输入
    // Raw Word 化迁移到 composer，本页（L11）上的通用触发器是 raw-word）。
    const rawWord = page.getByTestId('term-trigger-raw-word').first()
    await rawWord.click()
    const popover = page.getByTestId('term-popover-raw-word')
    await expect(popover).toBeVisible()
    await expect(popover).toContainText('对照总线抓包时，请使用低字节在前的 Wire 字节。')
    await expect(page.locator('[data-testid^="term-popover-"]')).toHaveCount(1)

    // Escape 恢复到当前有效触发器。
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-testid^="term-popover-"]')).toHaveCount(0)
    await expect(rawWord).toBeFocused()
  })
})
