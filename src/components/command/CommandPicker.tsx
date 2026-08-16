import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { autoUpdate, flip, offset, shift, size, useFloating } from '@floating-ui/react-dom'
import {
  COMMAND_METADATA,
  describeDataBytesConflict,
  describeEncodingRule,
  describePresetSource,
  describeTransactions,
} from '../../legacy/command-metadata'
import { ChevronDownIcon } from '../icons/Icon'

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

interface PopupBox {
  width: number
  maxHeight: number
}

const INITIAL_POPUP_BOX: PopupBox = { width: 0, maxHeight: 320 }

export default function CommandPicker({ commandKey, onChange, onApplyPreset }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeKey, setActiveKey] = useState<string>(commandKey ?? '')
  const [popupBox, setPopupBox] = useState<PopupBox>(INITIAL_POPUP_BOX)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listboxRef = useRef<HTMLUListElement>(null)

  const { refs, floatingStyles } = useFloating({
    strategy: 'fixed',
    placement: 'bottom-start',
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(6),
      flip({ fallbackPlacements: ['top-start'] }),
      shift({ padding: 12 }),
      size({
        apply({ rects, availableWidth: _availableWidth, availableHeight }) {
          const width = rects.reference.width
          const maxHeight = Math.max(96, availableHeight - 8)
          setPopupBox((prev) =>
            prev.width === width && prev.maxHeight === maxHeight ? prev : { width, maxHeight },
          )
        },
      }),
    ],
  })

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

  const closePopover = useCallback((restoreFocus: boolean) => {
    setOpen(false)
    setQuery('')
    if (restoreFocus) {
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
    if (open === false) return

    function handleOutsidePointerDown(e: MouseEvent) {
      const target = e.target as Node
      const trigger = triggerRef.current
      const inTrigger = trigger != null && trigger.contains(target)
      const inFloating = refs.floating.current != null && refs.floating.current.contains(target)
      if (inTrigger === false && inFloating === false) {
        closePopover(false)
      }
    }

    document.addEventListener('mousedown', handleOutsidePointerDown)
    return () => document.removeEventListener('mousedown', handleOutsidePointerDown)
  }, [open, closePopover, refs.floating, refs.reference])

  useEffect(() => {
    if (open === false) return
    inputRef.current?.focus()
    const idx = options.findIndex((o) => o.key === commandKey)
    setActiveKey(options[idx >= 0 ? idx : 0]?.key ?? '')
  }, [open, commandKey, options])

  // Keep the active option visible inside the listbox only.  Never call
  // scrollIntoView on the option directly because that can scroll the page.
  useEffect(() => {
    if (open === false) return
    const list = listboxRef.current
    const el = document.getElementById(optionId(activeKey))
    if (list == null || el == null) return
    const listRect = list.getBoundingClientRect()
    const elRect = el.getBoundingClientRect()
    if (elRect.top < listRect.top) {
      list.scrollTop += elRect.top - listRect.top
    } else if (elRect.bottom > listRect.bottom) {
      list.scrollTop += elRect.bottom - listRect.bottom
    }
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
      setOpen(false)
      setQuery('')
    } else {
      setOpen(true)
    }
  }

  return (
    <div className="relative px-4 py-2">
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
        ref={(el) => {
          triggerRef.current = el
          refs.setReference(el)
        }}
        onClick={toggleOpen}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? LISTBOX_ID : undefined}
        className="flex h-10 w-full items-center justify-between rounded-lg px-4 text-left text-sm transition-colors"
        style={{
          background: 'var(--color-surface-muted)',
          border: '1px solid var(--color-border)',
          color: 'var(--color-text-primary)',
        }}
      >
        <span className="truncate">
          {selected
            ? `${selected.label} (0x${selected.cmd.toString(16).toUpperCase().padStart(2, '0')}) — ${describeEncodingRule(selected.encodingRule)}`
            : '选择命令...'}
        </span>
        <ChevronDownIcon size={16} />
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
            className="min-h-9 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors"
            style={{
              background: 'var(--color-accent)',
              color: '#fff',
              border: '1px solid var(--color-accent)',
            }}
          >
            应用 project-demo 预设
          </button>
        </div>
      )}

      {open &&
        createPortal(
          <div
            ref={refs.setFloating}
            className="popover-enter flex flex-col overflow-hidden rounded-lg"
            style={{
              ...floatingStyles,
              width: popupBox.width > 0 ? popupBox.width : 'max-content',
              maxHeight: popupBox.maxHeight,
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              boxShadow: 'var(--shadow-panel)',
              zIndex: 1000,
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
                className="h-10 w-full rounded-md px-3 text-sm outline-none"
                style={{
                  background: 'var(--color-surface-muted)',
                  color: 'var(--color-text-primary)',
                  border: '1px solid var(--color-border)',
                }}
                autoFocus
              />
            </div>
            <ul
              ref={listboxRef}
              id={LISTBOX_ID}
              role="listbox"
              aria-label="PMBus 命令列表"
              className="min-h-0 flex-1 overflow-y-auto py-1"
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
                      className="w-full px-4 py-2 text-left text-sm transition-colors"
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
                            <div
                              className="mt-0.5 text-xs"
                              style={{ color: 'var(--color-warning)' }}
                            >
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
          </div>,
          document.body,
        )}
    </div>
  )
}
