import { test, expect, type Locator, type Page } from '@playwright/test'
import { appUrl } from './helpers/app-url'

async function setTheme(page: Page, theme: 'light' | 'dark') {
  await page.addInitScript((t) => localStorage.setItem('pmbus-calculator:theme', t), theme)
}

async function readContrast(locator: Locator) {
  return locator.evaluate((el) => {
    const cs = getComputedStyle(el)
    return { background: cs.backgroundColor, color: cs.color }
  })
}

async function contrastOf(rgb: { background: string; color: string }): Promise<number> {
  return parseContrast(rgb.background, rgb.color)
}

function parseRgb(value: string): [number, number, number] {
  const match = value.match(/rgba?\(([^)]+)\)/)
  if (match == null) return [0, 0, 0]
  const parts = match[1].split(',').map((n) => parseFloat(n.trim()))
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0]
}

function luminance(rgb: [number, number, number]): number {
  const linear = rgb.map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * (linear[0] ?? 0) + 0.7152 * (linear[1] ?? 0) + 0.0722 * (linear[2] ?? 0)
}

function parseContrast(a: string, b: string): number {
  const l1 = luminance(parseRgb(a))
  const l2 = luminance(parseRgb(b))
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

test.describe('contrast', () => {
  test('light/dark selected mode tab has >= 4.5 contrast', async ({ page }) => {
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(page, theme)
      await page.goto(appUrl())
      const activeTab = page.locator('[role="tab"][aria-selected="true"]')
      const styles = await readContrast(activeTab)
      expect(await contrastOf(styles)).toBeGreaterThanOrEqual(4.5)
    }
  })

  test('pressed/unpressed format preference buttons have >= 4.5 contrast', async ({ page }) => {
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(page, theme)
      await page.goto(appUrl())
      // 断言同一个偏好按钮在按下/未按下两个状态都满足对比度：不依赖其他
      // aria-pressed 控件的存在，也不依赖 reload 后持久化偏好的具体取值
      // （v3.0.0 移除字节序按钮后，旧「组内找 false」写法在第二轮失去目标）。
      const prefixButton = page.getByRole('button', { name: '0x 前缀' })
      await prefixButton.scrollIntoViewIfNeeded()
      const pressedBefore = (await prefixButton.getAttribute('aria-pressed')) === 'true'
      const pressedStyles = await readContrast(prefixButton)
      expect(await contrastOf(pressedStyles)).toBeGreaterThanOrEqual(4.5)

      await prefixButton.click()
      await expect(prefixButton).toHaveAttribute('aria-pressed', pressedBefore ? 'false' : 'true')
      const unpressedStyles = await readContrast(prefixButton)
      expect(await contrastOf(unpressedStyles)).toBeGreaterThanOrEqual(4.5)
    }
  })

  test('theme toggle button has >= 4.5 contrast', async ({ page }) => {
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(page, theme)
      await page.goto(appUrl())
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      const toggle = page.getByRole('button', { name: /当前主题/ })
      // 等待颜色过渡结束：transition-colors 期间读取会得到中间色
      await expect
        .poll(async () => contrastOf(await readContrast(toggle)))
        .toBeGreaterThanOrEqual(4.5)
    }
  })

  test('L11 blue N bit and green Y bit have >= 4.5 on-bit contrast', async ({ page }) => {
    await setTheme(page, 'dark')
    await page.goto(appUrl())
    await page.getByRole('button', { name: '位 15: 0' }).click()
    await page.waitForTimeout(300)
    const blueBit = page.getByRole('button', { name: '位 15: 1' })
    const blueStyles = await blueBit.evaluate((el) => {
      const chip = el.querySelector('div') as HTMLElement
      const cs = getComputedStyle(chip)
      return { background: cs.backgroundColor, color: cs.color }
    })
    expect(await contrastOf(blueStyles)).toBeGreaterThanOrEqual(4.5)

    await page.getByRole('button', { name: '位 15: 1' }).click()
    await page.getByRole('button', { name: '位 0: 0' }).click()
    await page.waitForTimeout(300)
    const greenBit = page.getByRole('button', { name: '位 0: 1' })
    const greenStyles = await greenBit.evaluate((el) => {
      const chip = el.querySelector('div') as HTMLElement
      const cs = getComputedStyle(chip)
      return { background: cs.backgroundColor, color: cs.color }
    })
    expect(await contrastOf(greenStyles)).toBeGreaterThanOrEqual(4.5)
  })

  test('HALF orange sign bit has >= 4.5 on-bit contrast', async ({ page }) => {
    await setTheme(page, 'dark')
    await page.goto(appUrl())
    await page.getByRole('tab', { name: /HALF/ }).click()
    await page.getByRole('button', { name: '位 15: 0' }).click()
    await page.waitForTimeout(300)
    const orangeBit = page.getByRole('button', { name: '位 15: 1' })
    const styles = await orangeBit.evaluate((el) => {
      const chip = el.querySelector('div') as HTMLElement
      const cs = getComputedStyle(chip)
      return { background: cs.backgroundColor, color: cs.color }
    })
    expect(await contrastOf(styles)).toBeGreaterThanOrEqual(4.5)
  })

  test('copy feedback success and failure have >= 4.5 contrast', async ({ page }) => {
    await setTheme(page, 'dark')
    await page.goto(appUrl())

    // Success path
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: async () => undefined },
        configurable: true,
      })
    })
    const copyRaw = page.getByRole('button', { name: 'Raw Word Hex' })
    await copyRaw.scrollIntoViewIfNeeded()
    await copyRaw.click()
    const success = page.locator('.copy-feedback')
    await expect(success).toBeVisible()
    const successStyles = await success.evaluate((el) => {
      const cs = getComputedStyle(el)
      return { background: cs.backgroundColor, color: cs.color }
    })
    expect(await contrastOf(successStyles)).toBeGreaterThanOrEqual(4.5)

    // Failure path
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          writeText: async () => {
            throw new Error('denied')
          },
        },
        configurable: true,
      })
    })
    await copyRaw.click()
    await expect(page.locator('.copy-feedback')).toContainText('复制失败')
    const errorStyles = await page.locator('.copy-feedback').evaluate((el) => {
      const cs = getComputedStyle(el)
      return { background: cs.backgroundColor, color: cs.color }
    })
    expect(await contrastOf(errorStyles)).toBeGreaterThanOrEqual(4.5)
  })
})
