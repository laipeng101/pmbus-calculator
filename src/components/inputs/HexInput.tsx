import { useEffect, useState } from 'react'
import { parseHexStrict } from '../../app/hex-parse'
import { useEditTransaction } from '../../app/input-transaction'
import { ChevronDownIcon, ChevronUpIcon } from '../icons/Icon'

interface Props {
  id: string
  value: string
  maxDigits: number
  placeholder?: string
  ariaLabel: string
  /** Fixed visual prefix rendered outside the real input (e.g. "0x"). */
  fixedPrefix?: string
  className?: string
  /**
   * Render the +1/-1 stepper inside the field shell. Enable only for
   * semantically steppable hex integers (bounded unsigned words); the range
   * is derived from `maxDigits` (0 .. 16^maxDigits - 1) and never wraps.
   */
  stepper?: boolean
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
 * field-level error and never modify committed state. An untouched focus/blur
 * (no onChange at all) is a strict no-op (v2.5.7).
 *
 * With `stepper`, the field renders as one shared shell (`.hex-field`): the
 * text input and a +1/-1 button pair live inside a single editable surface —
 * side by side on fine pointers (plain-input height), stacked vertically on
 * coarse/touch surfaces. The step buttons keep pointer focus in the input
 * (preventDefault on pointerdown/mousedown), so tapping them never fires the
 * input's blur-commit path and each activation commits exactly once through
 * the same `onCommit` route as typed edits. A valid draft steps from its
 * parsed value; an empty or invalid draft steps from the last committed
 * `value` prop and replaces the draft with the canonical padded result.
 * Boundaries disable the respective button — the value clamps, never wraps.
 */
export default function HexInput({
  id,
  value,
  maxDigits,
  placeholder,
  ariaLabel,
  fixedPrefix,
  className,
  stepper = false,
  onCommit,
}: Props) {
  const [draft, setDraft] = useState(value)
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const transaction = useEditTransaction()

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
    transaction.markDirty()
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
    // Untouched focus/blur (no onChange at all) is a strict no-op: no commit,
    // no raw rewrite, no provenance loss, no field-error change (v2.5.7).
    if (!transaction.shouldCommitOnBlur()) {
      setEditing(false)
      return
    }
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

  // Stepper range is derived from maxDigits: 2 digits -> 0xFF, 4 digits -> 0xFFFF.
  const maxValue = 16 ** maxDigits - 1
  const formatHex = (v: number) => v.toString(16).toUpperCase().padStart(maxDigits, '0')
  const stepBase = (): number => {
    // A complete, in-range draft steps from its own value; an empty or
    // invalid transitional draft steps from the last committed value.
    const fromDraft = parseHexStrict(draft, maxDigits)
    if (fromDraft.ok && !fromDraft.empty) return Math.min(fromDraft.value, maxValue)
    const fromCommitted = parseHexStrict(value, maxDigits)
    return fromCommitted.ok ? Math.min(fromCommitted.value, maxValue) : 0
  }
  const base = stepBase()
  const stepBy = (delta: 1 | -1) => {
    const next = Math.min(Math.max(base + delta, 0), maxValue)
    const text = formatHex(next)
    // One canonical commit per activation. The stepped draft equals the
    // committed state, so the pending edit transaction (e.g. from an invalid
    // draft the step just replaced) is consumed: the following blur is a
    // strict no-op and cannot re-commit the same value a second time.
    transaction.shouldCommitOnBlur()
    setDraft(text)
    setError(null)
    onCommit(text)
  }

  const inputElement = (
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
      className={stepper ? 'hex-field-input' : className}
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
  )

  if (!stepper) {
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
          {inputElement}
          {error && (
            <p id={`${id}-error`} role="alert" className="mt-1 text-xs color-danger">
              {error}
            </p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="min-w-0 flex-1">
      <div
        className={`hex-field input-field ${className ?? ''}`}
        data-error={error ? 'true' : undefined}
        data-testid={`${id}-field`}
      >
        {fixedPrefix && (
          <span
            className="hex-input-prefix self-center font-mono text-sm color-text-muted"
            aria-hidden="true"
            data-testid={`${id}-prefix`}
          >
            {fixedPrefix}
          </span>
        )}
        {inputElement}
        <span className="hex-stepper" role="group" aria-label="十六进制步进">
          <button
            type="button"
            className="hex-step-btn"
            aria-label={`${ariaLabel}增加 1`}
            aria-controls={id}
            disabled={base >= maxValue}
            onPointerDown={(e) => e.preventDefault()}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => stepBy(1)}
            data-testid={`${id}-step-up`}
          >
            <ChevronUpIcon size={14} />
          </button>
          <button
            type="button"
            className="hex-step-btn"
            aria-label={`${ariaLabel}减少 1`}
            aria-controls={id}
            disabled={base <= 0}
            onPointerDown={(e) => e.preventDefault()}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => stepBy(-1)}
            data-testid={`${id}-step-down`}
          >
            <ChevronDownIcon size={14} />
          </button>
        </span>
      </div>
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-1 text-xs color-danger">
          {error}
        </p>
      )}
    </div>
  )
}
