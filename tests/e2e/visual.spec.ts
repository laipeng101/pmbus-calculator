import { test, expect, type Page } from '@playwright/test'

async function settle(page: Page) {
  await page.goto('/')
  await expect(page.locator('.katex').first()).toBeVisible()
  await page.evaluate(async () => {
    await document.fonts.ready
  })
  await page.waitForTimeout(120)
}

test.describe('visual regression (M14)', () => {
  test('desktop dark LINEAR11', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('pmbus-calculator:theme', 'dark'))
    await settle(page)
    await expect(page).toHaveScreenshot('m14-desktop-dark-L11.png', { animations: 'disabled' })
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
    await expect(page).toHaveScreenshot('m14-desktop-dark-L16.png', { animations: 'disabled' })
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
    await expect(page).toHaveScreenshot('m14-desktop-dark-DIRECT.png', { animations: 'disabled' })
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
    await expect(page).toHaveScreenshot('m14-desktop-dark-HALF.png', { animations: 'disabled' })
  })

  test('desktop light L11', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('pmbus-calculator:theme', 'light'))
    await settle(page)
    await expect(page).toHaveScreenshot('m14-desktop-light-L11.png', { animations: 'disabled' })
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
    await expect(page).toHaveScreenshot('m14-desktop-light-DIRECT.png', { animations: 'disabled' })
  })

  test('mobile 390 L11', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.addInitScript(() => localStorage.setItem('pmbus-calculator:theme', 'light'))
    await settle(page)
    await expect(page).toHaveScreenshot('m14-mobile-390-L11.png', { animations: 'disabled' })
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
    await expect(page).toHaveScreenshot('m14-mobile-390-HALF.png', { animations: 'disabled' })
  })

  test('950x304 command popup expanded', async ({ page }) => {
    await page.setViewportSize({ width: 950, height: 304 })
    await page.addInitScript(() => localStorage.setItem('pmbus-calculator:theme', 'light'))
    await settle(page)
    await page.locator('#command-picker').click()
    await expect(page.locator('#command-picker-listbox')).toBeVisible()
    await page.waitForTimeout(120)
    await expect(page).toHaveScreenshot('m14-950x304-popup.png', { animations: 'disabled' })
  })

  test('reduced-motion key state', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.addInitScript(() => localStorage.setItem('pmbus-calculator:theme', 'light'))
    await settle(page)
    await expect(page).toHaveScreenshot('m14-reduced-motion-L11.png', { animations: 'disabled' })
  })
})
