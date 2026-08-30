import { test, expect } from '@playwright/test'

test.describe('LaTeX 公式展示与交互反馈', () => {
  test('四个计算模式均出现 KaTeX 容器且无 .katex-error', async ({ page }) => {
    const pageErrors: string[] = []
    const consoleErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })

    await page.goto('/')

    // VOUT_MODE 是结构化配置字节而非数学公式（M39 字体角色合同），其结果面板
    // 不经 KaTeX 排版；只有四个数值换算模式仍渲染真实公式。
    const tabs = [{ name: /LINEAR11/ }, { name: /LINEAR16/ }, { name: /DIRECT/ }, { name: /HALF/ }]

    for (const tab of tabs) {
      await page.getByRole('tab', { name: tab.name }).click()
      await expect(page.locator('.katex:visible').first()).toBeVisible()
      await expect(page.locator('.katex-error')).toHaveCount(0)
      await expect(page.locator('.katex math').first()).toBeAttached()
    }

    expect(pageErrors).toEqual([])
    expect(consoleErrors).toEqual([])
  })

  test('VOUT_MODE 结果面板使用配置摘要而非 KaTeX', async ({ page }) => {
    const summary = page.getByTestId('vout-mode-config-summary')
    await page.goto('/')
    await page.getByRole('tab', { name: /VOUT_MODE/ }).click()
    await expect(summary).toBeVisible()
    await expect(summary).toContainText('VOUT_MODE')
    await expect(summary).toContainText('0x18')
    // 配置摘要自身不经 KaTeX 排版；页面其他位置的真实公式（如计算过程）保留 KaTeX。
    await expect(summary.locator('.katex')).toHaveCount(0)
    await expect(page.locator('.katex-error')).toHaveCount(0)

    const byteFont = await summary
      .locator('.vout-config-byte')
      .evaluate((el) => getComputedStyle(el).fontFamily)
    expect(byteFont).toContain('mono')
    const summaryFont = await summary.evaluate((el) => getComputedStyle(el).fontFamily)
    // UI 字体角色：系统无衬线；不得回退到 KaTeX/Times serif。
    expect(summaryFont).toContain('sans-serif')
    expect(summaryFont).not.toContain('KaTeX')
    expect(summaryFont).not.toContain('Times New Roman')
  })

  test('修改输入后公式同步更新', async ({ page }) => {
    await page.goto('/')
    const hexInput = page.locator('input[placeholder="0000"]')

    await hexInput.fill('F819')
    await hexInput.press('Tab')

    await expect(page.locator('#value-input')).toHaveValue('12.5')
    // 计算过程里的数值代入公式包含实际 N/Y 值（25 × 2^-1）。
    // M36 起计算过程默认折叠，需先展开可访问 disclosure。
    await page.locator('[data-testid="calculation-steps-summary"]').click()
    const substitution = page
      .locator('section[aria-label="辅助结果"] [data-step-kind="formula"]')
      .filter({ hasText: '25' })
      .first()
    await expect(substitution).toBeVisible()
    await expect(substitution).toContainText('2')
  })

  test('cursor 语义：按钮 pointer、输入 text、禁用 N 为 not-allowed', async ({ page }) => {
    await page.goto('/')

    const commandReferenceToggle = page.locator('#command-reference-toggle')
    await expect(commandReferenceToggle).toBeVisible()
    expect(await commandReferenceToggle.evaluate((el) => getComputedStyle(el).cursor)).toBe(
      'pointer',
    )

    const hexInput = page.locator('input[placeholder="0000"]')
    expect(await hexInput.evaluate((el) => getComputedStyle(el).cursor)).toBe('text')

    const nInput = page.getByLabel('N 值 (指数)')
    await expect(nInput).toBeDisabled()
    expect(await nInput.evaluate((el) => getComputedStyle(el).cursor)).toBe('not-allowed')
  })

  test('hover 有可观察反馈', async ({ page }) => {
    await page.goto('/')

    const commandReferenceToggle = page.locator('#command-reference-toggle')
    await expect(commandReferenceToggle).toBeVisible()
    const hoverCapable = await page.evaluate(
      () => window.matchMedia('(hover: hover) and (pointer: fine)').matches,
    )

    if (!hoverCapable) return

    const shadowBefore = await commandReferenceToggle.evaluate(
      (el) => getComputedStyle(el).boxShadow,
    )
    await commandReferenceToggle.hover()
    const shadowAfter = await commandReferenceToggle.evaluate(
      (el) => getComputedStyle(el).boxShadow,
    )
    expect(shadowAfter).not.toBe(shadowBefore)
    expect(shadowAfter).toContain('rgb')
  })

  test('active 有按压反馈', async ({ page }) => {
    await page.goto('/')

    const commandReferenceToggle = page.locator('#command-reference-toggle')
    await expect(commandReferenceToggle).toBeVisible()
    const hoverCapable = await page.evaluate(
      () => window.matchMedia('(hover: hover) and (pointer: fine)').matches,
    )

    if (!hoverCapable) return

    // hover 先让元素滚动到视口并等待布局稳定，避免字体加载重流使
    // boundingBox 过期、mousedown 落到相邻元素上。
    await commandReferenceToggle.hover()
    const box = await commandReferenceToggle.boundingBox()
    if (box == null) throw new Error('command reference toggle bounding box missing')
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    const transformDuringActive = await commandReferenceToggle.evaluate(
      (el) => getComputedStyle(el).transform,
    )
    await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 40)
    await page.mouse.up()
    expect(transformDuringActive).not.toBe('none')
  })

  // 键盘 focus-visible 合同：从 fresh load 的真实 Tab 进入，断言预期具体控件
  // （首控件是 AppHeader 主题按钮，其相邻控件是活动模式 tab），并用
  // Tab/Shift+Tab 往返验证。不依赖“最后一个控件 Tab 后焦点仍在页面内”：
  // HTML sequential focus navigation 允许在页面末尾转向浏览器控件。
  test('键盘 Tab 进入首控件并在相邻控件间往返时 focus-visible 可观察', async ({ page }) => {
    await page.goto('/')

    const themeToggle = page.getByRole('button', { name: /当前主题/ })
    const activeTab = page.getByRole('tab', { name: /LINEAR11/ })

    await page.keyboard.press('Tab')
    await expect(themeToggle).toBeFocused()
    const firstFocus = await themeToggle.evaluate((el) => ({
      focusVisible: el.matches(':focus-visible'),
      outlineWidth: getComputedStyle(el).outlineWidth,
    }))
    expect(firstFocus.focusVisible).toBe(true)
    expect(firstFocus.outlineWidth).not.toBe('0px')

    await page.keyboard.press('Tab')
    await expect(activeTab).toBeFocused()
    const tabFocus = await activeTab.evaluate((el) => ({
      focusVisible: el.matches(':focus-visible'),
      outlineWidth: getComputedStyle(el).outlineWidth,
    }))
    expect(tabFocus.focusVisible).toBe(true)
    expect(tabFocus.outlineWidth).not.toBe('0px')

    await page.keyboard.press('Shift+Tab')
    await expect(themeToggle).toBeFocused()
  })

  test('prefers-reduced-motion: reduce 关闭非必要动画且保留功能反馈', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/')

    const toMs = (value: string) => parseFloat(value) * (value.endsWith('ms') ? 1 : 1000)

    const motionMetrics = await page.evaluate(() => {
      const selectedTab = document.querySelector(
        '[role="tab"][aria-selected="true"]',
      ) as HTMLElement | null
      const tabTransitionDuration = selectedTab
        ? getComputedStyle(selectedTab).transitionDuration
        : '0.2s'

      const popoverProbe = document.createElement('div')
      popoverProbe.className = 'popover-enter'
      document.body.appendChild(popoverProbe)
      const popoverAnimationDuration = getComputedStyle(popoverProbe).animationDuration
      popoverProbe.remove()

      const transformProbe = document.createElement('div')
      transformProbe.style.transition = 'transform 180ms ease'
      document.body.appendChild(transformProbe)
      const transformTransitionDuration = getComputedStyle(transformProbe).transitionDuration
      transformProbe.remove()

      return { tabTransitionDuration, popoverAnimationDuration, transformTransitionDuration }
    })

    expect(toMs(motionMetrics.tabTransitionDuration)).toBeLessThanOrEqual(1)
    expect(toMs(motionMetrics.popoverAnimationDuration)).toBeLessThanOrEqual(1)
    expect(toMs(motionMetrics.transformTransitionDuration)).toBeLessThanOrEqual(1)

    // 状态颜色保留：当前选中 tab 仍使用可见的背景色与前景色。
    const selectedTab = page.getByRole('tab', { name: /LINEAR11/ })
    const selectedStyles = await selectedTab.evaluate((el) => {
      const cs = getComputedStyle(el)
      return { backgroundColor: cs.backgroundColor, color: cs.color }
    })
    expect(selectedStyles.backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
    expect(selectedStyles.color).not.toBe('rgba(0, 0, 0, 0)')

    // focus-visible 提示保留：从 fresh load 的真实 Tab 进入并断言预期控件。
    await page.keyboard.press('Tab')
    const themeToggle = page.getByRole('button', { name: /当前主题/ })
    await expect(themeToggle).toBeFocused()
    const focusInfo = await themeToggle.evaluate((el) => ({
      focusVisible: el.matches(':focus-visible'),
      outlineWidth: getComputedStyle(el).outlineWidth,
    }))
    expect(focusInfo.focusVisible).toBe(true)
    expect(focusInfo.outlineWidth).not.toBe('0px')

    // active 按压反馈保留。
    const commandReferenceToggle = page.locator('#command-reference-toggle')
    await commandReferenceToggle.scrollIntoViewIfNeeded()
    const box = await commandReferenceToggle.boundingBox()
    if (box == null) throw new Error('command reference toggle bounding box missing')
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    const activeTransform = await commandReferenceToggle.evaluate(
      (el) => getComputedStyle(el).transform,
    )
    await page.mouse.up()
    expect(activeTransform).not.toBe('none')

    // 功能行为不受影响。
    const hexInput = page.locator('input[placeholder="0000"]')
    await hexInput.fill('F819')
    await hexInput.press('Tab')
    await expect(page.locator('#value-input')).toHaveValue('12.5')
    await expect(page.locator('.katex').first()).toBeVisible()
    await expect(page.locator('.katex-error')).toHaveCount(0)
  })

  test('360/390 视口无横向滚动，长公式只在自身容器滚动', async ({ page }) => {
    for (const width of [360, 390]) {
      await page.setViewportSize({ width, height: 844 })
      await page.goto('/')
      await page.getByRole('tab', { name: /DIRECT/ }).click()

      await page.getByLabel('DIRECT 系数 m').fill('-32768')
      await page.getByLabel('DIRECT 系数 m').press('Tab')
      await page.getByLabel('DIRECT 系数 b').fill('-32768')
      await page.getByLabel('DIRECT 系数 b').press('Tab')
      await page.getByLabel('DIRECT 系数 r').fill('-128')
      await page.getByLabel('DIRECT 系数 r').press('Tab')
      await page.getByLabel('Y（16 位有符号，−32768～32767）').fill('-32768')
      await page.getByLabel('Y（16 位有符号，−32768～32767）').press('Tab')

      const body = page.locator('body')
      const scrollWidth = await body.evaluate((el) => el.scrollWidth)
      const clientWidth = await body.evaluate((el) => el.clientWidth)
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth)

      const formulaContainer = page.locator('.math-scroll').first()
      await expect(formulaContainer).toBeVisible()
      expect(await formulaContainer.evaluate((el) => getComputedStyle(el).overflowX)).toBe('auto')
    }
  })

  test('light/dark 主题下公式与 focus ring 可读', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('pmbus-calculator:theme', 'dark')
    })
    await page.goto('/')

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect(page.locator('.katex').first()).toBeVisible()

    // 从 fresh load 的真实 Tab 进入，在预期首控件上验证 dark 主题 focus ring。
    await page.keyboard.press('Tab')
    const themeToggle = page.getByRole('button', { name: /当前主题/ })
    await expect(themeToggle).toBeFocused()
    const darkFocus = await themeToggle.evaluate((el) => {
      const style = getComputedStyle(el)
      return {
        focusVisible: el.matches(':focus-visible'),
        outlineWidth: style.outlineWidth,
        outlineColor: style.outlineColor,
      }
    })
    expect(darkFocus.focusVisible).toBe(true)
    expect(darkFocus.outlineWidth).not.toBe('0px')
    expect(darkFocus.outlineColor).not.toBe('rgba(0, 0, 0, 0)')
  })
})
