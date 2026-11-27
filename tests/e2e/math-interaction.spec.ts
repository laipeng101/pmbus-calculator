import { test, expect } from '@playwright/test'
import { tabTo } from './helpers/keyboard'
import { expectNoHorizontalOverflow } from './helpers/layout'

test.describe('公式展示与交互反馈', () => {
  test('四个换算页渲染可见公式和 MathML，编辑原字后同步更新', async ({ page }) => {
    const pageErrors: string[] = []
    const consoleErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })

    await page.goto('./')

    const equation = page.getByTestId('result-row-substitution')
    for (const mode of ['LINEAR16', 'DIRECT', 'HALF', 'LINEAR11']) {
      await page.getByRole('tab', { name: new RegExp(mode) }).click()
      await expect(equation.locator('.katex')).toBeVisible()
      await expect(equation.locator('math')).toBeAttached()
      await expect(page.getByTestId('result-panel').locator('[data-katex-fallback]')).toHaveCount(0)
    }

    await page.locator('#raw-hex-input').fill('F819')
    await expect(page.getByTestId('result-value')).toHaveText('12.5')
    await expect(equation).toContainText('25')
    await expect(equation).toContainText('12.5')
    await expect(equation.locator('math')).toBeAttached()
    expect(pageErrors).toEqual([])
    expect(consoleErrors).toEqual([])
  })

  test('VOUT_MODE 结果面板使用配置摘要而非 KaTeX', async ({ page }) => {
    const summary = page.getByTestId('vout-mode-config-summary')
    await page.goto('./')
    await page.getByRole('tab', { name: /VOUT_MODE/ }).click()
    await expect(summary).toBeVisible()
    await expect(summary).toContainText('VOUT_MODE')
    await expect(summary).toContainText('0x18')
    // 配置摘要自身不经 KaTeX 排版；页面其他位置的真实公式（如计算过程）保留 KaTeX。
    await expect(summary.locator('.katex')).toHaveCount(0)
    await expect(page.locator('.katex-error')).toHaveCount(0)

    const byteFont = await summary
      .locator('[data-testid="result-row-bitParse"] .result-segment[data-role="data"]')
      .first()
      .evaluate((el) => getComputedStyle(el).fontFamily)
    expect(byteFont).toContain('mono')
    const summaryFont = await summary.evaluate((el) => getComputedStyle(el).fontFamily)
    // UI 字体角色：系统无衬线；不得回退到 KaTeX/Times serif。
    expect(summaryFont).toContain('sans-serif')
    expect(summaryFont).not.toContain('KaTeX')
    expect(summaryFont).not.toContain('Times New Roman')
  })

  test('按钮、原字输入和禁用的指数显示对应指针', async ({ page }) => {
    await page.goto('./')

    const commandReferenceToggle = page.locator('#command-reference-toggle')
    await expect(commandReferenceToggle).toBeVisible()
    expect(await commandReferenceToggle.evaluate((el) => getComputedStyle(el).cursor)).toBe(
      'pointer',
    )

    const hexInput = page.locator('#raw-hex-input')
    expect(await hexInput.evaluate((el) => getComputedStyle(el).cursor)).toBe('text')

    const nInput = page.getByLabel('N 值 (指数)')
    await expect(nInput).toBeDisabled()
    expect(await nInput.evaluate((el) => getComputedStyle(el).cursor)).toBe('not-allowed')
  })

  test('悬停时显示控件反馈', async ({ page }) => {
    await page.goto('./')

    const commandReferenceToggle = page.locator('#command-reference-toggle')
    await expect(commandReferenceToggle).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    const hoverCapable = await page.evaluate(
      () => window.matchMedia('(hover: hover) and (pointer: fine)').matches,
    )

    expect(hoverCapable).toBe(true)

    const shadowBefore = await commandReferenceToggle.evaluate(
      (el) => getComputedStyle(el).boxShadow,
    )
    await commandReferenceToggle.hover()
    const shadow = () => commandReferenceToggle.evaluate((el) => getComputedStyle(el).boxShadow)
    await expect.poll(shadow).not.toBe(shadowBefore)
    await expect.poll(shadow).toContain('rgb')
  })

  test('按下控件时位置发生变化', async ({ page }) => {
    await page.goto('./')

    const commandReferenceToggle = page.locator('#command-reference-toggle')
    await expect(commandReferenceToggle).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    const hoverCapable = await page.evaluate(
      () => window.matchMedia('(hover: hover) and (pointer: fine)').matches,
    )

    expect(hoverCapable).toBe(true)

    // hover 先让元素滚动到视口并等待布局稳定，避免字体加载重流使
    // boundingBox 过期、mousedown 落到相邻元素上。
    await commandReferenceToggle.hover()
    const box = await commandReferenceToggle.boundingBox()
    if (box == null) throw new Error('command reference toggle bounding box missing')
    const restingTransform = await commandReferenceToggle.evaluate(
      (el) => getComputedStyle(el).transform,
    )
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await expect
      .poll(() => commandReferenceToggle.evaluate((el) => getComputedStyle(el).transform))
      .not.toBe(restingTransform)
    await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 40)
    await page.mouse.up()
  })

  // 键盘 focus-visible 合同：从 fresh load 的真实 Tab 进入，断言预期具体控件
  // （v2.6.0 起首控件是 AppHeader 标题内的 PMBus 术语触发器；页头术语触发器
  // 位于主题按钮之前），并用 Tab/Shift+Tab 往返验证相邻控件。不依赖“最后
  // 一个控件 Tab 后焦点仍在页面内”：HTML sequential focus navigation 允许
  // 在页面末尾转向浏览器控件。
  test('键盘可在页头和模式标签之间往返并看到焦点', async ({ page }) => {
    await page.goto('./')

    const firstControl = page.getByTestId('term-trigger-pmbus').first()
    const themeToggle = page.getByRole('button', { name: /当前主题/ })
    const activeTab = page.getByRole('tab', { name: /LINEAR11/ })

    await page.keyboard.press('Tab')
    await expect(firstControl).toBeFocused()
    const firstFocus = await firstControl.evaluate((el) => ({
      focusVisible: el.matches(':focus-visible'),
      outlineWidth: getComputedStyle(el).outlineWidth,
    }))
    expect(firstFocus.focusVisible).toBe(true)
    expect(firstFocus.outlineWidth).not.toBe('0px')

    // 有界 Tab 前进越过页头术语触发器，落到主题按钮。
    await tabTo(page, themeToggle)
    const tabFocus = await themeToggle.evaluate((el) => ({
      focusVisible: el.matches(':focus-visible'),
      outlineWidth: getComputedStyle(el).outlineWidth,
    }))
    expect(tabFocus.focusVisible).toBe(true)
    expect(tabFocus.outlineWidth).not.toBe('0px')

    await page.keyboard.press('Tab')
    await expect(activeTab).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await expect(themeToggle).toBeFocused()
  })

  test('减少动效时术语气泡静止显示，仍可按键操作和换算', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('./')
    const term = page.getByTestId('term-trigger-pmbus').first()
    await page.keyboard.press('Tab')
    await expect(term).toBeFocused()
    await page.keyboard.press('Enter')
    const popover = page.getByTestId('term-popover-pmbus')
    await expect(popover).toBeVisible()
    await expect(popover).toHaveCSS('animation-name', 'none')
    await page.keyboard.press('Escape')
    await expect(popover).toHaveCount(0)
    await expect(term).toBeFocused()

    const activeTab = page.getByRole('tab', { name: /LINEAR11/ })
    const toggle = page.getByRole('button', { name: '命令参考（只读）' })
    for (const control of [activeTab, toggle]) {
      const durations = await control.evaluate((el) => getComputedStyle(el).transitionDuration)
      for (const duration of durations.split(',')) {
        const milliseconds = parseFloat(duration) * (duration.trim().endsWith('ms') ? 1 : 1000)
        expect(milliseconds).toBeLessThanOrEqual(1)
      }
    }

    await tabTo(page, activeTab)
    await expect(activeTab.and(page.locator(':focus-visible'))).toBeFocused()
    await expect(activeTab).not.toHaveCSS('outline-width', '0px')

    await toggle.hover()
    const box = await toggle.boundingBox()
    if (box === null) throw new Error('Missing command reference button')
    const resting = await toggle.evaluate((el) => getComputedStyle(el).transform)
    await page.mouse.down()
    await expect
      .poll(() => toggle.evaluate((el) => getComputedStyle(el).transform))
      .not.toBe(resting)
    await page.mouse.move(box.x + box.width + 8, box.y)
    await page.mouse.up()

    await page.locator('#raw-hex-input').fill('F819')
    await expect(page.getByTestId('result-value')).toHaveText('12.5')
  })

  test('360 px 下长公式在自身容器内滚动', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 })
    await page.goto('./')
    await page.getByRole('tab', { name: /DIRECT/ }).click()

    for (const [field, text] of [
      ['m', '-32768'],
      ['b', '-32768'],
      ['r', '-128'],
    ]) {
      const input = page.getByLabel(`DIRECT 系数 ${field}`, { exact: true })
      await input.fill(text)
      await input.press('Tab')
    }
    await page.locator('#raw-hex-input').fill('7FFF')
    const formula = page.getByTestId('result-row-substitution')
    await expect(formula.locator('math')).toBeAttached()
    await page.evaluate(() => document.fonts.ready)
    await expect(formula).toHaveCSS('overflow-x', 'auto')
    await expect
      .poll(() => formula.evaluate((el) => el.scrollWidth - el.clientWidth))
      .toBeGreaterThan(0)
    await formula.evaluate((el) => {
      el.scrollLeft = el.scrollWidth
    })
    await expect.poll(() => formula.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)
    await expectNoHorizontalOverflow(page)
  })

  for (const theme of ['light', 'dark'] as const) {
    const label = theme === 'light' ? '浅色' : '暗色'
    test(`${label}主题下显示公式和键盘焦点轮廓`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme })
      await page.goto('./')
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await expect(page.locator('.katex').first()).toBeVisible()

      const themeToggle = page.getByRole('button', { name: /当前主题/ })
      await tabTo(page, themeToggle)
      await expect(themeToggle).toBeFocused()
      const focus = await themeToggle.evaluate((el) => {
        const style = getComputedStyle(el)
        return {
          visible: el.matches(':focus-visible'),
          width: style.outlineWidth,
          color: style.outlineColor,
        }
      })
      expect(focus.visible).toBe(true)
      expect(focus.width).not.toBe('0px')
      expect(focus.color).not.toBe('rgba(0, 0, 0, 0)')
    })
  }
})
