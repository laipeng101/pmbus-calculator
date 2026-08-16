import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import {
  COMMAND_METADATA,
  describeDataBytesConflict,
  describeEncodingRule,
  describePresetSource,
  describeTransactions,
} from '../../legacy/command-metadata'

interface Props {
  commandKey: string | null
  onChange: (key: string | null) => void
  onApplyPreset: (key: string) => void
}

interface OptionVM {
  key: string
  label: string
}

const NONE_OPTION: OptionVM = { key: '', label: '— 无命令 —' }

const LISTBOX_ID = 'command-picker-listbox'

function optionId(key: string): string {
  return `command-option-${key || 'none'}`
}

export default function CommandPicker({ commandKey, onChange, onApplyPreset }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeKey, setActiveKey] = useState<string>(commandKey ?? '')
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

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

  const options = useMemo<OptionVM[]>(
    () => [NONE_OPTION, ...filtered.map((c) => ({ key: c.key, label: c.label }))],
    [filtered],
  )

  const selected = commandKey ? (COMMAND_METADATA[commandKey] ?? null) : null

  /**
   * Close the popup.  `restoreFocus` is true for keyboard-originated closes
   * (Escape, Enter, option click) and false for outside pointer closes so the
   * user's newly focused control keeps focus.
   */
  const closePopover = useCallback((restoreFocus: boolean) => {
    setOpen(false)
    setQuery('')
    if (restoreFocus) {
      // Defer so the browser's default focus handling for the closing
      // interaction (e.g. Enter/click) finishes first.
      window.setTimeout(() => triggerRef.current?.focus(), 0)
    }
  }, [])

  const selectOption = useCallback(
    (key: string) => {
      onChange(key === '' ? null : key)
      closePopover(true)
    },
    [onChange, closePopover],
  )

  useEffect(() => {
    if (!open) return
    function handleOutsidePointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        // Do not steal focus back to the trigger: let the clicked Hex/Value
        // control keep the focus it is about to receive.
        closePopover(false)
      }
    }
    document.addEventListener('mousedown', handleOutsidePointerDown)
    return () => document.removeEventListener('mousedown', handleOutsidePointerDown)
  }, [open, closePopover])

  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
    const idx = options.findIndex((o) => o.key === commandKey)
    setActiveKey(options[idx >= 0 ? idx : 0]?.key ?? '')
  }, [open, commandKey, options])

  // Keep the active option visible while navigating with ArrowUp/ArrowDown.
  useEffect(() => {
    if (!open) return
    const el = document.getElementById(optionId(activeKey))
    el?.scrollIntoView({ block: 'nearest' })
  }, [open, activeKey])

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      closePopover(true)
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const current = options.findIndex((o) => o.key === activeKey)
      const delta = e.key === 'ArrowDown' ? 1 : -1
      const next = (current + delta + options.length) % options.length
      setActiveKey(options[next].key)
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const current = options.findIndex((o) => o.key === activeKey)
      if (current >= 0) selectOption(options[current].key)
    }
  }

  const toggleOpen = () => {
    if (open) {
      // The trigger already has focus when it is clicked; keep it there.
      setOpen(false)
      setQuery('')
    } else {
      setOpen(true)
    }
  }

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
        type="button"
        id="command-picker"
        ref={triggerRef}
        onClick={toggleOpen}
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
            ? `${selected.label} (0x${selected.cmd.toString(16).toUpperCase().padStart(2, '0')}) — ${describeEncodingRule(selected.encodingRule)}`
            : '选择命令...'}
        </span>
        <span className="ml-2 text-xs opacity-50">▼</span>
      </button>

      {selected?.preset && (
        <div
          className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2"
          style={{
            background: 'var(--color-surface-muted)',
            border: '1px dashed var(--color-border)',
          }}
        >
          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {describePresetSource(selected.preset)} 预设（{selected.preset.source}
            {selected.preset.units ? ` · ${selected.preset.units}` : ''}）— 不会自动应用
          </span>
          <button
            type="button"
            onClick={() => onApplyPreset(selected.key)}
            className="rounded-md px-3 py-1.5 text-xs font-semibold transition-colors"
            style={{
              background: 'var(--color-accent)',
              color: '#fff',
              border: '1px solid var(--color-border)',
            }}
          >
            应用 project-demo 预设
          </button>
        </div>
      )}

      {open && (
        <div
          className="popover-enter absolute left-4 right-4 bottom-full z-50 mb-1 overflow-hidden rounded-lg"
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            boxShadow: 'var(--shadow-panel)',
          }}
        >
          <div className="p-2">
            <input
              ref={inputRef}
              type="text"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded="true"
              aria-controls={LISTBOX_ID}
              aria-activedescendant={optionId(activeKey)}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onInputKeyDown}
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
          <ul
            id={LISTBOX_ID}
            role="listbox"
            aria-label="PMBus 命令列表"
            className="max-h-64 overflow-y-auto py-1"
          >
            {options.map((opt) => {
              const isSelected = opt.key === commandKey
              const isActive = opt.key === activeKey
              const cmd = opt.key ? COMMAND_METADATA[opt.key] : null
              return (
                <li key={opt.key || '__none__'}>
                  <button
                    type="button"
                    id={optionId(opt.key)}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => selectOption(opt.key)}
                    onMouseEnter={() => setActiveKey(opt.key)}
                    className="w-full px-4 py-2 text-left text-sm transition-colors hover:opacity-80"
                    style={{
                      background: isActive
                        ? 'var(--color-surface-muted)'
                        : isSelected
                          ? 'rgba(59,130,246,0.08)'
                          : 'transparent',
                      color: cmd ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                    }}
                  >
                    {cmd ? (
                      <>
                        <div className="flex items-center justify-between">
                          <span className="font-medium">{cmd.label}</span>
                          <span
                            className="ml-2 text-xs"
                            style={{ color: 'var(--color-text-muted)' }}
                          >
                            0x{cmd.cmd.toString(16).toUpperCase().padStart(2, '0')}
                          </span>
                        </div>
                        <div
                          className="mt-0.5 text-xs"
                          style={{ color: 'var(--color-text-muted)' }}
                        >
                          {describeEncodingRule(cmd.encodingRule)} ·{' '}
                          {describeTransactions(cmd.transactions)} · {cmd.units} · {cmd.spec}
                        </div>
                        {cmd.dataBytesConflict && (
                          <div className="mt-0.5 text-xs" style={{ color: 'var(--color-warning)' }}>
                            {describeDataBytesConflict(cmd.dataBytesConflict)}
                          </div>
                        )}
                      </>
                    ) : (
                      opt.label
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
