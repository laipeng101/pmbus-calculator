import { test, expect } from '@playwright/test'
import { appBasePath, appUrl } from './helpers/app-url'

test.describe('应用 URL 与受测构建合同', () => {
  test('生产构建在前缀路径下加载且资源同源成功', async ({ page, baseURL }) => {
    const basePath = appBasePath()
    const assetResponses: string[] = []
    const badResponses: string[] = []

    page.on('response', (response) => {
      const url = new URL(response.url())
      if (!url.pathname.startsWith(`${basePath}/assets/`)) return
      const type = response.headers()['content-type'] ?? ''
      assetResponses.push(`${url.pathname} ${response.status()} ${type}`)
      if (response.status() !== 200 || type.includes('text/html')) {
        badResponses.push(`${url.pathname} status=${response.status()} type=${type}`)
      }
    })

    await page.goto(appUrl())
    await expect(page).toHaveTitle(/PMBus/)
    await expect(page.getByRole('heading', { name: 'PMBus' })).toBeVisible()
    await expect(page.getByLabel('模式切换')).toBeVisible()
    await expect(page.getByLabel('命令参考')).toBeVisible()
    await expect(page.getByLabel('结果面板')).toBeVisible()
    await expect(page.getByTestId('version-badge')).toBeVisible()
    await expect(page.getByLabel('展开调试面板')).toHaveCount(0)

    // 受测构建来源：production dist 没有 Vite dev 注入的客户端脚本。
    const isDevServer = await page.evaluate(() =>
      [...document.querySelectorAll('script')].some((script) => script.src.includes('/@vite/')),
    )
    expect(isDevServer).toBe(false)

    // 部署前缀保留：实际页面 URL 在配置的前缀上，origin 与 baseURL 一致。
    const pageUrl = new URL(page.url())
    expect(pageUrl.pathname).toBe(`${basePath}/`)
    expect(pageUrl.origin).toBe(new URL(baseURL ?? 'http://localhost/').origin)

    // 静态资源存在、成功且不是 HTML fallback（JS/CSS/字体都在 assets/ 下）。
    expect(assetResponses.length).toBeGreaterThan(0)
    expect(
      assetResponses.some((entry) => entry.includes('text/javascript')),
      'at least one script asset observed',
    ).toBe(true)
    expect(badResponses).toEqual([])
  })

  test('?debug 显式入口保留部署前缀并可展开调试面板', async ({ page }) => {
    const basePath = appBasePath()

    await page.goto(appUrl('/', 'debug'))
    expect(new URL(page.url()).pathname).toBe(`${basePath}/`)
    expect(new URL(page.url()).search).toBe('?debug')

    const toggle = page.getByLabel('展开调试面板')
    await expect(toggle).toBeVisible()
    await toggle.click()
    const status = page.getByRole('region', { name: '调试状态' })
    await expect(status).toBeVisible()
    await expect(status.getByText('LINEAR11', { exact: true })).toBeVisible()
    await expect(status.getByText('0x0000', { exact: true })).toBeVisible()
  })
})
