import { test, expect, type Page } from '@playwright/test'

/**
 * Physical-value input blur transaction contract (v2.5.6):
 *
 * - 只 focus 后 blur（未发生任何编辑）是严格 no-op：不改写 raw、不派发
 *   value/set、不伪造格式编码量化误差请求来源（DOMAIN_MODEL §6.1）；
 * - 真实编辑（fill / 键入）仍按既有合同提交，包括 HALF 显式重输 NaN
 *   得到 canonical 0x7E00 与 special/warn provenance；
 * - Part II §7.6.2：设备读回必须返回主机写入的精确 IEEE 编码——
 *   0x7C01 与 0x7E00 都是 NaN，但 raw word 不同，不得因显示层往返合并。
 */

async function setTheme(page: Page, theme: 'light' | 'dark') {
  await page.addInitScript((value) => {
    localStorage.setItem('pmbus-calculator:theme', value)
  }, theme)
}

async function expectNoBodyHorizontalOverflow(page: Page) {
  const { scrollWidth, clientWidth } = await page.locator('body').evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }))
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth)
}

const hexInput = (page: Page) => page.locator('input[placeholder="0000"]')
const valueInput = (page: Page) => page.locator('#value-input')
const quantizationPanel = (page: Page) => page.getByTestId('quantization-error')
const halfSpecialCard = (page: Page) => page.getByTestId('half-special-semantics')

async function expectNoFieldErrorFor(page: Page, inputId: string) {
  const input = page.locator(`#${inputId}`)
  await expect(input).not.toHaveAttribute('aria-invalid', 'true')
  const describedBy = await input.getAttribute('aria-describedby')
  if (describedBy) {
    expect(await page.locator(`#${describedBy}`).count()).toBe(0)
  }
}

test.describe('HALF untouched blur（1280×900 dark）', () => {
  test.beforeEach(async ({ page }) => {
    await setTheme(page, 'dark')
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    await page.getByRole('tab', { name: /HALF/ }).click()
  })

  test('raw 7C01（非规范 NaN）无操作 focus/blur 后 raw 不变、误差隐藏、特殊值卡仍在', async ({
    page,
  }) => {
    await hexInput(page).fill('7C01')
    await hexInput(page).press('Tab')
    await expect(valueInput(page)).toHaveValue('NaN')
    await expect(halfSpecialCard(page)).toHaveCount(1)
    await expect(quantizationPanel(page)).toHaveCount(0)

    // 未编辑任何字符：focus -> blur
    await valueInput(page).click()
    await valueInput(page).press('Tab')
    await expect(hexInput(page)).toHaveValue('7C01')
    await expect(valueInput(page)).toHaveValue('NaN')
    await expect(quantizationPanel(page)).toHaveCount(0)
    await expect(halfSpecialCard(page)).toHaveCount(1)
    await expectNoBodyHorizontalOverflow(page)
  })

  test('raw FC01（负号非规范 NaN）无操作 blur 后 raw 不变', async ({ page }) => {
    await hexInput(page).fill('FC01')
    await hexInput(page).press('Tab')
    await expect(valueInput(page)).toHaveValue('NaN')

    await valueInput(page).click()
    await valueInput(page).press('Tab')
    await expect(hexInput(page)).toHaveValue('FC01')
    await expect(quantizationPanel(page)).toHaveCount(0)
  })

  test('显式重输 NaN 仍 canonical 化为 7E00 并出现 special provenance', async ({ page }) => {
    await hexInput(page).fill('7C01')
    await hexInput(page).press('Tab')
    await expect(valueInput(page)).toHaveValue('NaN')
    await expect(quantizationPanel(page)).toHaveCount(0)

    // 真实用户重输：先清空（过渡态，不提交）再输入 NaN。字段已显示 NaN 时
    // 同值 fill 不触发 React onChange，必须经过真实编辑事务。
    await valueInput(page).fill('')
    await valueInput(page).fill('NaN')
    await expect(hexInput(page)).toHaveValue('7E00')
    await expect(quantizationPanel(page)).toHaveCount(1)
    await expect(quantizationPanel(page)).toContainText('NaN → NaN')
    await expect(quantizationPanel(page)).toHaveAttribute('data-kind', 'warn')
    await expect(halfSpecialCard(page)).toHaveCount(1)
  })

  test('Enter 触发的 untouched blur 同样是 no-op', async ({ page }) => {
    await hexInput(page).fill('7C01')
    await hexInput(page).press('Tab')
    await expect(valueInput(page)).toHaveValue('NaN')

    await valueInput(page).click()
    await valueInput(page).press('Enter')
    await expect(hexInput(page)).toHaveValue('7C01')
    await expect(quantizationPanel(page)).toHaveCount(0)
  })
})

test.describe('HALF signed-zero shorthand（1280×900 dark）', () => {
  test.beforeEach(async ({ page }) => {
    await setTheme(page, 'dark')
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    await page.getByRole('tab', { name: /HALF/ }).click()
  })

  test('-.0 解析为 -0：raw 8000、显示 -0、exact provenance（v2.5.7 §7.6）', async ({ page }) => {
    await valueInput(page).fill('-.0')
    await expect(hexInput(page)).toHaveValue('8000')
    await valueInput(page).press('Tab')
    await expect(valueInput(page)).toHaveValue('-0')
    await expect(hexInput(page)).toHaveValue('8000')
    await expect(quantizationPanel(page)).toHaveCount(1)
    await expect(quantizationPanel(page)).toHaveAttribute('data-kind', 'ok')
  })

  test('负零简写矩阵：-.00 / -0.0 / -0e3 全部编码 0x8000', async ({ page }) => {
    for (const text of ['-.00', '-0.0', '-0e3']) {
      await valueInput(page).fill(text)
      await expect(hexInput(page), text).toHaveValue('8000')
      await valueInput(page).press('Tab')
      await expect(valueInput(page), text).toHaveValue('-0')
    }
  })

  test('正零简写矩阵：.0 / +.0 / 0.0 编码 0x0000', async ({ page }) => {
    for (const text of ['.0', '+.0', '0.0']) {
      await valueInput(page).fill(text)
      await expect(hexInput(page), text).toHaveValue('0000')
      await valueInput(page).press('Tab')
      await expect(valueInput(page), text).toHaveValue('0')
    }
  })

  test('编辑中的 -. 是过渡态：raw 不动；blur 规范化为 -0（8000）', async ({ page }) => {
    await hexInput(page).fill('7C01')
    await hexInput(page).press('Tab')
    await expect(valueInput(page)).toHaveValue('NaN')

    // 真实逐键编辑：先清空（过渡态），再键入 -. —— 每一步都不得提交 raw。
    await valueInput(page).fill('')
    await valueInput(page).pressSequentially('-')
    await expect(hexInput(page)).toHaveValue('7C01')
    await valueInput(page).pressSequentially('.')
    await expect(hexInput(page)).toHaveValue('7C01')
    await expectNoFieldErrorFor(page, 'value-input')

    await valueInput(page).press('Tab')
    await expect(hexInput(page)).toHaveValue('8000')
    await expect(valueInput(page)).toHaveValue('-0')
  })

  test('blur 规范化：. 与 +. 归一为 0（0000），-. 归一为 -0（8000）', async ({ page }) => {
    await valueInput(page).fill('')
    await valueInput(page).pressSequentially('.')
    await valueInput(page).press('Tab')
    await expect(hexInput(page)).toHaveValue('0000')
    await expect(valueInput(page)).toHaveValue('0')

    await valueInput(page).fill('')
    await valueInput(page).pressSequentially('+.')
    await valueInput(page).press('Tab')
    await expect(hexInput(page)).toHaveValue('0000')
    await expect(valueInput(page)).toHaveValue('0')

    await valueInput(page).fill('')
    await valueInput(page).pressSequentially('-.')
    await valueInput(page).press('Tab')
    await expect(hexInput(page)).toHaveValue('8000')
    await expect(valueInput(page)).toHaveValue('-0')
  })
})

test.describe('LINEAR11 untouched blur（360×800 light）', () => {
  test.beforeEach(async ({ page }) => {
    await setTheme(page, 'light')
    await page.setViewportSize({ width: 360, height: 800 })
    await page.goto('/')
  })

  test('raw 0801（N=1,Y=1）无操作 focus/blur 后 raw、N、Y 不变、误差隐藏', async ({ page }) => {
    await hexInput(page).fill('0801')
    await hexInput(page).press('Tab')
    await expect(valueInput(page)).toHaveValue('2')
    await expect(quantizationPanel(page)).toHaveCount(0)

    await valueInput(page).click()
    await valueInput(page).press('Tab')
    await expect(hexInput(page)).toHaveValue('0801')
    await expect(valueInput(page)).toHaveValue('2')
    await expect(page.getByLabel('N 值 (指数)')).toHaveValue('1')
    await expect(page.getByLabel('Y（11 位有符号整数）')).toHaveValue('1')
    await expect(quantizationPanel(page)).toHaveCount(0)
    await expectNoBodyHorizontalOverflow(page)
  })

  test('显式编辑物理值仍提交（0801 -> 输入 2 -> canonical 0002 且 provenance 出现）', async ({
    page,
  }) => {
    await hexInput(page).fill('0801')
    await hexInput(page).press('Tab')
    await expect(quantizationPanel(page)).toHaveCount(0)

    // 显式请求走 findBestLinear11 的 canonical 编码（N=0,Y=2 -> 0002），
    // 请求与表示值相等（exact: +0.000000）；provenance 必须来自用户事务
    // 而非 blur 伪造——这是与 untouched blur 相反的路径。字段已显示 2，
    // 同值 fill 不触发 React onChange，先清空再输入。
    await valueInput(page).fill('')
    await valueInput(page).fill('2')
    await expect(quantizationPanel(page)).toHaveCount(1)
    await expect(quantizationPanel(page)).toContainText('+0.000000')
    await expect(hexInput(page)).toHaveValue('0002')
  })
})

test.describe('LINEAR16 untouched blur（390×844 dark）', () => {
  test.beforeEach(async ({ page }) => {
    await setTheme(page, 'dark')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    await page.getByRole('tab', { name: /LINEAR16/ }).click()
  })

  test('raw Hex 编辑后 untouched value blur：raw、结果、N 不变、误差隐藏', async ({ page }) => {
    await hexInput(page).fill('0005')
    await hexInput(page).press('Tab')
    await expect(valueInput(page)).toHaveValue('0.01953125')
    await expect(quantizationPanel(page)).toHaveCount(0)

    // 未编辑任何字符：focus -> blur 不创建 LINEAR16 编码请求
    await valueInput(page).click()
    await valueInput(page).press('Tab')
    await expect(hexInput(page)).toHaveValue('0005')
    await expect(valueInput(page)).toHaveValue('0.01953125')
    await expect(page.getByLabel('L16 N（指数）')).toHaveValue('-8')
    await expect(quantizationPanel(page)).toHaveCount(0)
    await expectNoBodyHorizontalOverflow(page)
  })

  test('显式编辑物理值仍提交（fill 1 -> raw 0100 且 exact provenance 出现）', async ({ page }) => {
    await hexInput(page).fill('0005')
    await hexInput(page).press('Tab')
    await expect(quantizationPanel(page)).toHaveCount(0)

    // N=-8：Y_u = X / 2^N = 1 / 2^-8 = 256 -> raw 0x0100
    await valueInput(page).fill('')
    await valueInput(page).fill('1')
    await expect(hexInput(page)).toHaveValue('0100')
    await expect(valueInput(page)).toHaveValue('1')
    await expect(quantizationPanel(page)).toHaveCount(1)
    await expect(quantizationPanel(page)).toContainText('+0.000000')
  })
})

test.describe('DIRECT untouched blur（768×1024 light）', () => {
  test.beforeEach(async ({ page }) => {
    await setTheme(page, 'light')
    await page.setViewportSize({ width: 768, height: 1024 })
    await page.goto('/')
    await page.getByRole('tab', { name: /DIRECT/ }).click()
  })

  test('raw Hex 编辑后 untouched value blur：raw、结果、Y 不变、误差隐藏', async ({ page }) => {
    await hexInput(page).fill('000A')
    await hexInput(page).press('Tab')
    await expect(valueInput(page)).toHaveValue('10')
    await expect(quantizationPanel(page)).toHaveCount(0)

    await valueInput(page).click()
    await valueInput(page).press('Tab')
    await expect(hexInput(page)).toHaveValue('000A')
    await expect(valueInput(page)).toHaveValue('10')
    await expect(page.getByLabel('Y（16 位有符号，−32768～32767）')).toHaveValue('10')
    await expect(quantizationPanel(page)).toHaveCount(0)
  })

  test('Y 编辑后 untouched value blur：raw 不变、误差隐藏；显式 value 编辑仍提交', async ({
    page,
  }) => {
    const yInput = page.getByLabel('Y（16 位有符号，−32768～32767）')
    await yInput.fill('7')
    await yInput.press('Tab')
    await expect(hexInput(page)).toHaveValue('0007')
    await expect(quantizationPanel(page)).toHaveCount(0)

    // raw/Y 编辑路径之后：untouched value blur 不伪造编码请求
    await valueInput(page).click()
    await valueInput(page).press('Tab')
    await expect(hexInput(page)).toHaveValue('0007')
    await expect(valueInput(page)).toHaveValue('7')
    await expect(quantizationPanel(page)).toHaveCount(0)

    // 相反路径：显式物理值编辑按 m=1,b=0,R=0 编码 Y=5 -> raw 0005
    await valueInput(page).fill('')
    await valueInput(page).fill('5')
    await expect(hexInput(page)).toHaveValue('0005')
    await expect(valueInput(page)).toHaveValue('5')
    await expect(yInput).toHaveValue('5')
    await expect(quantizationPanel(page)).toHaveCount(1)
    await expect(quantizationPanel(page)).toContainText('+0.000000')
    await expectNoBodyHorizontalOverflow(page)
  })
})
