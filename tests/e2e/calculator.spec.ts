import { test, expect } from '@playwright/test'

test.describe('计算器真实用户流程', () => {
  test('L11：Hex 输入解码为 Y/N/Value', async ({ page }) => {
    await page.goto('/')
    const hexInput = page.locator('input[placeholder="0x0000"]')

    await hexInput.fill('F819')

    await expect(page.locator('#value-input')).toHaveValue('12.5')
    await expect(hexInput).toHaveValue('0xF819')
    await expect(page.getByText('Y=25 × 2^-1')).toBeVisible()
  })

  test('L11：Value 输入编码为 Hex', async ({ page }) => {
    await page.goto('/')
    const valueInput = page.locator('#value-input')
    const hexInput = page.locator('input[placeholder="0x0000"]')

    await valueInput.fill('12.5')

    await expect(hexInput).toHaveValue('0xF819')
  })

  test('bit toggle 更新 Hex 和 Value', async ({ page }) => {
    await page.goto('/')
    const hexInput = page.locator('input[placeholder="0x0000"]')

    await expect(hexInput).toHaveValue('0x0000')
    await page.getByRole('button', { name: '位 0: 0' }).click()

    await expect(hexInput).toHaveValue('0x0001')
    await expect(page.locator('#value-input')).toHaveValue('1')
  })

  test('命令选择会加载模式与参数并重新编码 raw', async ({ page }) => {
    await page.goto('/')
    const hexInput = page.locator('input[placeholder="0x0000"]')

    await page.locator('#command-picker').click()
    await page.getByRole('option', { name: /VOUT_COMMAND/ }).click()

    await expect(hexInput).toHaveValue('0x0C00')
    await expect(page.getByRole('tab', { name: /LINEAR16/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  test('STATUS_WORD 不强制切换数值模式', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('tab', { name: /LINEAR16/ }).click()

    await page.locator('#command-picker').click()
    await page.getByRole('option', { name: /STATUS_WORD/ }).click()

    await expect(page.getByRole('tab', { name: /LINEAR16/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(page.getByText(/状态位摘要/)).toBeVisible()
  })

  test('复制 Hex 使用当前偏好格式', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto('/')
    await page.locator('input[placeholder="0x0000"]').fill('0001')

    await page.getByRole('button', { name: '📋 Hex' }).click()

    const clipboard = await page.evaluate(() => navigator.clipboard.readText())
    expect(clipboard).toBe('0x 01 00')
  })

  test('主题切换由全局状态驱动并持久化', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('pmbus-calculator:theme', 'light')
    })
    await page.goto('/')

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')

    await page.getByRole('button', { name: /当前主题: 亮色/ }).click()

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect(page.getByRole('button', { name: /当前主题: 暗色/ })).toBeVisible()

    const stored = await page.evaluate(() => localStorage.getItem('pmbus-calculator:theme'))
    expect(stored).toBe('dark')
  })
})
