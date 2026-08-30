import { test, expect } from '@playwright/test'
import { appBasePath, appUrl } from './helpers/app-url'

// v2.5.15 URL/目标合同：默认套件以生产构建（vite preview 挂载在官方
// /pmbus-calculator/ 前缀下）为主要验收目标。本 spec 显式锁定三件事：
// 1) 受测页面必须是 production build（防止 dev 绿灯冒充 production）；
// 2) 应用加载在配置的部署前缀上，全部静态资源同源、成功且不是 HTML
//    fallback（vite preview 的 SPA fallback 会对未知路径返回 index.html）；
// 3) ?debug 查询入口经 appUrl() 构造，保留部署前缀（生产构建下 ?debug
//    是调试面板的唯一显式入口）。
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
    await expect(page.getByTestId('version-badge')).toBeVisible()

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
    await expect(page.getByText(/质量门禁/)).toBeVisible()
  })
})
