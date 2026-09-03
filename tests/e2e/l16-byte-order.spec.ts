import { test, expect, type Page } from '@playwright/test'
import { appUrl } from './helpers/app-url'

/**
 * v3.0.0 canonical Raw Word 闭环（breaking 领域模型重构回归）：
 * Raw Word 输入/显示永远是未交换的 16 位数值原字——L16 下输入 `3412`
 * 就是 raw 0x3412（v2.6.5 的 LE 字节流解释「3412 = 0x1234」已删除）。
 * 线上字节顺序只出现在 Wire Bytes / MSB-first 显示与复制层：
 * raw 0x1234 → Wire `34 12`（SMBus 3.0 §6.5.4 low byte first）、
 * MSB-first `12 34`；物理值始终派生自同一 canonical raw。
 */
test.describe('canonical Raw Word 闭环', () => {
  const hexInput = (page: Page) => page.locator('#raw-hex-input')
  const value = (page: Page) => page.getByTestId('result-value')
  const aux = (page: Page) => page.locator('section[aria-label="辅助结果"]')
  const byteRows = (page: Page) => ({
    wire: aux(page).getByText('0x 34 12', { exact: true }),
    msb: aux(page).getByText('0x 12 34', { exact: true }),
  })

  test('输入 1234 解码 18.203125，Wire 字节显示 34 12 且 Raw Word 保持原字', async ({
    page,
  }) => {
    await page.goto(appUrl())
    await page.getByRole('tab', { name: /LINEAR16/ }).click()

    await hexInput(page).fill('1234')
    await hexInput(page).press('Tab')

    await expect(hexInput(page)).toHaveValue('1234')
    // VOUT_MODE 0x18（absolute LINEAR，N=-8）：0x1234 → 4660 × 2^-8。
    await expect(value(page)).toHaveText('18.203125')
    await expect(byteRows(page).wire).toBeVisible()
    await expect(byteRows(page).msb).toBeVisible()
    // 页面上不存在字节序选择器：Raw Word 不受任何 endian 偏好影响。
    await expect(page.locator('#l16-byte-order')).toHaveCount(0)
  })

  test('输入 3412 得到 raw 0x3412（旧 LE 字节流解释被否定）', async ({ page }) => {
    await page.goto(appUrl())
    await page.getByRole('tab', { name: /LINEAR16/ }).click()

    await hexInput(page).fill('3412')
    await hexInput(page).press('Tab')

    // 0x3412 = 13330 × 2^-8 = 52.0703125。
    await expect(hexInput(page)).toHaveValue('3412')
    await expect(value(page)).toHaveText('52.0703125')
    await expect(aux(page).getByText('0x 12 34', { exact: true })).toBeVisible()
    await expect(aux(page).getByText('0x 34 12', { exact: true })).toBeVisible()
  })

  test('物理值编码后 Raw Word 显示 canonical 原字：12.5 → 0C80', async ({ page }) => {
    await page.goto(appUrl())
    await page.getByRole('tab', { name: /LINEAR16/ }).click()

    // VOUT_MODE 0x18（absolute LINEAR，N=-8）：12.5 → 3200 = 0x0C80。
    const valueInput = page.locator('#value-input')
    await valueInput.fill('12.5')
    await valueInput.press('Tab')
    await expect(value(page)).toHaveText('12.5')
    await expect(hexInput(page)).toHaveValue('0C80')
    await expect(aux(page).getByText('0x 80 0C', { exact: true })).toBeVisible()
  })

  test('遗留 v2 字节序偏好存储不会改写 Raw Word（持久化回归）', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('pmbus-calculator:byteOrder', 'le')
      localStorage.setItem(
        'pmbus-calculator:copy',
        JSON.stringify({ prefix0x: true, spaceBetweenBytes: true, endian: 'le' }),
      )
    })
    await page.goto(appUrl())
    await page.getByRole('tab', { name: /LINEAR16/ }).click()

    // 旧 LE 偏好被忽略：输入 3412 仍然是 raw 0x3412，而不是被换回 0x1234。
    await hexInput(page).fill('3412')
    await hexInput(page).press('Tab')
    await expect(hexInput(page)).toHaveValue('3412')
    await expect(value(page)).toHaveText('52.0703125')
  })
})
