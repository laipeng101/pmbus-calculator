import { test, expect } from '@playwright/test'

test.describe('计算器真实用户流程', () => {
  test('L11：Hex 输入解码为 Y/N/Value', async ({ page }) => {
    await page.goto('/')
    const hexInput = page.locator('input[placeholder="0x0000"]')

    await hexInput.fill('F819')
    await hexInput.press('Tab')

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

  test('CommandPicker 键盘导航、Enter 选择与焦点恢复', async ({ page }) => {
    await page.goto('/')
    const trigger = page.locator('#command-picker')

    await trigger.click()
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    const listbox = page.getByRole('listbox', { name: 'PMBus 命令列表' })
    await expect(listbox).toBeVisible()
    await expect(listbox).toHaveAttribute('aria-activedescendant', 'command-option-none')
    await expect(page.getByPlaceholder('搜索命令...')).toBeFocused()

    await page.keyboard.press('ArrowDown') // 无命令 -> VOUT_COMMAND
    await expect(listbox).toHaveAttribute('aria-activedescendant', 'command-option-VOUT_COMMAND')
    await page.keyboard.press('Enter')

    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await expect(trigger).toBeFocused()
    await expect(trigger).toContainText('VOUT_COMMAND')
  })

  test('CommandPicker Escape 关闭并恢复焦点', async ({ page }) => {
    await page.goto('/')
    const trigger = page.locator('#command-picker')

    await trigger.click()
    await page.keyboard.press('Escape')

    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await expect(trigger).toBeFocused()
    await expect(page.getByRole('listbox', { name: 'PMBus 命令列表' })).toHaveCount(0)
  })

  test('CommandPicker 外部点击关闭并恢复焦点', async ({ page }) => {
    await page.goto('/')
    const trigger = page.locator('#command-picker')

    await trigger.click()
    await page.locator('h1').click()

    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await expect(trigger).toBeFocused()
    await expect(page.getByRole('listbox', { name: 'PMBus 命令列表' })).toHaveCount(0)
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
    const hexInput = page.locator('input[placeholder="0x0000"]')
    await hexInput.fill('0001')
    await hexInput.press('Tab')

    const copyHex = page.getByRole('button', { name: '📋 Hex' })
    await copyHex.scrollIntoViewIfNeeded()
    await copyHex.evaluate((el: HTMLButtonElement) => el.click())

    const clipboard = await page.evaluate(() => navigator.clipboard.readText())
    expect(clipboard).toBe('0x 01 00')
  })

  test('复制 LE bytes 与 C 宏默认使用未交换 raw word', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto('/')
    const hexInput = page.locator('input[placeholder="0x0000"]')
    await hexInput.fill('0001')
    await hexInput.press('Tab')

    const leBtn = page.getByRole('button', { name: '📋 LE bytes' })
    await leBtn.scrollIntoViewIfNeeded()
    await leBtn.evaluate((el: HTMLButtonElement) => el.click())
    let clipboard = await page.evaluate(() => navigator.clipboard.readText())
    expect(clipboard).toBe('0x 01 00')

    const cBtn = page.getByRole('button', { name: 'C 代码' })
    await cBtn.scrollIntoViewIfNeeded()
    await cBtn.evaluate((el: HTMLButtonElement) => el.click())
    clipboard = await page.evaluate(() => navigator.clipboard.readText())
    expect(clipboard).toBe('#define RAW_VALUE 0x0001 /* Y=1 × 2^0 */')
  })

  test('选择命令后 C 宏使用安全清洗后的命令名', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto('/')
    const hexInput = page.locator('input[placeholder="0x0000"]')
    await hexInput.fill('0001')
    await hexInput.press('Tab')

    await page.locator('#command-picker').click()
    await page.getByRole('option', { name: /VOUT_COMMAND/ }).click()
    const cBtn = page.getByRole('button', { name: 'C 代码' })
    await cBtn.scrollIntoViewIfNeeded()
    await cBtn.evaluate((el: HTMLButtonElement) => el.click())

    const clipboard = await page.evaluate(() => navigator.clipboard.readText())
    expect(clipboard).toBe('#define VOUT_COMMAND 0x0001 /* Y=1 × 2^0 */')
  })

  test('非法 Hex 输入显示明确错误且不修改全局状态', async ({ page }) => {
    await page.goto('/')
    const hexInput = page.locator('input[placeholder="0x0000"]')

    await hexInput.fill('1G')

    await expect(page.getByText(/仅允许十六进制数字/)).toBeVisible()
    await expect(page.locator('#value-input')).toHaveValue('0')
  })

  test('只有 0x 前缀的 Hex 输入显示明确错误', async ({ page }) => {
    await page.goto('/')
    const hexInput = page.locator('input[placeholder="0x0000"]')

    await hexInput.fill('0x')

    await expect(page.getByText(/0x\/0X 后/)).toBeVisible()
    await expect(page.locator('#value-input')).toHaveValue('0')
  })

  test('超长 Hex 输入显示明确错误且不被静默截断', async ({ page }) => {
    await page.goto('/')
    const hexInput = page.locator('input[placeholder="0x0000"]')

    await hexInput.fill('12345')

    await expect(page.getByText(/最多 4 位十六进制数字/)).toBeVisible()
    await expect(page.locator('#value-input')).toHaveValue('0')
  })

  test('DIRECT 系数错误只在 DIRECT 模式显示', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('tab', { name: /DIRECT/ }).click()

    await page.getByLabel('DIRECT 系数 m').fill('2.5')

    await expect(page.getByText(/M 必须是/)).toBeVisible()

    await page.getByRole('tab', { name: /LINEAR11/ }).click()
    await expect(page.getByText(/M 必须是/)).toHaveCount(0)

    await page.getByRole('tab', { name: /DIRECT/ }).click()
    await expect(page.getByText(/M 必须是/)).toBeVisible()
  })

  test('复制偏好（0x/空格/字节序）在 reload 后恢复并影响复制结果', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto('/')

    const prefixBtn = page.getByRole('button', { name: '0x 前缀' })
    await prefixBtn.scrollIntoViewIfNeeded()
    await prefixBtn.evaluate((el: HTMLButtonElement) => el.click())
    const spaceBtn = page.getByRole('button', { name: '字节空格' })
    await spaceBtn.scrollIntoViewIfNeeded()
    await spaceBtn.evaluate((el: HTMLButtonElement) => el.click())
    const endianBtn = page.getByRole('button', { name: 'HEX 复制: LE' })
    await endianBtn.scrollIntoViewIfNeeded()
    await endianBtn.evaluate((el: HTMLButtonElement) => el.click())

    await expect(page.getByRole('button', { name: '0x 前缀' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    await expect(page.getByRole('button', { name: '字节空格' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    await expect(page.getByRole('button', { name: 'HEX 复制: BE' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    await page.reload()

    await expect(page.getByRole('button', { name: '0x 前缀' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    await expect(page.getByRole('button', { name: '字节空格' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    await expect(page.getByRole('button', { name: 'HEX 复制: BE' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    const hexInput = page.locator('input[placeholder="0x0000"]')
    await hexInput.fill('1234')
    await hexInput.press('Tab')
    const copyHex = page.getByRole('button', { name: '📋 Hex' })
    await copyHex.scrollIntoViewIfNeeded()
    await copyHex.evaluate((el: HTMLButtonElement) => el.click())

    const clipboard = await page.evaluate(() => navigator.clipboard.readText())
    expect(clipboard).toBe('1234')
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
