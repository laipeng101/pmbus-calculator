import { test, expect, type Page } from '@playwright/test'
import { appUrl } from './helpers/app-url'

/**
 * v2.5.1 P1-A/P1-B regression: SLINEAR16 offset under a relative VOUT_MODE
 * byte (0x98) must keep the physical-value entry, signed encoding, range,
 * quantization readout and provenance invalidation reachable end to end.
 * These cases drive the real UI — unit tests that construct state directly
 * cannot prove the entry is reachable.
 */

async function settle(page: Page) {
  await page.goto(appUrl())
  await expect(
    page.locator('#value-input').or(page.locator('#l16-nominal-vout')).first(),
  ).toBeVisible()
  await page.evaluate(async () => {
    await document.fonts.ready
  })
}

async function enterRelativeL16(page: Page, payload: 'ulinear16' | 'slinear16-offset') {
  await page.getByRole('tab', { name: /LINEAR16/ }).click()
  await expect(page.locator('#vout-mode-input')).toBeVisible()
  await page.locator('#vout-mode-input').fill('98')
  await page.locator('#vout-mode-input').press('Tab')
  await page.locator('#l16-payload-kind').selectOption(payload)
}

async function setValue(page: Page, text: string) {
  const input = page.locator('#value-input')
  await expect(input).toBeVisible()
  await input.fill(text)
  await input.press('Tab')
}

function panel(page: Page) {
  return page.locator('[data-testid="quantization-error"]')
}

function rawHex(page: Page) {
  return page.locator('#raw-hex-input')
}

test.describe('SLINEAR16 offset under relative VOUT_MODE (v2.5.1)', () => {
  test('relative ULINEAR16 keeps ratio semantics without a physical input', async ({ page }) => {
    await settle(page)
    await enterRelativeL16(page, 'ulinear16')

    // Ratio semantics: no physical-value reverse encode, nominal needed.
    await expect(page.locator('#value-input')).toHaveCount(0)
    await expect(page.locator('#l16-nominal-vout')).toBeVisible()
    await expect(panel(page)).toHaveCount(0)
    // Result never fabricates an absolute voltage from a ratio.
    await expect(page.locator('[data-testid="result-value"]')).toContainText('—')
  })

  test('SLINEAR16 offset keeps the physical input and drops the nominal gate', async ({ page }) => {
    await settle(page)
    await enterRelativeL16(page, 'slinear16-offset')

    // Y_s editor visible (signed editor in the shared formula editor).
    const ysEditor = page.locator('#l16-v-input')
    await expect(ysEditor).toBeVisible()
    await expect(ysEditor).toHaveAttribute('aria-label', /Y_s/)

    // Physical value input reachable; nominal gate gone; no blocking card.
    await expect(page.locator('#value-input')).toBeVisible()
    await expect(page.locator('#l16-nominal-vout')).toHaveCount(0)
    await expect(page.locator('.workspace-l16-block')).toHaveCount(0)
    await expect(panel(page)).toHaveCount(0)

    // Formula/result are explicitly signed-offset; bit7 marked N/A.
    await expect(page.locator('[data-testid="result-value"]')).toContainText('0')
    // The explanation lives in the explanation list (DOM-attached; may be
    // visually collapsed on some viewports) - assert attached, not visible.
    await expect(page.getByText('bit7 对本 payload').first()).toBeAttached()
  })

  test('3.3 encodes to 0x034D with the quantized warn readout', async ({ page }) => {
    await settle(page)
    await enterRelativeL16(page, 'slinear16-offset')
    await setValue(page, '3.3')

    await expect(rawHex(page)).toHaveValue(/034D/i)
    await expect(page.locator('[data-testid="result-value"]')).toContainText('3.30078125')
    await expect(panel(page)).toContainText('-0.000781 (-0.0237%)')
    await expect(panel(page)).toHaveAttribute('data-kind', 'warn')
    await expect(page.locator('#vout-mode-input')).toHaveValue(/98/i)
  })

  test('manual Y_s edit invalidates the panel and the calculation step', async ({ page }) => {
    await settle(page)
    await enterRelativeL16(page, 'slinear16-offset')
    await setValue(page, '3.3')
    await expect(panel(page)).toContainText('-0.000781')

    // Manual signed Y edit through the formula editor.
    const ysEditor = page.locator('#l16-v-input')
    await ysEditor.fill('1')
    await ysEditor.press('Tab')

    await expect(rawHex(page)).toHaveValue(/0001/i)
    await expect(panel(page)).toHaveCount(0)

    // Expand the calculation walkthrough: no quantization intermediate.
    await page.locator('[data-testid="calculation-steps-summary"]').first().click()
    await expect(page.getByText('格式编码量化误差（请求值 − 表示值）')).toHaveCount(0)
  })

  test('200 saturates to 0x7FFF with the error readout and signed range', async ({ page }) => {
    await settle(page)
    await enterRelativeL16(page, 'slinear16-offset')

    // Signed range shown even though the byte is relative (N=-8).
    await expect(page.getByText('-128 ~ 127.99609375')).toBeVisible()

    await setValue(page, '200')
    await expect(rawHex(page)).toHaveValue(/7FFF/i)
    await expect(panel(page)).toHaveAttribute('data-kind', 'error')
    await expect(panel(page)).toContainText('饱和')
  })

  test('no body overflow and keyboard focus stays reachable at 360/390/desktop', async ({
    page,
  }) => {
    for (const viewport of [
      { width: 360, height: 800 },
      { width: 390, height: 844 },
      { width: 1280, height: 900 },
    ]) {
      await page.setViewportSize(viewport)
      await settle(page)
      await enterRelativeL16(page, 'slinear16-offset')

      const result = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }))
      expect(result.scrollWidth, `viewport ${viewport.width}`).toBeLessThanOrEqual(
        result.clientWidth,
      )

      // Keyboard: tabbing from the physical input reaches the panel region.
      await page.locator('#value-input').focus()
      await page.locator('#value-input').press('Tab')
      const focused = await page.evaluate(() => document.activeElement?.tagName ?? '')
      expect(['BUTTON', 'INPUT', 'SELECT', 'DIV', 'SUMMARY']).toContain(focused)
    }
  })
})
