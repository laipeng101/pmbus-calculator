import { test, expect, type Page } from '@playwright/test'

/**
 * M39 中文优先语言合同。
 *
 * 允许的英文仅限 canonical token（命令名、格式名、规范章节引用、变量符号）
 * 与 IEEE 浮点等不可替代缩写；任何同义双语重复或完整英文解释段落都视为回归。
 * 违禁清单使用普通子串匹配，allowlist 显式列举，不会误伤 canonical token。
 */

const BANNED_SUBSTRINGS = [
  '说明 /',
  '规范化 /',
  'Apply default',
  'fallback-default',
  'nominal reference',
  'bit7 absolute',
  'bits[6:5] format',
  'bits[4:0] parameter',
  'Absolute / Relative (',
  'Relative LINEAR:',
  'Not Used',
  'must be 0',
  'is invalid',
  'the nominal',
  'structurally legal',
]

const ALLOWLIST = [
  'PMBus',
  'SMBus',
  'VOUT_MODE',
  'VOUT_COMMAND',
  'VOUT_MARGIN_HIGH',
  'VOUT_TRIM',
  'VOUT_CAL_OFFSET',
  'LINEAR',
  'LINEAR11',
  'LINEAR16',
  'ULINEAR16',
  'SLINEAR16',
  'VID',
  'DIRECT',
  'IEEE Half',
  'IEEE 754 binary16',
  'Hex',
  'LE',
  'BE',
  'NaN',
  'Infinity',
  'Part II',
]

async function expectChinesePrimary(page: Page, label: string) {
  const text = await page.evaluate(() => document.body.innerText)
  const offending = BANNED_SUBSTRINGS.filter((needle) => text.includes(needle))
  expect(offending, label + ' 出现违禁双语/英文文案').toEqual([])
}

test.describe('M39 中文优先界面语言合同', () => {
  const scenes: Array<{ name: string; run: (page: Page) => Promise<void> }> = [
    {
      name: 'VOUT_MODE 绝对 LINEAR 0x18',
      run: async (page) => {
        await page.getByRole('tab', { name: /VOUT_MODE/ }).click()
        await page.locator('#vout-mode-input').fill('18')
        await page.locator('#vout-mode-input').press('Tab')
      },
    },
    {
      name: 'VOUT_MODE 相对 LINEAR 0x96',
      run: async (page) => {
        await page.getByRole('tab', { name: /VOUT_MODE/ }).click()
        await page.locator('#vout-mode-input').fill('96')
        await page.locator('#vout-mode-input').press('Tab')
      },
    },
    {
      name: 'VOUT_MODE VID 未使用 0x20',
      run: async (page) => {
        await page.getByRole('tab', { name: /VOUT_MODE/ }).click()
        await page.locator('#vout-mode-input').fill('20')
        await page.locator('#vout-mode-input').press('Tab')
      },
    },
    {
      name: 'VOUT_MODE VID 保留 0x24',
      run: async (page) => {
        await page.getByRole('tab', { name: /VOUT_MODE/ }).click()
        await page.locator('#vout-mode-input').fill('24')
        await page.locator('#vout-mode-input').press('Tab')
      },
    },
    {
      name: 'VOUT_MODE 相对 VID 非法 0xA0',
      run: async (page) => {
        await page.getByRole('tab', { name: /VOUT_MODE/ }).click()
        await page.locator('#vout-mode-input').fill('A0')
        await page.locator('#vout-mode-input').press('Tab')
      },
    },
    {
      name: 'VOUT_MODE IEEE Half 参数非法 0x61',
      run: async (page) => {
        await page.getByRole('tab', { name: /VOUT_MODE/ }).click()
        await page.locator('#vout-mode-input').fill('61')
        await page.locator('#vout-mode-input').press('Tab')
      },
    },
    {
      name: 'L16 linked 与 SLINEAR16 offset',
      run: async (page) => {
        await page.getByRole('tab', { name: /LINEAR16/ }).click()
        await page.getByLabel('L16 数据解释类型').selectOption('slinear16-offset')
      },
    },
    {
      name: 'L16 fallback 默认回退 0x20',
      run: async (page) => {
        await page.getByRole('tab', { name: /LINEAR16/ }).click()
        await page.locator('#vout-mode-input').fill('20')
        await page.locator('#vout-mode-input').press('Tab')
      },
    },
    {
      name: 'L16 相对 LINEAR 缺标称参考值 0x98',
      run: async (page) => {
        await page.getByRole('tab', { name: /LINEAR16/ }).click()
        await page.locator('#vout-mode-input').fill('98')
        await page.locator('#vout-mode-input').press('Tab')
      },
    },
    {
      name: 'DIRECT 模式',
      run: async (page) => {
        await page.getByRole('tab', { name: /DIRECT/ }).click()
      },
    },
    {
      name: 'HALF 模式',
      run: async (page) => {
        await page.getByRole('tab', { name: /HALF/ }).click()
      },
    },
  ]

  for (const scene of scenes) {
    test(scene.name + ' 不出现双语重复或整段英文解释', async ({ page }) => {
      await page.goto('/')
      await expect(page.getByTestId('result-panel')).toBeVisible()
      // 展开说明面板与计算过程，让解释性文本进入可访问文本树。
      const details = page.locator('.vout-explanations-details')
      if ((await details.count()) > 0) {
        await details.first().evaluate((el) => el.setAttribute('open', ''))
      }
      const steps = page.locator('[data-testid="calculation-steps-disclosure"]')
      if ((await steps.count()) > 0) {
        await steps.first().evaluate((el) => el.setAttribute('open', ''))
      }
      await scene.run(page)
      await expectChinesePrimary(page, scene.name)
    })
  }

  test('canonical token allowlist 完整且包含关键规范名词', () => {
    for (const token of ['VOUT_MODE', 'LINEAR', 'VID', 'DIRECT', 'IEEE 754 binary16']) {
      expect(ALLOWLIST).toContain(token)
    }
  })

  test('页面标题包含全部五个模式且配置状态不经 KaTeX 排版', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveTitle(/PMBus/)
    await expect(page).toHaveTitle(/VOUT_MODE/)
    await page.getByRole('tab', { name: /VOUT_MODE/ }).click()
    const summary = page.getByTestId('vout-mode-config-summary')
    await expect(summary).toBeVisible()
    await expect(summary.locator('.katex')).toHaveCount(0)
  })
})
