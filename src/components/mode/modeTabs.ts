import type { AppMode } from '../../app/state'

export const MODE_PANEL_ID = 'mode-panel'

export function modeTabId(mode: AppMode): string {
  return `mode-tab-${mode}`
}
