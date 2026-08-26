import { useEffect, useState } from 'react'
import { parseHexStrict } from '../../app/hex-parse'

interface Props {
  id: string
  value: string
  maxDigits: number
  placeholder?: string
  ariaLabel: string
  /** Fixed visual prefix rendered outside the real input (e.g. "0x"). */
  fixedPrefix?: string
  className?: string
  onCommit: (text: string) => void
}

/** Transitional hex drafts (empty) that must not commit or error while typing. */
function isTransitionalHex(input: string): boolean {
  return input.trim() === ''
}

/**
 * Fixed-prefix hexadecimal input sharing the unified editing model.
 *
 * The real DOM input value contains ONLY hex digits; an optional `0x` prefix is
 * a fixed, non-editable element outside the input. Pasting `18`, `0x18` or
 * `0X18` is accepted and normalized to the digit-only draft `18`. Empty drafts
 * commit to 0 on blur/Enter; illegal characters and over-long drafts keep a
 * field-level error and never modify committed state.
 */
export default function HexInput({
  id,
  value,
  maxDigits,
  placeholder,
  ariaLabel,
  fixedPrefix,
  className,
  onCommit,
}: Props) {
  const [draft, setDraft] = useState(value)
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!editing && !error) setDraft(value)
  }, [value, editing, error])

  const normalizeDigits = (text: string): string => {
    const trimmed = text.trim()
    const m = /^0x([0-9a-fA-F]*)$/i.exec(trimmed)
    if (m) return m[1]
    return trimmed
  }

  const handleChange = (raw: string) => {
    const text = normalizeDigits(raw)
    setDraft(text)
    if (isTransitionalHex(text)) {
      setError(null)
      return
    }
    const parsed = parseHexStrict(text, maxDigits)
    if (!parsed.ok) {
      setError(parsed.error)
      return
    }
    setError(null)
    onCommit(text)
  }

  const handleBlur = () => {
    const text = normalizeDigits(draft)
    if (text === '') {
      setError(null)
      setDraft('0')
      onCommit('0')
      setEditing(false)
      return
    }
    const parsed = parseHexStrict(text, maxDigits)
    if (!parsed.ok) {
      setError(parsed.error)
    } else {
      setError(null)
      setDraft(text)
      onCommit(text)
    }
    setEditing(false)
  }

  return (
    <div className="hex-input-group flex min-w-0 flex-1 items-center gap-1">
      {fixedPrefix && (
        <span
          className="hex-input-prefix font-mono text-sm color-text-muted"
          aria-hidden="true"
          data-testid={`${id}-prefix`}
        >
          {fixedPrefix}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <input
          id={id}
          type="text"
          inputMode="text"
          autoComplete="off"
          spellCheck={false}
          value={editing || error ? draft : value}
          placeholder={placeholder}
          aria-label={`${ariaLabel}（十六进制，0x 前缀固定）`}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className={className}
          onFocus={(e) => {
            setEditing(true)
            e.target.select()
          }}
          onChange={(e) => handleChange(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
        />
        {error && (
          <p id={`${id}-error`} role="alert" className="mt-1 text-xs color-danger">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
