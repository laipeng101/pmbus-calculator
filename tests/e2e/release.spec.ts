import { lstatSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'
import { expectProductionCsp } from './helpers/pages-contract'
import { RELEASE_CSP } from './helpers/pages-network-policy'

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  version: string
}

test.describe('production build smoke', () => {
  test('Release tree contains no Analytics or Pages-only UI bytes', () => {
    const dist = fileURLToPath(new URL('../../dist/', import.meta.url))
    const forbidden = [
      'data-cf-beacon',
      'static.cloudflareinsights.com',
      'cloudflareinsights.com',
      'data-pages-only',
      'pages-overlay.css',
    ]
    function inspectDirectory(directory: string) {
      for (const name of readdirSync(directory)) {
        const path = join(directory, name)
        const stat = lstatSync(path)
        if (stat.isDirectory()) {
          inspectDirectory(path)
          continue
        }
        expect(stat.isFile(), `${name} must be a regular release file`).toBe(true)
        const content = readFileSync(path).toString('utf8').toLowerCase()
        for (const marker of forbidden) {
          expect(name.toLowerCase().includes(marker), `${name}: forbidden Pages filename`).toBe(
            false,
          )
          expect(content.includes(marker), `${name}: forbidden Pages marker ${marker}`).toBe(false)
        }
      }
    }
    inspectDirectory(dist)
  })

  test('生产构建加载正常：标题、核心控件、CSP 与静态资源', async ({ page, baseURL }) => {
    const pageErrors: string[] = []
    const failedAssets: string[] = []
    const fontResponses: string[] = []
    const offOriginResources: string[] = []
    const sameOriginTypes = new Set<string>()
    const previewOrigin = new URL(baseURL!).origin

    page.on('request', (request) => {
      if (new URL(request.url()).origin !== previewOrigin) {
        offOriginResources.push(request.url())
      }
    })

    page.on('requestfailed', (request) => {
      failedAssets.push(`${request.resourceType()} ${request.url()}`)
    })

    page.on('pageerror', (error) => {
      pageErrors.push(error.message)
    })

    page.on('response', (response) => {
      const type = response.request().resourceType()
      const status = response.status()
      if (status >= 200 && status < 400 && new URL(response.url()).origin === previewOrigin) {
        sameOriginTypes.add(type)
      }
      if (type === 'font' && status >= 200 && status < 400) {
        fontResponses.push(response.url())
      }
      if (
        status >= 400 &&
        status < 600 &&
        ['document', 'script', 'stylesheet', 'font', 'image', 'media', 'xhr', 'fetch'].includes(
          type,
        )
      ) {
        failedAssets.push(`${status} ${response.request().method()} ${response.url()}`)
      }
    })

    await page.goto('/')

    await expect(page).toHaveTitle(/PMBus/)
    // M39：页面标题包含全部五个模式（含 VOUT_MODE）。
    await expect(page).toHaveTitle(/VOUT_MODE/)
    await expect(page.getByRole('heading', { name: 'PMBus' })).toBeVisible()
    // 构建时从 package.json 注入的版本徽标必须与当前包版本一致。
    await expect(page.getByTestId('version-badge')).toHaveText(`App v${pkg.version}`)
    await expect(page.getByLabel('模式切换')).toBeVisible()
    await expect(page.getByLabel('命令参考')).toBeVisible()
    await expect(page.getByLabel('结果面板')).toBeVisible()

    await expectProductionCsp(page, RELEASE_CSP)
    await expect(page.locator('[data-cf-beacon]')).toHaveCount(0)
    await expect(page.locator('[data-pages-only="repository-link"]')).toHaveCount(0)
    await expect(page.locator('link[href*="pages-overlay.css"]')).toHaveCount(0)
    expect((await page.content()).toLowerCase().includes('cloudflareinsights.com')).toBe(false)

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

    expect(fontResponses.length).toBeGreaterThan(0)
    for (const fontUrl of fontResponses) {
      expect(new URL(fontUrl).origin).toBe(previewOrigin)
    }

    expect(pageErrors).toEqual([])
    expect(failedAssets).toEqual([])
    expect(offOriginResources).toEqual([])
    for (const type of ['script', 'stylesheet', 'font']) {
      expect(sameOriginTypes.has(type), `${type} loads same-origin`).toBe(true)
    }
  })

  test('browser CSP guard rejects NBSP before head and policies after resource elements', async ({
    page,
  }) => {
    const policy = Object.entries(RELEASE_CSP)
      .map(([directive, values]) => `${directive} ${values.join(' ')}`)
      .join('; ')
    const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}">`
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
