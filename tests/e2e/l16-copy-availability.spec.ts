import { expect, test } from '@playwright/test'
import { appUrl } from './helpers/app-url'

test('非 LINEAR 结果禁用物理值复制，恢复 LINEAR 后真实复制数值', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto(appUrl())
  await page.getByRole('tab', { name: /LINEAR16/ }).click()
  const raw = page.locator('#raw-hex-input')
  const vout = page.locator('#vout-mode-input')
  const copy = page.getByRole('button', { name: '物理值', exact: true })
  const reason = page.locator('#physical-value-copy-reason')
  await raw.fill('0100')

  for (const byte of ['20', '40', '60', '41', 'A0']) {
    await vout.fill(byte)
    await vout.press('Tab')
    await expect(page.getByTestId('result-value')).toHaveText('—')
    await expect(copy).toBeDisabled()
    await expect(copy).toHaveAttribute('aria-describedby', 'physical-value-copy-reason')
    await expect(reason).toBeVisible()
    await expect(reason).toContainText(`VOUT_MODE 0x${byte}`)
    await expect(raw).toHaveValue('0100')
    for (const name of ['Raw Word Hex', 'Wire 字节', 'MSB-first 字节', 'C 代码']) {
      await expect(page.getByRole('button', { name, exact: true })).toBeEnabled()
    }
  }

  await vout.fill('18')
  await vout.press('Tab')
  await expect(copy).toBeEnabled()
  await expect(reason).toHaveCount(0)
  await copy.click()
  await expect(page.getByText('已复制: 物理值', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('1')
})

test('360px：缺少标称参考与真零分开，清除/重填/切换 payload 后复制状态实时更新', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.setViewportSize({ width: 360, height: 800 })
  await page.goto(appUrl())
  await page.getByRole('tab', { name: /LINEAR16/ }).click()
  await page.locator('#raw-hex-input').fill('0100')
  await page.locator('#vout-mode-input').fill('98')
  await page.locator('#vout-mode-input').press('Tab')
  const copy = page.getByRole('button', { name: '物理值', exact: true })
  const nominal = page.locator('#l16-nominal-vout')
  const reason = page.locator('#physical-value-copy-reason')
  await expect(copy).toBeDisabled()
  await expect(reason).toContainText('标称参考值')
  await expect(reason).toBeVisible()

  await nominal.fill('0')
  await nominal.press('Tab')
  await expect(page.getByTestId('result-value')).toHaveText('0')
  await expect(copy).toBeEnabled()
  await copy.click()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('0')

  await nominal.fill('')
  await nominal.press('Tab')
  await expect(copy).toBeDisabled()
  await expect(page.getByTestId('result-value')).toHaveText('—')
  await page.locator('#l16-payload-kind').selectOption('slinear16-offset')
  await expect(copy).toBeEnabled()
  await expect(page.getByTestId('result-value')).toHaveText('1')
  await page.locator('#l16-payload-kind').selectOption('ulinear16')
  await expect(copy).toBeDisabled()
  await nominal.fill('12')
  await nominal.press('Tab')
  await expect(copy).toBeEnabled()
  await expect(page.getByTestId('result-value')).toHaveText('12')
  expect(await page.evaluate(() => document.body.scrollWidth <= innerWidth)).toBe(true)
})
