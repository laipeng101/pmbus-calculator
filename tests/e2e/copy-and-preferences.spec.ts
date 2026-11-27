import { expect, test, type Page } from '@playwright/test'

async function expectCopied(page: Page, button: string, text: string, feedback = button) {
  await page.getByRole('button', { name: button, exact: true }).click()
  const status = page
    .getByRole('status')
    .and(page.getByText(`已复制: ${feedback}`, { exact: true }))
  await expect(status).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(text)
}

test('前缀与字节空格可独立切换，重载后仍按偏好复制', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('./')

  const raw = page.locator('#raw-hex-input')
  const prefix = page.getByRole('button', { name: '0x 前缀' })
  const spacing = page.getByRole('button', { name: '字节空格' })

  await raw.fill('0001')
  await expectCopied(page, 'Raw Word Hex', '0x0001')
  await expectCopied(page, 'C 代码', '#define RAW_VALUE 0x0001 /* Y=1 × 2^0 */', 'C 宏')

  await raw.fill('1234')
  await prefix.click()
  await expect(prefix).toHaveAttribute('aria-pressed', 'false')
  await expect(spacing).toHaveAttribute('aria-pressed', 'true')
  await expectCopied(page, 'Wire 字节', '34 12')

  await spacing.click()
  await expect(prefix).toHaveAttribute('aria-pressed', 'false')
  await expect(spacing).toHaveAttribute('aria-pressed', 'false')
  await page.reload()
  await expect(prefix).toHaveAttribute('aria-pressed', 'false')
  await expect(spacing).toHaveAttribute('aria-pressed', 'false')

  await raw.fill('1234')
  for (const [button, text] of [
    ['Raw Word Hex', '1234'],
    ['Wire 字节', '3412'],
    ['MSB-first 字节', '1234'],
  ]) {
    await expectCopied(page, button, text)
  }
  await expect(raw).toHaveValue('1234')
})

test('切换到暗色主题，刷新后恢复偏好', async ({ page }) => {
  // 系统保持浅色，因此刷新后仍显示暗色可验证显式偏好生效。
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('./')
  const root = page.locator('html')
  await expect(root).toHaveAttribute('data-theme', 'light')

  await page.getByRole('button', { name: /当前主题: 跟随系统/ }).click()
  await page.getByRole('button', { name: /当前主题: 亮色/ }).click()
  await expect(root).toHaveAttribute('data-theme', 'dark')

  await page.reload()
  await expect(root).toHaveAttribute('data-theme', 'dark')
  await expect(page.getByRole('button', { name: /当前主题: 暗色/ })).toBeVisible()
})
