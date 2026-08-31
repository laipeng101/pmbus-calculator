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

async function switchToL16(page: Page) {
  await page.getByRole('tab', { name: /LINEAR16/ }).click()
  await expect(page.locator('.katex').first()).toBeVisible()
}

const CANONICAL = '[data-testid="vout-mode-canonical"]'
const STATUS = '[data-testid="vout-mode-status"]'
const L16_N = '#l16-n-input'

test.describe('M37 LINEAR 公式编辑器（L11 exponent 锚点）', () => {
  test('N 控件锚定在底数 2 的右上指数槽，且切换 N/lock 不使锚点漂移', async ({ page }) => {
    await settle(page)

    async function boxes() {
      return page.evaluate(() => {
        const b = document.querySelector('[data-testid="power-base"]')!.getBoundingClientRect()
        const o = document.querySelector('[data-testid="linear-op"]')!.getBoundingClientRect()
        const e = document.querySelector('[data-testid="power-exponent"]')!.getBoundingClientRect()
        const l = document.querySelector('.power-lock')!.getBoundingClientRect()
        return {
          bLeft: b.left,
          bTop: b.top,
          bRight: b.right,
          bBottom: b.bottom,
          oLeft: o.left,
          oTop: o.top,
          eLeft: e.left,
          eTop: e.top,
          eRight: e.right,
          eBottom: e.bottom,
          lLeft: l.left,
          lRight: l.right,
        }
      })
    }

    // 解锁 N 后可编辑
    await page.getByRole('button', { name: 'N 已锁定（自动）' }).click()
    const nInput = page.getByLabel('N 值 (指数)')
    await expect(nInput).toBeEnabled()

    const bLefts: number[] = []
    const bTops: number[] = []
    const oLefts: number[] = []
    const oTops: number[] = []
    for (const n of ['-1', '-16', '15']) {
      await nInput.fill(n)
      await nInput.press('Tab')
      const g = await boxes()
      // N 位于底数 2 上方、右侧区域：指数槽左边缘从底数右边缘开始（±2px 容差）
      expect(g.eBottom, 'exponent above base').toBeLessThanOrEqual(g.bTop + 4)
      expect(g.eLeft, 'exponent left aligns with base right').toBeGreaterThanOrEqual(g.bRight - 2)
      expect(g.eRight, 'exponent reaches right edge of base').toBeGreaterThanOrEqual(g.bRight)
      // 锁按钮在独立槽，不覆盖指数
      expect(g.eRight, 'exponent clears lock button').toBeLessThanOrEqual(g.lLeft)
      bLefts.push(g.bLeft)
      bTops.push(g.bTop)
      oLefts.push(g.oLeft)
      oTops.push(g.oTop)
    }

    // 切换锁定状态也不应移动底数与乘号（各坐标轴独立比较）
    await page.getByRole('button', { name: 'N 已解锁（手动）' }).click()
    const locked = await boxes()
    bLefts.push(locked.bLeft)
    bTops.push(locked.bTop)
    oLefts.push(locked.oLeft)
    oTops.push(locked.oTop)
    for (const axis of [bLefts, bTops, oLefts, oTops]) {
      expect(Math.max(...axis) - Math.min(...axis)).toBeLessThanOrEqual(1)
    }
  })
})

async function switchToVoutMode(page: Page) {
  await page.getByRole('tab', { name: /VOUT_MODE/ }).click()
  await expect(page.locator(CANONICAL)).toBeVisible()
}

test.describe('M38 VOUT_MODE 结构化配置器（L16 embedded）', () => {
  test('expert Hex 与结构化控件双向同步（0x18↔-8、0x0F↔15、0x10↔-16）', async ({ page }) => {
    await settle(page)
    await switchToL16(page)

    const hex = page.locator('#vout-mode-input')
    await expect(hex).toHaveValue('18')
    await expect(page.locator(L16_N)).toHaveValue('-8')

    await page.locator(L16_N).fill('15')
    await page.locator(L16_N).press('Tab')
    await expect(hex).toHaveValue('0F')
    await expect(page.locator(CANONICAL)).toContainText('0x0F')

    await page.locator(L16_N).fill('-16')
    await page.locator(L16_N).press('Tab')
    await expect(hex).toHaveValue('10')

    await hex.fill('18')
    await hex.press('Tab')
    await expect(page.locator(L16_N)).toHaveValue('-8')
  })

  test('bit7 切换不破坏 N；N 编辑不破坏 bit7/格式', async ({ page }) => {
    await settle(page)
    await switchToL16(page)

    await page.getByRole('radio', { name: '相对值' }).click()
    await expect(page.locator(CANONICAL)).toContainText('0x98')
    await expect(page.locator(L16_N)).toHaveValue('-8')
    await expect(page.locator(STATUS)).toContainText('相对 LINEAR')

    await page.locator(L16_N).fill('15')
    await page.locator(L16_N).press('Tab')
    await expect(page.locator(CANONICAL)).toContainText('0x8F') // relative LINEAR, N=15

    await page.getByRole('radio', { name: '绝对值' }).click()
    await expect(page.locator(CANONICAL)).toContainText('0x0F') // N 保持 15
  })

  test('L16 bits[6:5] 锁定：格式 radio 不出现，bit5/bit6 按钮 disabled', async ({ page }) => {
    await settle(page)
    await switchToL16(page)

    await expect(page.getByRole('radio', { name: 'VID' })).toHaveCount(0)
    const bit5 = page.getByRole('button', { name: /第 5 位，格式位固定为 LINEAR/ })
    const bit6 = page.getByRole('button', { name: /第 6 位，格式位固定为 LINEAR/ })
    await expect(bit5).toBeDisabled()
    await expect(bit6).toBeDisabled()
    await expect(page.getByRole('button', { name: /第 7 位，绝对值\/相对值/ })).toBeEnabled()
  })
})

test.describe('M38 standalone VOUT_MODE calculator', () => {
  test('第五个 tab、8-bit 双 nibble 与 canonical byte 显示', async ({ page }) => {
    await settle(page)
    await switchToVoutMode(page)

    await expect(page.getByRole('tab', { name: /VOUT_MODE/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(page.getByTestId('vout-mode-byte')).toHaveText('0x18')
    await expect(page.getByTestId('vout-mode-binary')).toHaveText('0b00011000')
    await expect(page.getByRole('button', { name: /第 7 位，绝对值\/相对值/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /第 0 位，参数/ })).toBeVisible()
  })

  test('raw bit toggle 是 lossless 的：可构造 0xA0/0x41/0xE1 且不被吞掉', async ({ page }) => {
    await settle(page)
    await switchToVoutMode(page)

    const hex = page.locator('#vout-mode-input')
    await hex.fill('A0')
    await hex.press('Tab')
    await expect(page.getByTestId('vout-mode-byte')).toHaveText('0xA0')
    await expect(page.locator(STATUS)).toContainText('相对 VID — 非法组合')

    await hex.fill('41')
    await hex.press('Tab')
    await expect(page.getByTestId('vout-mode-byte')).toHaveText('0x41')
    await expect(page.locator(STATUS)).toContainText('参数必须为 0')

    await hex.fill('E1')
    await hex.press('Tab')
    await expect(page.getByTestId('vout-mode-byte')).toHaveText('0xE1')
    await expect(page.locator(STATUS)).toContainText('参数必须为 0')
  })

  test('relative VID 0xA0 显示非法组合且绝不显示相对 LINEAR；Absolute 可修正', async ({ page }) => {
    await settle(page)
    await switchToVoutMode(page)
    const hex = page.locator('#vout-mode-input')
    await hex.fill('A0')
    await hex.press('Tab')

    await expect(page.locator(STATUS)).toContainText('相对 VID — 非法组合')
    await expect(page.locator(STATUS)).not.toContainText('相对 LINEAR')

    await page.getByRole('radio', { name: '绝对值' }).click()
    await expect(page.locator(CANONICAL)).toContainText('0x20')
    await expect(page.locator(STATUS)).toContainText('未使用')
  })

  test('选择 VID 时 Relative 被禁用；DIRECT/Half 参数固定为 0', async ({ page }) => {
    await settle(page)
    await switchToVoutMode(page)

    await page.getByRole('radio', { name: '相对值' }).click()
    await page.getByRole('radio', { name: 'VID' }).click()
    await expect(page.locator(CANONICAL)).toContainText('0x38')
    await expect(page.getByRole('radio', { name: '相对值' })).toBeDisabled()

    await page.getByRole('radio', { name: 'DIRECT' }).click()
    await expect(page.locator(CANONICAL)).toContainText('0x40')
    await expect(page.getByText(/参数 = 00000b/)).toBeVisible()

    await page.getByRole('radio', { name: 'IEEE Half' }).click()
    await expect(page.locator(CANONICAL)).toContainText('0x60')
  })

  test('Normalize 只修正非法组合/参数，不破坏合法位', async ({ page }) => {
    await settle(page)
    await switchToVoutMode(page)
    const hex = page.locator('#vout-mode-input')

    await hex.fill('E1')
    await hex.press('Tab')
    await page.getByRole('button', { name: /规范化/ }).click()
    await expect(page.getByTestId('vout-mode-byte')).toHaveText('0xE0')

    await hex.fill('A0')
    await hex.press('Tab')
    await page.getByRole('button', { name: /规范化/ }).click()
    await expect(page.getByTestId('vout-mode-byte')).toHaveText('0x20')
  })

  test('结构化控件不切换顶层模式；命令参考保持无副作用', async ({ page }) => {
    await settle(page)
    await switchToVoutMode(page)

    await page.getByRole('radio', { name: 'VID' }).click()
    await expect(page.getByRole('tab', { name: /VOUT_MODE/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )

    await page.locator('#command-reference-toggle').click()
    await expect(page.getByRole('row', { name: /STATUS_WORD/ })).toBeVisible()
    await page.locator('#command-reference-toggle').click()
    await expect(page.locator(CANONICAL)).toContainText('0x38')
  })
})

test.describe('M37 公式/配置器布局与溢出', () => {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1280, height: 900 },
    { width: 390, height: 844 },
    { width: 360, height: 800 },
  ]) {
    test(`${viewport.width}×${viewport.height}: L11/L16 公式与配置器无 body 横向溢出`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport)
      await settle(page)

      await expect(page.locator('[data-testid="power-base"]')).toBeVisible()
      const noOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      )
      expect(noOverflow).toBe(true)

      await switchToL16(page)
      await expect(page.locator(CANONICAL)).toBeVisible()
      const noOverflow16 = await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      )
      expect(noOverflow16).toBe(true)
    })
  }

  test('1280×900 L16 默认折叠下 scrollHeight ≤ 1400（M39：内嵌 VOUT_MODE 保留双 nibble 分组与图例）', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await settle(page)
    await switchToL16(page)
    const scrollHeight = await page.evaluate(() => document.documentElement.scrollHeight)
    expect(scrollHeight).toBeLessThanOrEqual(1400)
  })
})

test.describe('v2.6.2 VOUT_MODE radio 键盘合同（roving tabindex + 方向键）', () => {
  // ARIA APG radio pattern：选中项是唯一 tab stop；ArrowRight/Down 下一项、
  // ArrowLeft/Up 上一项，循环并跳过 disabled；焦点到达即选择。
  test('standalone abs/rel 组：方向键移动焦点并选择，循环，Space 幂等', async ({ page }) => {
    await settle(page)
    await switchToVoutMode(page)

    const abs = page.getByRole('radio', { name: '绝对值' })
    const rel = page.getByRole('radio', { name: '相对值' })

    // 选中项是唯一 roving tab stop。
    await expect(abs).toHaveAttribute('tabindex', '0')
    await expect(rel).toHaveAttribute('tabindex', '-1')

    await abs.focus()
    await page.keyboard.press('ArrowRight')
    await expect(rel).toBeFocused()
    await expect(rel).toHaveAttribute('aria-checked', 'true')
    await expect(abs).toHaveAttribute('aria-checked', 'false')
    await expect(page.locator(CANONICAL)).toContainText('0x98')
    await expect(page.locator(STATUS)).toContainText('相对 LINEAR')
    // 焦点到达即成为新的 roving tab stop。
    await expect(rel).toHaveAttribute('tabindex', '0')
    await expect(abs).toHaveAttribute('tabindex', '-1')

    // ArrowLeft 回到上一项。
    await page.keyboard.press('ArrowLeft')
    await expect(abs).toBeFocused()
    await expect(abs).toHaveAttribute('aria-checked', 'true')
    await expect(page.locator(CANONICAL)).toContainText('0x18')

    // ArrowDown 同 Right、ArrowUp 同 Left。
    await page.keyboard.press('ArrowDown')
    await expect(rel).toBeFocused()
    await page.keyboard.press('ArrowUp')
    await expect(abs).toBeFocused()

    // 从第一项向后循环到最后一项。
    await page.keyboard.press('ArrowLeft')
    await expect(rel).toBeFocused()

    // Space 在已选中的 radio 上是幂等 no-op。
    await page.keyboard.press('Space')
    await expect(page.locator(CANONICAL)).toContainText('0x98')
  })

  test('standalone format 组：方向键沿 LINEAR→VID→DIRECT→IEEE Half 行走并循环', async ({
    page,
  }) => {
    await settle(page)
    await switchToVoutMode(page)

    const linear = page.getByRole('radio', { name: 'LINEAR' })
    const vid = page.getByRole('radio', { name: 'VID' })
    const direct = page.getByRole('radio', { name: 'DIRECT' })
    const half = page.getByRole('radio', { name: 'IEEE Half' })

    await expect(linear).toHaveAttribute('tabindex', '0')
    for (const other of [vid, direct, half]) {
      await expect(other).toHaveAttribute('tabindex', '-1')
    }

    await linear.focus()
    await page.keyboard.press('ArrowRight')
    await expect(vid).toBeFocused()
    await expect(vid).toHaveAttribute('aria-checked', 'true')
    await expect(page.locator(CANONICAL)).toContainText('0x38')

    await page.keyboard.press('ArrowRight')
    await expect(direct).toBeFocused()
    await expect(page.locator(CANONICAL)).toContainText('0x40')

    await page.keyboard.press('ArrowRight')
    await expect(half).toBeFocused()
    await expect(page.locator(CANONICAL)).toContainText('0x60')

    // 从最后一项向后循环回第一项。
    await page.keyboard.press('ArrowRight')
    await expect(linear).toBeFocused()
    await expect(linear).toHaveAttribute('aria-checked', 'true')
    await expect(linear).toHaveAttribute('tabindex', '0')
    await expect(half).toHaveAttribute('tabindex', '-1')

    // 从第一项向前循环到最后一项。
    await page.keyboard.press('ArrowLeft')
    await expect(half).toBeFocused()
    await expect(half).toHaveAttribute('aria-checked', 'true')
  })

  test('选择 VID 后 ArrowRight/Left 跳过 disabled 相对值，焦点停回绝对值', async ({ page }) => {
    await settle(page)
    await switchToVoutMode(page)

    await page.getByRole('radio', { name: 'VID' }).click()
    const abs = page.getByRole('radio', { name: '绝对值' })
    const rel = page.getByRole('radio', { name: '相对值' })
    await expect(rel).toBeDisabled()

    await abs.focus()
    await page.keyboard.press('ArrowRight')
    await expect(abs).toBeFocused()
    await expect(abs).toHaveAttribute('aria-checked', 'true')
    await page.keyboard.press('ArrowLeft')
    await expect(abs).toBeFocused()
    await expect(page.locator(CANONICAL)).toContainText('0x38')
  })

  test('L16 embedded abs/rel 组同样支持方向键且不破坏 canonical 回写', async ({ page }) => {
    await settle(page)
    await switchToL16(page)

    const abs = page.getByRole('radio', { name: '绝对值' })
    const rel = page.getByRole('radio', { name: '相对值' })

    await expect(abs).toHaveAttribute('tabindex', '0')
    await abs.focus()
    await page.keyboard.press('ArrowRight')
    await expect(rel).toBeFocused()
    await expect(rel).toHaveAttribute('aria-checked', 'true')
    await expect(page.locator(CANONICAL)).toContainText('0x98')
    await expect(page.locator(STATUS)).toContainText('相对 LINEAR')

    await page.keyboard.press('ArrowLeft')
    await expect(abs).toBeFocused()
    await expect(page.locator(CANONICAL)).toContainText('0x18')
  })
})
