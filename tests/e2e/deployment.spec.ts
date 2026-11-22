import { readFileSync } from 'node:fs'
import { test as base, expect } from '@playwright/test'
import { isStableReleaseTag } from '../../scripts/release-artifact-contract.mjs'
import {
  expectPagesDomContract,
  expectPagesResources,
  observePagesResources,
  stubCloudflare,
} from './helpers/pages-contract'
import { PAGES_REPOSITORY_NAME } from '../../scripts/pages-network-policy.mjs'

const deploymentUrl = process.env.DEPLOYMENT_URL

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  version: string
}

const test = base.extend<{
  deploymentTarget: string
  deploymentResources: ReturnType<typeof observePagesResources>
}>({
  deploymentTarget: async ({ baseURL }, runWithTarget, testInfo) => {
    const local = testInfo.project.metadata.pagesOverlayLocal === true
    const target = local ? baseURL : deploymentUrl
    test.skip(!target, 'DEPLOYMENT_URL is required for remote deployment smoke')
    if (!target) throw new Error('Deployment URL is unavailable')
    const url = new URL(target)
    if (local) {
      expect(url.protocol).toBe('http:')
      expect(url.hostname).toBe('localhost')
      expect(url.pathname).toBe('/pmbus-calculator/')
    } else {
      expect(url.protocol).toBe('https:')
    }
    await runWithTarget(target)
  },
  deploymentResources: [
    async ({ page, deploymentTarget }, runWithResources) => {
      // Check published HTML/CSP/UI wiring independently of Cloudflare uptime.
      // Only the audited endpoints are stubbed. Observe every test, including
      // calculator interactions, failed requests and each redirect hop.
      await stubCloudflare(page)
      const observed = observePagesResources(page, deploymentTarget)
      await runWithResources(observed)
      expect(observed.pageErrors).toEqual([])
      expect(observed.failedAssets).toEqual([])
      expect(observed.unexpectedExternalOrigins).toEqual([])
    },
    { auto: true },
  ],
})

test.describe('GitHub Pages production deployment', () => {
  test('deployment page loads with title, core controls and exact Pages overlay', async ({
    page,
    deploymentTarget,
  }, testInfo) => {
    const response = await page.goto(deploymentTarget)
    if (response == null) throw new Error('page.goto returned no deployment response')
    expect(response.status()).toBe(200)
    const local = testInfo.project.metadata.pagesOverlayLocal === true
    if (!local) expect(new URL(page.url()).protocol).toBe('https:')
    expect(new URL(page.url()).origin).toBe(new URL(deploymentTarget).origin)

    await expect(page).toHaveTitle(/PMBus/)
    await expect(page).toHaveTitle(/VOUT_MODE/)
    await expect(page.getByRole('heading', { name: 'PMBus' })).toBeVisible()
    const expectedTag = process.env.EXPECTED_RELEASE_TAG ?? (local ? `v${pkg.version}` : '')
    if (!isStableReleaseTag(expectedTag))
      throw new Error('EXPECTED_RELEASE_TAG must be a stable tag')
    // The oldest published builds omit the "App " prefix.
    const versionBadge = new RegExp(`^(?:App )?${expectedTag.replaceAll('.', '\\.')}$`)
    await expect(page.getByTestId('version-badge')).toHaveText(versionBadge)
    await expect(page.getByLabel('模式切换')).toBeVisible()
    await expect(page.getByLabel('命令参考')).toBeVisible()
    await expect(page.getByLabel('结果面板')).toBeVisible()

    await expectPagesDomContract(page)
  })

  test('resources stay same-origin except the exact Cloudflare allowlist, with no errors', async ({
    page,
    deploymentTarget,
    deploymentResources,
  }) => {
    await page.goto(deploymentTarget)
    await expect(page.getByLabel('结果面板')).toBeVisible()
    await expectPagesResources(page, deploymentTarget, deploymentResources)
  })

  test('390px viewport has no horizontal overflow', async ({ page, deploymentTarget }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(deploymentTarget)

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

  test('L11 closed loop: hex input decodes and value input encodes back', async ({
    page,
    deploymentTarget,
  }) => {
    await page.goto(deploymentTarget)
    const hexInput = page.locator('input[placeholder="0000"]')
    const valueInput = page.locator('#value-input')

    await hexInput.fill('F819')
    await hexInput.press('Tab')
    await expect(valueInput).toHaveValue('12.5')
    await expect(hexInput).toHaveValue('F819')

    await valueInput.fill('1')
    await expect(hexInput).toHaveValue('0001')
  })
})
