import { test, expect, type Page } from '@playwright/test'

const hexInput = (page: Page) => page.locator('#raw-hex-input')
const valueInput = (page: Page) => page.locator('#value-input')

interface Vector {
  text: string
  raw: string
  n: string
  y: string
  result: string
  delta: string
}

// The independent nearest-code oracle covers the full vector matrix in Vitest.
// These three values exercise the browser wiring on either side of the tie.
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
]

test.describe('LINEAR11 最近值编码', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('./')
  })

  test('中点及相邻输入同步原字、N/Y、结果和量化误差', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 })
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
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })

  test('手动指定的指数决定中点两侧的编码', async ({ page }) => {
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

  test('切换自动指数时保留已有编码请求和原字编辑的区别', async ({ page }) => {
    const lock = page.locator('.n-lock-button')
    const quantization = page.getByTestId('quantization-error')
    await hexInput(page).fill('F123')
    await hexInput(page).press('Tab')
    await expect(quantization).toHaveCount(0)
    await lock.click()
    await expect(lock).toHaveAttribute('aria-pressed', 'false')
    await expect(hexInput(page)).toHaveValue('F123')
    await expect(quantization).toHaveCount(0)
    await lock.press('Space')
    await expect(lock).toHaveAttribute('aria-pressed', 'true')
    await expect(quantization).toHaveCount(0)

    await hexInput(page).fill('0801')
    await lock.click()
    await valueInput(page).fill('1.25')
    await valueInput(page).press('Tab')
    await expect(hexInput(page)).toHaveValue('0801')
    await expect(quantization).toContainText('-0.750000 (-60.0000%)')
    await lock.click()
    await expect(hexInput(page)).toHaveValue('F005')
    await expect(quantization).toContainText('+0.000000 (0.0000%)')
  })
})
