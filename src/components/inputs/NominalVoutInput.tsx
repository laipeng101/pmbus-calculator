import { useEffect, useState } from 'react'
import { parseFloatSafe, isTransitionalFloatText } from '../../app/float-parse'

interface Props {
  id: string
  value: number | null
  ariaLabel: string
  onCommit: (text: string) => void
}

const INVALID_MESSAGE = '标称值无效：仅支持十进制非负数（可含小数与科学计数法）'

/**
 * VOUT_COMMAND nominal reference input for ULINEAR16 Relative mode.
 * Finite non-negative values commit; invalid/negative drafts keep a field-level
 * error and never modify committed state.
 */
export default function NominalVoutInput({ id, value, ariaLabel, onCommit }: Props) {
  const [draft, setDraft] = useState(value == null ? '' : String(value))
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!editing && !error) setDraft(value == null ? '' : String(value))
  }, [value, editing, error])

  const classify = (text: string): { valid: boolean; value: number | null } => {
    const trimmed = text.trim()
    if (trimmed === '' || isTransitionalFloatText(trimmed)) return { valid: false, value: null }
    const parsed = parseFloatSafe(trimmed)
    if (parsed === null) return { valid: false, value: null }
    if (!Number.isFinite(parsed) || parsed < 0) return { valid: false, value: null }
    return { valid: true, value: parsed }
  }

  const handleChange = (text: string) => {
    setDraft(text)
    const { valid, value: v } = classify(text)
    if (text.trim() === '' || isTransitionalFloatText(text)) {
      setError(null)
      return
    }
    if (!valid) {
      setError(INVALID_MESSAGE)
      return
    }
    setError(null)
    if (v !== null) onCommit(text)
  }

  const handleBlur = () => {
    const { valid, value: v } = classify(draft)
    if (!valid && draft.trim() !== '' && !isTransitionalFloatText(draft)) {
      setError(INVALID_MESSAGE)
    } else {
      setError(null)
      if (draft.trim() === '' || isTransitionalFloatText(draft)) {
        setDraft('')
      } else if (v !== null) {
        setDraft(String(v))
        onCommit(String(v))
      }
    }
    setEditing(false)
  }

  return (
    <div>
      <label className="mb-1 block text-xs font-medium color-text-muted" htmlFor={id}>
        VOUT_COMMAND nominal（V）
      </label>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        value={editing || error ? draft : value == null ? '' : String(value)}
        aria-label={ariaLabel}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onFocus={() => setEditing(true)}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
        className="input-surface w-full rounded-lg px-3 py-2 text-base font-semibold outline-none"
        placeholder="0"
      />
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-1 text-xs color-danger">
          {error}
        </p>
      )}
    </div>
  )
}
