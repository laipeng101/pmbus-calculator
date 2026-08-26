import { useRef } from 'react'
import type { AppMode } from '../../app/state'
import { MODE_PANEL_ID, modeTabId } from './modeTabs'

const MODES: { key: AppMode; label: string; shortcut: string }[] = [
  { key: 'L11', label: 'LINEAR11', shortcut: '1' },
  { key: 'L16', label: 'LINEAR16', shortcut: '2' },
  { key: 'DIRECT', label: 'DIRECT', shortcut: '3' },
  { key: 'HALF', label: 'HALF', shortcut: '4' },
  { key: 'VOUT_MODE', label: 'VOUT_MODE', shortcut: '5' },
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
          <button
            type="button"
            key={m.key}
            id={modeTabId(m.key)}
            ref={(el) => {
              tabRefs.current[m.key] = el
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
        )
      })}
    </nav>
  )
}
