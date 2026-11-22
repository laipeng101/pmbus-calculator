import { test, expect, type Page } from '@playwright/test'
import { appUrl } from './helpers/app-url'

async function openMode(page: Page, name: RegExp) {
  await page.goto(appUrl())
  await page.getByRole('tab', { name }).click()
  await expect(page.getByTestId('vout-mode-canonical')).toBeVisible()
}

async function setVoutModeByte(page: Page, hex: string) {
  const input = page.locator('#vout-mode-input')
  await input.fill(hex)
  await input.press('Tab')
  await expect(page.getByTestId('vout-mode-byte')).toHaveText(`0x${hex}`)
}

async function openExplanation(page: Page) {
  const details = page.locator('.vout-explanations-details')
  const explanation = details.getByRole('list')
  if (!(await explanation.isVisible())) await details.getByText(/^说明/).click()
  await expect(explanation).toBeVisible()
  return explanation
}

const DEVICE_DATA_COPY = /需器件资料|器件 Profile|m\/b\/R|DIRECT 系数|设备数据/

test.describe('VOUT_MODE 字节配置', () => {
  test('LINEAR 按绝对或相对配置提供换算指引，只保留「说明」', async ({ page }) => {
    await openMode(page, /VOUT_MODE/)
    const explanation = await openExplanation(page)
    await expect(explanation).toContainText('用 LINEAR16 换算绝对电压')
    await expect(page.getByTestId('calculation-steps-disclosure')).toHaveCount(0)
    await expect(page.getByTestId('result-details')).toHaveCount(0)

    await setVoutModeByte(page, '98')
    await expect(await openExplanation(page)).toContainText('VOUT_COMMAND 标称参考值')
    await expect(page.getByTestId('vout-mode-status')).toHaveText('相对 LINEAR')
  })

  test('IEEE Half 可按 binary16 换算，只有相对配置需要标称参考值', async ({ page }) => {
    await openMode(page, /VOUT_MODE/)
    await setVoutModeByte(page, '60')
    await expect(page.getByTestId('vout-mode-status')).toHaveText('IEEE Half（标准 binary16）')
    await expect(page.getByTestId('vout-mode-canonical')).toContainText('0b01100000')
    const absolute = await openExplanation(page)
    await expect(absolute).toContainText('标准 IEEE 754 binary16')
    await expect(absolute).toContainText('HALF 模式页')
    await expect(absolute).not.toContainText('标称参考值')
    const halfAlert = page.getByRole('alert').filter({ hasText: '§8.4.4' })
    await expect(halfAlert).toHaveAttribute('data-level', 'warning')
    await expect(halfAlert).not.toContainText(DEVICE_DATA_COPY)
    await expect(halfAlert).not.toContainText('标称参考值')

    await setVoutModeByte(page, 'E0')
    await expect(page.getByTestId('vout-mode-status')).toHaveText('相对 IEEE Half（需参考值）')
    const relative = await openExplanation(page)
    await expect(relative).toContainText('VOUT_COMMAND 标称参考值')
    await expect(relative).toContainText('§8.5.2')
    await expect(relative).not.toContainText(DEVICE_DATA_COPY)
    await expect(page.getByRole('alert')).not.toContainText(DEVICE_DATA_COPY)
  })

  test('DIRECT 需要器件系数，相对配置还需要标称参考值', async ({ page }) => {
    await openMode(page, /VOUT_MODE/)
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

  test('IEEE Half 参数不为零时，提示修正参数而非换算数据字', async ({ page }) => {
    await openMode(page, /VOUT_MODE/)
    for (const hex of ['61', 'E1']) {
      await setVoutModeByte(page, hex)
      await expect(page.getByTestId('vout-mode-status')).toContainText('参数必须为 0')
      const invalid = page.getByRole('alert').filter({ hasText: '00000b' })
      await expect(invalid).toHaveAttribute('data-level', 'error')
      await expect(await openExplanation(page)).not.toContainText('标准 IEEE 754 binary16')
    }
  })

  test('可仅用键盘在 Hex 输入框编辑并提交字节', async ({ page }) => {
    await openMode(page, /VOUT_MODE/)
    const input = page.locator('#vout-mode-input')
    await input.focus()
    await page.keyboard.insertText('60')
    await page.keyboard.press('Tab')
    await expect(page.getByTestId('vout-mode-byte')).toHaveText('0x60')
    await expect(page.getByTestId('vout-mode-status')).toHaveText('IEEE Half（标准 binary16）')

    await input.focus()
    await page.keyboard.insertText('18')
    await page.keyboard.press('Tab')
    await expect(page.getByTestId('vout-mode-byte')).toHaveText('0x18')
  })

  test('展开 IEEE Half 配置说明时，桌面和窄屏页面无横向溢出', async ({ page }) => {
    await openMode(page, /VOUT_MODE/)
    await setVoutModeByte(page, '60')
    await openExplanation(page)
    await page.evaluate(() => document.fonts.ready)
    for (const viewport of [
      { width: 1280, height: 900 },
      { width: 390, height: 844 },
      { width: 360, height: 800 },
    ]) {
      await page.setViewportSize(viewport)
      const result = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }))
      expect(result.scrollWidth, `viewport ${viewport.width}`).toBeLessThanOrEqual(
        result.clientWidth,
      )
    }
  })

  test('制造商自定义 VID 需要码表，修正配置字节也保留合法字节', async ({ page }) => {
    await openMode(page, /VOUT_MODE/)
    for (const hex of ['3E', '3F']) {
      await setVoutModeByte(page, hex)
      await expect(page.getByTestId('vout-mode-status')).toContainText('由制造商定义')
      await expect(page.getByTestId('vout-mode-config-summary')).not.toHaveAttribute(
        'data-alert',
        /.*/,
      )
      await expect(page.getByTestId('vout-mode-status')).not.toHaveClass(
        /vout-canonical-status-alert/,
      )
      const alert = page.getByRole('alert').filter({ hasText: '器件资料中的 VID 码表' })
      await expect(alert).toHaveAttribute('data-level', 'warning')
      await expect(await openExplanation(page)).toContainText('规范允许的配置')

      await page.getByRole('button', { name: '修正配置字节' }).click()
      await expect(page.getByTestId('vout-mode-byte')).toHaveText(`0x${hex}`)
    }
  })

  test('区分未使用、保留和无效的 VID 配置', async ({ page }) => {
    await openMode(page, /VOUT_MODE/)
    for (const [hex, status] of [
      ['20', '00h 未使用'],
      ['21', '表 3 明列，留给未来 Intel 处理器'],
      ['24', '表 3 明列，留给未来 Intel 处理器'],
      ['25', '表 3 未列出'],
    ]) {
      await setVoutModeByte(page, hex)
      await expect(page.getByTestId('vout-mode-status')).toContainText(status)
      await expect(page.getByTestId('vout-mode-config-summary')).toHaveAttribute(
        'data-alert',
        'true',
      )
    }

    await setVoutModeByte(page, 'A0')
    await expect(page.getByTestId('vout-mode-status')).toContainText('非法组合')
    await expect(page.getByRole('alert').filter({ hasText: 'VID 只支持绝对值' })).toHaveAttribute(
      'data-level',
      'error',
    )
  })
})

test.describe('LINEAR16 根据 VOUT_MODE 保留数据字并提示其他格式', () => {
  test('IEEE Half 禁用 LINEAR16 换算并指向 HALF 页', async ({ page }) => {
    await openMode(page, /LINEAR16/)
    for (const hex of ['60', 'E0']) {
      await setVoutModeByte(page, hex)
      await expect(page.locator('#value-input')).toHaveCount(0)
      await expect(page.getByTestId('result-value')).toHaveText('—')
      const card = page.locator('.workspace-l16-block')
      await expect(card).toContainText('切换到 HALF 页')
      await expect(card).toContainText('IEEE 754 binary16')
      await expect(card).not.toContainText(DEVICE_DATA_COPY)
    }
  })

  test('制造商自定义 VID 禁用 LINEAR16 换算并提示查阅器件码表', async ({ page }) => {
    await openMode(page, /LINEAR16/)
    await setVoutModeByte(page, '3E')
    await expect(page.locator('#value-input')).toHaveCount(0)
    await expect(page.getByTestId('result-value')).toHaveText('—')
    const card = page.locator('.workspace-l16-block')
    await expect(card).toContainText('制造商自定义')
    await expect(card).toContainText('器件资料中的 VID 码表')
  })
})
