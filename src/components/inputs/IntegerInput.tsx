import { useEffect, useState } from 'react'

interface Props {
  id?: string
  value: number
  disabled?: boolean
  placeholder?: string
  ariaLabel: string
  className?: string
  style?: React.CSSProperties
  onCommit: (text: string) => void
}

function fixIntegerOnBlur(value: string): string {
  value = value.trim()
  if (!value || value === '-' || value === '+') return '0'
  return value
}

/**
 * Controlled integer input with an editing draft.
 *
 * Keeps transitional strings like "-" during editing instead of snapping back
 * to the committed value; the reducer still owns validation/parsing.
 */
export default function IntegerInput({
  id,
  value,
  disabled = false,
  placeholder,
  ariaLabel,
  className,
  style,
  onCommit,
}: Props) {
  const [draft, setDraft] = useState(String(value))
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    if (!editing) setDraft(String(value))
  }, [value, editing])

  return (
    <input
      id={id}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      spellCheck={false}
      disabled={disabled}
      value={editing ? draft : String(value)}
      placeholder={placeholder}
      aria-label={ariaLabel}
      className={className}
      style={style}
      onFocus={() => setEditing(true)}
      onChange={(e) => {
        setDraft(e.target.value)
        onCommit(e.target.value)
      }}
      onBlur={() => {
        const fixed = fixIntegerOnBlur(draft)
        setDraft(fixed)
        onCommit(fixed)
        setEditing(false)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
    />
  )
}
