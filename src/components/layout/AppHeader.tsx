import ThemeToggle from '../feedback/ThemeToggle'

export default function AppHeader() {
  return (
    <header className="flex items-center justify-between px-4 py-3 md:px-6 md:py-4">
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
      <ThemeToggle />
    </header>
  )
}
