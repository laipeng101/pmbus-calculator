import { test, expect, type Page } from '@playwright/test'
import { appUrl } from './helpers/app-url'

/**
 * v2.5.2/v2.5.3 regressions: a non-LINEAR shared VOUT_MODE byte must fail
 * closed on the LINEAR16 page, and the fail-closed copy must be
 * spec-accurate. Part II §8.4 — output-voltage-related commands take their
 * data format from the current VOUT_MODE, so the page must never substitute
 * the calculator example 0x18 behind the user's back. §8.4.2 — VID is a SUPPORTED
 * output-voltage data format: the page may only say "legal but missing a
 * table/profile", NEVER "output-voltage commands prohibit VID". The spec's
 * own prohibitions are narrow: VOUT_TRIM / VOUT_CAL_OFFSET under VID
 * (§13.3/§13.4) and relative × VID (§8.5.3). Recovery requires the explicit
 * "应用计算器 LINEAR 示例 0x18" action, which really writes 0x18.
 * These cases drive the real UI on both desktop and mobile projects.
 */

async function settle(page: Page) {
  await page.goto(appUrl())
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

function blockCard(page: Page) {
  return page.locator('.workspace-l16-block')
}

function legend(page: Page) {
  return page.locator('.bitfield[data-bit-count="16"] .bitfield-legend')
}

async function expectFailClosedBaseline(page: Page) {
  // No physical-value entry, no pseudo range, no result, no quantization.
  await expect(page.locator('#value-input')).toHaveCount(0)
  await expect(page.locator('#l16-nominal-vout')).toHaveCount(0)
  await expect(page.getByText(/可表示范围/)).toHaveCount(0)
  await expect(panel(page)).toHaveCount(0)
  await expect(page.locator('[data-testid="result-value"]')).toContainText('—')
  // The raw word legend is neutral — it never promises LINEAR16 V/Y.
  await expect(legend(page)).toContainText('未按 LINEAR16 解释')
  await expect(legend(page)).not.toContainText('数值 V [15:0]')
  await expect(legend(page)).not.toContainText('有符号值 Y [15:0]')
}

test.describe('L16 non-LINEAR VOUT_MODE fail-closed + VID scope (v2.5.3)', () => {
  test('0x20 + SLINEAR16 is prohibited per §13.3/§13.4 only — not a global VID ban', async ({
    page,
  }) => {
    await settle(page)
    await enterL16(page, '20', 'slinear16-offset')

    await expectFailClosedBaseline(page)
    // Prohibition named for exactly the two offset commands.
    const card = blockCard(page)
    await expect(card).toBeVisible()
    await expect(card).toContainText('禁止')
    await expect(card).toContainText('§13.3 / §13.4')
    await expect(card).toContainText('VOUT_TRIM / VOUT_CAL_OFFSET')
    await expect(card).toContainText('禁止范围仅限这两条二补码偏移命令')
    // And the over-broad v2.5.2 claim must be gone for good.
    await expect(card).not.toContainText('输出电压相关命令禁止使用 VID')
    await expect(card).not.toContainText('输出电压相关命令禁止使用')
    // Spec-level violation announces an error-level alert next to the card.
    const offsetAlert = page.getByRole('alert').filter({ hasText: '§13.3 / §13.4' }).first()
    await expect(offsetAlert).toBeAttached()
    await expect(offsetAlert).toHaveAttribute('data-level', 'error')

    // The composer shows the ACTUAL shared byte, never a substituted 0x18.
    await expect(page.getByTestId('vout-mode-byte')).toHaveText('0x20')
    await expect(page.getByTestId('vout-mode-source')).toHaveText('非 LINEAR')
    await expect(page.locator('#vout-mode-input')).toHaveValue(/20/i)

    // No implicit fallback channel: raw stays untouched at 0x0000.
    await expect(rawHex(page)).toHaveValue(/0000/i)
  })

  test('0x20 + ULINEAR16: VID is legal but needs a selected table/profile', async ({ page }) => {
    await settle(page)
    await enterL16(page, '20', 'ulinear16')

    await expectFailClosedBaseline(page)
    const card = blockCard(page)
    await expect(card).toContainText('VID 格式')
    // Legal-format wording present…
    await expect(card).toContainText('不是被禁止的数据格式')
    await expect(card).toContainText('§8.4.2')
    await expect(card).toContainText('未选定任何 VID 表或产品 profile')
    // …the historical over-claim absent…
    await expect(card).not.toContainText('输出电压相关命令禁止使用')
    await expect(card).not.toContainText('该命令组合被禁止')
    // …and the InfoPanel keeps calling code 00h what §8.4.2 Table 3 calls it.
    await expect(page.getByRole('alert').filter({ hasText: 'VID code 00h' }).first()).toBeAttached()
  })

  test('0x3E + ULINEAR16: manufacturer-specific VID is legal, mapping from device data', async ({
    page,
  }) => {
    await settle(page)
    await enterL16(page, '3E', 'ulinear16')

    await expectFailClosedBaseline(page)
    const card = blockCard(page)
    await expect(card).toContainText('1Eh — 制造商自定义（需器件资料）')
    await expect(card).toContainText('器件资料')
    await expect(card).not.toContainText('输出电压相关命令禁止使用')
    await expect(card).not.toContainText('保留')
    // The §8.4.2 VID-code note agrees: manufacturer-defined mapping comes
    // from the product literature, and this byte is neither banned nor
    // called reserved.
    await expect(page.getByRole('alert').filter({ hasText: '制造商自定义' }).first()).toBeAttached()
  })

  test('0x40 DIRECT and 0x60 IEEE Half stay fail-closed without guessing N or a profile', async ({
    page,
  }) => {
    await settle(page)
    for (const hex of ['40', '60'] as const) {
      await enterL16(page, hex, 'ulinear16')
      await expectFailClosedBaseline(page)
      const card = blockCard(page)
      await expect(card).toContainText(hex === '40' ? 'DIRECT 格式' : 'IEEE Half 格式')
      if (hex === '40') {
        await expect(card).toContainText('m / b / R')
        await expect(card).toContainText('不猜测系数')
      } else {
        await expect(card).toContainText('本页只实现 LINEAR16 解释')
        await expect(card).toContainText('HALF 模式页')
      }
      await expect(page.getByTestId('vout-mode-byte')).toHaveText(`0x${hex}`)
    }
  })

  test('invalid parameters 0x41/0x61 keep the error-level warning and neutral legend', async ({
    page,
  }) => {
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
      await expect(blockCard(page)).toContainText('无有效解释合同')
      await expect(page.locator('[data-testid="result-value"]')).toContainText('—')
      await expect(legend(page)).toContainText('未按 LINEAR16 解释')
    }
  })

  test('relative VID 0xA0: the byte combination itself is invalid per §8.5.3', async ({ page }) => {
    await settle(page)
    await enterL16(page, 'A0', 'ulinear16')

    await expectFailClosedBaseline(page)
    const card = blockCard(page)
    await expect(card).toContainText('相对 + VID 非法组合')
    await expect(card).toContainText('§8.5.3')
    await expect(card).not.toContainText('输出电压相关命令禁止使用')
    // The existing byte-level error remains.
    const invalidCombination = page.getByRole('alert').filter({ hasText: '§8.5.3' }).first()
    await expect(invalidCombination).toBeAttached()
    await expect(invalidCombination).toHaveAttribute('data-level', 'error')

    // Switching payloads must not turn the invalid byte into a computable
    // signed-offset state either.
    await page.locator('#l16-payload-kind').selectOption('slinear16-offset')
    await expect(blockCard(page)).toContainText('相对 + VID 非法组合')
    await expect(page.locator('#value-input')).toHaveCount(0)
  })

  test('0x18 反词：可见表面不得称规范/器件默认，必须表述为计算器示例（v2.5.7）', async ({
    page,
  }) => {
    await settle(page)
    await enterL16(page, '60', 'ulinear16')
    await expect(blockCard(page)).toBeVisible()

    // 旧按钮文案与自动回退措辞绝不允许出现；「默认」只允许出现在否定免责
    // 语境（不是/并非/不代表）中。扫描范围是承载 0x18 文案的表面：阻断卡、
    // composer 与提示面板（不含无关的字节序提示「默认低字节在前」）。
    const scopeText = (
      await Promise.all([
        page.locator('.workspace-l16-block').innerText(),
        page.locator('.vout-composer').innerText(),
        page.locator('section[aria-label="提示信息"]').innerText(),
      ])
    ).join('\n')
    expect(scopeText).not.toContain('应用默认 VOUT_MODE')
    expect(scopeText).not.toContain('自动回退')
    for (const m of scopeText.matchAll(/默认/g)) {
      const index = m.index ?? 0
      const before = scopeText.slice(Math.max(0, index - 14), index)
      expect(
        before,
        `默认 without negation near: ${scopeText.slice(Math.max(0, index - 20), index + 10)}`,
      ).toMatch(/不是|并非|不代表/)
    }

    // 阻断卡与恢复入口必须使用计算器示例表述并带免责声明。
    await expect(blockCard(page)).toContainText('计算器 LINEAR 示例 0x18')
    await expect(blockCard(page)).toContainText('不是 PMBus 规范默认值')
    await expect(blockCard(page)).toContainText('不代表真实器件一定接受 VOUT_MODE 写入')
    await expect(page.getByRole('button', { name: '应用计算器 LINEAR 示例 0x18' })).toBeVisible()
  })

  test('explicit apply of the calculator example byte writes 0x18 and restores encoding', async ({
    page,
  }) => {
    await settle(page)
    await enterL16(page, '20', 'slinear16-offset')
    await expect(page.locator('#value-input')).toHaveCount(0)

    // The explicit action really rewrites the shared byte.
    await page.getByRole('button', { name: '应用计算器 LINEAR 示例 0x18' }).click()
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
    // The blocking card is gone and the payload legend returns.
    await expect(blockCard(page)).toHaveCount(0)
    await expect(legend(page)).toContainText('有符号值 Y [15:0]')
    await expect(legend(page)).not.toContainText('未按 LINEAR16 解释')
  })

  test('explicit apply also restores absolute ULINEAR16 value input from 0x3E', async ({
    page,
  }) => {
    await settle(page)
    await enterL16(page, '3E', 'ulinear16')
    await expect(page.locator('#value-input')).toHaveCount(0)

    await page.getByRole('button', { name: '应用计算器 LINEAR 示例 0x18' }).click()
    await expect(page.getByTestId('vout-mode-byte')).toHaveText('0x18')
    await expect(page.locator('#value-input')).toBeVisible()
    await expect(legend(page)).toContainText('数值 V [15:0]')
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
      const applyButton = page.getByRole('button', { name: '应用计算器 LINEAR 示例 0x18' })
      await expect(applyButton).toBeAttached()
      await applyButton.focus()
      await page.keyboard.press('Enter')
      await expect(page.getByTestId('vout-mode-byte')).toHaveText('0x18')
    }
  })
})
