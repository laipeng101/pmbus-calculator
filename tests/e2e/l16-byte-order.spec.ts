import { test, expect, type Page } from '@playwright/test'
import { appUrl } from './helpers/app-url'

/**
 * v2.6.5 L16 Hex 字节序 byte-stream 闭环（P1 修复回归）：
 * Hex 输入/显示是所选字节序的字节流——BE（高字节在前）输入 `1234` 与
 * LE（低字节在前）输入 `3412` 是同一个寄存器 word 0x1234；物理值与
 * LE/BE byte 数组始终派生自未交换 raw，切换选择器只翻转 Hex 呈现顺序。
 */
test.describe('L16 字节序 byte-stream 闭环', () => {
  const hexInput = (page: Page) => page.locator('#raw-hex-input')
  const value = (page: Page) => page.getByTestId('result-value')
  const aux = (page: Page) => page.locator('section[aria-label="辅助结果"]')
  const byteArrays = (page: Page) => ({
    le: aux(page).getByText('0x 34 12', { exact: true }),
    be: aux(page).getByText('0x 12 34', { exact: true }),
  })

  test('BE 输入 1234 解码 18.203125；切到 LE 显示 3412 且数值与 byte 数组不变', async ({
    page,
  }) => {
    await page.goto(appUrl())
    await page.getByRole('tab', { name: /LINEAR16/ }).click()
    await page.locator('#l16-byte-order').selectOption('be')

    await hexInput(page).fill('1234')
    await hexInput(page).press('Tab')

    await expect(hexInput(page)).toHaveValue('1234')
    await expect(value(page)).toHaveText('18.203125')
    await expect(byteArrays(page).be).toBeVisible()
    await expect(byteArrays(page).le).toBeVisible()

    // 切换选择器只改变 Hex 呈现顺序，不改 raw 与物理值。
    await page.locator('#l16-byte-order').selectOption('le')
    await expect(hexInput(page)).toHaveValue('3412')
    await expect(value(page)).toHaveText('18.203125')
    await expect(byteArrays(page).be).toBeVisible()
    await expect(byteArrays(page).le).toBeVisible()

    // LE 方向输入闭环：低字节在前的字节流 3412 回到同一 raw。
    await hexInput(page).fill('3412')
    await hexInput(page).press('Tab')
    await expect(hexInput(page)).toHaveValue('3412')
    await expect(value(page)).toHaveText('18.203125')
  })

  test('物理值编码后切换字节序：raw 与物理值不变，仅 Hex 呈现翻转', async ({ page }) => {
    await page.goto(appUrl())
    await page.getByRole('tab', { name: /LINEAR16/ }).click()

    // VOUT_MODE 0x18（absolute LINEAR，N=-8）：12.5 → 3200 = 0x0C80。
    const valueInput = page.locator('#value-input')
    await valueInput.fill('12.5')
    await valueInput.press('Tab')
    await expect(value(page)).toHaveText('12.5')
    await expect(hexInput(page)).toHaveValue('800C')

    await page.locator('#l16-byte-order').selectOption('be')
    await expect(hexInput(page)).toHaveValue('0C80')
    await expect(value(page)).toHaveText('12.5')
    await expect(aux(page).getByText('0x 0C 80', { exact: true })).toBeVisible()
  })
})
