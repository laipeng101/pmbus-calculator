import { useEffect, useState } from 'react'
import { parseHexStrict } from '../../app/hex-parse'

interface Props {
  id?: string
  value: string
  maxDigits: number
  placeholder?: string
  ariaLabel: string
  className?: string
  style?: React.CSSProperties
  onCommit: (text: string) => void
}

function normalizeHexOnBlur(value: string, maxDigits: number): string {
  const trimmed = value.trim()
  if (trimmed === '') return '0'
  const parsed = parseHexStrict(trimmed, maxDigits)
  return parsed.ok ? trimmed : value
}

/**
 * Controlled hexadecimal input with an editing draft and strict validation.
 *
 * The reducer still owns global-state validation via `raw/set-from-hex` /
 * `l16/set-vout-mode`.  This component adds the local draft so users can type
 * transitional and invalid strings (e.g. `0x`, `1G`) without the controlled
 * value snapping back before they finish typing.  Invalid input shows an
 * explicit error and is never committed.
 */
export default function HexInput({
  id,
  value,
  maxDigits,
  placeholder,
  ariaLabel,
  className,
  style,
  onCommit,
}: Props) {
  const [draft, setDraft] = useState(value)
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!editing) setDraft(value)
  }, [value, editing])

  const validate = (next: string): boolean => {
    const parsed = parseHexStrict(next, maxDigits)
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
        inputMode="text"
        autoComplete="off"
        spellCheck={false}
        value={editing ? draft : value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id ?? ariaLabel}-hex-error` : undefined}
        className={className}
        style={style}
        onFocus={() => setEditing(true)}
        onChange={(e) => {
          setDraft(e.target.value)
          if (validate(e.target.value)) onCommit(e.target.value)
        }}
        onBlur={() => {
          const fixed = normalizeHexOnBlur(draft, maxDigits)
          if (parseHexStrict(fixed, maxDigits).ok) {
            setError(null)
            setDraft(fixed)
            onCommit(fixed)
          } else {
            setDraft(value)
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
          id={`${id ?? ariaLabel}-hex-error`}
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
