import { test, expect, type Locator, type Page, type TestInfo } from '@playwright/test'
import {
  expectPagesDomContract,
  expectPagesResources,
  observePagesResources,
  stubCloudflare,
} from './helpers/pages-contract'
import { CLOUDFLARE_RUM_URL, PAGES_REPOSITORY_NAME } from './helpers/pages-network-policy'

const calculatorTargets = [
  '#root button',
  '#root input',
  '#root select',
  '#root a',
  '#root [tabindex="0"]',
  '#root [data-testid="result-value"]',
  '#root [data-testid="result-context"]',
].join(', ')

async function expectClearViewport(
  page: Page,
  baseline?: { bodyWidth: number; documentWidth: number; panelWidth: number },
) {
  const geometry = await page.evaluate((selector) => {
    const link = document.querySelector('[data-pages-only="repository-link"]')!
    const box = link.getBoundingClientRect()
    const header = document.querySelector('#root .app-panel > header')!
    const theme = header.querySelector('button[aria-label^="当前主题"]')!.getBoundingClientRect()
    const panel = document.querySelector('#root .app-panel')!.getBoundingClientRect()
    const overlaps: string[] = []
    for (const element of document.querySelectorAll(selector)) {
      const rect = element.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) continue
      if (
        rect.left < box.right &&
        rect.right > box.left &&
        rect.top < box.bottom &&
        rect.bottom > box.top
      ) {
        overlaps.push(element.id || element.getAttribute('aria-label') || element.tagName)
      }
    }
    return {
      left: box.left,
      top: box.top,
      right: box.right,
      bottom: box.bottom,
      width: box.width,
      height: box.height,
      viewportWidth: document.documentElement.clientWidth,
      viewportHeight: document.documentElement.clientHeight,
      bodyWidth: document.body.scrollWidth,
      clientWidth: document.body.clientWidth,
      documentWidth: document.documentElement.scrollWidth,
      rootFontSize: Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
      wideShell: matchMedia('(min-width: 40rem)').matches,
      panelLeft: panel.left,
      panelRight: panel.right,
      panelWidth: panel.width,
      themeTop: theme.top,
      themeRight: theme.right,
      themeHeight: theme.height,
      headerBottom: header.getBoundingClientRect().bottom,
      scrollY,
      overlaps,
      position: getComputedStyle(link).position,
    }
  }, calculatorTargets)
  expect(geometry.position).toBe('absolute')
  expect(geometry.left).toBeGreaterThanOrEqual(0)
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth)
  if (geometry.scrollY === 0) {
    expect(geometry.top).toBeGreaterThanOrEqual(0)
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight)
  }
  // The icon occupies only the header slot, aligned with the theme control.
  // Both controls scroll away together; no fixed icon can cover later inputs.
  expect(geometry.top).toBeCloseTo(geometry.themeTop, 0)
  expect(geometry.height).toBeCloseTo(geometry.themeHeight, 0)
  expect(geometry.left - geometry.themeRight).toBeCloseTo(8, 0)
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.headerBottom)
  const expectedPanelWidth = Math.min(
    geometry.viewportWidth - (geometry.wideShell ? 2 * geometry.rootFontSize : 0),
    1120,
  )
  expect(geometry.panelWidth, 'calculator retains the full Release layout width').toBeCloseTo(
    expectedPanelWidth,
    0,
  )
  expect(geometry.panelLeft).toBeCloseTo(geometry.viewportWidth - geometry.panelRight, 0)
  if (baseline) expect(geometry.panelWidth).toBeCloseTo(baseline.panelWidth, 0)
  expect(geometry.width).toBeGreaterThanOrEqual(40)
  expect(geometry.width).toBeLessThanOrEqual(44)
  expect(geometry.height).toBeGreaterThanOrEqual(40)
  expect(geometry.height).toBeLessThanOrEqual(44)
  expect(geometry.bodyWidth).toBeLessThanOrEqual(baseline?.bodyWidth ?? geometry.clientWidth)
  expect(geometry.documentWidth).toBeLessThanOrEqual(
    baseline?.documentWidth ?? geometry.viewportWidth,
  )
  expect(geometry.overlaps, 'header repository link never covers calculator interactions').toEqual(
    [],
  )
}

function contrastRatio(foreground: string, background: string): number {
  function luminance(color: string): number {
    const match = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(color)
    if (!match) throw new Error(`Expected opaque computed color: ${color}`)
    const linear = match.slice(1).map((channel) => {
      const normalized = Number(channel) / 255
      return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
    })
    return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
  }
  const a = luminance(foreground)
  const b = luminance(background)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

async function recordViewport(page: Page, testInfo: TestInfo, name: string) {
  await page.evaluate(async () => document.fonts.ready)
  const path = testInfo.outputPath(`${name}.png`)
  await page.screenshot({ path, animations: 'disabled' })
  await testInfo.attach(name, { path, contentType: 'image/png' })
}

async function reachLinkByKeyboard(page: Page, repository: Locator) {
  // Start from the fresh page and traverse real Tab order. This catches an
  // accidental tabindex=-1 without assuming browser-chrome focus wrapping.
  for (let index = 0; index < 100; index++) {
    await page.keyboard.press('Tab')
    if (await repository.evaluate((element) => document.activeElement === element)) break
  }
  await expect(repository).toBeFocused()
  expect(await repository.evaluate((element) => element.matches(':focus-visible'))).toBe(true)
  const style = await repository.evaluate((element) => {
    const computed = getComputedStyle(element)
    return {
      width: Number.parseFloat(computed.outlineWidth),
      outline: computed.outlineStyle,
      color: computed.outlineColor,
      background: computed.backgroundColor,
    }
  })
  expect(style.width).toBeGreaterThanOrEqual(2)
  expect(style.outline).not.toBe('none')
  expect(contrastRatio(style.color, style.background)).toBeGreaterThanOrEqual(3)
  await page.keyboard.press('Shift+Tab')
  expect(
    await page.evaluate(() => document.querySelector('#root')!.contains(document.activeElement)),
  ).toBe(true)
  await page.keyboard.press('Tab')
  await expect(repository).toBeFocused()
}

async function readReleaseLayout(page: Page) {
  const baseline = await page.evaluate(() => {
    const css = document.querySelector<HTMLLinkElement>('link[href="./pages-overlay.css"]')!.sheet!
    const repository = document.querySelector<HTMLElement>('[data-pages-only="repository-link"]')!
    css.disabled = true
    repository.hidden = true
    const clean = {
      bodyWidth: document.body.scrollWidth,
      documentWidth: document.documentElement.scrollWidth,
      panelWidth: document.querySelector('#root .app-panel')!.getBoundingClientRect().width,
    }
    css.disabled = false
    repository.hidden = false
    return clean
  })
  await expect(page.locator('[data-pages-only="repository-link"]')).toHaveCSS(
    'position',
    'absolute',
  )
  return baseline
}

test.beforeEach(async ({ page }) => {
  await stubCloudflare(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
})

for (const theme of ['light', 'dark'] as const) {
  test(`${theme}: repository link is visible, keyboard reachable and clear of all five modes`, async ({
    page,
    baseURL,
  }, testInfo) => {
    await page.addInitScript(
      (value) => localStorage.setItem('pmbus-calculator:theme', value),
      theme,
    )
    const observed = observePagesResources(page, baseURL!)
    await page.goto('./')
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    await expectPagesDomContract(page)
    await expectPagesResources(page, baseURL!, observed)
    const repository = page.getByRole('link', { name: PAGES_REPOSITORY_NAME, exact: true })
    const colors = await repository.evaluate((element) => {
      const style = getComputedStyle(element)
      return { color: style.color, background: style.backgroundColor, radius: style.borderRadius }
    })
    expect(contrastRatio(colors.color, colors.background)).toBeGreaterThanOrEqual(4.5)
    expect(Number.parseFloat(colors.radius)).toBeGreaterThanOrEqual(8)
    await expectClearViewport(page)
    await recordViewport(page, testInfo, `${theme}-viewport`)
    await reachLinkByKeyboard(page, repository)
    await page.evaluate(() => window.scrollTo(0, 0))
    await recordViewport(page, testInfo, `${theme}-focus`)

    for (const mode of ['LINEAR11', 'LINEAR16', 'DIRECT', 'HALF', 'VOUT_MODE']) {
      await page.getByRole('tab', { name: new RegExp(mode) }).click()
      for (const fraction of [0, 0.5, 1]) {
        await page.evaluate(
          (ratio) =>
            window.scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * ratio),
          fraction,
        )
        await expectClearViewport(page)
      }
      // Exercise every real control and result interaction as it is brought
      // into view. The icon must stay with the header, never over the inputs.
      for (const target of await page.locator(calculatorTargets).all()) {
        if (!(await target.isVisible())) continue
        await target.scrollIntoViewIfNeeded()
        await expectClearViewport(page)
      }
    }
    expect(observed.pageErrors).toEqual([])
    expect(observed.failedAssets).toEqual([])
    expect(observed.unexpectedExternalOrigins).toEqual([])
  })
}

test('header controls follow responsive breakpoints and font size without shrinking the calculator', async ({
  page,
}) => {
  await page.goto('./')
  for (const fontSize of [12, 16, 20]) {
    await page.evaluate((size) => {
      document.documentElement.style.fontSize = `${size}px`
    }, fontSize)
    for (const width of [360, 390, 639, 640, 767, 768, 1280, 1440]) {
      await test.step(`${fontSize}px root font at ${width}px viewport`, async () => {
        await page.setViewportSize({ width, height: 900 })
        // Mobile emulation completes viewport/media updates on the next render.
        await page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            ),
        )
        // The clean app already overflows at 20px/768px. Additional font-size
        // checks compare that unchanged baseline; the default 16px contract
        // above and below still requires zero horizontal overflow everywhere.
        const baseline = fontSize === 16 ? undefined : await readReleaseLayout(page)
        await expectClearViewport(page, baseline)
      })
    }
  }
})

test('browser font preferences preserve header alignment across rem and px breakpoints', async ({
  browser,
  baseURL,
}, testInfo) => {
  for (const fontSize of [12, 20]) {
    // A root style cannot emulate browser font preferences: CSS media-query
    // rem units use the browser's initial font size, not the root's style.
    const preferredBrowser = await browser.browserType().launch({
      args: [`--blink-settings=defaultFontSize=${fontSize}`],
    })
    try {
      const context = await preferredBrowser.newContext({
        isMobile: Boolean(testInfo.project.use.isMobile),
        hasTouch: Boolean(testInfo.project.use.hasTouch),
        viewport: { width: 390, height: 900 },
      })
      const page = await context.newPage()
      await stubCloudflare(page)
      await page.goto(baseURL!)
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe(
        `${fontSize}px`,
      )
      for (const width of new Set([
        390,
        40 * fontSize - 1,
        40 * fontSize,
        48 * fontSize - 1,
        48 * fontSize,
        639,
        640,
        767,
        768,
        1440,
      ])) {
        await test.step(`${fontSize}px browser font at ${width}px viewport`, async () => {
          await page.setViewportSize({ width, height: 900 })
          await page.evaluate(
            () =>
              new Promise<void>((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
              ),
          )
          expect(await page.evaluate(() => matchMedia('(min-width: 40rem)').matches)).toBe(
            width >= 40 * fontSize,
          )
          expect(await page.evaluate(() => matchMedia('(min-width: 48rem)').matches)).toBe(
            width >= 48 * fontSize,
          )
          await expectClearViewport(page, await readReleaseLayout(page))
        })
      }
    } finally {
      await preferredBrowser.close()
    }
  }
})

test('CSP permits the exact module and RUM endpoint while application resources stay same-origin', async ({
  page,
  baseURL,
}) => {
  const observed = observePagesResources(page, baseURL!)
  await page.goto('./')
  await expectPagesDomContract(page)
  // Empty, controlled request: no calculator state or synthetic user event is
  // sent. Route fulfillment makes this a CSP/wiring test, not a service test.
  const status = await page.evaluate(async (url) => {
    const response = await fetch(url, { method: 'POST', body: '' })
    await response.text()
    return response.status
  }, CLOUDFLARE_RUM_URL)
  expect(status).toBe(200)
  await expectPagesResources(page, baseURL!, observed)
})

test('pointer feedback respects hover capability and reduced motion', async ({
  page,
}, testInfo) => {
  await page.goto('./')
  const repository = page.getByRole('link', { name: PAGES_REPOSITORY_NAME, exact: true })
  await expect(repository).toBeVisible()
  const coarse = Boolean(testInfo.project.use.hasTouch)
  expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(coarse)
  const readFeedback = () =>
    repository.evaluate((element) => {
      const style = getComputedStyle(element)
      return {
        background: style.backgroundColor,
        border: style.borderColor,
        transform: style.transform,
      }
    })
  const rest = await readFeedback()
  await repository.hover()
  if (coarse) expect(await readFeedback()).toEqual(rest)
  else expect(await readFeedback()).not.toEqual(rest)
  const hovered = await readFeedback()
  await page.mouse.down()
  expect(await readFeedback()).not.toEqual(hovered)
  await page.mouse.move(0, 0)
  await page.mouse.up()
  const durations = await repository.evaluate((element) => {
    const style = getComputedStyle(element)
    return [...style.transitionDuration.split(','), ...style.animationDuration.split(',')].map(
      (duration) => Number.parseFloat(duration),
    )
  })
  for (const duration of durations) expect(duration).toBeLessThanOrEqual(0.001)
  await expectClearViewport(page)
})
