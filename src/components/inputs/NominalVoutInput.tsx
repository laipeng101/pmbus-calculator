import { useEffect, useState } from 'react'
import {
  classifyFloatText,
  resolveFloatTextOnBlur,
  type FloatTextClassification,
} from '../../app/float-parse'
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
const UNDERFLOW_MESSAGE =
  '输入下溢：该非零十进制文本会转换为 ±0，请求的量级信息会丢失；请输入 JavaScript Number 可表示的非零有限值（最小到 5e-324），或真正的 0'

/** Keep-error blur mapping: each rejected raw kind keeps its own message. */
function errorForRawKind(kind: FloatTextClassification['kind']): string {
  switch (kind) {
    case 'out-of-range':
      return OUT_OF_RANGE_MESSAGE
    case 'underflow':
      return UNDERFLOW_MESSAGE
    default:
      return INVALID_MESSAGE
  }
}

/**
 * VOUT_COMMAND nominal reference input for ULINEAR16 Relative mode.
 * Finite non-negative values commit; invalid/out-of-range drafts keep a
 * field-level error and never modify committed state.  Parse classification
 * comes from the shared `classifyFloatText` (v2.5.8) — no local rule set.
 *
 * v2.5.8 clearing contract: null is a real, reachable committed state.  A
 * user who deleted the entire content and blurs/Enter clears the reference
 * (`onClear`); null ≠ 0 — 0 stays a distinct decode-only value.  Non-empty
 * transitional drafts ('1e', '-', '.') blur-normalize through the shared
 * `resolveFloatTextOnBlur` decision (v2.5.9, classification-first) instead of
 * silently restoring the previous value; invalid drafts keep their error.
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
  ): {
    kind: 'incomplete' | 'valid' | 'invalid' | 'out-of-range' | 'underflow'
    value: number | null
  } => {
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
      case 'underflow':
        return { kind: 'underflow', value: null }
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
    if (kind === 'underflow') {
      // Non-zero decimal text that binary64 rounds to ±0 (v2.5.10): explicit
      // input-underflow error; the last valid nominal stays committed.
      setError(UNDERFLOW_MESSAGE)
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
    // Classification-first blur decision (v2.5.9), shared with ValueInput:
    // the raw draft is classified before any normalization, so an invalid
    // draft (`12..`, `NaNe`, `1ee`) keeps its error and its last committed
    // value instead of being repaired into a commit on blur.
    const resolution = resolveFloatTextOnBlur(draft)
    if (resolution.kind === 'empty') {
      // Real deletion committed (v2.5.8): the reference becomes null — never
      // a silent restore of the previous value, and never coerced to 0.
      setError(null)
      setDraft('')
      onClear()
    } else if (resolution.kind === 'commit') {
      // Nominal references are finite non-negative voltages; NaN / ±Infinity
      // literals are HALF first-class values and stay invalid here.
      if (!Number.isFinite(resolution.value) || resolution.value < 0) {
        setError(INVALID_MESSAGE)
      } else {
        setError(null)
        setDraft(resolution.text)
        onCommit(String(resolution.value))
      }
    } else {
      // Invalid / out-of-range / input-underflow raw draft (or a defensive
      // fail-closed transitional): keep the original draft together with its
      // error and the last committed value.
      setError(errorForRawKind(resolution.raw.kind))
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
