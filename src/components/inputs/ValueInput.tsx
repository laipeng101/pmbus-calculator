import { useEffect, useState } from 'react'
import type { AppAction } from '../../app/actions'
import type { CalculatorViewModel } from '../../app/view-model'
import { parseFloatSafe, isTransitionalFloatText } from '../../app/float-parse'

interface Props {
  vm: CalculatorViewModel
  dispatch: React.Dispatch<AppAction>
}

type DraftKind = 'valid' | 'transitional' | 'invalid' | 'non-finite'

const INVALID_MESSAGE = '物理值输入无效：仅支持十进制数字（可含小数与科学计数法）'
const NON_FINITE_MESSAGE = '当前模式不支持 NaN / Infinity，仅 HALF 模式支持这些特殊值'

function classifyDraft(
  text: string,
  allowNonFinite: boolean,
): { kind: DraftKind; value: number | null } {
  const trimmed = text.trim()
  if (trimmed === '') return { kind: 'transitional', value: null }
  const value = parseFloatSafe(trimmed)
  if (value !== null) {
    if (!Number.isFinite(value) && !allowNonFinite) return { kind: 'non-finite', value }
    return { kind: 'valid', value }
  }
  if (isTransitionalFloatText(trimmed)) return { kind: 'transitional', value: null }
  return { kind: 'invalid', value: null }
}

/** Mirrors legacy blur normalization: '-', '+', '' -> '0'; trailing 'e'/'.' stripped. */
function fixFloatOnBlur(value: string): string {
  value = value.trim()
  if (!value) return '0'
  if (value === '-' || value === '+') return '0'
  if (/[eE][+-]?$/.test(value)) return value.replace(/[eE][+-]?$/, '') || '0'
  if (value.endsWith('.')) return value.slice(0, -1) || '0'
  return value
}

/**
 * Controlled physical-value input with a unified editing model:
 *
 * - 过渡态（空串、单独符号、`1.`、`1e` 等）暂存不报错；
 * - 非法文本与非有限值（非 HALF 模式）不进入 committed state / raw / 结果；
 * - 非法最终值在字段级显示唯一可见错误，blur 不静默回滚；
 * - HALF 模式继续接受 NaN、+Infinity、Infinity、-Infinity。
 */
export default function ValueInput({ vm, dispatch }: Props) {
  const [draft, setDraft] = useState(vm.valueText)
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!editing && !error) setDraft(vm.valueText)
  }, [vm.valueText, editing, error])

  const handleChange = (text: string) => {
    setDraft(text)
    const { kind, value } = classifyDraft(text, vm.mode === 'HALF')
    if (kind === 'invalid') {
      setError(INVALID_MESSAGE)
      return
    }
    if (kind === 'non-finite') {
      setError(NON_FINITE_MESSAGE)
      return
    }
    setError(null)
    if (kind === 'valid' && value !== null) {
      dispatch({ type: 'value/set', value: text })
    }
  }

  const handleBlur = () => {
    const fixed = fixFloatOnBlur(draft)
    const { kind, value } = classifyDraft(fixed, vm.mode === 'HALF')
    if (kind === 'invalid' || kind === 'non-finite') {
      // Keep the invalid draft visible together with its error.
      setError(kind === 'invalid' ? INVALID_MESSAGE : NON_FINITE_MESSAGE)
    } else {
      setError(null)
      setDraft(fixed)
      if (value !== null) dispatch({ type: 'value/set', value: fixed })
    }
    setEditing(false)
  }

  return (
    <div>
      <label
        className="mb-1 block text-xs font-medium"
        style={{ color: 'var(--color-text-muted)' }}
        htmlFor="value-input"
      >
        物理值
      </label>
      <input
        id="value-input"
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        value={editing || error ? draft : vm.valueText}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? 'value-input-error' : undefined}
        onFocus={() => setEditing(true)}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={handleBlur}
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
        aria-label="物理值"
      />
      {error && (
        <p
          id="value-input-error"
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
