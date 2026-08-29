import { test, expect, type Page } from '@playwright/test'

/**
 * v2.5.11 — DIRECT 精度保真合同（正式站反例 m=1,b=1,R=17）：
 *
 * raw FFFF 的精确物理值是 -1.00000000000000001，binary64 只能显示 -1。
 * 旧产品把两个不同 raw（0000 与 FFFF）无差别显示为同一个 -1，真实回输
 * 显示值会静默改变 payload 并被称为精确零误差。现在：
 *
 * - 折叠状态在提交前就被明确标记：近似值、精确值/分数、回编后果
 *   （"不同的请求"）全部可见；
 * - 「物理值」复制返回经验证可安全回录的精确文本，回输后回到原 raw；
 * - 真实键盘/剪贴板回录路径被逐字节断言，不以 fill 后外观为准；
 * - raw 0000/FFFF 切换、系数修改实时重算，无 stale 状态泄漏；
 * - 安全普通向量不出现噪音告警；v2.5.8 的 1e21/-1e21 向量不回归。
 */

const valueInput = (page: Page) => page.locator('#value-input')
const hexInput = (page: Page) => page.locator('#raw-hex-input')
const resultValue = (page: Page) => page.getByTestId('result-value')
const quantizationPanel = (page: Page) => page.getByTestId('quantization-error')
const copyNote = (page: Page) => page.locator('#physical-value-copy-note')

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

async function expandSteps(page: Page) {
  const details = page.locator('[data-testid="calculation-steps-disclosure"]')
  const open = await details.evaluate((el) => (el as HTMLDetailsElement).open)
  if (!open) await details.locator('summary').click()
  await expect(page.getByTestId('calculation-steps')).toBeVisible()
}

test.describe('DIRECT 精度保真（m=1,b=1,R=17 正式站反例，1280×900）', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    await page.getByRole('tab', { name: /DIRECT/ }).click()
    await setDirectCoefficients(page, 1, 1, 17)
  })

  test('raw FFFF：折叠状态提交前可见——近似值、精确值、回编后果、复制覆盖', async ({ page }) => {
    await setRaw(page, 'FFFF')
    await expect(resultValue(page)).toHaveText('-1')

    // 提交前的事实：显示值是近似值，直接回输会编码为 Y=0（不同的请求）。
    const warning = page.getByText(/不同的请求/).first()
    await expect(warning).toBeVisible()
    await expect(warning).toContainText('-1.00000000000000001')
    await expect(warning).toContainText('Y=0')

    // 复制覆盖：物理值复制给出经验证的精确文本（对当前 raw 而非近似值）。
    await expect(copyNote(page)).toBeVisible()
    await expect(copyNote(page)).toContainText('-1.00000000000000001')

    // 计算步骤给出精确有理数与精确十进制。
    await expandSteps(page)
    const steps = page.getByTestId('calculation-steps')
    await expect(steps).toContainText('-100000000000000001/100000000000000000')
    await expect(steps).toContainText('-1.00000000000000001')

    // raw 0000（同一系数）是安全状态：无折叠告警、无复制覆盖、无精确值步骤。
    await setRaw(page, '0000')
    await expect(resultValue(page)).toHaveText('-1')
    await expect(page.getByText(/不同的请求/)).toHaveCount(0)
    await expect(copyNote(page)).toHaveCount(0)
    await expandSteps(page)
    await expect(page.getByTestId('calculation-steps')).not.toContainText(
      '100000000000000001/100000000000000000',
    )
  })

  test('安全复制文本经真实剪贴板回录后 raw 仍为 FFFF', async ({ page }) => {
    await setRaw(page, 'FFFF')
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    // 点击「物理值」复制按钮，读取剪贴板内容（必须是精确文本而非 -1）。
    await page.getByRole('button', { name: '物理值' }).click()
    const copied = await page.evaluate(() => navigator.clipboard.readText())
    expect(copied).toBe('-1.00000000000000001')

    // 真实剪贴板粘贴回录：全选 → 粘贴 → Enter，raw 必须保持 FFFF。
    // 提交后输入框回到折叠显示 -1（binary64 解码）——但 raw 与折叠告警
    // 证明载荷回录到了原 Y，而不是旧 float 路径的 0000。
    await valueInput(page).click()
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.press('ControlOrMeta+v')
    await valueInput(page).press('Enter')
    await expect(hexInput(page)).toHaveValue('FFFF')
    await expect(valueInput(page)).toHaveValue('-1')
    await expect(page.getByText(/不同的请求/).first()).toBeVisible()
  })

  test('显式输入 -1 提交为 raw 0000：提交前已说明这是不同请求', async ({ page }) => {
    await setRaw(page, 'FFFF')
    // 提交前：折叠告警可见（用户在输入前就能知道 -1 会编码为不同 raw）。
    await expect(page.getByText(/不同的请求/).first()).toBeVisible()

    // 真实键盘输入 -1 并提交。
    await valueInput(page).click()
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.type('-1', { delay: 30 })
    await valueInput(page).press('Enter')

    // 新状态是诚实的：raw 0000、精确 -1、无折叠告警。
    await expect(hexInput(page)).toHaveValue('0000')
    await expect(resultValue(page)).toHaveText('-1')
    await expect(page.getByText(/不同的请求/)).toHaveCount(0)
    await expect(quantizationPanel(page)).toHaveAttribute('data-kind', 'ok')
    await expect(copyNote(page)).toHaveCount(0)
  })

  test('raw 0000 ↔ FFFF 切换：告警/步骤/复制无 stale 泄漏', async ({ page }) => {
    await setRaw(page, 'FFFF')
    await expect(page.getByText(/不同的请求/).first()).toBeVisible()
    await setRaw(page, '0000')
    await expect(page.getByText(/不同的请求/)).toHaveCount(0)
    await setRaw(page, 'FFFF')
    await expect(page.getByText(/不同的请求/).first()).toBeVisible()
    await expect(copyNote(page)).toContainText('-1.00000000000000001')
  })

  test('系数修改实时重算：R=17 → R=0 后同一 raw 不再折叠', async ({ page }) => {
    await setRaw(page, 'FFFF')
    await expect(page.getByText(/不同的请求/).first()).toBeVisible()
    await page.locator('#direct-coeff-r-input').fill('0')
    await page.locator('#direct-coeff-r-input').press('Tab')
    // R=0 时 Y=-1 精确等于 -1：安全状态，所有折叠表面消失。
    await expect(page.getByText(/不同的请求/)).toHaveCount(0)
    await expect(copyNote(page)).toHaveCount(0)
    await expect(hexInput(page)).toHaveValue('FFFF')
  })

  test('untouched focus/blur 保持严格 no-op（raw 与告警都不变）', async ({ page }) => {
    await setRaw(page, 'FFFF')
    const warningBefore = await page
      .getByText(/不同的请求/)
      .first()
      .textContent()
    await valueInput(page).click()
    await valueInput(page).press('Tab')
    await expect(hexInput(page)).toHaveValue('FFFF')
    await expect(valueInput(page)).toHaveValue('-1')
    await expect(page.getByText(/不同的请求/).first()).toHaveText(warningBefore ?? '')
  })

  test('折叠告警与复制说明的 ARIA 关联正确', async ({ page }) => {
    await setRaw(page, 'FFFF')
    const copyButton = page.getByRole('button', { name: '物理值' })
    await expect(copyButton).toBeVisible()
    await expect(copyButton).not.toBeDisabled()
    await expect(copyButton).toHaveAttribute('aria-describedby', 'physical-value-copy-note')
    await expect(page.locator('#physical-value-copy-note')).toBeVisible()
  })
})

test.describe('DIRECT 循环小数与安全向量（1280×900）', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    await page.getByRole('tab', { name: /DIRECT/ }).click()
  })

  test('m=3,b=1,R=17 循环小数：复制经验证近似文本回录回到原 raw', async ({ page }) => {
    await setDirectCoefficients(page, 3, 1, 17)
    await setRaw(page, '8001')
    // Y=-32767 的 float 解码回编为 Y=-32768：折叠状态必须被标记。
    await expect(page.getByText(/不同的请求/).first()).toBeVisible()
    // 步骤声明循环小数没有有限精确十进制。
    await expandSteps(page)
    await expect(page.getByTestId('calculation-steps')).toContainText('循环小数，无有限精确十进制')
    // 复制 → 真实回录 → raw 仍 8001。
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.getByRole('button', { name: '物理值' }).click()
    const copied = await page.evaluate(() => navigator.clipboard.readText())
    expect(copied).not.toBe('')
    await valueInput(page).click()
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.press('ControlOrMeta+v')
    await valueInput(page).press('Enter')
    await expect(hexInput(page)).toHaveValue('8001')
  })

  test('普通安全向量不出现噪音告警；v2.5.8 的 1e21/-1e21 向量不回归', async ({ page }) => {
    await setDirectCoefficients(page, 1, 0, 0)
    await valueInput(page).fill('12')
    await valueInput(page).press('Tab')
    await expect(hexInput(page)).toHaveValue('000C')
    await expect(page.getByText(/不同的请求/)).toHaveCount(0)
    await expect(quantizationPanel(page)).toHaveAttribute('data-kind', 'ok')

    await setDirectCoefficients(page, 1, 0, -21)
    await valueInput(page).fill('1e21')
    await valueInput(page).press('Tab')
    await expect(hexInput(page)).toHaveValue('0001')
    await valueInput(page).fill('-1e21')
    await valueInput(page).press('Tab')
    await expect(hexInput(page)).toHaveValue('FFFF')
    await expect(page.getByText(/不同的请求/)).toHaveCount(0)
  })
})

test.describe('DIRECT 精度保真响应式与资源（390/360px）', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.getByRole('tab', { name: /DIRECT/ }).click()
    await setDirectCoefficients(page, 1, 1, 17)
    await setRaw(page, 'FFFF')
  })

  for (const width of [390, 360]) {
    test(`${width}px：告警/复制说明可见且无横向溢出`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 })
      await expect(page.getByText(/不同的请求/).first()).toBeVisible()
      await expect(copyNote(page)).toBeVisible()
      const { scrollWidth, clientWidth } = await page
        .locator('body')
        .evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }))
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth)
      // 键盘焦点仍可到达复制按钮。
      await page.getByRole('button', { name: '物理值' }).focus()
      await expect(page.getByRole('button', { name: '物理值' })).toBeFocused()
    })
  }

  test('无产品源 console/page error', async ({ page }) => {
    const consoleErrors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })
    page.on('pageerror', (err) => consoleErrors.push(String(err)))
    await setRaw(page, '0000')
    await setRaw(page, 'FFFF')
    await valueInput(page).click()
    await valueInput(page).press('Tab')
    expect(consoleErrors).toEqual([])
  })
})

test.describe('DIRECT 精确请求 provenance（v2.5.12 正式站反例，1280×900）', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    await page.getByRole('tab', { name: /DIRECT/ }).click()
  })

  async function commitViaKeyboard(page: Page, text: string) {
    await valueInput(page).click()
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.type(text, { delay: 20 })
    await valueInput(page).press('Enter')
  }

  test('反例 A：整数请求 100000000000000001 → raw 0001，量化面板报精确 +1（非零）', async ({
    page,
  }) => {
    await setDirectCoefficients(page, 1, 0, -17)
    await commitViaKeyboard(page, '100000000000000001')

    await expect(hexInput(page)).toHaveValue('0001')
    // 输入框沿用 represented 的规范化显示；面板保留原始请求。
    await expect(valueInput(page)).toHaveValue('100000000000000000')
    await expect(quantizationPanel(page)).toHaveAttribute('data-kind', 'warn')
    await expect(quantizationPanel(page)).toContainText('+1（约 1e-15%）')
    await expect(quantizationPanel(page)).toContainText('用户请求 100000000000000001')
    await expect(quantizationPanel(page)).toContainText('raw 精确表示 100000000000000000')

    // 步骤：请求、精确表示、精确误差同屏可见。
    await expandSteps(page)
    const steps = page.getByTestId('calculation-steps')
    await expect(steps).toContainText('100000000000000001')
    await expect(steps).toContainText('raw 精确解码值')
    await expect(steps).toContainText('精确误差（请求 − 表示）')

    // 物理值复制仍是可安全回录的表示值：真实剪贴板回录回到 raw 0001。
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.getByRole('button', { name: '物理值' }).click()
    const copied = await page.evaluate(() => navigator.clipboard.readText())
    expect(copied).toBe('100000000000000000')
    await commitViaKeyboard(page, copied)
    await expect(hexInput(page)).toHaveValue('0001')
  })

  test('反例 A 负向对称：-100000000000000001 → raw FFFF，精确 -1', async ({ page }) => {
    await setDirectCoefficients(page, 1, 0, -17)
    await commitViaKeyboard(page, '-100000000000000001')
    await expect(hexInput(page)).toHaveValue('FFFF')
    await expect(quantizationPanel(page)).toContainText('-1（约 -1e-15%）')
    await expect(quantizationPanel(page)).toContainText('用户请求 -100000000000000001')
  })

  test('反例 B：-1.0000000000000000001 → raw 0000，精确 -1e-19（绝不显示为 0）', async ({
    page,
  }) => {
    await setDirectCoefficients(page, 1, 1, 17)
    await commitViaKeyboard(page, '-1.0000000000000000001')
    await expect(hexInput(page)).toHaveValue('0000')
    await expect(quantizationPanel(page)).toHaveAttribute('data-kind', 'warn')
    await expect(quantizationPanel(page)).toContainText('-1e-19（约 -1e-17%）')
    await expect(quantizationPanel(page)).toContainText('用户请求 -1.0000000000000000001')
    await expect(quantizationPanel(page)).toContainText('raw 精确表示 -1')
  })

  test('反例 C：精确越界饱和——32767.0000000000000001 → 7FFF / +1e-16', async ({ page }) => {
    await setDirectCoefficients(page, 1, 0, 0)
    await commitViaKeyboard(page, '32767.0000000000000001')
    await expect(hexInput(page)).toHaveValue('7FFF')
    await expect(quantizationPanel(page)).toHaveAttribute('data-kind', 'error')
    await expect(quantizationPanel(page)).toContainText('+1e-16（已编码到边界值）')
    await commitViaKeyboard(page, '-32768.0000000000000001')
    await expect(hexInput(page)).toHaveValue('8000')
    await expect(quantizationPanel(page)).toHaveAttribute('data-kind', 'error')
    await expect(quantizationPanel(page)).toContainText('-1e-16（已编码到边界值）')
    // 精确端点仍是 exact，不误报饱和。
    await commitViaKeyboard(page, '32767')
    await expect(hexInput(page)).toHaveValue('7FFF')
    await expect(quantizationPanel(page)).toHaveAttribute('data-kind', 'ok')
    await commitViaKeyboard(page, '-32768')
    await expect(hexInput(page)).toHaveValue('8000')
    await expect(quantizationPanel(page)).toHaveAttribute('data-kind', 'ok')
  })

  test('provenance 生命周期：真实 raw 编辑清除、untouched blur 保留、显式同值重输重建', async ({
    page,
  }) => {
    await setDirectCoefficients(page, 1, 0, -17)
    await commitViaKeyboard(page, '100000000000000001')
    await expect(quantizationPanel(page)).toContainText('用户请求 100000000000000001')

    // untouched focus/blur：严格 no-op，provenance 保留。
    await valueInput(page).click()
    await valueInput(page).press('Tab')
    await expect(quantizationPanel(page)).toContainText('用户请求 100000000000000001')

    // 显式同值重输：重新建立 provenance（新事务，面板仍在）。
    await commitViaKeyboard(page, '100000000000000001')
    await expect(hexInput(page)).toHaveValue('0001')
    await expect(quantizationPanel(page)).toContainText('用户请求 100000000000000001')

    // 真实 raw 编辑（键盘全选替换）：provenance 清除，面板消失。
    await hexInput(page).click()
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.type('1234', { delay: 20 })
    await hexInput(page).press('Tab')
    await expect(hexInput(page)).toHaveValue('1234')
    await expect(quantizationPanel(page)).toHaveCount(0)
  })

  test('fidelity 折叠告警与量化面板共存且不矛盾（请求精确可表示时）', async ({ page }) => {
    await setDirectCoefficients(page, 1, 1, 17)
    // 请求 -1.00000000000000001 恰好精确可表示：raw FFFF、量化 exact，
    // 但显示值折叠——两个告警必须同时可见。
    await commitViaKeyboard(page, '-1.00000000000000001')
    await expect(hexInput(page)).toHaveValue('FFFF')
    await expect(page.getByText(/不同的请求/).first()).toBeVisible()
    await expect(quantizationPanel(page)).toContainText('+0.000000 (0.0000%)')
    await expect(quantizationPanel(page)).toContainText('用户请求 -1.00000000000000001')
  })

  for (const width of [390, 360]) {
    test(`${width}px：长精确请求文本换行显示且无横向溢出`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 })
      await setDirectCoefficients(page, 1, 0, -17)
      await commitViaKeyboard(page, '100000000000000001')
      await expect(quantizationPanel(page)).toContainText('用户请求 100000000000000001')
      const { scrollWidth, clientWidth } = await page
        .locator('body')
        .evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }))
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth)
      // 完整值仍可通过步骤访问（不截断丢失）。
      await expandSteps(page)
      await expect(page.getByTestId('calculation-steps')).toContainText('100000000000000001')
    })
  }
})
