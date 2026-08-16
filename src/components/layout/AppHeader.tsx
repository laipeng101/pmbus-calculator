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
        <h1
          className="text-xl font-bold tracking-tight md:text-2xl"
          style={{ color: 'var(--color-accent)' }}
        >
          PMBus 协议计算器
        </h1>
        <p className="mt-0.5 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          L11 / L16 / DIRECT / HALF
        </p>
      </div>
      <ThemeToggle theme={theme} onChange={onThemeChange} />
    </header>
  )
}
