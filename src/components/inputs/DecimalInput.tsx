import { useEffect, useState } from 'react'
import { parseDecimalIntStrict } from '../../app/decimal-parse'

interface Props {
  id?: string
  value: number
  placeholder?: string
  ariaLabel: string
  className?: string
  style?: React.CSSProperties
  onCommit: (text: string) => void
}

function normalizeDecimalOnBlur(value: string): string {
  const trimmed = value.trim()
  if (trimmed === '') return '0'
  const parsed = parseDecimalIntStrict(trimmed)
  return parsed.ok ? trimmed : value
}

/**
 * Controlled decimal integer input with a local editing draft and strict
 * validation.  Invalid text (`12abc`, `1e2`, `1.5`, `+`) is shown with an
 * explicit error and never committed; empty input resets to 0 on blur.
 */
export default function DecimalInput({
  id,
  value,
  placeholder,
  ariaLabel,
  className,
  style,
  onCommit,
}: Props) {
  const [draft, setDraft] = useState(String(value))
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!editing) setDraft(String(value))
  }, [value, editing])

  const validate = (next: string): boolean => {
    const parsed = parseDecimalIntStrict(next)
    if (!parsed.ok) {
      setError(parsed.error)
      return false
    }
    setError(null)
    return true
  }

  return (
    <div className="min-w-0 flex-1">
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        value={editing ? draft : String(value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id ?? ariaLabel}-decimal-error` : undefined}
        className={className}
        style={style}
        onFocus={() => setEditing(true)}
        onChange={(e) => {
          setDraft(e.target.value)
          if (validate(e.target.value)) onCommit(e.target.value)
        }}
        onBlur={() => {
          const fixed = normalizeDecimalOnBlur(draft)
          if (parseDecimalIntStrict(fixed).ok) {
            setError(null)
            setDraft(fixed)
            onCommit(fixed)
          } else {
            setDraft(String(value))
            setError(null)
          }
          setEditing(false)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
      />
      {error && (
        <p
          id={`${id ?? ariaLabel}-decimal-error`}
          role="alert"
          className="mt-1 text-xs"
          style={{ color: 'var(--color-danger)' }}
        >
          {error}
        </p>
      )}
    </div>
  )
}
