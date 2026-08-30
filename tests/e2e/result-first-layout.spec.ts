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

// VOUT_MODE 结果面板是配置摘要而非公式，因此这里只要求结果面板可见。
async function switchMode(page: Page, name: RegExp) {
  await page.getByRole('tab', { name }).click()
  await expect(page.getByTestId('result-panel')).toBeVisible()
}

const MODES = [
  { label: 'LINEAR11', tab: /LINEAR11/ },
  { label: 'LINEAR16', tab: /LINEAR16/ },
  { label: 'DIRECT', tab: /DIRECT/ },
  { label: 'HALF', tab: /HALF/ },
  { label: 'VOUT_MODE', tab: /VOUT_MODE/ },
] as const

async function resultGeometry(page: Page) {
  return page.evaluate(() => {
    const tile = document.querySelector('[data-testid="result-tile"]')
    const value = document.querySelector('[data-testid="result-value"]')
    const tileBox = tile?.getBoundingClientRect()
    const valueBox = value?.getBoundingClientRect()
    if (tileBox == null || valueBox == null) {
      throw new Error('missing result geometry boxes')
    }
    const de = document.documentElement
    return {
      tileTop: tileBox.top,
      tileBottom: tileBox.bottom,
      valueTop: valueBox.top,
      valueBottom: valueBox.bottom,
      valueLeft: valueBox.left,
      valueRight: valueBox.right,
      tileLeft: tileBox.left,
      tileRight: tileBox.right,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
      scrollWidth: de.scrollWidth,
      clientWidth: de.clientWidth,
    }
  })
}

test.describe('M36 result-first geometry', () => {
  const viewports = [
    { width: 1440, height: 900, maxTop: 360 },
    { width: 1280, height: 900, maxTop: 360 },
    { width: 390, height: 844, maxTop: 430 },
    { width: 360, height: 800, maxTop: 430 },
  ]

  for (const viewport of viewports) {
    test(`${viewport.width}×${viewport.height}: 五模式结果卡完整位于首屏且切换顶边稳定`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport)
      await settle(page)

      const tops: number[] = []
      for (const mode of MODES) {
        await switchMode(page, mode.tab)
        const g = await resultGeometry(page)

        expect(g.tileTop).toBeGreaterThanOrEqual(0)
        expect(g.tileBottom).toBeLessThanOrEqual(g.viewportHeight + 0.5)
        expect(g.tileTop).toBeLessThanOrEqual(viewport.maxTop)

        // 结果值完全位于结果卡内。
        expect(g.valueTop).toBeGreaterThanOrEqual(g.tileTop - 0.5)
        expect(g.valueBottom).toBeLessThanOrEqual(g.tileBottom + 0.5)
        expect(g.valueLeft).toBeGreaterThanOrEqual(g.tileLeft - 0.5)
        expect(g.valueRight).toBeLessThanOrEqual(g.tileRight + 0.5)

        // 无横向溢出。
        expect(g.scrollWidth).toBeLessThanOrEqual(g.clientWidth)

        tops.push(g.tileTop)
      }

      expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(2)
    })
  }

  test('默认信息顺序：ModeSwitcher → ResultSummary → ModeWorkspace', async ({ page }) => {
    await settle(page)

    const order = await page.evaluate(() => {
      const nav = document.querySelector('nav[aria-label="模式切换"]')
      const result = document.querySelector('[data-testid="result-panel"]')
      const workspace = document.querySelector('.primary-panel')
      if (nav == null || result == null || workspace == null) {
        throw new Error('missing order anchors')
      }
      const following = Node.DOCUMENT_POSITION_FOLLOWING
      return {
        navBeforeResult: Boolean(nav.compareDocumentPosition(result) & following),
        resultBeforeWorkspace: Boolean(result.compareDocumentPosition(workspace) & following),
      }
    })

    expect(order.navBeforeResult).toBe(true)
    expect(order.resultBeforeWorkspace).toBe(true)
  })

  test('1280×900 默认折叠状态下五模式 scrollHeight ≤ 1400（M39：L16 内嵌双 nibble 分组）', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await settle(page)

    for (const mode of MODES) {
      await switchMode(page, mode.tab)
      const scrollHeight = await page.evaluate(() => document.documentElement.scrollHeight)
      expect(scrollHeight, mode.label).toBeLessThanOrEqual(1400)
    }
  })

  test('桌面 workspace 两列顶端对齐；移动端为单列且无重叠', async ({ page }) => {
    for (const viewport of [
      { width: 1280, height: 900, columns: 2 },
      { width: 390, height: 844, columns: 1 },
    ]) {
      await page.setViewportSize(viewport)
      await settle(page)

      const layout = await page.evaluate(() => {
        const workspace = document.querySelector('.workspace-layout') as HTMLElement
        const primary = document.querySelector('.primary-panel') as HTMLElement
        const secondary = document.querySelector('.secondary-panel') as HTMLElement
        const wsBox = workspace.getBoundingClientRect()
        const primaryBox = primary.getBoundingClientRect()
        const secondaryBox = secondary.getBoundingClientRect()
        return {
          columns: getComputedStyle(workspace).gridTemplateColumns.split(' ').length,
          primaryTop: primaryBox.top,
          secondaryTop: secondaryBox.top,
          primaryBottom: primaryBox.bottom,
          secondaryLeft: secondaryBox.left,
          secondaryWidth: secondaryBox.width,
          workspaceWidth: wsBox.width,
          overlap: !(
            secondaryBox.left >= primaryBox.right ||
            secondaryBox.right <= primaryBox.left ||
            secondaryBox.top >= primaryBox.bottom ||
            secondaryBox.bottom <= primaryBox.top
          ),
        }
      })

      expect(layout.columns).toBe(viewport.columns)
      if (viewport.columns === 2) {
        expect(Math.abs(layout.primaryTop - layout.secondaryTop)).toBeLessThanOrEqual(1)
        expect(layout.secondaryWidth).toBeGreaterThan(0)
        expect(layout.secondaryWidth).toBeLessThan(layout.workspaceWidth)
        expect(layout.overlap).toBe(false)
      } else {
        expect(layout.secondaryTop).toBeGreaterThanOrEqual(layout.primaryBottom - 1)
        expect(layout.overlap).toBe(false)
      }
    }
  })
})

test.describe('M36 disclosure 与命令参考', () => {
  test('计算过程默认折叠，可展开且不改变计算结果', async ({ page }) => {
    await settle(page)
    const details = page.locator('[data-testid="calculation-steps-disclosure"]')
    const summary = page.locator('[data-testid="calculation-steps-summary"]')
    const steps = page.locator('[data-testid="calculation-steps"]')
    const value = page.locator('[data-testid="result-value"]')

    await expect(summary).toBeVisible()
    await expect(summary).toContainText('计算过程')
    await expect(details).not.toHaveAttribute('open')
    await expect(steps).not.toBeVisible()

    const before = await value.textContent()
    await summary.click()
    await expect(details).toHaveAttribute('open')
    await expect(steps).toBeVisible()
    await expect(steps.locator('[data-step-kind]').first()).toBeVisible()
    expect(await value.textContent()).toBe(before)
  })

  test('计算过程 disclosure 可键盘操作并有 focus-visible', async ({ page }) => {
    await settle(page)
    const details = page.locator('[data-testid="calculation-steps-disclosure"]')
    const summary = page.locator('[data-testid="calculation-steps-summary"]')

    await summary.focus()
    const focusInfo = await summary.evaluate((el) => ({
      focusVisible: el.matches(':focus-visible'),
      outlineWidth: getComputedStyle(el).outlineWidth,
    }))
    expect(focusInfo.focusVisible).toBe(true)
    expect(focusInfo.outlineWidth).not.toBe('0px')

    await page.keyboard.press('Enter')
    await expect(details).toHaveAttribute('open')

    await page.keyboard.press(' ')
    await expect(details).not.toHaveAttribute('open')
  })

  test('命令参考默认折叠只显示按钮；展开后说明与 13 行表格可见', async ({ page }) => {
    await settle(page)
    const toggle = page.locator('#command-reference-toggle')
    const hint = page.locator('.command-ref-hint')

    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(hint).toHaveCount(0)
    await expect(page.getByRole('row')).toHaveCount(0)

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(hint).toBeVisible()
    await expect(page.getByRole('row')).toHaveCount(14)
  })
})
