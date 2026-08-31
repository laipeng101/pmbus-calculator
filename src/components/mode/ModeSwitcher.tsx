import { useRef } from 'react'
import type { AppMode } from '../../app/state'
import type { ControlHelpParams } from '../../app/control-help'
import ControlTooltip from '../help/ControlTooltip'
import type { ControlTriggerProps } from '../help/ControlTooltip'
import { MODE_PANEL_ID, modeTabId } from './modeTabs'

type ModeTabHelpId = keyof Pick<
  ControlHelpParams,
  | 'mode-tab-linear11'
  | 'mode-tab-linear16'
  | 'mode-tab-direct'
  | 'mode-tab-half'
  | 'mode-tab-vout-mode'
>

const MODES: { key: AppMode; label: string; shortcut: string; help: ModeTabHelpId }[] = [
  { key: 'L11', label: 'LINEAR11', shortcut: '1', help: 'mode-tab-linear11' },
  { key: 'L16', label: 'LINEAR16', shortcut: '2', help: 'mode-tab-linear16' },
  { key: 'DIRECT', label: 'DIRECT', shortcut: '3', help: 'mode-tab-direct' },
  { key: 'HALF', label: 'HALF', shortcut: '4', help: 'mode-tab-half' },
  { key: 'VOUT_MODE', label: 'VOUT_MODE', shortcut: '5', help: 'mode-tab-vout-mode' },
]

interface Props {
  mode: AppMode
  onChange: (mode: AppMode) => void
}

export default function ModeSwitcher({ mode, onChange }: Props) {
  const tabRefs = useRef<Partial<Record<AppMode, HTMLButtonElement | null>>>({})

  const focusTab = (key: AppMode) => {
    tabRefs.current[key]?.focus()
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, current: AppMode) => {
    const index = MODES.findIndex((m) => m.key === current)
    let next: AppMode | null = null

    if (event.key === 'ArrowRight') {
      event.preventDefault()
      next = MODES[(index + 1) % MODES.length].key
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      next = MODES[(index - 1 + MODES.length) % MODES.length].key
    } else if (event.key === 'Home') {
      event.preventDefault()
      next = MODES[0].key
    } else if (event.key === 'End') {
      event.preventDefault()
      next = MODES[MODES.length - 1].key
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onChange(current)
      return
    }

    if (next != null) {
      onChange(next)
      focusTab(next)
    }
  }

  return (
    <nav
      aria-label="模式切换"
      role="tablist"
      className="grid grid-cols-2 gap-2 px-4 py-3 sm:px-0 md:flex md:flex-row md:justify-center md:gap-3"
    >
      {MODES.map((m) => {
        const active = mode === m.key
        return (
          <ControlTooltip key={m.key} help={m.help} params={undefined}>
            {(triggerProps: ControlTriggerProps) => (
              <button
                {...triggerProps}
                type="button"
                key={m.key}
                id={modeTabId(m.key)}
                ref={(el) => {
                  tabRefs.current[m.key] = el
                  triggerProps.ref?.(el)
                }}
                role="tab"
                aria-selected={active}
                aria-controls={MODE_PANEL_ID}
                tabIndex={active ? 0 : -1}
                onClick={() => onChange(m.key)}
                onKeyDown={(e) => onKeyDown(e, m.key)}
                className={`mode-tab relative rounded-full px-3 py-2 text-xs font-semibold transition-colors md:px-5 md:text-sm`}
              >
                {m.label}
                <span className="ml-1 hidden text-[10px] opacity-60 md:inline" aria-hidden="true">
                  Ctrl+{m.shortcut}
                </span>
              </button>
            )}
          </ControlTooltip>
        )
      })}
    </nav>
  )
}
