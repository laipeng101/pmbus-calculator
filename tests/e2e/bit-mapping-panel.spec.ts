import { expect, test } from '@playwright/test'
import { appUrl } from './helpers/app-url'

const RAW_TOGGLE = 'bit-mapping-raw-word-toggle'
const VOUT_TOGGLE = 'bit-mapping-vout-mode-toggle'
const PREF_KEY = 'pmbus-calculator:bitMappingOpen'

for (const mode of ['LINEAR11', 'LINEAR16', 'DIRECT', 'HALF']) {
  test(`${mode}：位映射默认展开，Hex、位按钮与结果保持同步`, async ({ page }) => {
    await page.goto(appUrl())
    await page.getByRole('tab', { name: new RegExp(mode) }).click()
    const grid = page.getByRole('group', { name: '16 位编辑器', exact: true })
    const hex = page.locator('#raw-hex-input')
    await expect(page.getByTestId(RAW_TOGGLE)).toHaveAttribute('aria-expanded', 'true')
    await expect(grid).toBeVisible()
    await expect(grid.locator('.bitfield-nibble')).toHaveCount(4)
    await expect(grid.getByRole('button')).toHaveCount(16)

    const initialValue = await page.getByTestId('result-value').textContent()
    await grid.getByRole('button', { name: '位 0: 0', exact: true }).click()
    await expect(hex).toHaveValue('0001')
    await expect(page.getByTestId('result-value')).not.toHaveText(initialValue!)
    await hex.fill('0002')
    await hex.press('Tab')
    await expect(grid.getByRole('button', { name: '位 1: 1', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(grid.getByRole('button', { name: '位 0: 0', exact: true })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })
}

test('收起不改变计算请求；隐藏时继续编辑，展开显示当前 raw', async ({ page }) => {
  await page.goto(appUrl())
  await page.locator('#value-input').fill('12.5')
  const result = page.getByTestId('result-panel')
  const before = await result.textContent()
  const toggle = page.getByTestId(RAW_TOGGLE)
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(page.locator('#bit-mapping-raw-word-content')).toBeHidden()
  await expect(page.locator('#raw-hex-input')).toHaveValue('F819')
  expect(await result.textContent()).toBe(before)
  await page.locator('#raw-hex-input').fill('0003')
  await page.locator('#raw-hex-input').press('Tab')
  await expect(page.locator('#value-input')).toHaveValue('3')
  await toggle.click()
  await expect(page.getByRole('button', { name: '位 0: 1', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.getByRole('button', { name: '位 1: 1', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})

test('16 位和 VOUT_MODE 分别记忆展开状态，跨模式和刷新保持', async ({ page }) => {
  await page.goto(appUrl())
  await page.getByTestId(RAW_TOGGLE).click()
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), PREF_KEY))
    .toBe(JSON.stringify({ rawWord: false, voutMode: true }))
  await page.reload()
  await expect(page.getByTestId(RAW_TOGGLE)).toHaveAttribute('aria-expanded', 'false')
  await expect(page.locator('#bit-mapping-raw-word-content')).toBeHidden()
  await page.getByRole('tab', { name: /HALF/ }).click()
  await expect(page.getByTestId(RAW_TOGGLE)).toHaveAttribute('aria-expanded', 'false')

  await page.getByRole('tab', { name: /VOUT_MODE/ }).click()
  await expect(page.getByTestId(VOUT_TOGGLE)).toHaveAttribute('aria-expanded', 'true')
  await page.getByTestId(VOUT_TOGGLE).click()
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), PREF_KEY))
    .toBe(JSON.stringify({ rawWord: false, voutMode: false }))
  await page.reload()
  await expect(page.getByTestId(VOUT_TOGGLE)).toHaveAttribute('aria-expanded', 'false')
  await expect(page.locator('#vout-mode-input')).toBeVisible()
  await page.getByRole('tab', { name: /LINEAR16/ }).click()
  await expect(page.getByTestId(RAW_TOGGLE)).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByTestId(VOUT_TOGGLE)).toHaveAttribute('aria-expanded', 'false')

  await page.getByTestId(VOUT_TOGGLE).click()
  await page.getByRole('button', { name: /第 0 位，参数/ }).click()
  await expect(page.locator('#vout-mode-input')).toHaveValue('19')
  for (const bit of [5, 6]) {
    await expect(
      page.getByRole('button', {
        name: new RegExp(`第 ${bit} 位，格式位固定为 LINEAR`),
      }),
    ).toBeDisabled()
  }
  await page.reload()
  await expect(page.getByTestId(RAW_TOGGLE)).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByTestId(VOUT_TOGGLE)).toHaveAttribute('aria-expanded', 'true')
})

test('Enter/Space 可收起和展开；隐藏位按钮退出 Tab 顺序', async ({ page }) => {
  await page.goto(appUrl())
  const toggle = page.getByTestId(RAW_TOGGLE)
  await toggle.focus()
  await page.keyboard.press('Enter')
  await expect(toggle).toBeFocused()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  expect(await toggle.evaluate((el) => el.matches(':focus-visible'))).toBe(true)
  await page.keyboard.press('Tab')
  expect(await page.evaluate(() => document.activeElement?.closest('.bitfield') == null)).toBe(true)
  await toggle.focus()
  await page.keyboard.press('Space')
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await page.keyboard.press('Tab')
  await expect(
    page.getByRole('group', { name: '16 位编辑器', exact: true }).getByRole('button').first(),
  ).toBeFocused()
})

test('存储被浏览器禁用时面板仍可操作，重新加载安全恢复默认展开', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new Error('storage blocked')
    }
    Storage.prototype.setItem = () => {
      throw new Error('storage blocked')
    }
  })
  await page.goto(appUrl())
  const toggle = page.getByTestId(RAW_TOGGLE)
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await page.reload()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await page.getByRole('button', { name: '位 0: 0', exact: true }).click()
  await expect(page.locator('#raw-hex-input')).toHaveValue('0001')
  expect(errors).toEqual([])
})
