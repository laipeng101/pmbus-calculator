import { test, expect, type Page } from '@playwright/test'
import { expectNoHorizontalOverflow } from './helpers/layout'

// The displayed DIRECT value can round to a number that encodes to a different
// Raw Word. Exercise typing it and pasting the calculator's copy through the
// real input and clipboard paths.

const valueInput = (page: Page) => page.locator('#value-input')
const hexInput = (page: Page) => page.locator('#raw-hex-input')
const resultValue = (page: Page) => page.getByTestId('result-value')
const quantizationPanel = (page: Page) => page.getByTestId('quantization-error')
const copyNote = (page: Page) => page.locator('#physical-value-copy-note')
const precisionWarning = (page: Page) =>
  page.getByRole('alert').filter({ hasText: '重新输入显示值' })

async function setDirectCoefficients(page: Page, m: number, b: number, r: number) {
  await page.locator('#direct-coeff-m-input').fill(String(m))
  await page.locator('#direct-coeff-m-input').press('Tab')
  await page.locator('#direct-coeff-b-input').fill(String(b))
  await page.locator('#direct-coeff-b-input').press('Tab')
  await page.locator('#direct-coeff-r-input').fill(String(r))
  await page.locator('#direct-coeff-r-input').press('Tab')
}

async function setRaw(page: Page, hex: string) {
  await hexInput(page).fill(hex)
  await hexInput(page).press('Tab')
}

async function pasteCopiedValue(page: Page, startingRaw: string) {
  // Change the Raw Word first so a paste that never commits cannot pass.
  await setRaw(page, startingRaw)
  await expect(hexInput(page)).toHaveValue(startingRaw)
  await valueInput(page).click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('ControlOrMeta+v')
  await valueInput(page).press('Enter')
}

async function expandSteps(page: Page) {
  const details = page.locator('[data-testid="calculation-steps-disclosure"]')
  const open = await details.evaluate((el) => (el as HTMLDetailsElement).open)
  if (!open) await details.locator('summary').click()
  await expect(page.getByTestId('calculation-steps')).toBeVisible()
}

async function typeValue(page: Page, text: string) {
  const input = valueInput(page)
  await input.click()
  await input.press('ControlOrMeta+a')
  await input.press('Backspace')
  await input.pressSequentially(text)
  await input.press('Enter')
}

async function pasteValue(page: Page, text: string) {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.evaluate((draft) => navigator.clipboard.writeText(draft), text)
  await valueInput(page).click()
  await valueInput(page).press('ControlOrMeta+a')
  await valueInput(page).press('ControlOrMeta+v')
}

const longText = '9'.repeat(4_097)
const longError = (page: Page) => page.getByText(/输入过长，未提交/)

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('./')
  await page.getByRole('tab', { name: /DIRECT/ }).click()
})

test(
  'DIRECT 浮点精度不足时真实复制、粘贴精确值可恢复原字',
  { tag: '@browser-smoke' },
  async ({ page, context }) => {
    await setDirectCoefficients(page, 1, 1, 17)
    await setRaw(page, 'FFFF')
    await expect(resultValue(page)).toHaveText('-1')
    const warning = precisionWarning(page)
    await expect(warning).toContainText('浮点精度有限')
    await expect(warning).toContainText('Y = 0')
    await expect(copyNote(page)).toContainText('复制精确值')
    const copy = page.getByRole('button', { name: '物理值', exact: true })
    await expect(copy).toHaveAttribute('aria-describedby', 'physical-value-copy-note')
    await expandSteps(page)
    const steps = page.getByTestId('calculation-steps')
    await expect(steps).toContainText('-100000000000000001/100000000000000000')
    await expect(steps).toContainText('-1.00000000000000001')

    await valueInput(page).click()
    await valueInput(page).press('Tab')
    await expect(hexInput(page)).toHaveValue('FFFF')
    await expect(warning).toContainText('Y = 0')
    await expect(quantizationPanel(page)).toHaveCount(0)

    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await copy.click()
    await expect(page.getByText('已复制: 物理值', { exact: true })).toBeVisible()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('-1.00000000000000001')
    await pasteCopiedValue(page, '0000')
    await expect(hexInput(page)).toHaveValue('FFFF')
    await expect(valueInput(page)).toHaveValue('-1')
    await expect(warning).toBeVisible()
    await expect(quantizationPanel(page)).toContainText('用户请求 -1.00000000000000001')
    await expect(quantizationPanel(page)).toContainText('+0.000000 (0.0000%)')
    await expect(quantizationPanel(page)).toHaveAttribute('data-kind', 'warn')

    await typeValue(page, '-1')
    await expect(hexInput(page)).toHaveValue('0000')
    await expect(resultValue(page)).toHaveText('-1')
    await expect(warning).toHaveCount(0)
    await expect(copyNote(page)).toHaveCount(0)
  },
)

test('DIRECT 显示位数不足时说明重输影响，修改系数后清除过时告警', async ({ page }) => {
  await setDirectCoefficients(page, 1, 1, 12)
  await setRaw(page, 'FFFF')
  await expect(resultValue(page)).toHaveText('-1')
  const warning = precisionWarning(page)
  await expect(warning).toContainText('Y = 0')
  await expect(warning).toContainText('显示位数有限')
  await expect(copyNote(page)).toContainText('复制精确值')
  await expandSteps(page)
  await expect(page.getByTestId('calculation-steps')).toContainText('-1.000000000001')

  await page.locator('#direct-coeff-r-input').fill('0')
  await page.locator('#direct-coeff-r-input').press('Tab')
  await expect(hexInput(page)).toHaveValue('FFFF')
  await expect(warning).toHaveCount(0)
  await expect(copyNote(page)).toHaveCount(0)
  await expect(page.getByTestId('calculation-steps-disclosure')).toHaveCount(0)
})

test('循环小数复制可重输的近似值，粘贴恢复原字', async ({ page }) => {
  await setDirectCoefficients(page, 3, 1, 16)
  await setRaw(page, '0000')
  await expect(resultValue(page)).toHaveText('-0.333333333333')

  // 显示文本 -0.333333333333 回编为 Y=10000：告警在提交前可见。
  const warning = precisionWarning(page)
  await expect(warning).toBeVisible()
  await expect(warning).toContainText('Y = 10000')
  await expect(copyNote(page)).toContainText('近似值')
  await expandSteps(page)
  await expect(page.getByTestId('calculation-steps')).toContainText('-1/3')

  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.getByRole('button', { name: '物理值' }).click()
  const copied = await page.evaluate(() => navigator.clipboard.readText())
  expect(copied).toBe('-0.33333333333333333')
  await pasteCopiedValue(page, '0001')
  await expect(hexInput(page)).toHaveValue('0000')
})

test('DIRECT 精确请求与结果误差在主面板、步骤同步并按编辑来源变化', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 })
  await setDirectCoefficients(page, 1, 0, -17)
  const text = '100000000000000001'
  const panel = quantizationPanel(page)
  await typeValue(page, text)
  await expect(hexInput(page)).toHaveValue('0001')
  await expect(panel).toHaveAttribute('data-kind', 'warn')
  await expect(panel).toContainText('+1（约 1e-15%）')
  await expect(panel).toContainText(`用户请求 ${text}`)
  await expect(panel).toContainText('raw 精确表示 100000000000000000')
  await expandSteps(page)
  const steps = page.getByTestId('calculation-steps')
  await expect(steps).toContainText(text)
  await expect(steps).toContainText('raw 精确解码值')
  await expect(steps).toContainText('精确误差（请求 − 表示）')
  await expectNoHorizontalOverflow(page)

  await valueInput(page).click()
  await valueInput(page).press('Tab')
  await expect(panel).toContainText(`用户请求 ${text}`)
  await setRaw(page, '1234')
  await expect(panel).toHaveCount(0)
  await typeValue(page, text)
  await expect(hexInput(page)).toHaveValue('0001')
  await expect(panel).toContainText(`用户请求 ${text}`)
})

test('360 px 可读取 DIRECT 保真告警及复制说明', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 })
  await setDirectCoefficients(page, 1, 1, 17)
  await setRaw(page, 'FFFF')
  await expect(precisionWarning(page)).toBeVisible()
  await expect(copyNote(page)).toBeVisible()
  await expectNoHorizontalOverflow(page)
})

test('DIRECT 在同一输入入口接受长度上限，拒绝填充文本并接受补偿指数', async ({ page }) => {
  const panel = quantizationPanel(page)
  const maxText = `${'0'.repeat(4095)}1`
  await pasteValue(page, maxText)
  await valueInput(page).press('Enter')
  await expect(hexInput(page)).toHaveValue('0001')
  await expect(panel).toHaveAttribute('data-kind', 'ok')
  await expect(panel).toContainText(maxText)
  await expectNoHorizontalOverflow(page)

  // The whitespace is part of the raw input length even when trimming
  // would leave only a valid single digit.
  await pasteValue(page, `${' '.repeat(4096)}2`)
  await valueInput(page).press('Tab')
  await expect(longError(page)).toBeVisible()
  await expect(hexInput(page)).toHaveValue('0001')
  await expect(panel).toContainText(maxText)

  const compensated = `2${'0'.repeat(501)}e-501`
  await pasteValue(page, compensated)
  await valueInput(page).press('Enter')
  await expect(hexInput(page)).toHaveValue('0002')
  await expect(longError(page)).toHaveCount(0)
  await expect(panel).toHaveAttribute('data-kind', 'ok')
  await expect(panel).toContainText(compensated)
  await expectNoHorizontalOverflow(page)
})

test('超长粘贴后按 Tab 或 Enter 保留 DIRECT 原字', async ({ page }) => {
  await setDirectCoefficients(page, 1, 1, 17)
  const raw = hexInput(page)
  const input = valueInput(page)
  const panel = quantizationPanel(page)
  await setRaw(page, 'FFFF')
  await expect(input).toHaveValue('-1')
  await expect(precisionWarning(page)).toBeVisible()
  await expect(panel).toHaveCount(0)

  for (const key of ['Tab', 'Enter'] as const) {
    await pasteValue(page, longText)
    await expect(longError(page)).toBeVisible()
    await input.press(key)
    await expect(raw).toHaveValue('FFFF')
    await expect(input).toHaveValue('-1')
    await expect(precisionWarning(page)).toBeVisible()
    await expect(panel).toHaveCount(0)
    await expect(longError(page)).toBeVisible()
  }

  await page.getByRole('tab', { name: /HALF/ }).click()
  await expect(longError(page)).toHaveCount(0)
  await page.getByRole('tab', { name: /DIRECT/ }).click()
  await expect(longError(page)).toHaveCount(0)
  await expect(raw).toHaveValue('FFFF')
})

test('已有精确请求时，拒绝超长粘贴会保留原字、请求和误差', async ({ page }) => {
  await setDirectCoefficients(page, 1, 0, -17)
  const text = '100000000000000001'
  const input = valueInput(page)
  const panel = quantizationPanel(page)
  await typeValue(page, text)

  // A transitional draft must never normalize to zero after rejection.
  await input.click()
  await input.press('ControlOrMeta+a')
  await input.press('Backspace')
  await input.pressSequentially('-.')
  await expect(input).toHaveValue('-.')
  await pasteValue(page, longText)
  await input.press('Enter')
  await expect(hexInput(page)).toHaveValue('0001')
  await expect(panel).toContainText(`用户请求 ${text}`)
  await expect(panel).toContainText('+1（约 1e-15%）')

  await input.click()
  await input.press('Tab')
  await expect(longError(page)).toBeVisible()
  await expect(hexInput(page)).toHaveValue('0001')
  await expect(panel).toContainText(`用户请求 ${text}`)
  await typeValue(page, text)
  await expect(longError(page)).toHaveCount(0)
  await expect(hexInput(page)).toHaveValue('0001')
  await expect(panel).toContainText('+1（约 1e-15%）')
})

test('拒绝超长候选保留同一次编辑中最后提交的值，清空后可重新提交', async ({ page }) => {
  const input = valueInput(page)
  const panel = quantizationPanel(page)
  await input.fill('7')
  await expect(hexInput(page)).toHaveValue('0007')
  await input.pressSequentially('x')
  await expect(page.getByText(/物理值输入无效/)).toBeVisible()
  await pasteValue(page, longText)
  await hexInput(page).click()
  await expect(input).not.toBeFocused()
  await expect(hexInput(page)).toHaveValue('0007')
  await expect(longError(page)).toBeVisible()
  await expect(panel).toHaveAttribute('data-kind', 'ok')

  await input.click()
  await input.press('ControlOrMeta+a')
  await input.press('Backspace')
  await input.press('Tab')
  await expect(hexInput(page)).toHaveValue('0000')
  await expect(longError(page)).toHaveCount(0)
})
