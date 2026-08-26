import ThemeToggle from '../feedback/ThemeToggle'
import type { Theme } from '../../app/state'

interface Props {
  theme: Theme
  onThemeChange: (theme: Theme) => void
}

export default function AppHeader({ theme, onThemeChange }: Props) {
  return (
    <header className="flex items-center justify-between px-4 py-3 sm:px-0 md:py-4">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-bold tracking-tight md:text-2xl color-accent">
            PMBus 数值格式计算器
          </h1>
          <span data-testid="version-badge" className="version-badge">
            v{__APP_VERSION__}
          </span>
        </div>
        <p className="mt-0.5 break-words text-sm color-text-secondary">
          LINEAR11 / LINEAR16 / DIRECT / binary16 / VOUT_MODE
        </p>
        <p className="mt-0.5 text-xs color-text-muted">
          数值格式换算，不实现完整 PMBus/SMBus 协议栈
        </p>
      </div>
      <ThemeToggle theme={theme} onChange={onThemeChange} />
    </header>
  )
}
