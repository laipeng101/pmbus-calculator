import { test, expect, type Page } from '@playwright/test'

// 版本号随发布变化，保留徽标的位置和样式，只固定截图中的文本。
async function normalizeVersionBadge(page: Page) {
  const badge = page.getByTestId('version-badge')
  await expect(badge).toBeVisible()
  await expect(badge).toHaveText(/^App v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/)
  await badge.evaluate((el) => {
    el.textContent = 'App v0.0.0-visual'
  })
}

async function waitForMathFonts(page: Page) {
  await expect(page.locator('.katex').first()).toBeVisible()
  await page.evaluate(async () => {
    await document.fonts.ready
  })
}

async function openPage(page: Page, theme: 'light' | 'dark') {
  await page.addInitScript((theme) => localStorage.setItem('pmbus-calculator:theme', theme), theme)
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
  await normalizeVersionBadge(page)
  await waitForMathFonts(page)
}

// 移走点击后留在控件上的指针，避免把悬停说明拍进静止画面。
async function parkPointer(page: Page) {
  await page.mouse.move(0, 0)
  await expect(page.locator('[data-testid^="control-tooltip-"]')).toHaveCount(0)
}

async function fillRaw(page: Page, hex: string) {
  const hexInput = page.locator('#raw-hex-input')
  await hexInput.fill(hex)
  await hexInput.press('Tab')
  // 提交输入后释放焦点，截图只比较静止状态。
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await waitForMathFonts(page)
}

async function setHalfStress(page: Page) {
  await page.getByRole('tab', { name: /HALF/ }).click()
  await fillRaw(page, '8FC3')
}

async function setDirectStress(page: Page) {
  await page.getByRole('tab', { name: /DIRECT/ }).click()
  await page.getByLabel('DIRECT 系数 r').fill('12')
  await page.getByLabel('DIRECT 系数 r').press('Tab')
  await fillRaw(page, '8FC3')
  // 编辑系数可能触发焦点滚动，截图始终从页首开始。
  await page.evaluate(() => window.scrollTo(0, 0))
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
}

async function switchToVoutMode(page: Page) {
  await page.getByRole('tab', { name: /VOUT_MODE/ }).click()
  await expect(page.locator('#vout-mode-input')).toBeVisible()
}

test.describe('界面截图比对', () => {
  test('窄屏暗色 VOUT_MODE 收起位映射', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openPage(page, 'dark')
    await switchToVoutMode(page)
    await page.getByTestId('bit-mapping-vout-mode-toggle').click()
    await expect(page.locator('#bit-mapping-vout-mode-content')).toBeHidden()
    await page.evaluate(() => window.scrollTo(0, 0))
    await parkPointer(page)
    await expect(page).toHaveScreenshot('mobile-390-vout-mode-bits-collapsed.png', {
      animations: 'disabled',
    })
  })

  test('桌面浅色 LINEAR11 首屏', async ({ page }) => {
    await openPage(page, 'light')
    await parkPointer(page)
    await expect(page).toHaveScreenshot('desktop-light-l11.png', { animations: 'disabled' })
  })

  test('桌面浅色 VOUT_MODE 打开术语气泡', async ({ page }) => {
    await openPage(page, 'light')
    await switchToVoutMode(page)
    const summary = page.getByTestId('vout-mode-config-summary')
    await summary.getByTestId('term-trigger-vout-mode').click()
    await expect(page.getByTestId('term-popover-vout-mode')).toBeVisible()
    await expect(page.getByTestId('term-popover-vout-mode')).toContainText('输出电压格式配置字节')
    await parkPointer(page)
    await expect(page).toHaveScreenshot('desktop-light-vout-mode-glossary.png', {
      animations: 'disabled',
    })
  })

  test('窄屏浅色 LINEAR16 内嵌位映射', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openPage(page, 'light')
    await page.getByRole('tab', { name: /LINEAR16/ }).click()
    await expect(page.locator('[data-testid="vout-mode-canonical"]')).toBeVisible()
    const grid = page.locator('.bitfield[data-density="compact"]')
    await expect(grid.locator('.bitfield-nibble')).toHaveCount(2)
    await waitForMathFonts(page)
    await parkPointer(page)
    await expect(page).toHaveScreenshot('mobile-390-l16-embedded.png', { animations: 'disabled' })
  })

  test('桌面深色 DIRECT 长值', async ({ page }) => {
    await openPage(page, 'dark')
    await setDirectStress(page)
    await parkPointer(page)
    await expect(page).toHaveScreenshot('desktop-dark-direct-stress.png', {
      animations: 'disabled',
    })
  })

  test('窄屏浅色 HALF 长读数', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openPage(page, 'light')
    await setHalfStress(page)
    await parkPointer(page)
    await expect(page).toHaveScreenshot('mobile-390-half-stress.png', { animations: 'disabled' })
  })

  test('深色命令参考表含备注列', async ({ page }) => {
    await page.setViewportSize({ width: 950, height: 304 })
    await openPage(page, 'dark')
    await page.locator('#command-reference-toggle').click()
    await expect(page.getByRole('row', { name: /STATUS_WORD/ })).toBeVisible()
    const shell = page.locator('.command-ref-table-shell')
    await shell.scrollIntoViewIfNeeded()
    await shell.evaluate((el: HTMLElement) => {
      el.style.overflow = 'visible'
      el.style.width = 'max-content'
      el.style.maxWidth = 'none'
    })
    await parkPointer(page)
    await expect(shell).toHaveScreenshot('command-reference-table-dark.png', {
      animations: 'disabled',
    })
  })
})
