import { test, expect, type Page } from '@playwright/test'
import { expectNoHorizontalOverflow } from './helpers/layout'

async function openComposer(page: Page, mode: 'LINEAR16' | 'VOUT_MODE') {
  await page.goto('./')
  await page.getByRole('tab', { name: new RegExp(mode) }).click()
  await expect(page.getByTestId('vout-mode-canonical')).toBeVisible()
}

const CANONICAL = '[data-testid="vout-mode-canonical"]'
const STATUS = '[data-testid="vout-mode-status"]'
const L16_N = '#l16-n-input'

test.describe('LINEAR11 指数编辑器', () => {
  test('指数位于底数右上方，编辑与锁定保持位置', async ({ page }) => {
    await page.goto('./')
    await expect(page.getByTestId('power-base')).toBeVisible()
    await page.evaluate(() => document.fonts.ready)

    async function boxes() {
      return page.evaluate(() => {
        const b = document.querySelector('[data-testid="power-base"]')!.getBoundingClientRect()
        const o = document.querySelector('[data-testid="linear-op"]')!.getBoundingClientRect()
        const e = document.querySelector('[data-testid="power-exponent"]')!.getBoundingClientRect()
        const l = document.querySelector('.power-lock')!.getBoundingClientRect()
        return {
          bLeft: b.left,
          bTop: b.top,
          bRight: b.right,
          oLeft: o.left,
          oTop: o.top,
          eLeft: e.left,
          eRight: e.right,
          eBottom: e.bottom,
          lLeft: l.left,
        }
      })
    }

    // 解锁 N 后可编辑
    await page.getByRole('button', { name: 'N 已锁定（自动）' }).click()
    const nInput = page.getByLabel('N 值 (指数)')
    await expect(nInput).toBeEnabled()

    const bLefts: number[] = []
    const bTops: number[] = []
    const oLefts: number[] = []
    const oTops: number[] = []
    for (const n of ['-1', '-16', '15']) {
      await nInput.fill(n)
      await nInput.press('Tab')
      const g = await boxes()
      // N 位于底数 2 上方、右侧区域：指数槽左边缘从底数右边缘开始（±2px 容差）
      expect(g.eBottom, 'exponent above base').toBeLessThanOrEqual(g.bTop + 4)
      expect(g.eLeft, 'exponent left aligns with base right').toBeGreaterThanOrEqual(g.bRight - 2)
      expect(g.eRight, 'exponent reaches right edge of base').toBeGreaterThanOrEqual(g.bRight)
      // 锁按钮在独立槽，不覆盖指数
      expect(g.eRight, 'exponent clears lock button').toBeLessThanOrEqual(g.lLeft)
      bLefts.push(g.bLeft)
      bTops.push(g.bTop)
      oLefts.push(g.oLeft)
      oTops.push(g.oTop)
    }

    // 切换锁定状态也不应移动底数与乘号（各坐标轴独立比较）
    await page.getByRole('button', { name: 'N 已解锁（手动）' }).click()
    const locked = await boxes()
    bLefts.push(locked.bLeft)
    bTops.push(locked.bTop)
    oLefts.push(locked.oLeft)
    oTops.push(locked.oTop)
    for (const axis of [bLefts, bTops, oLefts, oTops]) {
      expect(Math.max(...axis) - Math.min(...axis)).toBeLessThanOrEqual(1)
    }
  })
})

test('内嵌配置器的字节、指数与绝对或相对值双向同步', async ({ page }) => {
  await openComposer(page, 'LINEAR16')
  const hex = page.locator('#vout-mode-input')
  const exponent = page.locator(L16_N)
  const byte = page.getByTestId('vout-mode-byte')

  await expect(page.getByRole('radiogroup', { name: /格式/ })).toHaveCount(0)
  await expect(hex).toHaveValue('18')
  await expect(exponent).toHaveValue('-8')

  await page.getByRole('radio', { name: '相对值', exact: true }).click()
  await expect(byte).toHaveText('0x98')
  await expect(exponent).toHaveValue('-8')
  await expect(page.locator(STATUS)).toContainText('相对 LINEAR')

  for (const [text, expected] of [
    ['15', '8F'],
    ['-16', '90'],
  ]) {
    await exponent.fill(text)
    await exponent.press('Tab')
    await expect(byte).toHaveText(`0x${expected}`)
    await expect(hex).toHaveValue(expected)
  }

  await page.getByRole('radio', { name: '绝对值', exact: true }).click()
  await expect(byte).toHaveText('0x10')
  await expect(exponent).toHaveValue('-16')

  await setVoutModeByte(page, '18')
  await expect(exponent).toHaveValue('-8')
})

test.describe('独立 VOUT_MODE 配置器', () => {
  test('VID 只可选绝对值，DIRECT 与 IEEE Half 的参数为零', async ({ page }) => {
    await openComposer(page, 'VOUT_MODE')

    await page.getByRole('radio', { name: '相对值' }).click()
    await page.getByRole('radio', { name: 'VID' }).click()
    await expect(page.locator(CANONICAL)).toContainText('0x38')
    await expect(page.getByRole('radio', { name: '相对值' })).toBeDisabled()

    await page.getByRole('radio', { name: 'DIRECT' }).click()
    await expect(page.locator(CANONICAL)).toContainText('0x40')
    await expect(page.getByText(/参数 = 00000b/)).toBeVisible()
    await expect(page.getByRole('tab', { name: /VOUT_MODE/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )

    await page.getByRole('radio', { name: 'IEEE Half' }).click()
    await expect(page.locator(CANONICAL)).toContainText('0x60')
  })

  test('修正配置字节只更改无效的组合或参数', async ({ page }) => {
    await openComposer(page, 'VOUT_MODE')
    const hex = page.locator('#vout-mode-input')

    const repair = page.getByRole('button', { name: '修正配置字节' })
    const bytes = page.getByTestId('vout-mode-byte')
    await hex.fill('E1')
    await hex.press('Tab')
    await expect(bytes).toHaveText('0xE1')
    await expect(page.locator(STATUS)).toContainText('参数必须为 0')
    await repair.click()
    await expect(bytes).toHaveText('0xE0')

    await hex.fill('20')
    await hex.press('Tab')
    await page.getByRole('button', { name: /第 7 位，绝对值\/相对值/ }).click()
    await expect(bytes).toHaveText('0xA0')
    await expect(page.locator(STATUS)).toContainText('相对 VID — 非法组合')
    await expect(page.locator(STATUS)).not.toContainText('相对 LINEAR')
    await repair.click()
    await expect(bytes).toHaveText('0x20')
    await expect(page.locator(STATUS)).toContainText('未使用')

    await hex.fill('3E')
    await hex.press('Tab')
    await expect(page.locator(STATUS)).toContainText('由制造商定义')
    await expect(
      page.getByRole('alert').filter({ hasText: '器件资料中的 VID 码表' }),
    ).toHaveAttribute('data-level', 'warning')
    await repair.click()
    await expect(bytes).toHaveText('0x3E')
  })
})

test.describe('VOUT_MODE 单选组键盘操作', () => {
  // ARIA APG radio pattern：选中项是唯一 tab stop；ArrowRight/Down 下一项、
  // ArrowLeft/Up 上一项，循环并跳过 disabled；焦点到达即选择。
  test('独立配置器的绝对值与相对值可用方向键循环选择', async ({ page }) => {
    await openComposer(page, 'VOUT_MODE')

    const abs = page.getByRole('radio', { name: '绝对值' })
    const rel = page.getByRole('radio', { name: '相对值' })

    // 选中项是唯一 roving tab stop。
    await expect(abs).toHaveAttribute('tabindex', '0')
    await expect(rel).toHaveAttribute('tabindex', '-1')

    await abs.focus()
    await page.keyboard.press('ArrowRight')
    await expect(rel).toBeFocused()
    await expect(rel).toHaveAttribute('aria-checked', 'true')
    await expect(abs).toHaveAttribute('aria-checked', 'false')
    await expect(page.locator(CANONICAL)).toContainText('0x98')
    await expect(page.locator(STATUS)).toContainText('相对 LINEAR')
    // 焦点到达即成为新的 roving tab stop。
    await expect(rel).toHaveAttribute('tabindex', '0')
    await expect(abs).toHaveAttribute('tabindex', '-1')

    // ArrowLeft 回到上一项。
    await page.keyboard.press('ArrowLeft')
    await expect(abs).toBeFocused()
    await expect(abs).toHaveAttribute('aria-checked', 'true')
    await expect(page.locator(CANONICAL)).toContainText('0x18')

    // ArrowDown 同 Right、ArrowUp 同 Left。
    await page.keyboard.press('ArrowDown')
    await expect(rel).toBeFocused()
    await page.keyboard.press('ArrowUp')
    await expect(abs).toBeFocused()

    // 从第一项向后循环到最后一项。
    await page.keyboard.press('ArrowLeft')
    await expect(rel).toBeFocused()

    // Space 在已选中的 radio 上是幂等 no-op。
    await page.keyboard.press('Space')
    await expect(page.locator(CANONICAL)).toContainText('0x98')
  })

  test('独立配置器可用方向键循环选择格式', async ({ page }) => {
    await openComposer(page, 'VOUT_MODE')

    const linear = page.getByRole('radio', { name: 'LINEAR' })
    const vid = page.getByRole('radio', { name: 'VID' })
    const direct = page.getByRole('radio', { name: 'DIRECT' })
    const half = page.getByRole('radio', { name: 'IEEE Half' })

    await expect(linear).toHaveAttribute('tabindex', '0')
    for (const other of [vid, direct, half]) {
      await expect(other).toHaveAttribute('tabindex', '-1')
    }

    await linear.focus()
    await page.keyboard.press('ArrowRight')
    await expect(vid).toBeFocused()
    await expect(vid).toHaveAttribute('aria-checked', 'true')
    await expect(page.locator(CANONICAL)).toContainText('0x38')

    await page.keyboard.press('ArrowRight')
    await expect(direct).toBeFocused()
    await expect(page.locator(CANONICAL)).toContainText('0x40')

    await page.keyboard.press('ArrowRight')
    await expect(half).toBeFocused()
    await expect(page.locator(CANONICAL)).toContainText('0x60')

    // 从最后一项向后循环回第一项。
    await page.keyboard.press('ArrowRight')
    await expect(linear).toBeFocused()
    await expect(linear).toHaveAttribute('aria-checked', 'true')
    await expect(linear).toHaveAttribute('tabindex', '0')
    await expect(half).toHaveAttribute('tabindex', '-1')

    // 从第一项向前循环到最后一项。
    await page.keyboard.press('ArrowLeft')
    await expect(half).toBeFocused()
    await expect(half).toHaveAttribute('aria-checked', 'true')
  })

  test('VID 只允许绝对值，方向键跳过禁用选项', async ({ page }) => {
    await openComposer(page, 'VOUT_MODE')

    await page.getByRole('radio', { name: 'VID' }).click()
    const abs = page.getByRole('radio', { name: '绝对值' })
    const rel = page.getByRole('radio', { name: '相对值' })
    await expect(rel).toBeDisabled()

    await abs.focus()
    await page.keyboard.press('ArrowRight')
    await expect(abs).toBeFocused()
    await expect(abs).toHaveAttribute('aria-checked', 'true')
    await page.keyboard.press('ArrowLeft')
    await expect(abs).toBeFocused()
    await expect(page.locator(CANONICAL)).toContainText('0x38')
  })

  test('内嵌配置器方向键同步绝对值、相对值和配置字节', async ({ page }) => {
    await openComposer(page, 'LINEAR16')

    const abs = page.getByRole('radio', { name: '绝对值' })
    const rel = page.getByRole('radio', { name: '相对值' })

    await expect(abs).toHaveAttribute('tabindex', '0')
    await abs.focus()
    await page.keyboard.press('ArrowRight')
    await expect(rel).toBeFocused()
    await expect(rel).toHaveAttribute('aria-checked', 'true')
    await expect(page.locator(CANONICAL)).toContainText('0x98')
    await expect(page.locator(STATUS)).toContainText('相对 LINEAR')

    await page.keyboard.press('ArrowLeft')
    await expect(abs).toBeFocused()
    await expect(page.locator(CANONICAL)).toContainText('0x18')
  })
})

async function setVoutModeByte(page: Page, hex: string) {
  const input = page.locator('#vout-mode-input')
  await input.fill(hex)
  await input.press('Tab')
  await expect(page.getByTestId('vout-mode-byte')).toHaveText(`0x${hex}`)
}

async function openExplanation(page: Page) {
  const details = page.locator('.vout-explanations-details')
  await expect(details).not.toHaveAttribute('open')
  await details.getByText(/^说明/).click()
  const explanation = details.getByRole('list')
  await expect(explanation).toBeVisible()
  return explanation
}

const DEVICE_DATA_COPY = /需器件资料|器件 Profile|m\/b\/R|DIRECT 系数|设备数据/

test.describe('VOUT_MODE 字节配置', () => {
  test('LINEAR 按绝对或相对配置提供换算指引，只保留「说明」', async ({ page }) => {
    await openComposer(page, 'VOUT_MODE')
    const explanation = await openExplanation(page)
    await expect(explanation).toContainText('用 LINEAR16 换算绝对电压')
    await expect(page.getByTestId('calculation-steps-disclosure')).toHaveCount(0)
    await expect(page.getByTestId('result-details')).toHaveCount(0)

    await setVoutModeByte(page, '98')
    await expect(explanation).toContainText('VOUT_COMMAND 标称参考值')
    await expect(page.getByTestId('vout-mode-status')).toHaveText('相对 LINEAR')
  })

  test('IEEE Half 可按 binary16 换算，只有相对配置需要标称参考值', async ({ page }) => {
    await openComposer(page, 'VOUT_MODE')
    await setVoutModeByte(page, '60')
    await expect(page.getByTestId('vout-mode-status')).toHaveText('IEEE Half（标准 binary16）')
    await expect(page.getByTestId('vout-mode-canonical')).toContainText('0b01100000')
    const explanation = await openExplanation(page)
    await expect(explanation).toContainText('标准 IEEE 754 binary16')
    await expect(explanation).toContainText('HALF 模式页')
    await expect(explanation).not.toContainText('标称参考值')
    const halfAlert = page.getByRole('alert').filter({ hasText: '§8.4.4' })
    await expect(halfAlert).toHaveAttribute('data-level', 'warning')
    await expect(halfAlert).not.toContainText(DEVICE_DATA_COPY)
    await expect(halfAlert).not.toContainText('标称参考值')

    await setVoutModeByte(page, 'E0')
    await expect(page.getByTestId('vout-mode-status')).toHaveText('相对 IEEE Half（需参考值）')
    await expect(explanation).toContainText('VOUT_COMMAND 标称参考值')
    await expect(explanation).toContainText('§8.5.2')
    await expect(explanation).not.toContainText(DEVICE_DATA_COPY)
    await expect(page.getByRole('alert')).not.toContainText(DEVICE_DATA_COPY)
  })

  test('DIRECT 需要器件系数，相对配置还需要标称参考值', async ({ page }) => {
    await openComposer(page, 'VOUT_MODE')
    await setVoutModeByte(page, '40')
    await expect(page.getByTestId('vout-mode-status')).toHaveText('绝对 DIRECT（需 m/b/R 系数）')
    const absolute = await openExplanation(page)
    await expect(absolute).toContainText('COEFFICIENTS')
    await expect(absolute).toContainText('§7.4')
    await expect(absolute).not.toContainText('标称参考值')

    await setVoutModeByte(page, 'C0')
    await expect(page.getByTestId('vout-mode-status')).toHaveText('相对 DIRECT（需系数与参考值）')
    const alert = page.getByRole('alert').filter({ hasText: 'm/b/R' })
    await expect(alert).toContainText('VOUT_COMMAND 标称参考值')
    await expect(alert).toContainText('§8.5.2')
  })

  test('展开 IEEE Half 配置说明时，桌面和窄屏页面无横向溢出', async ({ page }) => {
    await openComposer(page, 'VOUT_MODE')
    await setVoutModeByte(page, '60')
    await openExplanation(page)
    await page.evaluate(() => document.fonts.ready)
    for (const viewport of [
      { width: 1280, height: 900 },
      { width: 390, height: 844 },
      { width: 360, height: 800 },
    ]) {
      await page.setViewportSize(viewport)
      await expectNoHorizontalOverflow(page)
    }
  })
})
