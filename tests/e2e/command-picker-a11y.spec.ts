import { test, expect, type Page } from '@playwright/test'

/**
 * M22 CommandPicker APG 焦点、选择与搜索生命周期回归矩阵。
 *
 * 长期合同（docs/UI_CONVENTIONS.md §9）：
 * - option 是不进入 Tab 顺序的语义元素；`aria-selected=true` 恒等于
 *   `aria-activedescendant` 指向的 active option；committed command 的视觉
 *   标记走 `data-current`，不复用 ARIA selection。
 * - ArrowUp/ArrowDown 首尾停止不循环；Enter 应用 active option；Escape 取消
 *   并恢复 trigger 焦点；Tab/Shift+Tab 关闭 popup 并移动到 trigger 的逻辑
 *   后继/前驱；焦点移到 popup/trigger 外部时关闭但不抢焦点；Home/End 与
 *   左右键保持浏览器文本编辑行为。
 * - “无命令”只在空 query 时是合法 option；非空 query 零匹配显示非 option
 *   状态文案，`aria-activedescendant` 移除，Arrow/Enter 安全 no-op；清空
 *   query 恢复 option、active selection 与 listbox 内部滚动位置。
 */

const SEARCH_INPUT = '[role="combobox"]'

interface ActiveState {
  active: string | null
  selected: string[]
  optionCount: number
}

async function activeState(page: Page): Promise<ActiveState> {
  return page.evaluate(() => {
    const input = document.querySelector('[role="combobox"]')
    const options = Array.from(document.querySelectorAll('[role="option"]'))
    return {
      active: input?.getAttribute('aria-activedescendant') ?? null,
      selected: options.filter((o) => o.getAttribute('aria-selected') === 'true').map((o) => o.id),
      optionCount: options.length,
    }
  })
}

/** Whenever options exist there is exactly one aria-selected=true and it is the
 *  activedescendant target; when zero options exist there is no activedescendant. */
async function expectActiveInvariant(page: Page) {
  const state = await activeState(page)
  if (state.optionCount > 0) {
    expect(state.selected, JSON.stringify(state)).toHaveLength(1)
    expect(state.active, JSON.stringify(state)).toBe(state.selected[0])
    expect(await page.locator(`#${state.active}`).count()).toBe(1)
  } else {
    expect(state.active, JSON.stringify(state)).toBeNull()
    expect(state.selected, JSON.stringify(state)).toHaveLength(0)
  }
}

async function openPicker(page: Page) {
  await page.goto('/')
  await page.locator('#command-picker').click()
  await expect(page.locator('#command-picker-listbox')).toBeVisible()
  await expect(page.locator('#command-picker')).toHaveAttribute('aria-expanded', 'true')
}

/** Re-open on the current page — unlike openPicker this must NOT navigate,
 *  otherwise a previously committed command would be reset by the reload. */
async function reopenPicker(page: Page) {
  await page.locator('#command-picker').click()
  await expect(page.locator('#command-picker-listbox')).toBeVisible()
  await expect(page.locator('#command-picker')).toHaveAttribute('aria-expanded', 'true')
}

async function selectCommandViaSearch(page: Page, query: string) {
  await openPicker(page)
  await page.locator(SEARCH_INPUT).fill(query)
  await page.keyboard.press('Enter')
  await expect(page.locator('#command-picker')).toHaveAttribute('aria-expanded', 'false')
  await expect(page.locator('#command-picker')).toContainText(query)
}

async function focusReport(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement
    const trigger = document.getElementById('command-picker')
    let position: string | null = null
    if (el instanceof Element && trigger) {
      const mask = trigger.compareDocumentPosition(el)
      if (mask & Node.DOCUMENT_POSITION_FOLLOWING) position = 'after-trigger'
      else if (mask & Node.DOCUMENT_POSITION_PRECEDING) position = 'before-trigger'
      else position = 'same'
    }
    return {
      tag: el?.tagName ?? null,
      role: el?.getAttribute('role') ?? null,
      id: el?.id ?? null,
      text: el?.textContent?.trim().slice(0, 24) ?? null,
      position,
      popupOpen: document.getElementById('command-picker-listbox') != null,
    }
  })
}

test.describe('选项语义：option 不聚焦、aria-selected 跟随 active、committed 走 data-current', () => {
  test('option 是不可聚焦的语义元素，不是 Tab 顺序中的 button', async ({ page }) => {
    await openPicker(page)
    const info = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[role="option"]')).map((o) => ({
        tag: o.tagName,
        tabIndex: (o as HTMLElement).tabIndex,
        hasButtonChild: o.querySelector('button') != null,
      })),
    )
    expect(info.length).toBeGreaterThan(0)
    for (const option of info) {
      expect(option.tag).toBe('LI')
      expect(option.tabIndex).toBe(-1)
      expect(option.hasButtonChild).toBe(false)
    }
  })

  test('打开后 active 与唯一 aria-selected=true 一致（默认无命令 → NONE）', async ({ page }) => {
    await openPicker(page)
    const state = await activeState(page)
    expect(state.optionCount).toBeGreaterThan(0)
    await expectActiveInvariant(page)
    expect(state.active).toBe('command-option-none')
  })

  test('方向键移动后 aria-selected 始终跟随 activedescendant 目标', async ({ page }) => {
    await openPicker(page)
    for (let i = 0; i < 3; i += 1) {
      await page.keyboard.press('ArrowDown')
      await expectActiveInvariant(page)
    }
    const state = await activeState(page)
    expect(state.active).not.toBe('command-option-none')
  })

  test('committed command 用 data-current 标记；aria-selected 只反映 active', async ({ page }) => {
    await selectCommandViaSearch(page, 'VOUT_COMMAND')
    await reopenPicker(page)
    const current = await page.evaluate(() => {
      const marked = document.querySelector('[data-current="true"]')
      return marked ? marked.id : null
    })
    expect(current).toBe('command-option-VOUT_COMMAND')
    // 打开时 active = committed → 唯一 aria-selected 同时是 data-current。
    await expectActiveInvariant(page)
    const before = await activeState(page)
    expect(before.selected[0]).toBe('command-option-VOUT_COMMAND')
    // 移动后 aria-selected 离开 committed，但 data-current 不动。
    await page.keyboard.press('ArrowDown')
    await expectActiveInvariant(page)
    const after = await activeState(page)
    expect(after.selected[0]).not.toBe('command-option-VOUT_COMMAND')
    expect(
      await page.evaluate(() => document.querySelector('[data-current="true"]')?.id ?? null),
    ).toBe('command-option-VOUT_COMMAND')
  })
})

test.describe('键盘生命周期：打开、首尾停止、Enter/Escape/Tab、外部焦点', () => {
  test('trigger 键盘打开（Enter）并聚焦搜索框', async ({ page }) => {
    await page.goto('/')
    await page.locator('#command-picker').focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('#command-picker-listbox')).toBeVisible()
    const report = await focusReport(page)
    expect(report.tag).toBe('INPUT')
    expect(report.role).toBe('combobox')
    expect(report.popupOpen).toBe(true)
    await expect(page.locator(SEARCH_INPUT)).toBeFocused()
  })

  test('ArrowUp 在首项停止、ArrowDown 在末项停止（不循环）', async ({ page }) => {
    await openPicker(page)
    const ids = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[role="option"]')).map((o) => o.id),
    )
    expect(ids.length).toBeGreaterThan(2)
    // 首项 NONE 上按 ArrowUp 保持不动。
    await page.keyboard.press('ArrowUp')
    await expectActiveInvariant(page)
    expect((await activeState(page)).active).toBe(ids[0])
    // 连续 ArrowDown 超过 option 总数：停在末项。
    for (let i = 0; i < ids.length + 5; i += 1) {
      await page.keyboard.press('ArrowDown')
    }
    await expectActiveInvariant(page)
    expect((await activeState(page)).active).toBe(ids[ids.length - 1])
    // 末项上再按 ArrowDown / ArrowUp 交替仍受边界约束。
    await page.keyboard.press('ArrowDown')
    expect((await activeState(page)).active).toBe(ids[ids.length - 1])
    await page.keyboard.press('ArrowUp')
    expect((await activeState(page)).active).toBe(ids[ids.length - 2])
  })

  test('Enter 应用 active option 并关闭，焦点回到 trigger', async ({ page }) => {
    await openPicker(page)
    await page.keyboard.press('ArrowDown')
    const applied = await activeState(page)
    expect(applied.active).not.toBe('command-option-none')
    await page.keyboard.press('Enter')
    await expect(page.locator('#command-picker')).toHaveAttribute('aria-expanded', 'false')
    await expect(page.locator('#command-picker-listbox')).toHaveCount(0)
    await expect(page.locator('#command-picker')).toBeFocused()
  })

  test('Escape 取消并恢复 trigger 焦点，query 不残留', async ({ page }) => {
    await openPicker(page)
    await page.locator(SEARCH_INPUT).fill('VOUT')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Escape')
    await expect(page.locator('#command-picker')).toHaveAttribute('aria-expanded', 'false')
    await expect(page.locator('#command-picker')).toBeFocused()
    await openPicker(page)
    await expect(page.locator(SEARCH_INPUT)).toHaveValue('')
    expect((await activeState(page)).optionCount).toBeGreaterThan(1)
  })

  test('Tab 关闭 popup 并移动到 trigger 逻辑后继（不进 option、不跳回页首）', async ({ page }) => {
    await openPicker(page)
    await page.keyboard.press('Tab')
    // 焦点移动在 popup 卸载后的宏任务里完成，等待其稳定。
    await expect
      .poll(async () => {
        const report = await focusReport(page)
        return report.position === 'after-trigger' && report.tag !== 'BODY' ? report : null
      })
      .toBeTruthy()
    const report = await focusReport(page)
    expect(report.popupOpen).toBe(false)
    expect(report.role).not.toBe('option')
    await expect(page.locator('#command-picker')).toHaveAttribute('aria-expanded', 'false')
  })

  test('Shift+Tab 关闭 popup 并移动到 trigger 逻辑前驱（模式 tab，不是页面末尾控件）', async ({
    page,
  }) => {
    await openPicker(page)
    await page.keyboard.press('Shift+Tab')
    await expect
      .poll(async () => {
        const report = await focusReport(page)
        return report.role === 'tab' ? report : null
      })
      .toBeTruthy()
    const report = await focusReport(page)
    expect(report.popupOpen).toBe(false)
    expect(report.position).toBe('before-trigger')
    // 默认 L11 模式下 roving tabindex 只保留活动 tab 可聚焦。
    expect(report.text).toContain('LINEAR11')
  })

  test('option 在方向键与 Tab/Shift+Tab 全程不获得 DOM focus', async ({ page }) => {
    await openPicker(page)
    for (let i = 0; i < 4; i += 1) {
      await page.keyboard.press('ArrowDown')
      const during = await focusReport(page)
      expect(during.role).toBe('combobox')
    }
    await page.keyboard.press('Tab')
    expect((await focusReport(page)).role).not.toBe('option')
    await openPicker(page)
    await page.keyboard.press('Shift+Tab')
    expect((await focusReport(page)).role).not.toBe('option')
  })

  test('脚本移动焦点到 popup 外部时关闭 popup 且不抢焦点', async ({ page }) => {
    await openPicker(page)
    await page.evaluate(() => document.getElementById('raw-hex-input')?.focus())
    const report = await focusReport(page)
    expect(report.popupOpen).toBe(false)
    expect(report.id).toBe('raw-hex-input')
    await expect(page.locator('#command-picker')).toHaveAttribute('aria-expanded', 'false')
  })

  test('Home/End 与左右键不被拦截、不做选项导航、焦点保持', async ({ page }) => {
    await openPicker(page)
    await page.locator(SEARCH_INPUT).fill('VOUT')
    const before = await activeState(page)
    // 合同是“不拦截浏览器文本编辑键”。合成键盘事件的光标默认动作在
    // 不同环境并不稳定（无头/有头、页面状态都会影响），因此断言精确到
    // 合同本身：事件到达 document 时 defaultPrevented 必须仍为 false。
    await page.evaluate(() => {
      document.addEventListener('keydown', (e) => {
        const root = document.documentElement
        const list = JSON.parse(root.dataset.keyDefaults ?? '[]') as string[][]
        list.push([e.key, String(e.defaultPrevented)])
        root.dataset.keyDefaults = JSON.stringify(list)
      })
    })
    for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) {
      await page.keyboard.press(key)
    }
    const keyDefaults = await page.evaluate(() =>
      JSON.parse(document.documentElement.dataset.keyDefaults ?? '[]'),
    )
    expect(keyDefaults).toEqual([
      ['ArrowLeft', 'false'],
      ['ArrowRight', 'false'],
      ['Home', 'false'],
      ['End', 'false'],
    ])
    // 无冲突导航：active option 不因文本编辑键变化，query 未被改写。
    expect((await activeState(page)).active).toBe(before.active)
    await expect(page.locator(SEARCH_INPUT)).toHaveValue('VOUT')
    const report = await focusReport(page)
    expect(report.role).toBe('combobox')
    expect(report.popupOpen).toBe(true)
  })
})

test.describe('搜索与零结果：零匹配状态、清空恢复、多字符收敛', () => {
  test('非空零匹配：无 option、无 activedescendant、状态文案、Arrow/Enter no-op', async ({
    page,
  }) => {
    await openPicker(page)
    await page.locator(SEARCH_INPUT).fill('zzzqqqxxx')
    const state = await activeState(page)
    expect(state.optionCount).toBe(0)
    expect(state.active).toBeNull()
    await expect(page.getByText('无匹配命令')).toBeVisible()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowUp')
    expect((await activeState(page)).active).toBeNull()
    await page.keyboard.press('Enter')
    await expect(page.locator('#command-picker-listbox')).toBeVisible()
    await expect(page.locator('#command-picker')).toContainText('选择命令')
    await expect(page.locator('#command-picker')).toHaveAttribute('aria-expanded', 'true')
  })

  test('清空 query 恢复 option、active selection 与 listbox 滚动位置', async ({ page }) => {
    await selectCommandViaSearch(page, 'VOUT_COMMAND')
    await reopenPicker(page)
    await page.locator(SEARCH_INPUT).fill('zzzqqqxxx')
    expect((await activeState(page)).optionCount).toBe(0)
    await page.locator(SEARCH_INPUT).fill('')
    const restored = await activeState(page)
    expect(restored.optionCount).toBeGreaterThan(1)
    await expectActiveInvariant(page)
    expect(restored.selected[0]).toBe('command-option-VOUT_COMMAND')
    // 滚动恢复：committed/active option 必须重新滚回 listbox 可视范围。
    await expect
      .poll(() =>
        page.evaluate(() => {
          const list = document.getElementById('command-picker-listbox')
          const el = document.getElementById('command-option-VOUT_COMMAND')
          if (list == null || el == null) return false
          const lr = list.getBoundingClientRect()
          const er = el.getBoundingClientRect()
          return er.top >= lr.top - 1 && er.bottom <= lr.bottom + 1
        }),
      )
      .toBe(true)
  })

  test('多字符搜索逐步收敛且 active 不悬空、无命令选项不再出现', async ({ page }) => {
    await openPicker(page)
    const full = (await activeState(page)).optionCount
    await page.locator(SEARCH_INPUT).fill('STATUS')
    const narrowed = await activeState(page)
    expect(narrowed.optionCount).toBeGreaterThan(0)
    expect(narrowed.optionCount).toBeLessThan(full)
    await expectActiveInvariant(page)
    const labels = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[role="option"] .font-medium')).map(
        (el) => el.textContent ?? '',
      ),
    )
    for (const label of labels) {
      expect(label.toLowerCase()).toContain('status')
    }
    // NONE 只在空 query 合法。
    expect(labels.some((l) => l.includes('无命令'))).toBe(false)
  })
})

test.describe('pointer 选择与 viewport containment', () => {
  test('pointer 点击 option：应用、关闭、焦点回 trigger', async ({ page }) => {
    await openPicker(page)
    await page.locator('[role="option"]').nth(1).click()
    await expect(page.locator('#command-picker')).toHaveAttribute('aria-expanded', 'false')
    await expect(page.locator('#command-picker')).toBeFocused()
    await expect(page.locator('#command-picker')).not.toContainText('选择命令')
  })

  test('950×304：popup 完整位于 viewport 内且只有 listbox 滚动', async ({ page }) => {
    await page.setViewportSize({ width: 950, height: 304 })
    await openPicker(page)
    const geometry = await page.evaluate(() => {
      const popup = document.querySelector('[role="listbox"]')!.closest('div')!
      const list = document.getElementById('command-picker-listbox')!
      const pr = popup.getBoundingClientRect()
      return {
        popup: { top: pr.top, bottom: pr.bottom, left: pr.left, right: pr.right },
        listScrolls: list.scrollHeight > list.clientHeight,
        vw: window.innerWidth,
        vh: window.innerHeight,
        docOverflowX: document.documentElement.scrollWidth > window.innerWidth,
      }
    })
    expect(geometry.popup.top).toBeGreaterThanOrEqual(0)
    expect(geometry.popup.bottom).toBeLessThanOrEqual(geometry.vh)
    expect(geometry.popup.left).toBeGreaterThanOrEqual(0)
    expect(geometry.popup.right).toBeLessThanOrEqual(geometry.vw)
    expect(geometry.listScrolls).toBe(true)
    expect(geometry.docOverflowX).toBe(false)
  })

  test('360×800：打开 popup 无 body 横向 overflow', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 })
    await openPicker(page)
    const { scrollWidth, clientWidth } = await page.locator('body').evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }))
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth)
  })
})
