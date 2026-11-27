import { test, expect } from '@playwright/test'
import {
  expectApplicationAssets,
  expectNoResourceErrors,
  isApplicationAsset,
  observeBrowserResources,
} from './helpers/browser-resources'
import { PAGES_BASE_PATH } from '../../scripts/pages-network-policy.mjs'

test(
  '生产构建从部署前缀加载脚本、样式和字体',
  { tag: '@browser-smoke' },
  async ({ page, baseURL }) => {
    const base = new URL(baseURL!)
    const assetPath = new URL('assets/', base).pathname
    const observed = observeBrowserResources(page, (request) => {
      const url = new URL(request.url())
      return (
        url.origin === base.origin &&
        (!isApplicationAsset(request.resourceType()) || url.pathname.startsWith(assetPath))
      )
    })

    await page.goto('./')
    await expect(page.getByTestId('version-badge')).toBeVisible()
    await expect(page).toHaveURL(new URL(PAGES_BASE_PATH, base).href)
    await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveCount(1)
    await expectApplicationAssets(page, base.origin, observed)
    expectNoResourceErrors(observed)
  },
)

test('生产构建可通过 ?debug 查看当前的 Raw Word', async ({ page, baseURL }) => {
  const toggle = page.getByRole('button', { name: '展开调试面板' })

  await page.goto('./')
  await expect(page.getByTestId('version-badge')).toBeVisible()
  await expect(toggle).toHaveCount(0)

  await page.goto('./?debug')
  await expect(page).toHaveURL(new URL('?debug', baseURL!).href)
  await page.getByRole('textbox', { name: 'Raw Word（16 位原始字）' }).fill('3442')
  await toggle.click()
  await expect(page.getByLabel('调试信息').getByText('0x3442', { exact: true })).toBeVisible()
})
