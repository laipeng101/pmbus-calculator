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
    const resultFormula = page.locator('section[aria-label="结果面板"] .katex').first()

    await hexInput.fill('F819')
    await hexInput.press('Tab')

    await expect(page.locator('#value-input')).toHaveValue('12.5')
    await expect(resultFormula).toContainText('25')
  })

  test('cursor 语义：按钮 pointer、输入 text、禁用 N 为 not-allowed', async ({ page }) => {
    await page.goto('/')

    const commandPicker = page.locator('#command-picker')
    await expect(commandPicker).toBeVisible()
    expect(await commandPicker.evaluate((el) => getComputedStyle(el).cursor)).toBe('pointer')

    const hexInput = page.locator('input[placeholder="0x0000"]')
    expect(await hexInput.evaluate((el) => getComputedStyle(el).cursor)).toBe('text')

    const nInput = page.getByLabel('N 值 (指数)')
    await expect(nInput).toBeDisabled()
    expect(await nInput.evaluate((el) => getComputedStyle(el).cursor)).toBe('not-allowed')
  })

  test('hover、active 与 focus-visible 有可观察反馈', async ({ page }) => {
    await page.goto('/')

    const commandPicker = page.locator('#command-picker')
    const hoverCapable = await page.evaluate(
      () => window.matchMedia('(hover: hover) and (pointer: fine)').matches,
    )

    if (hoverCapable) {
      const shadowBefore = await commandPicker.evaluate((el) => getComputedStyle(el).boxShadow)
      await commandPicker.hover()
      const shadowAfter = await commandPicker.evaluate((el) => getComputedStyle(el).boxShadow)
      expect(shadowAfter).not.toBe(shadowBefore)
      expect(shadowAfter).toContain('rgb')

      const box = await commandPicker.boundingBox()
      if (box == null) throw new Error('command picker bounding box missing')
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down()
      const transformDuringActive = await commandPicker.evaluate(
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

  test('prefers-reduced-motion: reduce 关闭非必要动画', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/')

    const tab = page.getByRole('tab', { name: /LINEAR11/ })
    const transitionDuration = await tab.evaluate((el) => getComputedStyle(el).transitionDuration)
    expect(transitionDuration).not.toBe('0.2s')

    const popoverDuration = await page.evaluate(() => {
      const probe = document.createElement('div')
      probe.className = 'popover-enter'
      document.body.appendChild(probe)
      const duration = getComputedStyle(probe).animationDuration
      probe.remove()
      return duration
    })
    const popoverDurationMs =
      parseFloat(popoverDuration) * (popoverDuration.endsWith('ms') ? 1 : 1000)
    expect(popoverDurationMs).toBeLessThanOrEqual(1)
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
      await page.getByLabel('Y (16-bit signed)').fill('-32768')
      await page.getByLabel('Y (16-bit signed)').press('Tab')

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
