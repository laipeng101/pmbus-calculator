import { expect, test } from '@playwright/test'

test('LINEAR16 在旧版字节序偏好下用同一原字进行解码、显示字节和编码', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('pmbus-calculator:byteOrder', 'le')
    localStorage.setItem(
      'pmbus-calculator:copy',
      JSON.stringify({ prefix0x: true, spaceBetweenBytes: true, endian: 'le' }),
    )
  })
  await page.goto('./')
  await page.getByRole('tab', { name: /LINEAR16/ }).click()

  const hex = page.locator('#raw-hex-input')
  const result = page.getByTestId('result-value')
  const aux = page.getByRole('region', { name: '辅助结果' })
  await hex.fill('1234')
  await hex.press('Tab')
  await expect(hex).toHaveValue('1234')
  await expect(result).toHaveText('18.203125')
  await expect(aux.getByText('0x 34 12', { exact: true })).toBeVisible()
  await expect(aux.getByText('0x 12 34', { exact: true })).toBeVisible()
  await expect(page.locator('#l16-byte-order')).toHaveCount(0)

  const value = page.locator('#value-input')
  await value.fill('12.5')
  await value.press('Tab')
  await expect(result).toHaveText('12.5')
  await expect(hex).toHaveValue('0C80')
  await expect(aux.getByText('0x 80 0C', { exact: true })).toBeVisible()
})
