import { readFileSync } from 'node:fs'
import { test as base, expect } from '@playwright/test'
import { isStableReleaseTag } from '../../scripts/release-artifact-contract.mjs'
import {
  expectPagesDomContract,
  expectPagesResources,
  observePagesResources,
  stubCloudflare,
} from './helpers/pages-contract'
import { expectNoResourceErrors, type BrowserResources } from './helpers/browser-resources'
import { PAGES_BASE_PATH, PAGES_REPOSITORY_NAME } from '../../scripts/pages-network-policy.mjs'

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  version: string
}

const test = base.extend<{
  deployment: { url: string; expectedTag: string }
  deploymentResources: BrowserResources
}>({
  deployment: async ({ baseURL }, runWithTarget, testInfo) => {
    const local = testInfo.project.metadata.pagesOverlayLocal === true
    const target = local ? baseURL : process.env.DEPLOYMENT_URL
    const expectedTag = local ? `v${pkg.version}` : process.env.EXPECTED_RELEASE_TAG
    if (!target || !URL.canParse(target)) {
      throw new Error(local ? 'Pages fixture requires baseURL' : 'DEPLOYMENT_URL must be a URL')
    }
    if (!isStableReleaseTag(expectedTag)) {
      throw new Error(
        local
          ? 'package.json requires a stable version'
          : 'EXPECTED_RELEASE_TAG must be a stable tag',
      )
    }
    const url = new URL(target)
    if (local) {
      expect(url.protocol).toBe('http:')
      expect(url.hostname).toBe('localhost')
      expect(url.pathname).toBe(PAGES_BASE_PATH)
    } else if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new Error(
        'DEPLOYMENT_URL must be an HTTPS base URL without credentials, query or fragment',
      )
    }
    await runWithTarget({ url: url.href, expectedTag })
  },
  deploymentResources: [
    async ({ page, deployment }, runWithResources) => {
      // Check published HTML/CSP/UI wiring independently of Cloudflare uptime.
      // Only the audited endpoints are stubbed. Observe every test, including
      // calculator interactions, failed requests and each redirect hop.
      await stubCloudflare(page)
      const observed = observePagesResources(page, deployment.url)
      await runWithResources(observed)
      expectNoResourceErrors(observed)
    },
    { auto: true },
  ],
})

test.describe('GitHub Pages production deployment', () => {
  test('deployed build loads the Pages overlay and converts LINEAR11 in both directions', async ({
    page,
    deployment,
    deploymentResources,
  }) => {
    const response = await page.goto(deployment.url)
    if (response == null) throw new Error('page.goto returned no deployment response')
    expect(response.status()).toBe(200)
    expect(new URL(page.url()).origin).toBe(new URL(deployment.url).origin)

    await expect(page).toHaveTitle(/PMBus/)
    await expect(page).toHaveTitle(/VOUT_MODE/)
    await expect(page.getByRole('heading', { name: 'PMBus' })).toBeVisible()
    // The oldest published builds omit the "App " prefix.
    const versionBadge = new RegExp(`^(?:App )?${deployment.expectedTag.replaceAll('.', '\\.')}$`)
    await expect(page.getByTestId('version-badge')).toHaveText(versionBadge)
    await expect(page.getByLabel('模式切换')).toBeVisible()
    await expect(page.getByLabel('命令参考')).toBeVisible()
    await expect(page.getByLabel('结果面板')).toBeVisible()

    await expectPagesDomContract(page)
    await expectPagesResources(page, deployment.url, deploymentResources)

    const hexInput = page.locator('input[placeholder="0000"]')
    const valueInput = page.locator('#value-input')
    await hexInput.fill('F819')
    await hexInput.press('Tab')
    await expect(valueInput).toHaveValue('12.5')
    await expect(hexInput).toHaveValue('F819')

    await valueInput.fill('1')
    await expect(hexInput).toHaveValue('0001')
  })

  test('390px viewport has no horizontal overflow', async ({ page, deployment }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(deployment.url)

    const body = page.locator('body')
    const scrollWidth = await body.evaluate((el) => el.scrollWidth)
    const clientWidth = await body.evaluate((el) => el.clientWidth)
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth)
    const repository = page.getByRole('link', { name: PAGES_REPOSITORY_NAME, exact: true })
    await expect(repository).toBeVisible()
    const box = await repository.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.y).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(390)
    expect(box!.y + box!.height).toBeLessThanOrEqual(844)
  })
})
