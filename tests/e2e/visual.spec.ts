import { test, expect, type Page } from '@playwright/test'

/**
 * Visual scenes are deterministic by construction.
 *
 * The production version badge is correctly injected from package.json, but it
 * changes on every release. That volatile metadata is not a product layout
 * regression, so before any screenshot we (1) assert the real badge is present
 * and SemVer-shaped, then (2) replace only its DOM text with a stable
 * placeholder. We intentionally do NOT mask it: masking would lose the badge's
 * layout and color regression signal. release.spec.ts / deployment.spec.ts keep
 * asserting the real v${pkg.version} contract.
 */
async function normalizeVersionBadge(page: Page) {
  const badge = page.getByTestId('version-badge')
  await expect(badge).toBeVisible()
  await expect(badge).toHaveText(/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/)
  await badge.evaluate((el) => {
    el.textContent = 'v0.0.0-visual'
  })
}

async function settle(page: Page) {
  await page.goto('/')
  await normalizeVersionBadge(page)
  await expect(page.locator('.katex').first()).toBeVisible()
  await page.evaluate(async () => {
    await document.fonts.ready
  })
  await page.waitForTimeout(120)
}

async function fillRaw(page: Page, hex: string) {
  const hexInput = page.locator('input[placeholder="0000"]')
  await hexInput.fill(hex)
  await hexInput.press('Tab')
  await expect(page.locator('.katex').first()).toBeVisible()
  await page.evaluate(async () => {
    await document.fonts.ready
  })
  await page.waitForTimeout(120)
}

async function setHalfStress(page: Page) {
  await page.getByRole('tab', { name: /HALF/ }).click()
  await expect(page.locator('.katex').first()).toBeVisible()
  await fillRaw(page, '8FC3')
}

async function setL11Stress(page: Page) {
  await fillRaw(page, 'A3C1')
}

async function setL16Stress(page: Page) {
  await page.getByRole('tab', { name: /LINEAR16/ }).click()
  await page.locator('#vout-mode-input').fill('13')
  await page.locator('#vout-mode-input').press('Tab')
  await fillRaw(page, '8FC3')
}

async function setDirectStress(page: Page) {
  await page.getByRole('tab', { name: /DIRECT/ }).click()
  await page.getByLabel('DIRECT 系数 r').fill('12')
  await page.getByLabel('DIRECT 系数 r').press('Tab')
  await fillRaw(page, '8FC3')
}

async function switchToVoutMode(page: Page) {
  await page.getByRole('tab', { name: /VOUT_MODE/ }).click()
  await expect(page.locator('#vout-mode-input')).toBeVisible()
  await page.evaluate(async () => {
    await document.fonts.ready
  })
  await page.waitForTimeout(120)
}

test.describe('visual regression (stable scenes)', () => {
  test('desktop dark LINEAR11', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('pmbus-calculator:theme', 'dark'))
    await settle(page)
    await expect(page).toHaveScreenshot('desktop-dark-l11.png', { animations: 'disabled' })
  })

  test('desktop dark LINEAR16', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('pmbus-calculator:theme', 'dark'))
    await settle(page)
    await page.getByRole('tab', { name: /LINEAR16/ }).click()
    await expect(page.locator('.katex').first()).toBeVisible()
    await page.evaluate(async () => {
      await document.fonts.ready
    })
    await page.waitForTimeout(120)
    await expect(page).toHaveScreenshot('desktop-dark-l16.png', { animations: 'disabled' })
  })

  test('desktop dark DIRECT', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('pmbus-calculator:theme', 'dark'))
    await settle(page)
    await page.getByRole('tab', { name: /DIRECT/ }).click()
    await expect(page.locator('.katex').first()).toBeVisible()
    await page.evaluate(async () => {
      await document.fonts.ready
    })
    await page.waitForTimeout(120)
    await expect(page).toHaveScreenshot('desktop-dark-direct.png', { animations: 'disabled' })
  })

  test('desktop dark HALF', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('pmbus-calculator:theme', 'dark'))
    await settle(page)
    await page.getByRole('tab', { name: /HALF/ }).click()
    await expect(page.locator('.katex').first()).toBeVisible()
    await page.evaluate(async () => {
      await document.fonts.ready
    })
    await page.waitForTimeout(120)
    await expect(page).toHaveScreenshot('desktop-dark-half.png', { animations: 'disabled' })
  })

  test('desktop light L11', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('pmbus-calculator:theme', 'light'))
    await settle(page)
    await expect(page).toHaveScreenshot('desktop-light-l11.png', { animations: 'disabled' })
  })

  test('desktop light DIRECT', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('pmbus-calculator:theme', 'light'))
    await settle(page)
    await page.getByRole('tab', { name: /DIRECT/ }).click()
    await expect(page.locator('.katex').first()).toBeVisible()
    await page.evaluate(async () => {
      await document.fonts.ready
    })
    await page.waitForTimeout(120)
    await expect(page).toHaveScreenshot('desktop-light-direct.png', { animations: 'disabled' })
  })

  test('desktop light L16', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('pmbus-calculator:theme', 'light'))
    await settle(page)
    await page.getByRole('tab', { name: /LINEAR16/ }).click()
    await expect(page.locator('.katex').first()).toBeVisible()
    await page.evaluate(async () => {
      await document.fonts.ready
    })
    await page.waitForTimeout(120)
    await expect(page).toHaveScreenshot('desktop-light-l16.png', { animations: 'disabled' })
  })

  test('desktop light HALF', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('pmbus-calculator:theme', 'light'))
    await settle(page)
    await page.getByRole('tab', { name: /HALF/ }).click()
    await expect(page.locator('.katex').first()).toBeVisible()
    await page.evaluate(async () => {
      await document.fonts.ready
    })
    await page.waitForTimeout(120)
    await expect(page).toHaveScreenshot('desktop-light-half.png', { animations: 'disabled' })
  })

  test('desktop dark VOUT_MODE', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('pmbus-calculator:theme', 'dark'))
    await settle(page)
    await switchToVoutMode(page)
    await expect(page).toHaveScreenshot('desktop-dark-vout-mode.png', { animations: 'disabled' })
  })

  test('desktop light VOUT_MODE', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('pmbus-calculator:theme', 'light'))
    await settle(page)
    await switchToVoutMode(page)
    await expect(page).toHaveScreenshot('desktop-light-vout-mode.png', { animations: 'disabled' })
  })

  test('mobile 390 VOUT_MODE', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.addInitScript(() => localStorage.setItem('pmbus-calculator:theme', 'light'))
    await settle(page)
    await switchToVoutMode(page)
    await expect(page).toHaveScreenshot('mobile-390-vout-mode.png', { animations: 'disabled' })
  })

  test('mobile 390 L11', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.addInitScript(() => localStorage.setItem('pmbus-calculator:theme', 'light'))
    await settle(page)
    await expect(page).toHaveScreenshot('mobile-390-l11.png', { animations: 'disabled' })
  })

  test('mobile 390 HALF', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.addInitScript(() => localStorage.setItem('pmbus-calculator:theme', 'light'))
    await settle(page)
    await page.getByRole('tab', { name: /HALF/ }).click()
    await expect(page.locator('.katex').first()).toBeVisible()
    await page.evaluate(async () => {
      await document.fonts.ready
    })
    await page.waitForTimeout(120)
    await expect(page).toHaveScreenshot('mobile-390-half.png', { animations: 'disabled' })
  })

  test('mobile 390 DIRECT', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.addInitScript(() => localStorage.setItem('pmbus-calculator:theme', 'light'))
    await settle(page)
    await page.getByRole('tab', { name: /DIRECT/ }).click()
    await expect(page.locator('.katex').first()).toBeVisible()
    await page.evaluate(async () => {
      await document.fonts.ready
    })
    await page.waitForTimeout(120)
    await expect(page).toHaveScreenshot('mobile-390-direct.png', { animations: 'disabled' })
  })

  test('mobile 360 L11', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 })
    await page.addInitScript(() => localStorage.setItem('pmbus-calculator:theme', 'light'))
    await settle(page)
    await expect(page).toHaveScreenshot('mobile-360-l11.png', { animations: 'disabled' })
  })

  // M39：术语气泡打开状态——触发器虚下划线、浮层完整位于首屏。
  test('desktop light VOUT_MODE 术语气泡打开', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('pmbus-calculator:theme', 'light'))
    await settle(page)
    await switchToVoutMode(page)
    const summary = page.getByTestId('vout-mode-config-summary')
    await summary.getByTestId('term-trigger-vout-mode').click()
    await expect(page.getByTestId('term-popover-vout-mode')).toBeVisible()
    await expect(page.getByTestId('term-popover-vout-mode')).toContainText('输出电压格式配置字节')
    await expect(page).toHaveScreenshot('desktop-light-vout-mode-glossary.png', {
      animations: 'disabled',
    })
  })

  // M39：L16 内嵌 VOUT_MODE 保持两个四位分组（compact 密度）与统一图例。
  test('mobile 390 LINEAR16 内嵌双 nibble', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.addInitScript(() => localStorage.setItem('pmbus-calculator:theme', 'light'))
    await settle(page)
    await page.getByRole('tab', { name: /LINEAR16/ }).click()
    await expect(page.locator('[data-testid="vout-mode-canonical"]')).toBeVisible()
    const grid = page.locator('.bitfield[data-density="compact"]')
    await expect(grid.locator('.bitfield-nibble')).toHaveCount(2)
    await expect(page.locator('.katex').first()).toBeVisible()
    await page.evaluate(async () => {
      await document.fonts.ready
    })
    await page.waitForTimeout(120)
    await expect(page).toHaveScreenshot('mobile-390-l16-embedded.png', { animations: 'disabled' })
  })

  test('mobile 360 HALF', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 })
    await page.addInitScript(() => localStorage.setItem('pmbus-calculator:theme', 'light'))
    await settle(page)
    await page.getByRole('tab', { name: /HALF/ }).click()
    await expect(page.locator('.katex').first()).toBeVisible()
    await page.evaluate(async () => {
      await document.fonts.ready
    })
    await page.waitForTimeout(120)
    await expect(page).toHaveScreenshot('mobile-360-half.png', { animations: 'disabled' })
  })

  test('command reference table (light) — 覆盖表格与 note 列', async ({ page }) => {
    await page.setViewportSize({ width: 950, height: 304 })
    await page.addInitScript(() => localStorage.setItem('pmbus-calculator:theme', 'light'))
    await settle(page)
    await page.locator('#command-reference-toggle').click()
    await expect(page.getByRole('row', { name: /STATUS_WORD/ })).toBeVisible()
    const shell = page.locator('.command-ref-table-shell')
    await shell.scrollIntoViewIfNeeded()
    // 展开容器以便元素截图覆盖整张表格（含说明列），而不是被 viewport 裁剪。
    await shell.evaluate((el: HTMLElement) => {
      el.style.overflow = 'visible'
      el.style.width = 'max-content'
      el.style.maxWidth = 'none'
    })
    await page.waitForTimeout(120)
    await expect(shell).toHaveScreenshot('command-reference-table-light.png', {
      animations: 'disabled',
    })
  })

  test('desktop dark L11 stress', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('pmbus-calculator:theme', 'dark'))
    await settle(page)
    await setL11Stress(page)
    await expect(page).toHaveScreenshot('desktop-dark-l11-stress.png', { animations: 'disabled' })
  })

  test('desktop dark L16 stress', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('pmbus-calculator:theme', 'dark'))
    await settle(page)
    await setL16Stress(page)
    await expect(page).toHaveScreenshot('desktop-dark-l16-stress.png', { animations: 'disabled' })
  })

  test('desktop dark DIRECT stress', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('pmbus-calculator:theme', 'dark'))
    await settle(page)
    await setDirectStress(page)
    await expect(page).toHaveScreenshot('desktop-dark-direct-stress.png', {
      animations: 'disabled',
    })
  })

  test('desktop dark HALF stress', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('pmbus-calculator:theme', 'dark'))
    await settle(page)
    await setHalfStress(page)
    await expect(page).toHaveScreenshot('desktop-dark-half-stress.png', { animations: 'disabled' })
  })

  test('desktop light L11 stress', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('pmbus-calculator:theme', 'light'))
    await settle(page)
    await setL11Stress(page)
    await expect(page).toHaveScreenshot('desktop-light-l11-stress.png', { animations: 'disabled' })
  })

  test('desktop light HALF stress', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('pmbus-calculator:theme', 'light'))
    await settle(page)
    await setHalfStress(page)
    await expect(page).toHaveScreenshot('desktop-light-half-stress.png', { animations: 'disabled' })
  })

  test('mobile 390 L11 stress', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.addInitScript(() => localStorage.setItem('pmbus-calculator:theme', 'light'))
    await settle(page)
    await setL11Stress(page)
    await expect(page).toHaveScreenshot('mobile-390-l11-stress.png', { animations: 'disabled' })
  })

  test('mobile 390 HALF stress', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.addInitScript(() => localStorage.setItem('pmbus-calculator:theme', 'light'))
    await settle(page)
    await setHalfStress(page)
    await expect(page).toHaveScreenshot('mobile-390-half-stress.png', { animations: 'disabled' })
  })

  test('command reference table (dark) — 覆盖表格与 note 列', async ({ page }) => {
    await page.setViewportSize({ width: 950, height: 304 })
    await page.addInitScript(() => localStorage.setItem('pmbus-calculator:theme', 'dark'))
    await settle(page)
    await page.locator('#command-reference-toggle').click()
    await expect(page.getByRole('row', { name: /STATUS_WORD/ })).toBeVisible()
    const shell = page.locator('.command-ref-table-shell')
    await shell.scrollIntoViewIfNeeded()
    await shell.evaluate((el: HTMLElement) => {
      el.style.overflow = 'visible'
      el.style.width = 'max-content'
      el.style.maxWidth = 'none'
    })
    await page.waitForTimeout(120)
    await expect(shell).toHaveScreenshot('command-reference-table-dark.png', {
      animations: 'disabled',
    })
  })
})
