import { test, expect, type Page } from '@playwright/test'

/**
 * v2.5.4: legal IEEE Half VOUT_MODE bytes (0x60 absolute / 0xE0 relative) are
 * standard IEEE 754 binary16 (Part II §7.6 / §8.4.4). Their word↔value
 * conversion never depends on device m/b/R coefficients, a VID table or a
 * product profile — so NO user-visible surface may claim otherwise. Only a
 * relative byte needs a VOUT_COMMAND nominal reference (§8.5.2). DIRECT
 * (0x40/0xC0) genuinely needs device m/b/R (§7.4). The matrix drives the real
 * standalone VOUT_MODE page plus the L16 fail-closed card, on both desktop and
 * mobile projects.
 *
 * v2.5.5: surfaces are captured and asserted INDIVIDUALLY — the helper below
 * returns a per-surface record instead of one concatenated string, so a claim
 * present on only one surface can never satisfy another surface's check.
 */

const HALF_BANNED = ['需器件资料', '器件 Profile', 'm/b/R', 'DIRECT 系数', '设备数据']

/** Every user-visible VOUT_MODE-page surface, kept separate. */
interface VoutModeSurfaces {
  /** Config summary line (absent on some L16 states). */
  summary: string | null
  /** Canonical status chip. */
  status: string
  /** Canonical byte/binary block. */
  canonical: string
  /** InfoPanel alerts (each element individually). */
  alerts: string[]
  /** Structured explanation list. */
  explanations: string
  /** Calculation steps panel. */
  steps: string
}

async function settle(page: Page) {
  await page.goto('/')
  await page.evaluate(async () => {
    await document.fonts.ready
  })
  await page.waitForTimeout(80)
}

async function switchToVoutMode(page: Page) {
  await page.getByRole('tab', { name: /VOUT_MODE/ }).click()
  await expect(page.getByTestId('vout-mode-canonical')).toBeVisible()
}

async function setVoutModeByte(page: Page, hex: string) {
  const input = page.locator('#vout-mode-input')
  await input.fill(hex)
  await input.press('Tab')
  await expect(page.getByTestId('vout-mode-byte')).toHaveText(`0x${hex}`)
}

async function expandDetails(page: Page) {
  // Expand the explanation list and the calculation walkthrough so every
  // collapsed surface is covered by the copy assertions below. Idempotent:
  // clicking an already-open disclosure would close it again.
  for (const details of [
    page.locator('.vout-explanations-details'),
    page.locator('[data-testid="calculation-steps-disclosure"]'),
  ]) {
    const open = await details.evaluate((el) => (el as HTMLDetailsElement).open)
    if (!open) await details.locator('summary').click()
  }
  await expect(page.locator('[data-testid="calculation-steps"]')).toBeVisible()
}

async function visibleSurfaces(page: Page): Promise<VoutModeSurfaces> {
  const summary = page.getByTestId('vout-mode-config-summary')
  const summaryText = (await summary.count()) > 0 ? await summary.innerText() : null
  const status = await page.getByTestId('vout-mode-status').innerText()
  const canonical = await page.getByTestId('vout-mode-canonical').innerText()
  const alerts: string[] = []
  const alertLocators = page.getByRole('alert')
  const alertCount = await alertLocators.count()
  for (let i = 0; i < alertCount; i++) {
    alerts.push(await alertLocators.nth(i).innerText())
  }
  const explanations = page.locator('.vout-explanations-details')
  const explanationText = (await explanations.count()) > 0 ? await explanations.innerText() : ''
  const steps = page.getByTestId('calculation-steps')
  const stepsText = (await steps.count()) > 0 ? await steps.innerText() : ''
  return {
    summary: summaryText,
    status,
    canonical,
    alerts,
    explanations: explanationText,
    steps: stepsText,
  }
}

function surfaceEntries(surfaces: VoutModeSurfaces): Array<[string, string]> {
  return [
    ['summary', surfaces.summary ?? ''],
    ['status', surfaces.status],
    ['canonical', surfaces.canonical],
    ...surfaces.alerts.map((a, i): [string, string] => [`alert#${i}`, a]),
    ['explanations', surfaces.explanations],
    ['steps', surfaces.steps],
  ]
}

/** Per-surface banned-copy check: each surface must pass on its own. */
function expectNoHalfProfileCopy(surface: string, label: string) {
  for (const banned of HALF_BANNED) {
    expect(surface, `${label} unexpected copy: ${banned}`).not.toContain(banned)
  }
}

function expectNoHalfProfileCopyEverywhere(surfaces: VoutModeSurfaces, label: string) {
  for (const [name, text] of surfaceEntries(surfaces)) {
    expectNoHalfProfileCopy(text, `${label} ${name}:`)
  }
}

/**
 * Named surfaces must contain all the fragments. For 'alerts' the check is
 * "at least one alert carries every fragment" (unrelated alerts may coexist);
 * every other named surface is checked on its own. Banned-copy checks above
 * still run per individual alert.
 */
function expectSurfacesContain(
  surfaces: VoutModeSurfaces,
  names: string[],
  fragments: string[],
  label: string,
) {
  const entries = surfaceEntries(surfaces)
  for (const name of names) {
    if (name === 'alerts') {
      const alertTexts = entries.filter(([n]) => n.startsWith('alert#')).map(([, t]) => t)
      const carrier = alertTexts.find((t) => fragments.every((f) => t.includes(f)))
      expect(
        carrier,
        `${label} no single alert carries all of: ${fragments.join(', ')}`,
      ).toBeDefined()
      continue
    }
    const text = entries.find(([n]) => n === name)?.[1] ?? ''
    for (const fragment of fragments) {
      expect(text, `${label} ${name} missing: ${fragment}`).toContain(fragment)
    }
  }
}

test.describe('v2.5.4 standalone VOUT_MODE page — IEEE Half vs DIRECT requirement matrix', () => {
  test('0x60 absolute Half: every surface states standard binary16 without profile copy', async ({
    page,
  }) => {
    await settle(page)
    await switchToVoutMode(page)
    await setVoutModeByte(page, '60')
    await expandDetails(page)

    await expect(page.getByTestId('vout-mode-status')).toHaveText('IEEE Half（标准 binary16）')
    await expect(page.getByTestId('vout-mode-canonical')).toContainText('0b01100000')
    const surfaces = await visibleSurfaces(page)
    expectNoHalfProfileCopyEverywhere(surfaces, '0x60')
    // Per-surface positive statements — each surface on its own.
    expectSurfacesContain(surfaces, ['explanations', 'steps'], ['标准 IEEE 754 binary16'], '0x60')
    expectSurfacesContain(surfaces, ['steps'], ['§7.6', 'HALF 模式页'], '0x60')
    expectSurfacesContain(surfaces, ['alerts'], ['§8.4.4'], '0x60')
    // Absolute Half needs no nominal reference, on any surface.
    expect(surfaces.status).not.toContain('标称参考值')
    expect(surfaces.explanations).not.toContain('标称参考值')
    expect(surfaces.steps).not.toContain('标称参考值')
    for (const alert of surfaces.alerts) expect(alert).not.toContain('标称参考值')

    // The half-standard warning is informational (warning level), never an
    // error: the byte is a legal configuration.
    const halfAlert = page.getByRole('alert').filter({ hasText: '§8.4.4' }).first()
    await expect(halfAlert).toBeAttached()
    await expect(halfAlert).toHaveAttribute('data-level', 'warning')
  })

  test('0xE0 relative Half: nominal reference only — still no profile copy', async ({ page }) => {
    await settle(page)
    await switchToVoutMode(page)
    await setVoutModeByte(page, 'E0')
    await expandDetails(page)

    await expect(page.getByTestId('vout-mode-status')).toHaveText('相对 IEEE Half（需参考值）')
    const surfaces = await visibleSurfaces(page)
    expectNoHalfProfileCopyEverywhere(surfaces, '0xE0')
    expectSurfacesContain(surfaces, ['status'], ['需参考值'], '0xE0')
    expectSurfacesContain(
      surfaces,
      ['explanations', 'steps'],
      ['标准 IEEE 754 binary16', '标称参考值', '§8.5.2'],
      '0xE0',
    )
  })

  test('0x40/0xC0 DIRECT: device m/b/R requirement stays; relative adds the reference', async ({
    page,
  }) => {
    await settle(page)
    await switchToVoutMode(page)

    await setVoutModeByte(page, '40')
    await expandDetails(page)
    await expect(page.getByTestId('vout-mode-status')).toHaveText('绝对 DIRECT（需 m/b/R 系数）')
    const absolute = await visibleSurfaces(page)
    expectSurfacesContain(absolute, ['alerts', 'explanations', 'steps'], ['m/b/R', '§7.4'], '0x40')
    for (const surface of [absolute.status, absolute.explanations, absolute.steps]) {
      expect(surface, '0x40 must not need a nominal reference').not.toContain('标称参考值')
    }

    await setVoutModeByte(page, 'C0')
    await expandDetails(page)
    await expect(page.getByTestId('vout-mode-status')).toHaveText('相对 DIRECT（需系数与参考值）')
    const relative = await visibleSurfaces(page)
    // The InfoPanel alert ITSELF must state both the coefficients and the
    // nominal reference — not one of them split across other surfaces.
    const coeffAlert = relative.alerts.find((a) => a.includes('m/b/R'))
    expect(coeffAlert, '0xC0 InfoPanel alert with m/b/R').toBeDefined()
    expect(coeffAlert, '0xC0 InfoPanel alert must also carry the nominal reference').toContain(
      '标称参考值',
    )
    expect(coeffAlert, '0xC0 InfoPanel alert cites §8.5.2').toContain('§8.5.2')
    expectSurfacesContain(relative, ['explanations', 'steps'], ['m/b/R', '标称参考值'], '0xC0')
  })

  test('0x61/0xE1: parameter-invalid error is preserved and no requirement branch fires', async ({
    page,
  }) => {
    await settle(page)
    await switchToVoutMode(page)
    for (const hex of ['61', 'E1']) {
      await setVoutModeByte(page, hex)
      await expandDetails(page)
      await expect(page.getByTestId('vout-mode-status')).toContainText('参数必须为 0')
      const invalid = page.getByRole('alert').filter({ hasText: '00000b' }).first()
      await expect(invalid).toBeAttached()
      await expect(invalid).toHaveAttribute('data-level', 'error')
      const surfaces = await visibleSurfaces(page)
      expectNoHalfProfileCopyEverywhere(surfaces, `0x${hex}`)
      // No requirement branch fires on any surface.
      for (const text of [surfaces.status, surfaces.explanations, surfaces.steps]) {
        expect(text, `0x${hex}`).not.toContain('标准 IEEE 754 binary16')
      }
    }
  })

  test('keyboard: the Half byte is reachable and editable through the hex input alone', async ({
    page,
  }) => {
    await settle(page)
    await switchToVoutMode(page)
    await page.locator('#vout-mode-input').focus()
    await page.keyboard.insertText('60')
    await page.keyboard.press('Tab') // HexInput commits on blur (Tab), not Enter
    await expect(page.getByTestId('vout-mode-byte')).toHaveText('0x60')
    await expect(page.getByTestId('vout-mode-status')).toHaveText('IEEE Half（标准 binary16）')

    // And back to the default LINEAR byte through the keyboard.
    await page.locator('#vout-mode-input').focus()
    await page.keyboard.insertText('18')
    await page.keyboard.press('Tab')
    await expect(page.getByTestId('vout-mode-byte')).toHaveText('0x18')
  })

  test('no horizontal overflow at 1280/390/360 with the Half byte active', async ({ page }) => {
    await settle(page)
    await switchToVoutMode(page)
    for (const viewport of [
      { width: 1280, height: 900 },
      { width: 390, height: 844 },
      { width: 360, height: 800 },
    ]) {
      await page.setViewportSize(viewport)
      await setVoutModeByte(page, '60')
      await expandDetails(page)
      const result = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }))
      expect(result.scrollWidth, `viewport ${viewport.width}`).toBeLessThanOrEqual(
        result.clientWidth,
      )
    }
  })
})

test.describe('v2.5.4 L16 page — IEEE Half block card never claims a profile', () => {
  test('0x60/0xE0 fail closed and point at the HALF page without banned copy', async ({ page }) => {
    await settle(page)
    await page.getByRole('tab', { name: /LINEAR16/ }).click()
    await expect(page.locator('#vout-mode-input')).toBeVisible()

    for (const hex of ['60', 'E0'] as const) {
      await page.locator('#vout-mode-input').fill(hex)
      await page.locator('#vout-mode-input').press('Tab')
      await expect(page.getByTestId('vout-mode-byte')).toHaveText(`0x${hex}`)

      // Fail-closed baseline unchanged (v2.5.2).
      await expect(page.locator('#value-input')).toHaveCount(0)
      await expect(page.locator('[data-testid="result-value"]')).toContainText('—')
      const card = page.locator('.workspace-l16-block')
      await expect(card).toContainText('IEEE Half 是合法的输出电压数据格式')
      await expect(card).toContainText('HALF 模式页')
      // The v2.5.3 L16 card was already correct — pin it against regression.
      expectNoHalfProfileCopy(await card.innerText(), `L16 block card 0x${hex}`)

      // The InfoPanel warning for the shared byte must not smuggle profile
      // copy in either.
      const alerts = page.getByRole('alert')
      const alertText = await alerts.allInnerTexts()
      expectNoHalfProfileCopy(alertText.join('\n'), `L16 alerts 0x${hex}`)
    }
  })
})

test.describe('v2.5.5 VOUT_MODE legality — structural validity is separate from calculability', () => {
  test('0x3E/0x3F carry no illegal alert marker and keep the device-data warning', async ({
    page,
  }) => {
    await settle(page)
    await switchToVoutMode(page)
    for (const hex of ['3E', '3F'] as const) {
      await setVoutModeByte(page, hex)
      await expandDetails(page)

      // Structurally legal: no alert marker on the config summary and no
      // alert class on the canonical status chip.
      await expect(page.getByTestId('vout-mode-status')).toHaveText(
        'VID code 制造商自定义（需器件资料）',
      )
      await expect(page.getByTestId('vout-mode-config-summary')).not.toHaveAttribute(
        'data-alert',
        /.*/,
      )
      await expect(page.getByTestId('vout-mode-status')).not.toHaveClass(
        /vout-canonical-status-alert/,
      )

      // Still needs the device datasheet: explicit warning remains.
      const profileAlert = page.getByRole('alert').filter({ hasText: '器件资料' }).first()
      await expect(profileAlert).toBeAttached()
      await expect(profileAlert).toHaveAttribute('data-level', 'warning')

      // Never described as reserved or illegal; each surface keeps its own
      // manufacturer-specific branch wording.
      const surfaces = await visibleSurfaces(page)
      expectSurfacesContain(surfaces, ['explanations', 'steps'], ['制造商自定义'], hex)
      for (const [name, text] of surfaceEntries(surfaces)) {
        expect(text, `${hex} ${name} must not say illegal/reserved`).not.toContain('非法')
        expect(text, `${hex} ${name} must not say illegal/reserved`).not.toContain('保留')
      }

      // Normalize must not rewrite a legal manufacturer-specific byte.
      const before = await page.getByTestId('vout-mode-byte').innerText()
      const normalize = page.getByRole('button', { name: /规范化|Normalize/ })
      if ((await normalize.count()) > 0) {
        await normalize.click()
        await expect(page.getByTestId('vout-mode-byte')).toHaveText(before)
      }
    }
  })

  test('negative examples keep their non-usable classification', async ({ page }) => {
    await settle(page)
    await switchToVoutMode(page)

    // 00h Not Used, a Table-3-LISTED reserved code (04h Intel, v2.5.6) and
    // an unlisted reserved code (25h): not valid profiles, but listed codes
    // must state their listing and never read "未列出".
    for (const [hex, expected] of [
      ['20', 'VID code 00h — 未使用'],
      ['21', 'VID code 保留（Table 3 明列，留给未来 Intel 处理器）'],
      ['24', 'VID code 保留（Table 3 明列，留给未来 Intel 处理器）'],
      ['25', 'VID code 保留（Table 3 未列出，保留供未来使用）'],
    ] as const) {
      await setVoutModeByte(page, hex)
      await expect(page.getByTestId('vout-mode-status')).toContainText(expected)
      if (hex === '21' || hex === '24') {
        // Listed-reserved provenance: the listing must be stated and
        // "未列出" must not appear anywhere in the surfaces.
        await expect(page.getByTestId('vout-mode-status')).not.toContainText('未列出')
        const alert = page.getByRole('alert').filter({ hasText: 'VID code' }).first()
        await expect(alert).toBeAttached()
        await expect(alert).not.toContainText('未列出')
      }
      await expect(page.getByTestId('vout-mode-config-summary')).toHaveAttribute(
        'data-alert',
        'true',
      )
    }

    // Relative + VID stays an invalid combination (§8.5.3).
    await setVoutModeByte(page, 'A0')
    await expect(page.getByTestId('vout-mode-status')).toContainText('非法组合')
    await expect(page.getByRole('alert').filter({ hasText: '非法组合' }).first()).toHaveAttribute(
      'data-level',
      'error',
    )

    // Absolute DIRECT is legal and needs m/b/R; Half parameter error stays.
    await setVoutModeByte(page, '40')
    await expect(page.getByTestId('vout-mode-config-summary')).not.toHaveAttribute(
      'data-alert',
      /.*/,
    )
    await setVoutModeByte(page, '61')
    await expect(page.getByTestId('vout-mode-status')).toContainText('参数必须为 0')
    await expect(page.getByTestId('vout-mode-config-summary')).toHaveAttribute('data-alert', 'true')
  })

  test('L16 page 0x3E fails closed as legal-but-profile-missing, never illegal', async ({
    page,
  }) => {
    await settle(page)
    await page.getByRole('tab', { name: /LINEAR16/ }).click()
    await expect(page.locator('#vout-mode-input')).toBeVisible()
    await page.locator('#vout-mode-input').fill('3E')
    await page.locator('#vout-mode-input').press('Tab')
    await expect(page.getByTestId('vout-mode-byte')).toHaveText('0x3E')

    await expect(page.locator('#value-input')).toHaveCount(0)
    await expect(page.locator('[data-testid="result-value"]')).toContainText('—')
    const card = page.locator('.workspace-l16-block')
    await expect(card).toContainText('制造商自定义')
    await expect(card).toContainText('器件资料')
    await expect(card).not.toContainText('非法')
  })
})
