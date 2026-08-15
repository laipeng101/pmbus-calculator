import { useEffect, useState } from 'react'
import type { AppAction } from '../../app/actions'
import type { CalculatorViewModel } from '../../app/view-model'

interface Props {
  vm: CalculatorViewModel
  dispatch: React.Dispatch<AppAction>
}

/**
 * Controlled physical-value input with an editing draft.
 *
 * While the user is editing we keep the local draft so transitional strings
 * like "1e" or "-" are not clobbered by the encoded/represented value.
 * The reducer ignores unparsable states and only commits valid values.
 */
function fixFloatOnBlur(value: string): string {
  value = value.trim()
  if (!value) return '0'
  if (value === '-' || value === '+') return '0'
  if (/[eE][+-]?$/.test(value)) return value.replace(/[eE][+-]?$/, '') || '0'
  if (value.endsWith('.')) return value.slice(0, -1) || '0'
  return value
}

export default function ValueInput({ vm, dispatch }: Props) {
  const [draft, setDraft] = useState(vm.valueText)
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    if (!editing) setDraft(vm.valueText)
  }, [vm.valueText, editing])

  return (
    <div>
      <label
        className="mb-1 block text-xs font-medium"
        style={{ color: 'var(--color-text-muted)' }}
        htmlFor="value-input"
      >
        物理值 (Value)
      </label>
      <input
        id="value-input"
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        value={editing ? draft : vm.valueText}
        onFocus={() => setEditing(true)}
        onChange={(e) => {
          setDraft(e.target.value)
          dispatch({ type: 'value/set', value: e.target.value })
        }}
        onBlur={() => {
          const fixed = fixFloatOnBlur(draft)
          setDraft(fixed)
          dispatch({ type: 'value/set', value: fixed })
          setEditing(false)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
        className="w-full rounded-lg px-3 py-2 text-base font-semibold outline-none"
        style={{
          background: 'var(--color-surface-muted)',
          color: 'var(--color-accent)',
          border: '1px solid var(--color-border)',
          fontFamily: 'var(--font-mono)',
        }}
        placeholder="0"
        aria-label="物理值 (Value)"
      />
    </div>
  )
}
