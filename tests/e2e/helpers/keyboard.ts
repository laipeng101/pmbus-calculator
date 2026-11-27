import { expect, type Locator, type Page } from '@playwright/test'

export async function tabTo(
  page: Page,
  target: Locator,
  key: 'Tab' | 'Shift+Tab' = 'Tab',
  limit = 20,
) {
  for (let step = 0; step < limit; step += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) break
    await page.keyboard.press(key)
  }
  await expect(target, `应在 ${limit} 次 ${key} 内到达目标控件`).toBeFocused()
}
