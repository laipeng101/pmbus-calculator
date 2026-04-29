import { useCallback, useEffect, useState } from 'react'

type Theme = 'light' | 'dark' | 'system'

function getSystemTheme(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function resolveTheme(theme: Theme): 'light' | 'dark' {
  return theme === 'system' ? getSystemTheme() : theme
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem('theme') as Theme | null
    return saved ?? 'system'
  })

  useEffect(() => {
    const resolved = resolveTheme(theme)
    document.documentElement.setAttribute('data-theme', resolved)
    localStorage.setItem('theme', theme)
  }, [theme])

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => {
      if (theme === 'system') {
        document.documentElement.setAttribute('data-theme', getSystemTheme())
      }
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [theme])

  const cycle = useCallback(() => {
    setTheme((prev) => {
      const order: Theme[] = ['light', 'dark', 'system']
      const next = order[(order.indexOf(prev) + 1) % order.length]
      return next
    })
  }, [])

  const icon =
    theme === 'light' ? '☀️' : theme === 'dark' ? '🌙' : '🖥️'

  const label =
    theme === 'light' ? '亮色' : theme === 'dark' ? '暗色' : '跟随系统'

  return (
    <button
      onClick={cycle}
      aria-label={`当前主题: ${label}，点击切换`}
      title={`主题: ${label}`}
      className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
      style={{
        background: 'var(--color-surface-muted)',
        color: 'var(--color-text-secondary)',
        border: '1px solid var(--color-border)',
      }}
    >
      <span>{icon}</span>
      <span className="hidden sm:inline">{label}</span>
    </button>
  )
}
