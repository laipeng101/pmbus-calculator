import { test, expect } from '@playwright/test'
import { appUrl } from './helpers/app-url'

test.describe('计算器真实用户流程', () => {
  test('L11：Hex 输入解码为 Y/N/Value', async ({ page }) => {
    await page.goto(appUrl())
    const hexInput = page.locator('input[placeholder="0000"]')

    await hexInput.fill('F819')
    await hexInput.press('Tab')

    await expect(page.locator('#value-input')).toHaveValue('12.5')
    await expect(hexInput).toHaveValue('F819')
    await expect(page.locator('.katex').first()).toBeVisible()
    await expect(page.locator('.katex-error')).toHaveCount(0)
  })

  test('L11：Value 输入编码为 Hex', async ({ page }) => {
    await page.goto(appUrl())
    const valueInput = page.locator('#value-input')
    const hexInput = page.locator('input[placeholder="0000"]')

    await valueInput.fill('12.5')

    await expect(hexInput).toHaveValue('F819')
  })

  test('bit toggle 更新 Hex 和 Value', async ({ page }) => {
    await page.goto(appUrl())
    const hexInput = page.locator('input[placeholder="0000"]')

    await expect(hexInput).toHaveValue('0000')
    await page.getByRole('button', { name: '位 0: 0' }).click()

    await expect(hexInput).toHaveValue('0001')
    await expect(page.locator('#value-input')).toHaveValue('1')
  })

  test('命令参考默认折叠且展开后只读显示命令信息', async ({ page }) => {
    await page.goto(appUrl())
    const hexInput = page.locator('input[placeholder="0000"]')
    const toggle = page.locator('#command-reference-toggle')

    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(page.getByRole('row', { name: /VOUT_COMMAND/ })).toHaveCount(0)

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByRole('row', { name: /VOUT_COMMAND/ })).toBeVisible()

    // 只读：模式与 raw 完全不受影响，也没有预设按钮
    await expect(hexInput).toHaveValue('0000')
    await expect(page.getByRole('tab', { name: /LINEAR11/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(page.getByRole('button', { name: /应用.*预设/ })).toHaveCount(0)
  })

  test('L16：十进制 V 输入拒绝 partial parse/科学计数法/小数并显示错误', async ({ page }) => {
    await page.goto(appUrl())
    await page.getByRole('tab', { name: /LINEAR16/ }).click()
    const vInput = page.getByLabel('V（16 位无符号，0～65535）')
    const hexInput = page.locator('input[placeholder="0000"]')

    for (const bad of ['12abc', '1e2', '1.5']) {
      await vInput.fill(bad)
      await expect(page.getByText(/仅允许十进制整数/)).toBeVisible()
      await expect(hexInput).toHaveValue('0000')
    }

    await vInput.fill('+12')
    await vInput.press('Tab')
    await expect(vInput).toHaveValue('12')
    await expect(hexInput).toHaveValue('000C')

    await vInput.fill('70000')
    await vInput.press('Tab')
    await expect(vInput).toHaveValue('65535')
    await expect(hexInput).toHaveValue('FFFF')
  })

  test('命令参考中 device_defined 行标注需要器件数据手册且不切换模式', async ({ page }) => {
    await page.goto(appUrl())
    await page.getByRole('tab', { name: /LINEAR16/ }).click()
    await page.locator('#command-reference-toggle').click()

    const vinRow = page.getByRole('row', { name: /READ_VIN/ })
    await expect(vinRow).toContainText('由器件资料决定')
    await expect(vinRow).toContainText('PMBus Part II §18.1')
    await expect(page.getByRole('tab', { name: /LINEAR16/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  test('DIRECT：Hex→Y/Value、Y→raw、Value→raw 双向同步', async ({ page }) => {
    await page.goto(appUrl())
    await page.getByRole('tab', { name: /DIRECT/ }).click()
    const hexInput = page.locator('input[placeholder="0000"]')
    const yInput = page.getByLabel('Y（16 位有符号，−32768～32767）')
    const valueInput = page.locator('#value-input')

    await hexInput.fill('8000')
    await expect(yInput).toHaveValue('-32768')
    await expect(valueInput).toHaveValue('-32768')

    await yInput.fill('10')
    await expect(hexInput).toHaveValue('000A')
    await expect(valueInput).toHaveValue('10')

    await valueInput.fill('5')
    await expect(hexInput).toHaveValue('0005')
    await expect(yInput).toHaveValue('5')
  })

  test('DIRECT：bit toggle 同步 Y 与 Value', async ({ page }) => {
    await page.goto(appUrl())
    await page.getByRole('tab', { name: /DIRECT/ }).click()
    const hexInput = page.locator('input[placeholder="0000"]')
    const yInput = page.getByLabel('Y（16 位有符号，−32768～32767）')

    await page.getByRole('button', { name: '位 0: 0' }).click()

    await expect(hexInput).toHaveValue('0001')
    await expect(yInput).toHaveValue('1')
    await expect(page.locator('#value-input')).toHaveValue('1')
  })

  test('DIRECT：m=0 显示明确错误且 Value 不编码', async ({ page }) => {
    await page.goto(appUrl())
    await page.getByRole('tab', { name: /DIRECT/ }).click()
    const hexInput = page.locator('input[placeholder="0000"]')

    await page.getByLabel('DIRECT 系数 m').fill('0')

    await expect(page.getByText(/m 不能为 0/).first()).toBeVisible()
    await page.locator('#value-input').fill('12')
    await expect(hexInput).toHaveValue('0000')
  })

  test('HALF：Hex→Value、Value→Hex、bit toggle 三方向同步', async ({ page }) => {
    await page.goto(appUrl())
    await page.getByRole('tab', { name: /HALF/ }).click()
    const hexInput = page.locator('input[placeholder="0000"]')
    const valueInput = page.locator('#value-input')

    await hexInput.fill('3C00')
    await expect(valueInput).toHaveValue('1')

    await valueInput.fill('1')
    await expect(hexInput).toHaveValue('3C00')

    await page.getByRole('button', { name: '位 15: 0' }).click()
    await expect(hexInput).toHaveValue('BC00')
    await expect(valueInput).toHaveValue('-1')
  })

  test('HALF：NaN 作为一等值支持', async ({ page }) => {
    await page.goto(appUrl())
    await page.getByRole('tab', { name: /HALF/ }).click()
    const hexInput = page.locator('input[placeholder="0000"]')
    const valueInput = page.locator('#value-input')

    await valueInput.fill('NaN')

    await expect(hexInput).toHaveValue('7E00')
    await expect(valueInput).toHaveValue('NaN')
  })

  test('命令参考 STATUS_WORD 行显示状态位语义且不切换模式', async ({ page }) => {
    await page.goto(appUrl())
    await page.getByRole('tab', { name: /LINEAR16/ }).click()
    await page.locator('#command-reference-toggle').click()

    const statusRow = page.getByRole('row', { name: /STATUS_WORD/ })
    await expect(statusRow).toContainText('状态位')
    await expect(statusRow).toContainText('STATUS 位')
    await expect(page.getByRole('tab', { name: /LINEAR16/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  test('L16 非 LINEAR 共享字节（0x20）fail closed：无物理输入、无伪 VID 电压', async ({ page }) => {
    await page.goto(appUrl())
    await page.getByRole('tab', { name: /LINEAR16/ }).click()
    const voutModeInput = page.locator('#vout-mode-input')
    await voutModeInput.fill('20')
    await voutModeInput.press('Tab')

    // §8.4 fail-closed: the displayed byte is the actual 0x20 (no 0x18 swap),
    // the physical-value input disappears, and the result is not computable.
    await expect(page.locator('#value-input')).toHaveCount(0)
    await expect(page.getByTestId('result-value')).toHaveText('—')
    await expect(page.getByTestId('vout-mode-byte')).toHaveText('0x20')
    await expect(page.getByTestId('vout-mode-source')).toHaveText('非 LINEAR')
    await expect(page.locator('.workspace-l16-block')).toContainText(
      '显式应用计算器 LINEAR 示例 0x18',
    )
  })

  test('L16 relative LINEAR（0x98）显示需要参考值且不给出绝对电压', async ({ page }) => {
    await page.goto(appUrl())
    await page.getByRole('tab', { name: /LINEAR16/ }).click()
    const voutModeInput = page.locator('#vout-mode-input')
    await voutModeInput.fill('98')
    await voutModeInput.press('Tab')

    await expect(page.locator('#value-input')).toHaveCount(0)
    await expect(page.getByTestId('result-value')).toHaveText('—')
    await expect(page.getByText(/相对 LINEAR/).first()).toBeVisible()
    await expect(page.getByText(/标称参考值/).first()).toBeVisible()
  })

  test('复制 Hex 使用当前偏好格式', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto(appUrl())
    const hexInput = page.locator('input[placeholder="0000"]')
    await hexInput.fill('0001')
    await hexInput.press('Tab')

    const copyHex = page.getByRole('button', { name: 'Hex（LE）' })
    await copyHex.scrollIntoViewIfNeeded()
    await copyHex.evaluate((el: HTMLButtonElement) => el.click())

    const clipboard = await page.evaluate(() => navigator.clipboard.readText())
    expect(clipboard).toBe('0x 01 00')
  })

  test('复制 LE bytes 与 C 宏默认使用未交换 raw word', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto(appUrl())
    const hexInput = page.locator('input[placeholder="0000"]')
    await hexInput.fill('0001')
    await hexInput.press('Tab')

    const leBtn = page.getByRole('button', { name: 'LE 字节' })
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

  test('非法 Hex 输入显示明确错误且不修改全局状态', async ({ page }) => {
    await page.goto(appUrl())
    const hexInput = page.locator('input[placeholder="0000"]')

    await hexInput.fill('1G')

    await expect(page.getByText(/仅允许十六进制数字/)).toBeVisible()
    await expect(page.locator('#value-input')).toHaveValue('0')
  })

  test('固定 0x 前缀下粘贴裸 0x 归一化为空 digits，blur 后回到 0', async ({ page }) => {
    await page.goto(appUrl())
    const hexInput = page.locator('input[placeholder="0000"]')

    await hexInput.fill('0x')

    // 固定前缀在 input 外；裸 0x 被归一化为空 digits，是合法过渡态。
    await expect(page.getByText(/0x\/0X 后/)).toHaveCount(0)
    await expect(page.locator('#value-input')).toHaveValue('0')

    await hexInput.press('Tab')
    await expect(hexInput).toHaveValue('0000')
    await expect(page.locator('#value-input')).toHaveValue('0')
  })

  test('超长 Hex 输入显示明确错误且不被静默截断', async ({ page }) => {
    await page.goto(appUrl())
    const hexInput = page.locator('input[placeholder="0000"]')

    await hexInput.fill('12345')

    await expect(page.getByText(/最多 4 位十六进制数字/)).toBeVisible()
    await expect(page.locator('#value-input')).toHaveValue('0')
  })

  test('DIRECT 系数错误只在 DIRECT 模式显示', async ({ page }) => {
    await page.goto(appUrl())
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
    await page.goto(appUrl())

    const prefixBtn = page.getByRole('button', { name: '0x 前缀' })
    await prefixBtn.scrollIntoViewIfNeeded()
    await prefixBtn.evaluate((el: HTMLButtonElement) => el.click())
    const spaceBtn = page.getByRole('button', { name: '字节空格' })
    await spaceBtn.scrollIntoViewIfNeeded()
    await spaceBtn.evaluate((el: HTMLButtonElement) => el.click())
    // v2.6.0: 结果面板的 BE 术语触发器同名，字节序按钮必须按组收窄。
    const endianBtn = page
      .getByLabel('Hex 复制顺序')
      .getByRole('button', { name: 'BE', exact: true })
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
    await expect(
      page.getByLabel('Hex 复制顺序').getByRole('button', { name: 'BE', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true')

    await page.reload()

    await expect(page.getByRole('button', { name: '0x 前缀' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    await expect(page.getByRole('button', { name: '字节空格' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    await expect(
      page.getByLabel('Hex 复制顺序').getByRole('button', { name: 'BE', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true')

    const hexInput = page.locator('input[placeholder="0000"]')
    await hexInput.fill('1234')
    await hexInput.press('Tab')
    const copyHex = page.getByRole('button', { name: 'Hex（BE）' })
    await copyHex.scrollIntoViewIfNeeded()
    await copyHex.evaluate((el: HTMLButtonElement) => el.click())

    const clipboard = await page.evaluate(() => navigator.clipboard.readText())
    expect(clipboard).toBe('1234')
  })

  test('主题切换由全局状态驱动并持久化', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('pmbus-calculator:theme', 'light')
    })
    await page.goto(appUrl())

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')

    await page.getByRole('button', { name: /当前主题: 亮色/ }).click()

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect(page.getByRole('button', { name: /当前主题: 暗色/ })).toBeVisible()

    const stored = await page.evaluate(() => localStorage.getItem('pmbus-calculator:theme'))
    expect(stored).toBe('dark')
  })
})
