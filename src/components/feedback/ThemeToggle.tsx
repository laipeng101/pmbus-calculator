import type { Theme } from '../../app/state'
import { MonitorIcon, MoonIcon, SunIcon } from '../icons/Icon'
import ControlTooltip from '../help/ControlTooltip'

interface Props {
  theme: Theme
  onChange: (theme: Theme) => void
}

const ORDER: Theme[] = ['light', 'dark', 'system']

export default function ThemeToggle({ theme, onChange }: Props) {
  const cycle = () => {
    const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length]
    onChange(next)
  }

  const label = theme === 'light' ? '亮色' : theme === 'dark' ? '暗色' : '跟随系统'

  return (
    <ControlTooltip help="theme-toggle" params={{ themeLabel: label }}>
      {(triggerProps) => (
        <button
          {...triggerProps}
          type="button"
          onClick={cycle}
          aria-label={`当前主题: ${label}，点击切换`}
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors surface-muted border-default color-text-primary"
        >
          <span className="inline-flex" aria-hidden="true">
            {theme === 'light' ? (
              <SunIcon size={16} />
            ) : theme === 'dark' ? (
              <MoonIcon size={16} />
            ) : (
              <MonitorIcon size={16} />
            )}
          </span>
          <span className="hidden sm:inline">{label}</span>
        </button>
      )}
    </ControlTooltip>
  )
}
