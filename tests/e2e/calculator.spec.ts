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

  test('选择命令只显示命令信息，不自动加载参数', async ({ page }) => {
    await page.goto('/')
    const hexInput = page.locator('input[placeholder="0x0000"]')

    await page.locator('#command-picker').click()
    await page.getByRole('option', { name: /VOUT_COMMAND/ }).click()

    await expect(hexInput).toHaveValue('0x0000')
    await expect(page.getByRole('tab', { name: /LINEAR11/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(page.getByRole('button', { name: '应用 project-demo 预设' })).toBeVisible()
  })

  test('显式应用 project-demo 预设后才加载模式与参数并重新编码 raw', async ({ page }) => {
    await page.goto('/')
    const hexInput = page.locator('input[placeholder="0x0000"]')

    await page.locator('#command-picker').click()
    await page.getByRole('option', { name: /VOUT_COMMAND/ }).click()
    await page.getByRole('button', { name: '应用 project-demo 预设' }).click()

    await expect(hexInput).toHaveValue('0x0C00')
    await expect(page.getByRole('tab', { name: /LINEAR16/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  test('device_defined 命令提示需要器件数据手册且不切换模式', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('tab', { name: /LINEAR16/ }).click()

    await page.locator('#command-picker').click()
    await page.getByRole('option', { name: /READ_VIN/ }).click()

    await expect(page.getByRole('tab', { name: /LINEAR16/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(page.getByText(/需要器件数据手册/).first()).toBeVisible()
  })

  test('DIRECT：Hex→Y/Value、Y→raw、Value→raw 双向同步', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('tab', { name: /DIRECT/ }).click()
    const hexInput = page.locator('input[placeholder="0x0000"]')
    const yInput = page.getByLabel('Y (16-bit signed)')
    const valueInput = page.locator('#value-input')

    await hexInput.fill('8000')
    await expect(yInput).toHaveValue('-32768')
    await expect(valueInput).toHaveValue('-32768')

    await yInput.fill('10')
    await expect(hexInput).toHaveValue('0x000A')
    await expect(valueInput).toHaveValue('10')

    await valueInput.fill('5')
    await expect(hexInput).toHaveValue('0x0005')
    await expect(yInput).toHaveValue('5')
  })

  test('DIRECT：bit toggle 同步 Y 与 Value', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('tab', { name: /DIRECT/ }).click()
    const hexInput = page.locator('input[placeholder="0x0000"]')
    const yInput = page.getByLabel('Y (16-bit signed)')

    await page.getByRole('button', { name: '位 0: 0' }).click()

    await expect(hexInput).toHaveValue('0x0001')
    await expect(yInput).toHaveValue('1')
    await expect(page.locator('#value-input')).toHaveValue('1')
  })

  test('DIRECT：m=0 显示明确错误且 Value 不编码', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('tab', { name: /DIRECT/ }).click()
    const hexInput = page.locator('input[placeholder="0x0000"]')

    await page.getByLabel('DIRECT 系数 m').fill('0')

    await expect(page.getByText(/m 不能为 0/).first()).toBeVisible()
    await page.locator('#value-input').fill('12')
    await expect(hexInput).toHaveValue('0x0000')
  })

  test('HALF：Hex→Value、Value→Hex、bit toggle 三方向同步', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('tab', { name: /HALF/ }).click()
    const hexInput = page.locator('input[placeholder="0x0000"]')
    const valueInput = page.locator('#value-input')

    await hexInput.fill('3C00')
    await expect(valueInput).toHaveValue('1')

    await valueInput.fill('1')
    await expect(hexInput).toHaveValue('0x3C00')

    await page.getByRole('button', { name: '位 15: 0' }).click()
    await expect(hexInput).toHaveValue('0xBC00')
    await expect(valueInput).toHaveValue('-1')
  })

  test('HALF：NaN 作为一等值支持', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('tab', { name: /HALF/ }).click()
    const hexInput = page.locator('input[placeholder="0x0000"]')
    const valueInput = page.locator('#value-input')

    await valueInput.fill('NaN')

    await expect(hexInput).toHaveValue('0x7E00')
    await expect(valueInput).toHaveValue('NaN')
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

  test('复制 LE bytes 与 C 宏默认使用未交换 raw word', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto('/')
    await page.locator('input[placeholder="0x0000"]').fill('0001')

    await page.getByRole('button', { name: '📋 LE bytes' }).click()
    let clipboard = await page.evaluate(() => navigator.clipboard.readText())
    expect(clipboard).toBe('0x 01 00')

    await page.getByRole('button', { name: 'C 代码' }).click()
    clipboard = await page.evaluate(() => navigator.clipboard.readText())
    expect(clipboard).toBe('#define RAW_VALUE 0x0001 /* Y=1 × 2^0 */')
  })

  test('选择命令后 C 宏使用安全清洗后的命令名', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto('/')
    await page.locator('input[placeholder="0x0000"]').fill('0001')

    await page.locator('#command-picker').click()
    await page.getByRole('option', { name: /VOUT_COMMAND/ }).click()
    await page.getByRole('button', { name: 'C 代码' }).click()

    const clipboard = await page.evaluate(() => navigator.clipboard.readText())
    expect(clipboard).toBe('#define VOUT_COMMAND 0x0001 /* Y=1 × 2^0 */')
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
