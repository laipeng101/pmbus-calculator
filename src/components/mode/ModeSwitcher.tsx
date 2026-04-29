import type { AppMode } from '../../app/state'

const MODES: { key: AppMode; label: string; shortcut: string }[] = [
  { key: 'L11', label: 'LINEAR11', shortcut: '1' },
  { key: 'L16', label: 'LINEAR16', shortcut: '2' },
  { key: 'DIRECT', label: 'DIRECT', shortcut: '3' },
  { key: 'HALF', label: 'HALF', shortcut: '4' },
]

interface Props {
  mode: AppMode
  onChange: (mode: AppMode) => void
}

export default function ModeSwitcher({ mode, onChange }: Props) {
  return (
    <nav
      aria-label="模式切换"
      role="tablist"
      className="grid grid-cols-2 gap-2 px-4 py-3 md:flex md:flex-row md:justify-center md:gap-3"
    >
      {MODES.map((m) => {
        const active = mode === m.key
        return (
          <button
            key={m.key}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(m.key)}
            className="relative rounded-full px-3 py-2 text-xs font-semibold transition-all duration-200 md:px-5 md:text-sm"
            style={{
              background: active ? 'var(--color-accent)' : 'var(--color-surface)',
              color: active ? '#fff' : 'var(--color-text-primary)',
              border: `2px solid ${active ? 'var(--color-accent)' : 'var(--color-border)'}`,
              boxShadow: active
                ? '0 4px 6px -1px rgb(30 64 175 / 0.2)'
                : '0 1px 3px rgba(0,0,0,0.05)',
            }}
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
