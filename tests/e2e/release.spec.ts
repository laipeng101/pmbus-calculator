import { readFileSync } from 'node:fs'
import { test, expect } from '@playwright/test'
import {
  expectApplicationAssets,
  expectNoResourceErrors,
  observeBrowserResources,
} from './helpers/browser-resources'
import { expectProductionCsp } from './helpers/pages-contract'
import { formatCsp, RELEASE_CSP } from '../../scripts/pages-network-policy.mjs'

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  version: string
}

test.describe('production build smoke', () => {
  test('生产构建加载正常：标题、核心控件、CSP 与静态资源', async ({ page, baseURL }) => {
    const previewOrigin = new URL(baseURL!).origin
    const observed = observeBrowserResources(
      page,
      (request) => new URL(request.url()).origin === previewOrigin,
    )

    await page.goto('/')

    await expect(page).toHaveTitle(/PMBus/)
    await expect(page).toHaveTitle(/VOUT_MODE/)
    await expect(page.getByRole('heading', { name: 'PMBus' })).toBeVisible()
    await expect(page.getByTestId('version-badge')).toHaveText(`App v${pkg.version}`)
    await expect(page.getByLabel('模式切换')).toBeVisible()
    await expect(page.getByLabel('命令参考')).toBeVisible()
    await expect(page.getByLabel('结果面板')).toBeVisible()

    await expectProductionCsp(page, RELEASE_CSP)
    await expect(page.locator('[data-cf-beacon]')).toHaveCount(0)
    await expect(page.locator('[data-pages-only="repository-link"]')).toHaveCount(0)
    await expect(page.locator('link[href*="pages-overlay.css"]')).toHaveCount(0)
    expect((await page.content()).toLowerCase().includes('cloudflareinsights.com')).toBe(false)

    await expectApplicationAssets(page, previewOrigin, observed)
    expectNoResourceErrors(observed)
  })

  test('browser CSP guard rejects NBSP before head and policies after resource elements', async ({
    page,
  }) => {
    const meta = `<meta http-equiv="Content-Security-Policy" content="${formatCsp(RELEASE_CSP)}">`
    // Canonical link and JSON script exercise resource ordering without any
    // network request or executable fixture code.
    const valid = `<!doctype html><html><head>${meta}<link rel="canonical" href="/"><script type="application/json">{}</script></head><body>fixture</body></html>`
    await page.setContent(valid)
    await expectProductionCsp(page, RELEASE_CSP)

    await page.setContent(valid.replace('<head>', '\u00a0<head>'))
    await expect(expectProductionCsp(page, RELEASE_CSP)).rejects.toThrow(
      'CSP meta must be a direct child of HEAD',
    )

    await page.setContent(valid.replace(meta, '').replace('</head>', `${meta}</head>`))
    await expect(expectProductionCsp(page, RELEASE_CSP)).rejects.toThrow(
      'CSP meta must precede every script and link',
    )
  })
})
