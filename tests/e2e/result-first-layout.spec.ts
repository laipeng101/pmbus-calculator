import { test, expect, type Locator, type Page } from '@playwright/test'
import { tabTo } from './helpers/keyboard'

async function settle(page: Page) {
  await page.goto('./')
  await expect(page.locator('.katex').first()).toBeVisible()
  await page.evaluate(async () => {
    await document.fonts.ready
  })
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

test.describe('结果优先布局', () => {
  const viewports = [
    { width: 1440, height: 900, maxTop: 360 },
    { width: 1280, height: 900, maxTop: 360 },
    { width: 390, height: 844, maxTop: 430 },
    { width: 360, height: 800, maxTop: 430 },
  ]

  for (const viewport of viewports) {
    test(`${viewport.width}×${viewport.height}: 首屏结果、输入和位映射保持可达`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport)
      await settle(page)

      const tops: number[] = []
      for (const mode of MODES) {
        await switchMode(page, mode.tab)
        await page.evaluate(() => window.scrollTo(0, 0))
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
        if (mode.label === 'VOUT_MODE') continue

        const bitGrid = page.getByRole('group', { name: '16 位编辑器', exact: true })
        const value = page.locator('#value-input')
        await expectInsideViewport(page.locator('#raw-hex-input'), page)
        if (viewport.width >= 1280) {
          await expectInsideViewport(bitGrid, page)
          await expectInsideViewport(value, page)
          if (mode.label === 'DIRECT') {
            for (const name of ['m', 'b', 'r']) {
              await expectInsideViewport(page.locator(`#direct-coeff-${name}-input`), page)
            }
          }
          if (mode.label === 'LINEAR16') {
            await expectInsideViewport(page.locator('#l16-payload-kind'), page)
            await expect(page.locator('#l16-n-input')).toBeVisible()
          }
        } else {
          await expectInsideViewport(page.getByTestId('bit-mapping-raw-word-toggle'), page)
          const gridBox = await bitGrid.boundingBox()
          const valueBox = await value.boundingBox()
          if (gridBox === null || valueBox === null)
            throw new Error('Missing mobile input geometry')
          expect(gridBox.y + gridBox.height).toBeLessThanOrEqual(valueBox.y)
        }
      }

      expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(2)

      if (viewport.width < 1280) {
        await switchMode(page, /LINEAR16/)
        await page.getByTestId('bit-mapping-raw-word-toggle').click()
        await page.getByRole('radio', { name: '相对值', exact: true }).click()
        await page.evaluate(() => window.scrollTo(0, 0))
        await expectInsideViewport(page.locator('#l16-nominal-vout'), page)
        await expect(page.getByTestId('result-context')).toContainText('待填标称参考值')
      }
    })
  }

  test('模式选择、结果和输入区依次呈现', async ({ page }) => {
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

  test('1280×900：五模式位映射默认展开总高 ≤ 1500，收起后 ≤ 1400', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await settle(page)

    for (const mode of MODES) {
      await switchMode(page, mode.tab)
      const toggles = page.locator('.bit-mapping-toggle')
      await expect(toggles).toHaveCount(mode.label === 'LINEAR16' ? 2 : 1)
      for (const toggle of await toggles.all()) {
        await expect(toggle).toHaveAttribute('aria-expanded', 'true')
      }
      // Default expansion includes both disclosure headings in L16. Keep a
      // bounded full-page height while preserving the first-screen checks.
      const scrollHeight = await page.evaluate(() => document.documentElement.scrollHeight)
      expect(scrollHeight, mode.label).toBeLessThanOrEqual(1500)
    }

    for (const mode of MODES) {
      await switchMode(page, mode.tab)
      for (const toggle of await page.locator('.bit-mapping-toggle[aria-expanded="true"]').all()) {
        await toggle.click()
      }
      await expect(
        page
          .locator('#bit-mapping-raw-word-content, #bit-mapping-vout-mode-content')
          .filter({ visible: true }),
      ).toHaveCount(0)
      const scrollHeight = await page.evaluate(() => document.documentElement.scrollHeight)
      expect(scrollHeight, mode.label).toBeLessThanOrEqual(1400)
      if (mode.label === 'LINEAR16') {
        await expect(page.locator('#vout-mode-input')).toBeVisible()
        await expect(page.locator('#l16-n-input')).toBeEnabled()
      }
    }
  })

  test('桌面双列顶端对齐，窄屏单列无重叠', async ({ page }) => {
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

test.describe('计算过程展开', () => {
  test('计算过程默认折叠，可展开且不改变计算结果', async ({ page }) => {
    await settle(page)
    const details = page.locator('[data-testid="calculation-steps-disclosure"]')
    const summary = page.locator('[data-testid="calculation-steps-summary"]')
    const steps = page.locator('[data-testid="calculation-steps"]')
    const value = page.locator('[data-testid="result-value"]')

    // First screen already carries the complete equation: an ordinary decode
    // has no supplemental diagnostics, so the container is omitted entirely.
    await expect(details).toHaveCount(0)
    const valueInput = page.locator('#value-input')
    await valueInput.fill('0.999999')
    await valueInput.press('Tab')

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

  test('计算过程可用键盘展开收起并显示焦点', async ({ page }) => {
    await settle(page)
    const valueInput = page.locator('#value-input')
    await valueInput.fill('0.999999')
    await valueInput.press('Tab')
    const details = page.locator('[data-testid="calculation-steps-disclosure"]')
    const summary = page.locator('[data-testid="calculation-steps-summary"]')

    await tabTo(page, summary)
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
})

async function expectInsideViewport(locator: Locator, page: Page) {
  const box = await locator.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height)
}

test('首次键盘操作在 12 次 Tab 内到达 Raw，主输入保持 focus-visible', async ({ page }) => {
  await settle(page)
  const raw = page.locator('#raw-hex-input')
  await tabTo(page, raw, 'Tab', 12)
  await expect(raw.and(page.locator(':focus-visible'))).toBeFocused()
})

test('结果旁的原字、参数和状态随模式与配置更新', async ({ page }) => {
  await settle(page)
  const context = page.getByTestId('result-context')
  await page.locator('#value-input').fill('12.5')
  await expect(context).toContainText('0xF819')
  // 参数槽位现在是结构化 label/value 对（不拼成 “N = -1” 一类字符串）。
  const params = page.getByTestId('result-context-params')
  await expect(params).toContainText('N')
  await expect(params).toContainText('-1')
  await page.getByRole('tab', { name: /DIRECT/ }).click()
  await page.locator('#direct-coeff-r-input').fill('12')
  await page.locator('#direct-coeff-r-input').press('Tab')
  await expect(params).toContainText('R')
  await expect(params).toContainText('12')
  await expect(context).toContainText('器件相关')
  await page.getByRole('tab', { name: /LINEAR16/ }).click()
  await page.locator('#vout-mode-input').fill('20')
  await page.locator('#vout-mode-input').press('Tab')
  await expect(context).toContainText('0x20')
  await expect(context).toContainText('未按 LINEAR16 解释')
  await expect(params).not.toContainText('N')
  await page.getByRole('tab', { name: /VOUT_MODE/ }).click()
  await page.locator('#vout-mode-input').fill('18')
  await page.locator('#vout-mode-input').press('Tab')
  await expect(params).toContainText('N')
  await expect(params).toContainText('-8')
})

for (const width of [360, 390, 960]) {
  test(`${width}px：DIRECT 系数标签换行和报错时三列输入保持对齐`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await settle(page)
    await page.getByRole('tab', { name: /DIRECT/ }).click()
    const fields = ['m', 'b', 'r'].map((name) => page.locator(`#direct-coeff-${name}-input`))
    const expectAligned = async () => {
      const boxes = await Promise.all(fields.map((field) => field.boundingBox()))
      const tops = boxes.map((box) => box!.y)
      expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(1)
    }
    await expectAligned()

    await fields[0].fill('32768')
    await fields[0].press('Tab')
    await expect(fields[0]).toHaveAttribute('aria-invalid', 'true')
    await expectAligned()
    await expect(page.locator('#raw-hex-input')).toHaveValue('0000')

    await page.locator('label[for="direct-coeff-r-input"]').click()
    await expect(fields[2]).toBeFocused()
    await expect(fields[0]).toHaveAttribute('aria-invalid', 'true')
  })
}
