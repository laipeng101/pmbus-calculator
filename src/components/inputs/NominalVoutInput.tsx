import { useEffect, useState } from 'react'
import { classifyFloatText, fixFloatTextOnBlur } from '../../app/float-parse'
import { useEditTransaction } from '../../app/input-transaction'

interface Props {
  id: string
  value: number | null
  ariaLabel: string
  onCommit: (text: string) => void
  /** Fired when the user really deleted all content and blurs (v2.5.8). */
  onClear: () => void
}

const INVALID_MESSAGE = '标称值无效：仅支持十进制非负数（可含小数与科学计数法）'
const OUT_OF_RANGE_MESSAGE =
  '数值超出可表示范围：该十进制文本会转换为 ±Infinity，请输入 JavaScript Number 可表示的有限值'

/**
 * VOUT_COMMAND nominal reference input for ULINEAR16 Relative mode.
 * Finite non-negative values commit; invalid/out-of-range drafts keep a
 * field-level error and never modify committed state.  Parse classification
 * comes from the shared `classifyFloatText` (v2.5.8) — no local rule set.
 *
 * v2.5.8 clearing contract: null is a real, reachable committed state.  A
 * user who deleted the entire content and blurs/Enter clears the reference
 * (`onClear`); null ≠ 0 — 0 stays a distinct decode-only value.  Non-empty
 * transitional drafts ('1e', '-', '.') blur-normalize via the shared
 * `fixFloatTextOnBlur` instead of silently restoring the previous value.
 * Untouched focus/blur sessions (no onChange at all) remain strict no-ops.
 */
export default function NominalVoutInput({ id, value, ariaLabel, onCommit, onClear }: Props) {
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
    // no clear, no draft reset, no provenance loss, no field-error change
    // (v2.5.7).
    if (!transaction.shouldCommitOnBlur()) {
      setEditing(false)
      return
    }
    if (draft.trim() === '') {
      // Real deletion committed (v2.5.8): the reference becomes null — never
      // a silent restore of the previous value, and never coerced to 0.
      setError(null)
      setDraft('')
      onClear()
      setEditing(false)
      return
    }
    // Non-empty transitional draft ('1e', '-', '.'): normalize exactly like
    // the physical-value input instead of silently restoring the old value.
    const fixed = fixFloatTextOnBlur(draft)
    const { kind, value: v } = classify(fixed)
    if (kind === 'invalid') {
      setError(INVALID_MESSAGE)
      setDraft(fixed)
    } else if (kind === 'out-of-range') {
      setError(OUT_OF_RANGE_MESSAGE)
      setDraft(fixed)
    } else {
      setError(null)
      setDraft(fixed)
      if (kind === 'valid' && v !== null) onCommit(String(v))
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
        placeholder="未设置（相对比值仍可计算）"
      />
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-1 text-xs color-danger">
          {error}
        </p>
      )}
    </div>
  )
}
