import { useEffect, useState } from 'react'
import { classifyFloatText } from '../../app/float-parse'
import { useEditTransaction } from '../../app/input-transaction'

interface Props {
  id: string
  value: number | null
  ariaLabel: string
  onCommit: (text: string) => void
}

const INVALID_MESSAGE = '标称值无效：仅支持十进制非负数（可含小数与科学计数法）'
const OUT_OF_RANGE_MESSAGE =
  '数值超出可表示范围：该十进制文本会转换为 ±Infinity，请输入 JavaScript Number 可表示的有限值'

/**
 * VOUT_COMMAND nominal reference input for ULINEAR16 Relative mode.
 * Finite non-negative values commit; invalid/out-of-range drafts keep a
 * field-level error and never modify committed state.  Parse classification
 * comes from the shared `classifyFloatText` (v2.5.8) — no local rule set.
 */
export default function NominalVoutInput({ id, value, ariaLabel, onCommit }: Props) {
  const [draft, setDraft] = useState(value == null ? '' : String(value))
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const transaction = useEditTransaction()

  useEffect(() => {
    if (!editing && !error) setDraft(value == null ? '' : String(value))
  }, [value, editing, error])

  const classify = (
    text: string,
  ): { kind: 'incomplete' | 'valid' | 'invalid' | 'out-of-range'; value: number | null } => {
    const parsed = classifyFloatText(text)
    switch (parsed.kind) {
      case 'empty':
      case 'transitional':
        return { kind: 'incomplete', value: null }
      case 'value': {
        // Nominal references are finite non-negative voltages; NaN / ±Infinity
        // literals are HALF first-class values and stay invalid here.
        if (!Number.isFinite(parsed.value) || parsed.value < 0) {
          return { kind: 'invalid', value: null }
        }
        return { kind: 'valid', value: parsed.value }
      }
      case 'out-of-range':
        return { kind: 'out-of-range', value: null }
      case 'invalid':
        return { kind: 'invalid', value: null }
    }
  }

  const handleChange = (text: string) => {
    transaction.markDirty()
    setDraft(text)
    const { kind } = classify(text)
    if (kind === 'invalid') {
      setError(INVALID_MESSAGE)
      return
    }
    if (kind === 'out-of-range') {
      setError(OUT_OF_RANGE_MESSAGE)
      return
    }
    setError(null)
    if (kind === 'valid') onCommit(text)
  }

  const handleBlur = () => {
    // Untouched focus/blur (no onChange at all) is a strict no-op: no commit,
    // no draft reset, no provenance loss, no field-error change (v2.5.7).
    if (!transaction.shouldCommitOnBlur()) {
      setEditing(false)
      return
    }
    const { kind, value: v } = classify(draft)
    if (kind === 'invalid') {
      setError(INVALID_MESSAGE)
    } else if (kind === 'out-of-range') {
      setError(OUT_OF_RANGE_MESSAGE)
    } else {
      setError(null)
      if (kind === 'incomplete') {
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
        VOUT_COMMAND 标称参考值（V）
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
