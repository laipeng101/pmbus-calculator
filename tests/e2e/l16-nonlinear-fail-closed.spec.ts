import { test, expect, type Page } from '@playwright/test'

/**
 * v2.5.2 P1 regression: a non-LINEAR shared VOUT_MODE byte must fail closed
 * on the LINEAR16 page. Part II §8.4 — output-voltage-related commands take
 * their data format from the current VOUT_MODE, so the page must never
 * substitute the default 0x18 behind the user's back. Recovery requires the
 * explicit "应用默认 VOUT_MODE" action, which really writes 0x18.
 * These cases drive the real UI on both desktop and mobile projects.
 */

async function settle(page: Page) {
  await page.goto('/')
  await expect(
    page.locator('#value-input').or(page.locator('.workspace-l16-block')).first(),
  ).toBeVisible()
  await page.evaluate(async () => {
    await document.fonts.ready
  })
}

async function enterL16(page: Page, hex: string, payload: 'ulinear16' | 'slinear16-offset') {
  await page.getByRole('tab', { name: /LINEAR16/ }).click()
  await expect(page.locator('#vout-mode-input')).toBeVisible()
  await page.locator('#vout-mode-input').fill(hex)
  await page.locator('#vout-mode-input').press('Tab')
  await page.locator('#l16-payload-kind').selectOption(payload)
}

function panel(page: Page) {
  return page.locator('[data-testid="quantization-error"]')
}

function rawHex(page: Page) {
  return page.locator('#raw-hex-input')
}

test.describe('L16 non-LINEAR VOUT_MODE fail-closed (v2.5.2)', () => {
  test('0x20 + SLINEAR16 is VID-prohibited: no input, no encode, no word', async ({ page }) => {
    await settle(page)
    await enterL16(page, '20', 'slinear16-offset')

    // Fail closed: no physical-value entry, no pseudo range, no result.
    await expect(page.locator('#value-input')).toHaveCount(0)
    await expect(page.locator('#l16-nominal-vout')).toHaveCount(0)
    await expect(page.locator('.workspace-l16-block')).toBeVisible()
    await expect(page.locator('.workspace-l16-block')).toContainText('禁止')
    await expect(page.locator('.workspace-l16-block')).toContainText('§13.3/§13.4')
    await expect(page.locator('[data-testid="result-value"]')).toContainText('—')
    await expect(page.getByText(/可表示范围/)).toHaveCount(0)
    await expect(panel(page)).toHaveCount(0)

    // The composer shows the ACTUAL shared byte, never a substituted 0x18.
    await expect(page.getByTestId('vout-mode-byte')).toHaveText('0x20')
    await expect(page.getByTestId('vout-mode-source')).toHaveText('非 LINEAR')
    await expect(page.locator('#vout-mode-input')).toHaveValue(/20/i)

    // No implicit fallback channel: raw stays untouched at 0x0000.
    await expect(rawHex(page)).toHaveValue(/0000/i)
  })

  test('0x40 DIRECT and 0x60 IEEE Half never guess N or a profile', async ({ page }) => {
    await settle(page)
    for (const [hex, formatName] of [
      ['40', 'DIRECT'],
      ['60', 'IEEE Half'],
    ] as const) {
      await enterL16(page, hex, 'ulinear16')
      await expect(page.locator('#value-input')).toHaveCount(0)
      await expect(page.locator('.workspace-l16-block')).toContainText(formatName)
      await expect(page.locator('.workspace-l16-block')).toContainText(
        '需要相应 format/profile/coefficients',
      )
      await expect(page.locator('[data-testid="result-value"]')).toContainText('—')
      await expect(page.getByText(/可表示范围/)).toHaveCount(0)
      await expect(page.getByTestId('vout-mode-byte')).toHaveText(`0x${hex}`)
    }
  })

  test('invalid parameters 0x41/0x61 keep the error-level warning', async ({ page }) => {
    await settle(page)
    for (const hex of ['41', '61']) {
      await enterL16(page, hex, 'ulinear16')
      await expect(page.locator('#value-input')).toHaveCount(0)
      const invalidParamAlert = page
        .getByRole('alert')
        .filter({ hasText: '参数必须为 00000b' })
        .first()
      await expect(invalidParamAlert).toBeAttached()
      await expect(invalidParamAlert).toHaveAttribute('data-level', 'error')
      await expect(page.locator('[data-testid="result-value"]')).toContainText('—')
    }
  })

  test('explicit apply of the default byte writes 0x18 and restores encoding', async ({ page }) => {
    await settle(page)
    await enterL16(page, '20', 'slinear16-offset')
    await expect(page.locator('#value-input')).toHaveCount(0)

    // The explicit action really rewrites the shared byte.
    await page.getByRole('button', { name: '应用默认 VOUT_MODE' }).click()
    await expect(page.getByTestId('vout-mode-byte')).toHaveText('0x18')
    await expect(page.getByTestId('vout-mode-source')).toHaveText('已关联')
    await expect(page.locator('#vout-mode-input')).toHaveValue(/18/i)

    // SLINEAR16 input, signed range and the encoding channel are back.
    await expect(page.locator('#value-input')).toBeVisible()
    await expect(page.getByText('-128 ~ 127.99609375')).toBeVisible()
    await page.locator('#value-input').fill('1')
    await page.locator('#value-input').press('Tab')
    await expect(rawHex(page)).toHaveValue(/0100/i)
    await expect(page.locator('[data-testid="result-value"]')).toContainText('1')

    // Quantization readout is back too — exact at this vector.
    await expect(panel(page)).toContainText('0.000000 (0.0000%)')
    // The blocking card is gone.
    await expect(page.locator('.workspace-l16-block')).toHaveCount(0)
  })

  test('calculation walkthrough shows the fail-closed notice without pseudo N', async ({
    page,
  }) => {
    await settle(page)
    await enterL16(page, '40', 'ulinear16')

    await page.locator('[data-testid="calculation-steps-summary"]').first().click()
    const aux = page.getByRole('region', { name: '辅助结果' })
    await expect(aux).toContainText('本页不隐式替换字节')
    await expect(aux).toContainText('§8.4')
    // No LINEAR quantization step and no result step.
    await expect(page.getByText('格式编码量化误差（请求值 − 表示值）')).toHaveCount(0)
  })

  test('no horizontal overflow and keyboard reachability at 360/390/1280', async ({ page }) => {
    for (const viewport of [
      { width: 360, height: 800 },
      { width: 390, height: 844 },
      { width: 1280, height: 900 },
    ]) {
      await page.setViewportSize(viewport)
      await settle(page)
      await enterL16(page, '20', 'slinear16-offset')

      const result = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }))
      expect(result.scrollWidth, `viewport ${viewport.width}`).toBeLessThanOrEqual(
        result.clientWidth,
      )

      // Keyboard: the composer hex input is reachable and the apply button
      // activates from the keyboard after applying.
      await page.locator('#vout-mode-input').focus()
      await page.keyboard.press('Tab')
      const applyButton = page.getByRole('button', { name: '应用默认 VOUT_MODE' })
      await expect(applyButton).toBeAttached()
      await applyButton.focus()
      await page.keyboard.press('Enter')
      await expect(page.getByTestId('vout-mode-byte')).toHaveText('0x18')
    }
  })
})
