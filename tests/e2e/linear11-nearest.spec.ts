import { test, expect, type Page } from '@playwright/test'
import { appUrl } from './helpers/app-url'

/**
 * v2.5.10 — LINEAR11 auto-N must encode the strictly nearest representable
 * code (minimal |X − Y×2^N|) with a single deterministic exact-tie policy
 * (smaller |N|). These vectors are the v2.5.10 audit counterexamples: the
 * former fixed 1e-15 tie epsilon made values just above the 2^-17 midpoint
 * silently encode as 0x0000 although 0x8001 was strictly nearer.
 *
 * Every case drives the real physical-value input (fill + blur commit) and
 * asserts raw, N/Y, result, quantization delta and provenance readout.
 */

const hexInput = (page: Page) => page.locator('input[placeholder="0000"]')
const valueInput = (page: Page) => page.locator('#value-input')

interface Vector {
  text: string
  raw: string
  n: string
  y: string
  result: string
  delta: string
}

// Golden values cross-checked against the algorithm unit suite
// (src/legacy/linear11-nearest.test.ts) and the oracle over all 65536 codes.
const VECTORS: Vector[] = [
  {
    text: '0.0000076293945312',
    raw: '0000',
    n: '0',
    y: '0',
    result: '0',
    delta: '+0.000008 (100.0000%)',
  },
  {
    text: '0.00000762939453125',
    raw: '0000',
    n: '0',
    y: '0',
    result: '0',
    delta: '+0.000008 (100.0000%)',
  },
  {
    text: '0.0000076293945313',
    raw: '8001',
    n: '-16',
    y: '1',
    result: '0.0000152587890625',
    delta: '-0.000008 (-100.0000%)',
  },
  {
    text: '0.00000762939454',
    raw: '8001',
    n: '-16',
    y: '1',
    result: '0.0000152587890625',
    delta: '-0.000008 (-100.0000%)',
  },
  {
    text: '-0.0000076293945312',
    raw: '0000',
    n: '0',
    y: '0',
    result: '0',
    delta: '-0.000008 (-100.0000%)',
  },
  {
    text: '-0.00000762939453125',
    raw: '0000',
    n: '0',
    y: '0',
    result: '0',
    delta: '-0.000008 (-100.0000%)',
  },
  {
    text: '-0.0000076293945313',
    raw: '87FF',
    n: '-16',
    y: '-1',
    result: '-0.0000152587890625',
    delta: '+0.000008 (100.0000%)',
  },
  {
    text: '-0.00000762939454',
    raw: '87FF',
    n: '-16',
    y: '-1',
    result: '-0.0000152587890625',
    delta: '+0.000008 (100.0000%)',
  },
]

test.describe('LINEAR11 严格最近值编码（v2.5.10）', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto(appUrl())
  })

  test('2^-17 中点邻接向量：物理值输入 → raw/N/Y/结果/量化误差一致', async ({ page }) => {
    const quantization = page.getByTestId('quantization-error')
    for (const v of VECTORS) {
      await valueInput(page).fill(v.text)
      await valueInput(page).press('Tab')
      await expect(hexInput(page), v.text).toHaveValue(v.raw)
      await expect(page.locator('#l11-n-input'), v.text).toHaveValue(v.n)
      await expect(page.locator('#l11-y-input'), v.text).toHaveValue(v.y)
      await expect(page.getByTestId('result-value'), v.text).toHaveText(v.result)
      // Provenance exists (explicit request) → the real delta is shown.
      await expect(quantization, v.text).toBeVisible()
      await expect(quantization, v.text).toContainText(v.delta)
    }
  })

  test('exact tie 2^-17 遵循已文档化的较小 |N| 策略', async ({ page }) => {
    await valueInput(page).fill('0.00000762939453125')
    await valueInput(page).press('Tab')
    // Exactly 2^-17 away from both 0 and 2^-16 → documented tie policy picks
    // the smaller |N| (0x0000), never a hidden epsilon tie.
    await expect(hexInput(page)).toHaveValue('0000')
    await expect(page.locator('#l11-n-input')).toHaveValue('0')
    await expect(page.locator('#l11-y-input')).toHaveValue('0')
  })

  test('常规值 12 / 2 与正负饱和边界不回归', async ({ page }) => {
    await valueInput(page).fill('12')
    await valueInput(page).press('Tab')
    await expect(hexInput(page)).toHaveValue('000C')
    await expect(page.getByTestId('result-value')).toHaveText('12')
    await expect(page.locator('#l11-n-input')).toHaveValue('0')
    await expect(page.locator('#l11-y-input')).toHaveValue('12')

    await valueInput(page).fill('2')
    await valueInput(page).press('Tab')
    await expect(hexInput(page)).toHaveValue('0002')

    await valueInput(page).fill('100000000')
    await valueInput(page).press('Tab')
    await expect(hexInput(page)).toHaveValue('7BFF')
    await expect(page.getByTestId('quantization-error')).toHaveAttribute('data-kind', 'error')

    await valueInput(page).fill('-100000000')
    await valueInput(page).press('Tab')
    await expect(hexInput(page)).toHaveValue('7C00')
    await expect(page.getByTestId('quantization-error')).toHaveAttribute('data-kind', 'error')
  })

  test('锁定 N 路径与自动搜索相互独立（回归）', async ({ page }) => {
    const lock = page.locator('.n-lock-button')
    await expect(lock).toHaveAttribute('aria-pressed', 'true')
    await lock.click()
    await expect(lock).toHaveAttribute('aria-pressed', 'false')
    await page.locator('#l11-n-input').fill('-16')
    await page.locator('#l11-n-input').press('Tab')

    // Below the midpoint: locked N=-16 rounds Y to 0 → 0x8000, while the
    // auto-N search would pick the strictly nearer 0x0000.
    await valueInput(page).fill('0.0000076293945312')
    await valueInput(page).press('Tab')
    await expect(hexInput(page)).toHaveValue('8000')
    await expect(page.locator('#l11-y-input')).toHaveValue('0')

    // Above the midpoint: locked N=-16 rounds Y to 1 → 0x8001.
    await valueInput(page).fill('0.0000076293945313')
    await valueInput(page).press('Tab')
    await expect(hexInput(page)).toHaveValue('8001')
    await expect(page.locator('#l11-y-input')).toHaveValue('1')
  })

  test('360px 视口：向量与量化读数无横向溢出', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 })
    const value = valueInput(page)
    await value.fill('0.0000076293945313')
    await value.press('Tab')
    await expect(hexInput(page)).toHaveValue('8001')
    const { scrollWidth, clientWidth } = await page
      .locator('body')
      .evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }))
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth)
    await expect(page.getByTestId('quantization-error')).toBeVisible()
  })
})
