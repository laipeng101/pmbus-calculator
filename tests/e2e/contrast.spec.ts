import { test, expect, type Locator, type Page } from '@playwright/test'

async function openWithTheme(page: Page, theme: 'light' | 'dark') {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
  await page.goto('./')
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
}

async function readContrast(locator: Locator) {
  return locator.evaluate((el) => {
    const cs = getComputedStyle(el)
    const ancestorBackgrounds: string[] = []
    for (let node: Element | null = el; node; node = node.parentElement) {
      const style = getComputedStyle(node)
      // This color calculation covers solid/transparent surfaces. Fail if a
      // visual effect needs a different measurement instead of reporting green.
      if (
        style.backgroundImage !== 'none' ||
        style.opacity !== '1' ||
        style.mixBlendMode !== 'normal'
      ) {
        throw new Error(`Unsupported contrast surface: ${node.tagName}`)
      }
      if (node !== el) ancestorBackgrounds.unshift(style.backgroundColor)
    }
    return { background: cs.backgroundColor, color: cs.color, ancestorBackgrounds }
  })
}

function contrastOf(rgb: {
  background: string
  color: string
  ancestorBackgrounds: string[]
}): number {
  // Composite from the browser canvas towards the label, including the
  // alpha of transparent ancestors and of the foreground itself.
  let background: [number, number, number] = [255, 255, 255]
  for (const layer of [...rgb.ancestorBackgrounds, rgb.background]) {
    background = composite(parseRgba(layer), background)
  }
  const foreground = composite(parseRgba(rgb.color), background)
  const l1 = luminance(background)
  const l2 = luminance(foreground)
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}

function parseRgba(value: string): [number, number, number, number] {
  const match = value.match(/rgba?\(([^)]+)\)/)
  if (match == null) throw new Error(`Unsupported computed color: ${value}`)
  const parts = match[1].split(',').map((n) => parseFloat(n.trim()))
  return [parts[0], parts[1], parts[2], parts[3] ?? 1]
}

function composite(
  [r, g, b, alpha]: [number, number, number, number],
  background: [number, number, number],
): [number, number, number] {
  return [
    r * alpha + background[0] * (1 - alpha),
    g * alpha + background[1] * (1 - alpha),
    b * alpha + background[2] * (1 - alpha),
  ]
}

function luminance(rgb: [number, number, number]): number {
  const linear = rgb.map((v) => {
    const s = v / 255
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * (linear[0] ?? 0) + 0.7152 * (linear[1] ?? 0) + 0.0722 * (linear[2] ?? 0)
}

async function expectContrast(label: Locator, description: string) {
  await expect(label).toBeVisible()
  const colors = await readContrast(label)
  expect
    .soft(contrastOf(colors), `${description}: ${JSON.stringify(colors)}`)
    .toBeGreaterThanOrEqual(4.5)
}

for (const theme of ['light', 'dark'] as const) {
  const label = theme === 'light' ? '浅色' : '暗色'
  test(`${label}主题的结果标签和控件达到 4.5:1 对比度`, async ({ page }) => {
    await openWithTheme(page, theme)
    const themeButton = page.getByRole('button', { name: /当前主题/ })
    const prefix = page.getByRole('button', { name: '0x 前缀', exact: true })

    await expectContrast(themeButton, '主题切换按钮')
    await expect(prefix).toHaveAttribute('aria-pressed', 'true')
    await expectContrast(prefix, '已选 0x 前缀')
    await prefix.click()
    await expect(prefix).toHaveAttribute('aria-pressed', 'false')
    await page.mouse.move(0, 0)
    await expectContrast(prefix, '未选 0x 前缀')

    for (const width of [1440, 360]) {
      await page.setViewportSize({ width, height: 900 })
      for (const mode of ['LINEAR11', 'LINEAR16', 'DIRECT', 'HALF', 'VOUT_MODE']) {
        const tab = page.getByRole('tab', { name: new RegExp(mode) })
        await tab.click()
        await expect(tab).toHaveAttribute('aria-selected', 'true')
        await page.mouse.move(0, 0)
        await expectContrast(tab, `${width} px ${mode} 已选标签`)

        const labels = page.locator(
          'h3, [data-testid="result-tile"] > :first-child, [data-testid="result-context"] dt, [data-testid="result-context"] dd',
        )
        expect(await labels.count()).toBeGreaterThan(1)
        for (const label of await labels.all()) {
          await expectContrast(label, `${width} px ${mode} ${await label.textContent()}`)
        }
      }
    }
  })
}

test('暗色主题下已选的指数、尾数和符号位达到 4.5:1 对比度', async ({ page }) => {
  await openWithTheme(page, 'dark')
  for (const [bit, region] of [
    [15, 'LINEAR11 指数'],
    [0, 'LINEAR11 尾数'],
  ] as const) {
    await page.getByRole('button', { name: `位 ${bit}: 0`, exact: true }).click()
    await page.mouse.move(0, 0)
    const button = page.getByRole('button', { name: `位 ${bit}: 1`, exact: true })
    await expect(button).toHaveAttribute('aria-pressed', 'true')
    await expectContrast(button.locator('div').first(), region)
  }

  await page.getByRole('tab', { name: /HALF/ }).click()
  const sign = page.getByRole('button', { name: '位 15: 1', exact: true })
  await expect(sign).toHaveAttribute('aria-pressed', 'true')
  await expectContrast(sign.locator('div').first(), 'HALF 符号')
})

test('暗色主题下复制成功及失败反馈达到 4.5:1 对比度', async ({ page }) => {
  await openWithTheme(page, 'dark')
  const button = page.getByRole('button', { name: 'Raw Word Hex', exact: true })
  const status = page.locator('.copy-feedback')

  for (const [reject, text] of [
    [false, '已复制: Raw Word Hex'],
    [true, '复制失败'],
  ] as const) {
    await page.evaluate((shouldReject) => {
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          writeText: async () => {
            if (shouldReject) throw new Error('denied')
          },
        },
        configurable: true,
      })
    }, reject)
    await button.click()
    await expect(status).toHaveAttribute('role', 'status')
    await expect(status).toHaveAttribute('aria-live', 'polite')
    await expect(status).toContainText(text)
    await expectContrast(status, text)
  }
})
