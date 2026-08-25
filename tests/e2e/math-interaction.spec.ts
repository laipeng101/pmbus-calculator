import { test, expect } from '@playwright/test'

test.describe('LaTeX 公式展示与交互反馈', () => {
  test('四个模式均出现 KaTeX 容器且无 .katex-error', async ({ page }) => {
    const pageErrors: string[] = []
    const consoleErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })

    await page.goto('/')

    const tabs = [
      { name: /LINEAR11/, mode: 'L11' },
      { name: /LINEAR16/, mode: 'L16' },
      { name: /DIRECT/, mode: 'DIRECT' },
      { name: /HALF/, mode: 'HALF' },
    ]

    for (const tab of tabs) {
      await page.getByRole('tab', { name: tab.name }).click()
      await expect(page.locator('.katex').first()).toBeVisible()
      await expect(page.locator('.katex-error')).toHaveCount(0)
      await expect(page.locator('.katex math').first()).toBeAttached()
    }

    expect(pageErrors).toEqual([])
    expect(consoleErrors).toEqual([])
  })

  test('修改输入后公式同步更新', async ({ page }) => {
    await page.goto('/')
    const hexInput = page.locator('input[placeholder="0x0000"]')

    await hexInput.fill('F819')
    await hexInput.press('Tab')

    await expect(page.locator('#value-input')).toHaveValue('12.5')
    // 计算过程里的数值代入公式包含实际 N/Y 值（25 × 2^-1）
    const substitution = page
      .locator('section[aria-label="结果面板"] [data-step-kind="formula"]')
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

    const hexInput = page.locator('input[placeholder="0x0000"]')
    expect(await hexInput.evaluate((el) => getComputedStyle(el).cursor)).toBe('text')

    const nInput = page.getByLabel('N 值 (指数)')
    await expect(nInput).toBeDisabled()
    expect(await nInput.evaluate((el) => getComputedStyle(el).cursor)).toBe('not-allowed')
  })

  test('hover、active 与 focus-visible 有可观察反馈', async ({ page }) => {
    await page.goto('/')

    const commandReferenceToggle = page.locator('#command-reference-toggle')
    const hoverCapable = await page.evaluate(
      () => window.matchMedia('(hover: hover) and (pointer: fine)').matches,
    )

    if (hoverCapable) {
      const shadowBefore = await commandReferenceToggle.evaluate(
        (el) => getComputedStyle(el).boxShadow,
      )
      await commandReferenceToggle.hover()
      const shadowAfter = await commandReferenceToggle.evaluate(
        (el) => getComputedStyle(el).boxShadow,
      )
      expect(shadowAfter).not.toBe(shadowBefore)
      expect(shadowAfter).toContain('rgb')

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
    }

    await page.evaluate(() => {
      const active = document.activeElement as HTMLElement | null
      if (active) active.blur()
    })
    await page.keyboard.press('Tab')
    const focusInfo = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement
      return {
        tagName: el?.tagName ?? '',
        focusVisible: el?.matches(':focus-visible') ?? false,
        outlineWidth: el ? getComputedStyle(el).outlineWidth : '',
      }
    })
    expect(['BUTTON', 'INPUT']).toContain(focusInfo.tagName)
    expect(focusInfo.focusVisible).toBe(true)
    expect(focusInfo.outlineWidth).not.toBe('0px')
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

    // focus-visible 提示保留。
    await page.evaluate(() => {
      const active = document.activeElement as HTMLElement | null
      active?.blur?.()
    })
    await page.keyboard.press('Tab')
    const focusInfo = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null
      return {
        tagName: el?.tagName ?? '',
        focusVisible: el?.matches(':focus-visible') ?? false,
        outlineWidth: el ? getComputedStyle(el).outlineWidth : '',
      }
    })
    expect(['BUTTON', 'INPUT']).toContain(focusInfo.tagName)
    expect(focusInfo.focusVisible).toBe(true)
    expect(focusInfo.outlineWidth).not.toBe('0px')

    // active 按压反馈保留。
    const commandReferenceToggle = page.locator('#command-reference-toggle')
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
    const hexInput = page.locator('input[placeholder="0x0000"]')
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

    await page.keyboard.press('Tab')
    const darkFocus = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement
      const style = el ? getComputedStyle(el) : null
      return style ? { outlineWidth: style.outlineWidth, outlineColor: style.outlineColor } : null
    })
    expect(darkFocus).not.toBeNull()
    expect(darkFocus?.outlineWidth).not.toBe('0px')
    expect(darkFocus?.outlineColor).not.toBe('rgba(0, 0, 0, 0)')
  })
})
