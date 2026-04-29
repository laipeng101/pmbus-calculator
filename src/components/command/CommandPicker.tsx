import { useState, useRef, useEffect, useMemo } from 'react'
import { COMMAND_METADATA } from '../../legacy/command-metadata'

interface Props {
  commandKey: string | null
  onChange: (key: string | null) => void
}

export default function CommandPicker({ commandKey, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  const commands = useMemo(() => Object.values(COMMAND_METADATA), [])

  const filtered = useMemo(() => {
    const q = query.toLowerCase()
    return q === ''
      ? commands
      : commands.filter(
          (c) =>
            c.label.toLowerCase().includes(q) ||
            c.cmd.toString(16).includes(q) ||
            (c.spec?.toLowerCase().includes(q) ?? false),
        )
  }, [commands, query])

  const selected = commandKey ? (COMMAND_METADATA[commandKey] ?? null) : null

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div ref={containerRef} className="relative px-4 py-2">
      <label
        htmlFor="command-picker"
        className="mb-1.5 block text-xs font-semibold uppercase tracking-wider"
        style={{ color: 'var(--color-text-secondary)' }}
      >
        PMBus 命令
      </label>
      <button
        id="command-picker"
        onClick={() => setOpen(!open)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center justify-between rounded-lg px-4 py-2.5 text-left text-sm transition-colors"
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          color: 'var(--color-text-primary)',
        }}
      >
        <span className="truncate">
          {selected
            ? `${selected.label} (0x${selected.cmd.toString(16).toUpperCase().padStart(2, '0')}) — ${selected.mode}`
            : '选择命令...'}
        </span>
        <span className="ml-2 text-xs opacity-50">▼</span>
      </button>

      {open && (
        <div
          className="absolute left-4 right-4 top-full z-50 mt-1 overflow-hidden rounded-lg"
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            boxShadow: 'var(--shadow-panel)',
          }}
        >
          <div className="p-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索命令..."
              className="w-full rounded-md px-3 py-2 text-sm outline-none"
              style={{
                background: 'var(--color-surface-muted)',
                color: 'var(--color-text-primary)',
                border: '1px solid var(--color-border)',
              }}
              autoFocus
            />
          </div>
          <ul role="listbox" className="max-h-64 overflow-y-auto py-1">
            <li>
              <button
                role="option"
                aria-selected={commandKey === null}
                onClick={() => {
                  onChange(null)
                  setOpen(false)
                  setQuery('')
                }}
                className="w-full px-4 py-2 text-left text-sm transition-colors hover:opacity-80"
                style={{
                  background: commandKey === null ? 'var(--color-surface-muted)' : 'transparent',
                  color: 'var(--color-text-secondary)',
                }}
              >
                — 无命令 —
              </button>
            </li>
            {filtered.map((cmd) => (
              <li key={cmd.key}>
                <button
                  role="option"
                  aria-selected={commandKey === cmd.key}
                  onClick={() => {
                    onChange(cmd.key)
                    setOpen(false)
                    setQuery('')
                  }}
                  className="w-full px-4 py-2 text-left text-sm transition-colors hover:opacity-80"
                  style={{
                    background:
                      commandKey === cmd.key ? 'var(--color-surface-muted)' : 'transparent',
                    color: 'var(--color-text-primary)',
                  }}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{cmd.label}</span>
                    <span className="ml-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                      0x{cmd.cmd.toString(16).toUpperCase().padStart(2, '0')}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    {cmd.mode} · {cmd.spec}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
