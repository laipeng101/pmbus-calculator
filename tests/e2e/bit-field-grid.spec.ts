import { test, expect, type Page } from '@playwright/test'
import { appUrl } from './helpers/app-url'

/**
 * M39 共享位字段网格结构 / 几何 / 无障碍合同。
 *
 * 16 位 = 4 个 nibble 组 × 4 位；VOUT_MODE（独立页与 L16 内嵌 compact）= 2 × 4。
 * regular 与 compact 只是统一 token 下的尺寸差异，不产生另一套 DOM 语义；
 * L16 的 bits[6:5] 必须真正 disabled 并在 ARIA 中说明“格式位固定为 LINEAR”。
 */

async function settle(page: Page) {
  await page.goto(appUrl())
  await expect(page.locator('.katex').first()).toBeVisible()
}

async function gridInfo(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel)
    if (root == null) throw new Error('missing grid ' + sel)
    const nibbles = Array.from(root.querySelectorAll(':scope .bitfield-grid > .bitfield-nibble'))
    return {
      density: root.getAttribute('data-density'),
      bitCount: root.getAttribute('data-bit-count'),
      nibbleCount: nibbles.length,
      bitsPerNibble: nibbles.map((n) => n.querySelectorAll('.bitfield-bit').length),
      hexLabels: nibbles.map((n) => {
        const el = n.querySelector('.bitfield-nibble-hex')
        return { text: el?.textContent ?? '', font: getComputedStyle(el!).fontFamily }
      }),
      legendItems: Array.from(root.querySelectorAll('.bitfield-legend-item')).map((item) => ({
        text: item.textContent ?? '',
        swatchClass: item.querySelector('.legend-swatch')?.className ?? '',
        swatchSize: (() => {
          const box = item.querySelector('.legend-swatch')!.getBoundingClientRect()
          return { w: Math.round(box.width), h: Math.round(box.height) }
        })(),
      })),
    }
  }, selector)
}

test.describe('M39 共享位字段网格', () => {
  test('16 位网格是 4 nibble × 4 位，nibble 标签为大写 mono Hex', async ({ page }) => {
    await settle(page)
    const info = await gridInfo(page, '.bitfield[data-bit-count="16"]')
    expect(info.nibbleCount).toBe(4)
    expect(info.bitsPerNibble).toEqual([4, 4, 4, 4])
    for (const hex of info.hexLabels) {
      expect(hex.text).toMatch(/^[0-9A-F]$/)
      expect(hex.font).toContain('mono')
    }
    expect(info.legendItems.length).toBeGreaterThanOrEqual(2)
    // 统一图例 swatch 几何
    const sizes = info.legendItems.map((i) => i.swatchSize.w + 'x' + i.swatchSize.h)
    expect(new Set(sizes).size).toBe(1)
    expect(info.legendItems.at(-1)?.text).toContain('未置位')
    // 中文图例：不残留英文 Sign/Exponent/Mantissa 字段名
    const allText = info.legendItems.map((i) => i.text).join(' | ')
    expect(allText).not.toContain('Sign [')
    expect(allText).not.toContain('Exponent [')
    expect(allText).not.toContain('Mantissa [')
  })

  test('独立 VOUT_MODE 是 2 nibble × 4 位；bit/Hex/语义三向同步仍成立', async ({ page }) => {
    await page.goto(appUrl())
    await page.getByRole('tab', { name: /VOUT_MODE/ }).click()
    const info = await gridInfo(page, '.bitfield[data-bit-count="8"]')
    expect(info.nibbleCount).toBe(2)
    expect(info.bitsPerNibble).toEqual([4, 4])
    expect(info.density).toBe('regular')

    const hex = page.locator('#vout-mode-input')
    const bit7 = page.getByRole('button', { name: /第 7 位，绝对值\/相对值/ })
    await bit7.click()
    await expect(hex).toHaveValue('98')
    await hex.fill('18')
    await hex.press('Tab')
    await expect(bit7).toHaveAttribute('aria-pressed', 'false')
  })

  test('L16 内嵌 VOUT_MODE 为 compact 且仍是两个四位组；bits[6:5] 真正禁用', async ({ page }) => {
    await page.goto(appUrl())
    await page.getByRole('tab', { name: /LINEAR16/ }).click()
    const root = page.locator('.bitfield[data-density="compact"]')
    await expect(root).toBeVisible()
    const info = await gridInfo(page, '.bitfield[data-density="compact"]')
    expect(info.nibbleCount).toBe(2)
    expect(info.bitsPerNibble).toEqual([4, 4])

    for (const index of [6, 5]) {
      const bit = page.getByRole('button', {
        name: new RegExp('第 ' + index + ' 位，格式位固定为 LINEAR'),
      })
      await expect(bit).toBeDisabled()
      await expect(bit).toHaveAttribute('aria-pressed', 'false')
    }
    // 可交互位：bit7、bit4..0
    const bit7 = root.locator('.bitfield-bit:not([disabled])').first()
    await expect(bit7).toBeEnabled()

    // canonical byte 与位操作同步（lossless）
    const hex = page.locator('#vout-mode-input')
    await root.getByRole('button', { name: /第 0 位，参数/ }).click()
    await expect(hex).toHaveValue('19')

    // 图例覆盖当前 mode 的三个字段区
    const legendText = info.legendItems.map((i) => i.text).join('|')
    expect(legendText).toContain('绝对/相对 [7]')
    expect(legendText).toContain('格式 [6:5]')
    expect(legendText).toContain('参数 [4:0]')
  })

  test('L16 数据解释类型切换时图例文案跟随（无符号值 vs 有符号值）', async ({ page }) => {
    await page.goto(appUrl())
    await page.getByRole('tab', { name: /LINEAR16/ }).click()
    const legend = page.locator('.bitfield[data-bit-count="16"] .bitfield-legend')
    await expect(legend).toContainText('数值 V [15:0]')
    await page.getByLabel('L16 数据解释类型').selectOption('slinear16-offset')
    await expect(legend).toContainText('有符号值 Y [15:0]')
  })

  test('非 LINEAR 共享字节的 L16 图例必须是中性 raw word，绝不显示 V/Y（v2.5.3）', async ({
    page,
  }) => {
    await page.goto(appUrl())
    await page.getByRole('tab', { name: /LINEAR16/ }).click()
    const legend = page.locator('.bitfield[data-bit-count="16"] .bitfield-legend')
    for (const hex of ['20', '3E', '40', '60']) {
      await page.locator('#vout-mode-input').fill(hex)
      await page.locator('#vout-mode-input').press('Tab')
      await expect(legend, `VOUT_MODE ${hex}`).toContainText('未按 LINEAR16 解释')
      await expect(legend, `VOUT_MODE ${hex}`).not.toContainText('数值 V')
      await expect(legend, `VOUT_MODE ${hex}`).not.toContainText('有符号值 Y')

      // The payload dropdown must not resurrect the V/Y legend either.
      await page.getByLabel('L16 数据解释类型').selectOption('slinear16-offset')
      await expect(legend, `VOUT_MODE ${hex} + SLINEAR16`).toContainText('未按 LINEAR16 解释')
      await expect(legend, `VOUT_MODE ${hex} + SLINEAR16`).not.toContainText('有符号值 Y')
      await page.getByLabel('L16 数据解释类型').selectOption('ulinear16')
    }
    // Back on a LINEAR byte the payload-specific legends return.
    await page.locator('#vout-mode-input').fill('18')
    await page.locator('#vout-mode-input').press('Tab')
    await expect(legend).toContainText('数值 V [15:0]')
    await expect(legend).not.toContainText('未按 LINEAR16 解释')
  })

  // v2.5.11: 每个视口一个独立用例——断言集合不变，但单个用例的
  // viewport×tab 循环从 6×5 缩到 1×5，冷启动负载下不再逼近 30s 临界路径。
  for (const width of [360, 390, 430, 768, 1024, 1440]) {
    test(`宽横截面 ${width}px：五个模式无横向溢出`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await page.goto(appUrl())
      await expect(page.getByTestId('result-panel')).toBeVisible()
      for (const tab of [/LINEAR11/, /LINEAR16/, /DIRECT/, /HALF/, /VOUT_MODE/]) {
        await page.getByRole('tab', { name: tab }).click()
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        )
        expect(overflow, width + 'px ' + String(tab)).toBe(true)
      }
    })
  }

  // v2.5.11: 同上按视口拆分；几何断言逐条保留。
  for (const width of [360, 390, 768, 1024, 1440, 2048]) {
    test(`位格落在宿主卡片内容盒内（v2.4.0 溢出回归，${width}px）`, async ({ page }) => {
      // 页面级 scrollWidth 断言拦不住「居中网格在卡片内部溢出」：
      // v2.4.0 的 16 位网格 auto 轨道（4×174px+gap=714px）曾在 618px 卡片两侧
      // 对称溢出 48px 而 scrollWidth 不变。这里直接断言位格几何。
      await page.setViewportSize({ width, height: 900 })
      await page.goto(appUrl())
      await expect(page.getByTestId('result-panel')).toBeVisible()
      for (const tab of [/LINEAR11/, /LINEAR16/, /DIRECT/, /HALF/, /VOUT_MODE/]) {
        await page.getByRole('tab', { name: tab }).click()
        await expect(page.locator('.bitfield').first()).toBeVisible()
        const violations = await page.evaluate(() => {
          const out: string[] = []
          for (const field of document.querySelectorAll('.bitfield')) {
            let card = field.parentElement
            while (card && getComputedStyle(card).borderRadius === '0px') {
              card = card.parentElement
            }
            if (card == null) continue
            const cs = getComputedStyle(card)
            const cardRect = card.getBoundingClientRect()
            const contentL = cardRect.left + (parseFloat(cs.paddingLeft) || 0)
            const contentR = cardRect.right - (parseFloat(cs.paddingRight) || 0)
            for (const bit of field.querySelectorAll('.bitfield-bit')) {
              const r = bit.getBoundingClientRect()
              if (r.width === 0) continue
              if (r.left < contentL - 0.5 || r.right > contentR + 0.5) {
                out.push(
                  'bit ' +
                    (bit.querySelector('.bitfield-index')?.textContent ?? '?') +
                    ' [' +
                    Math.round(r.left) +
                    '..' +
                    Math.round(r.right) +
                    '] vs content [' +
                    Math.round(contentL) +
                    '..' +
                    Math.round(contentR) +
                    ']',
                )
              }
            }
          }
          return out
        })
        expect(violations, width + 'px ' + String(tab)).toEqual([])
      }
    })
  }

  test('共享 token 可由 DOM/computed style 证明：16 位与 compact 单元使用同一 cell 类', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto(appUrl())
    await page.getByRole('tab', { name: /LINEAR16/ }).click()
    const result = await page.evaluate(() => {
      const cells = document.querySelectorAll('.bitfield-cell')
      if (cells.length === 0) throw new Error('no shared bit cells found')
      let mono = 0
      for (const cell of cells) {
        const font = getComputedStyle(cell as Element).fontFamily
        if (font.includes('mono')) mono++
      }
      const legacySelectors = document.querySelectorAll(
        '.bit-cell, .vout-bit-cell, .vout-bit-btn',
      ).length
      return { total: cells.length, mono, legacySelectors }
    })
    expect(result.total).toBeGreaterThan(0)
    expect(result.mono).toBe(result.total)
    expect(result.legacySelectors, '旧分叉 CSS 类不得存在').toBe(0)
  })
})
