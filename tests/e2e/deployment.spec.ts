import { readFileSync } from 'node:fs'
import { test, expect } from '@playwright/test'

const deploymentUrl = process.env.DEPLOYMENT_URL

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  version: string
}

test.skip(!deploymentUrl, 'DEPLOYMENT_URL is required for remote deployment smoke')

const requiredResourceTypes = new Set([
  'document',
  'script',
  'stylesheet',
  'font',
  'image',
  'fetch',
])

test.describe('GitHub Pages production deployment', () => {
  test('HTTPS page loads with title and core controls', async ({ page }) => {
    const response = await page.goto(deploymentUrl!)
    if (response == null) throw new Error(`page.goto returned no response for ${deploymentUrl}`)
    expect(response.status()).toBe(200)
    expect(page.url().startsWith('https://')).toBeTruthy()

    await expect(page).toHaveTitle(/PMBus/)
    // M39：页面标题包含全部五个模式（含 VOUT_MODE）。
    await expect(page).toHaveTitle(/VOUT_MODE/)
    await expect(page.getByRole('heading', { name: 'PMBus' })).toBeVisible()
    // 线上页面必须显示与部署包一致的版本（构建时注入，非手工维护）。
    await expect(page.getByTestId('version-badge')).toHaveText(`v${pkg.version}`)
    await expect(page.getByLabel('模式切换')).toBeVisible()
    await expect(page.getByLabel('命令参考')).toBeVisible()
    await expect(page.getByLabel('结果面板')).toBeVisible()

    const csp = page.locator('meta[http-equiv="Content-Security-Policy"]')
    await expect(csp).toHaveCount(1)
    await expect(csp).toHaveAttribute('content', /default-src 'self'/)
  })

  test('no page errors and every resource loads from the Pages origin', async ({ page }) => {
    const pageErrors: string[] = []
    const failedAssets: string[] = []
    const offOriginResources: string[] = []
    const observedResources: string[] = []
    const observedFonts: string[] = []

    page.on('pageerror', (error) => {
      pageErrors.push(error.message)
    })

    page.on('response', (response) => {
      const type = response.request().resourceType()
      if (!requiredResourceTypes.has(type)) {
        return
      }
      const url = response.url()
      observedResources.push(url)
      if (response.status() >= 400 && response.status() < 600) {
        failedAssets.push(`${response.status()} ${response.request().method()} ${url}`)
      }
      if (new URL(url).origin !== new URL(deploymentUrl!).origin) {
        offOriginResources.push(url)
      }
      if (type === 'font') {
        observedFonts.push(url)
      }
    })

    await page.goto(deploymentUrl!)
    await expect(page.getByLabel('结果面板')).toBeVisible()

    await expect(page.locator('.katex').first()).toBeVisible()
    await expect(page.locator('.katex-error')).toHaveCount(0)
    await expect(page.locator('.katex math').first()).toBeAttached()

    await page.evaluate(async () => {
      await document.fonts.ready
    })

    const katexFontFamily = await page
      .locator('.katex')
      .first()
      .evaluate((el) => getComputedStyle(el).fontFamily)
    expect(katexFontFamily).toContain('KaTeX_Main')
    expect(observedFonts.length).toBeGreaterThan(0)

    expect(pageErrors).toEqual([])
    expect(failedAssets).toEqual([])
    expect(offOriginResources).toEqual([])
    expect(observedResources.length).toBeGreaterThanOrEqual(3)

    const pagesUrl = new URL(deploymentUrl!)
    const basePath = pagesUrl.pathname.replace(/\/$/, '')
    for (const url of observedResources) {
      const parsed = new URL(url)
      expect(parsed.origin).toBe(pagesUrl.origin)
      expect(parsed.pathname).toMatch(new RegExp(`^${basePath}/`))
    }
  })

  test('390px viewport has no horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(deploymentUrl!)

    const body = page.locator('body')
    const scrollWidth = await body.evaluate((el) => el.scrollWidth)
    const clientWidth = await body.evaluate((el) => el.clientWidth)
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth)
  })

  test('L11 closed loop: hex input decodes and value input encodes back', async ({ page }) => {
    await page.goto(deploymentUrl!)
    const hexInput = page.locator('input[placeholder="0000"]')
    const valueInput = page.locator('#value-input')

    await hexInput.fill('F819')
    await hexInput.press('Tab')
    await expect(valueInput).toHaveValue('12.5')
    await expect(hexInput).toHaveValue('F819')

    await valueInput.fill('12.5')
    await expect(hexInput).toHaveValue('F819')
  })

  // v2.6.2 正式站验收：审计修复的四个用户可见行为必须在线上构建中成立。
  test.describe('v2.6.2 audit acceptance (production)', () => {
    test('DIRECT 尾零补偿科学计数法向量提交为 raw 0001', async ({ page }) => {
      await page.goto(deploymentUrl!)
      await page.getByRole('tab', { name: /DIRECT/ }).click()
      for (const [id, value] of [
        ['#direct-coeff-m-input', '1'],
        ['#direct-coeff-b-input', '1'],
        ['#direct-coeff-r-input', '17'],
      ] as const) {
        await page.locator(id).fill(value)
        await page.locator(id).press('Tab')
      }

      const text = `1${'0'.repeat(501)}e-501`
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
      await page.evaluate((t) => navigator.clipboard.writeText(t), text)
      const valueInput = page.locator('#value-input')
      await valueInput.click()
      await page.keyboard.press('ControlOrMeta+a')
      await page.keyboard.press('ControlOrMeta+v')

      await expect(page.locator('#raw-hex-input')).toHaveValue('0001')
      await expect(page.getByText(/输入过长|输入下溢|超出可表示范围/)).toHaveCount(0)
      await expect(page.getByTestId('quantization-error')).toHaveAttribute('data-kind', 'ok')
    })

    test('控件 tooltip 可悬停驻留（SC 1.4.13）：移入浮层不关闭', async ({ page }) => {
      await page.goto(deploymentUrl!)
      const button = page.locator('header button[aria-label^="当前主题"]')
      const tooltip = page.locator('[data-testid="control-tooltip-theme-toggle"]')

      await button.hover()
      await expect(tooltip).toBeVisible()
      await tooltip.hover()
      await expect(tooltip).toBeVisible()
      await button.hover()
      await expect(tooltip).toBeVisible()
      await page.mouse.move(8, 300)
      await expect(tooltip).toHaveCount(0)
    })

    test('VOUT_MODE radio 方向键行走并选择（roving tabindex）', async ({ page }) => {
      await page.goto(deploymentUrl!)
      await page.getByRole('tab', { name: /VOUT_MODE/ }).click()

      const abs = page.getByRole('radio', { name: '绝对值' })
      const rel = page.getByRole('radio', { name: '相对值' })
      await expect(abs).toHaveAttribute('tabindex', '0')
      await expect(rel).toHaveAttribute('tabindex', '-1')

      await abs.focus()
      await page.keyboard.press('ArrowRight')
      await expect(rel).toBeFocused()
      await expect(rel).toHaveAttribute('aria-checked', 'true')
      await expect(page.getByTestId('vout-mode-byte')).toHaveText('0x98')
      await expect(rel).toHaveAttribute('tabindex', '0')
      await expect(abs).toHaveAttribute('tabindex', '-1')
    })

    test('L16 bits[6:5] 禁用原因在 overlay 外可见并关联到位按钮', async ({ page }) => {
      await page.goto(deploymentUrl!)
      await page.getByRole('tab', { name: /LINEAR16/ }).click()

      const reason = page.locator('#vout-bits65-disabled-reason')
      await expect(reason).toBeVisible()
      await expect(reason).toContainText('格式位固定为 LINEAR')
      for (const index of [5, 6]) {
        const bit = page.getByRole('button', {
          name: new RegExp('第 ' + index + ' 位，格式位固定为 LINEAR'),
        })
        await expect(bit).toBeDisabled()
        await expect(bit).toHaveAttribute('aria-describedby', 'vout-bits65-disabled-reason')
      }
    })
  })
})
