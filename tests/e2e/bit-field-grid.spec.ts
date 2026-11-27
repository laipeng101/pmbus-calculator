import { test, expect, type Page } from '@playwright/test'
import { expectNoHorizontalOverflow } from './helpers/layout'

async function settle(page: Page) {
  await page.goto('./')
  await expect(page.locator('.katex').first()).toBeVisible()
}

async function gridInfo(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel)
    if (root == null) throw new Error('missing grid ' + sel)
    const nibbles = Array.from(root.querySelectorAll(':scope .bitfield-grid > .bitfield-nibble'))
    return {
      density: root.getAttribute('data-density'),
      nibbleCount: nibbles.length,
      bitsPerNibble: nibbles.map((n) => n.querySelectorAll('.bitfield-bit').length),
      hexLabels: nibbles.map((n) => {
        const el = n.querySelector('.bitfield-nibble-hex')
        return { text: el?.textContent ?? '', font: getComputedStyle(el!).fontFamily }
      }),
      legendItems: Array.from(root.querySelectorAll('.bitfield-legend-item')).map((item) => ({
        text: item.textContent ?? '',
        swatchSize: (() => {
          const box = item.querySelector('.legend-swatch')!.getBoundingClientRect()
          return { w: Math.round(box.width), h: Math.round(box.height) }
        })(),
      })),
    }
  }, selector)
}

test.describe('位编辑器', () => {
  test('16 位编辑器每四位分组，以大写等宽十六进制标注', async ({ page }) => {
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

  test('独立 VOUT_MODE 的两组位按钮与字节输入同步', async ({ page }) => {
    await page.goto('./')
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

  test('LINEAR16 内嵌配置器保留两个四位组，格式位禁用', async ({ page }) => {
    await page.goto('./')
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

  test('LINEAR16 数据解释切换后显示对应图例', async ({ page }) => {
    await page.goto('./')
    await page.getByRole('tab', { name: /LINEAR16/ }).click()
    const legend = page.locator('.bitfield[data-bit-count="16"] .bitfield-legend')
    await expect(legend).toContainText('数值 V [15:0]')
    await page.getByLabel('L16 数据解释类型').selectOption('slinear16-offset')
    await expect(legend).toContainText('有符号值 Y [15:0]')
  })

  const rawBits = { id: 'bit-mapping-raw-word-content', name: '16 位编辑器', count: 16 }
  const configurationBits = {
    id: 'bit-mapping-vout-mode-content',
    name: 'VOUT_MODE 8 位编辑器',
    count: 8,
  }
  const modes = [
    { name: 'LINEAR11', grids: [rawBits] },
    { name: 'LINEAR16', grids: [rawBits, configurationBits] },
    { name: 'VOUT_MODE', grids: [configurationBits] },
  ]

  // 采样位网格列数和工作区分栏切换处。两侧同时溢出时页面宽度可能不变。
  for (const width of [359, 360, 960, 1151, 1152]) {
    test(`${width} px 下各位编辑器完整显示在面板内`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await page.goto('./')

      for (const mode of modes) {
        await page.getByRole('tab', { name: new RegExp(mode.name) }).click()
        for (const { id, name, count } of mode.grids) {
          const panel = page.locator(`#${id}`)
          const group = panel.getByRole('group', { name, exact: true })
          await expect(group).toBeVisible()
          await expect(group.getByRole('button')).toHaveCount(count)

          const clipped = await panel.evaluate((element) => {
            const panel = element.getBoundingClientRect()
            return Array.from(element.querySelectorAll('.bitfield-bit'))
              .filter((bit) => {
                const box = bit.getBoundingClientRect()
                return (
                  box.width <= 0 ||
                  box.height <= 0 ||
                  box.left < panel.left - 0.5 ||
                  box.right > panel.right + 0.5
                )
              })
              .map((bit) => bit.getAttribute('aria-label'))
          })
          expect(clipped, `${mode.name} 的 ${name}`).toEqual([])
        }
        await expectNoHorizontalOverflow(page)
      }
    })
  }
})

test.describe('LINEAR16 配置格式位的禁用原因', () => {
  // 原生 disabled 的位按钮不产生指针/焦点事件，禁用原因必须有 tooltip 之外的
  // 可见路径，并通过 aria-describedby 关联到这两个按钮。
  test('已关联的 LINEAR16 格式位关联可见禁用原因', async ({ page }) => {
    await page.goto('./')
    await page.getByRole('tab', { name: /LINEAR16/ }).click()

    const reason = page.locator('#vout-bits65-disabled-reason')
    await expect(reason).toBeVisible()
    await expect(reason).toContainText('格式位固定为 LINEAR')

    for (const index of [5, 6]) {
      const bit = page.getByRole('button', {
        name: new RegExp('第 ' + index + ' 位，格式位固定为 LINEAR'),
      })
      await expect(bit).toBeDisabled()
      await expect(bit).toHaveAttribute('aria-describedby', 'vout-bits65-disabled-reason')
    }
    const bit7 = page.getByRole('button', { name: /第 7 位，绝对值\/相对值/ })
    await expect(bit7).toBeEnabled()
    await expect(bit7).not.toHaveAttribute('aria-describedby')

    // 独立 VOUT_MODE 页没有这个锁，也没有该可见原因行。
    await page.getByRole('tab', { name: /VOUT_MODE/ }).click()
    await expect(page.locator('#vout-bits65-disabled-reason')).toHaveCount(0)
  })

  test('非 LINEAR 配置的格式位关联相应禁用原因', async ({ page }) => {
    await page.goto('./')
    await page.getByRole('tab', { name: /LINEAR16/ }).click()

    const hex = page.locator('#vout-mode-input')
    await hex.fill('40')
    await hex.press('Tab')

    const reason = page.locator('#vout-bits65-disabled-reason')
    await expect(reason).toBeVisible()
    await expect(reason).toContainText('格式位不可在本页切换（当前字节非 LINEAR）')
    for (const index of [5, 6]) {
      const bit = page.getByRole('button', {
        name: new RegExp('第 ' + index + ' 位，格式位不可在本页切换'),
      })
      await expect(bit).toBeDisabled()
      await expect(bit).toHaveAttribute('aria-describedby', 'vout-bits65-disabled-reason')
    }
  })

  test('390 px 下禁用原因完整显示', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('./')
    await page.getByRole('tab', { name: /LINEAR16/ }).click()
    await expect(page.locator('#vout-bits65-disabled-reason')).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })
})
