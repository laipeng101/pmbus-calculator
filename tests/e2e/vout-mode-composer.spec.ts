import { test, expect, type Page } from '@playwright/test'

async function settle(page: Page) {
  await page.goto('/')
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
      // N 位于底数 2 上方、右侧区域
      expect(g.eBottom, 'exponent above base').toBeLessThanOrEqual(g.bTop + 2)
      expect(g.eRight, 'exponent reaches right edge of base').toBeGreaterThanOrEqual(g.bRight - 4)
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

test.describe('M37 VOUT_MODE 结构化配置器（L16）', () => {
  test('expert Hex 与结构化控件双向同步（0x18↔-8、0x0F↔15、0x10↔-16）', async ({ page }) => {
    await settle(page)
    await switchToL16(page)

    const hex = page.locator('#vout-mode-input')
    await expect(hex).toHaveValue('0x18')
    await expect(page.locator(L16_N)).toHaveValue('-8')

    await page.locator(L16_N).fill('15')
    await page.locator(L16_N).press('Tab')
    await expect(hex).toHaveValue('0x0F')
    await expect(page.locator(CANONICAL)).toContainText('0x0F')

    await page.locator(L16_N).fill('-16')
    await page.locator(L16_N).press('Tab')
    await expect(hex).toHaveValue('0x10')

    await hex.fill('18')
    await hex.press('Tab')
    await expect(page.locator(L16_N)).toHaveValue('-8')
  })

  test('bit7 切换不破坏 N；N 编辑不破坏 bit7/format', async ({ page }) => {
    await settle(page)
    await switchToL16(page)

    await page.getByRole('radio', { name: 'Relative' }).click()
    await expect(page.locator(CANONICAL)).toContainText('0x98')
    await expect(page.locator(L16_N)).toHaveValue('-8')
    await expect(page.locator(STATUS)).toContainText('相对 LINEAR')

    await page.locator(L16_N).fill('15')
    await page.locator(L16_N).press('Tab')
    await expect(page.locator(CANONICAL)).toContainText('0x8F') // relative LINEAR, N=15

    await page.getByRole('radio', { name: 'Absolute' }).click()
    await expect(page.locator(CANONICAL)).toContainText('0x0F') // N 保持 15
  })

  test('relative VID 0xA0 显示非法组合且绝不显示相对 LINEAR', async ({ page }) => {
    await settle(page)
    await switchToL16(page)
    const hex = page.locator('#vout-mode-input')
    await hex.fill('A0')
    await hex.press('Tab')

    await expect(page.locator(STATUS)).toContainText('相对 VID — 非法组合')
    await expect(page.getByTestId('result-value')).toHaveText('—')
    await expect(page.getByText(/相对 LINEAR/)).toHaveCount(0)

    // Absolute 控件可把非法相对 VID 修正回绝对 VID
    await page.getByRole('radio', { name: 'Absolute' }).click()
    await expect(page.locator(CANONICAL)).toContainText('0x20')
    await expect(page.locator(STATUS)).toContainText('Not Used')
  })

  test('DIRECT/Half 参数非零（0x5F/0xE1）被判 invalid parameter 且不计算', async ({ page }) => {
    await settle(page)
    await switchToL16(page)
    const hex = page.locator('#vout-mode-input')

    await hex.fill('5F')
    await hex.press('Tab')
    await expect(page.locator(STATUS)).toContainText('DIRECT 参数必须为 0')
    await expect(page.getByTestId('result-value')).toHaveText('—')

    await hex.fill('E1')
    await hex.press('Tab')
    await expect(page.locator(STATUS)).toContainText('IEEE Half 参数必须为 0')
    await expect(page.getByTestId('result-value')).toHaveText('—')
  })

  test('选择 VID 时 Relative 被规范化禁用；DIRECT/Half 参数固定为 0', async ({ page }) => {
    await settle(page)
    await switchToL16(page)

    // 先切 relative，再选 VID：bit7 被规范化为 absolute
    await page.getByRole('radio', { name: 'Relative' }).click()
    await page.getByRole('radio', { name: 'VID' }).click()
    await expect(page.locator(CANONICAL)).toContainText('0x38') // absolute VID, 参数保留 24
    await expect(page.getByRole('radio', { name: 'Relative' })).toBeDisabled()
    await expect(page.locator('#vout-vid-code-select')).toBeVisible()

    // DIRECT：参数固定 0
    await page.getByRole('radio', { name: 'DIRECT' }).click()
    await expect(page.locator(CANONICAL)).toContainText('0x40')
    await expect(page.getByText(/parameter = 00000b/)).toBeVisible()

    // IEEE Half：参数固定 0
    await page.getByRole('radio', { name: 'IEEE Half' }).click()
    await expect(page.locator(CANONICAL)).toContainText('0x60')
  })

  test('结构化控件不切换顶层模式；命令参考保持无副作用', async ({ page }) => {
    await settle(page)
    await switchToL16(page)

    await page.getByRole('radio', { name: 'VID' }).click()
    await expect(page.getByRole('tab', { name: /LINEAR16/ })).toHaveAttribute(
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

  test('1280×900 L16 默认折叠下 scrollHeight ≤ 1350', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await settle(page)
    await switchToL16(page)
    const scrollHeight = await page.evaluate(() => document.documentElement.scrollHeight)
    expect(scrollHeight).toBeLessThanOrEqual(1350)
  })
})
