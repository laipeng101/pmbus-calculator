import { useEffect, useState } from 'react'
import type { AppAction } from '../../app/actions'
import type { CalculatorViewModel } from '../../app/view-model'
import { classifyFloatText, fixFloatTextOnBlur } from '../../app/float-parse'
import { useEditTransaction } from '../../app/input-transaction'

interface Props {
  vm: CalculatorViewModel
  dispatch: React.Dispatch<AppAction>
}

type DraftKind = 'valid' | 'transitional' | 'invalid' | 'non-finite' | 'out-of-range'

const INVALID_MESSAGE = '物理值输入无效：仅支持十进制数字（可含小数与科学计数法）'
const NON_FINITE_MESSAGE = '当前模式不支持 NaN / Infinity，仅 HALF 模式支持这些特殊值'
const OUT_OF_RANGE_MESSAGE =
  '数值超出可表示范围：该十进制文本会转换为 ±Infinity，请输入 JavaScript Number 可表示的有限值'

function classifyDraft(
  text: string,
  allowNonFinite: boolean,
): { kind: DraftKind; value: number | null } {
  const parsed = classifyFloatText(text)
  switch (parsed.kind) {
    case 'empty':
      return { kind: 'transitional', value: null }
    case 'value':
      if (!Number.isFinite(parsed.value) && !allowNonFinite) {
        return { kind: 'non-finite', value: parsed.value }
      }
      return { kind: 'valid', value: parsed.value }
    case 'out-of-range':
      return { kind: 'out-of-range', value: null }
    case 'transitional':
      return { kind: 'transitional', value: null }
    case 'invalid':
      return { kind: 'invalid', value: null }
  }
}

/**
 * Controlled physical-value input with a unified editing model:
 *
 * - 过渡态（空串、单独符号、`1.`、`1e` 等）暂存不报错；
 * - 非法文本与非有限值（非 HALF 模式）不进入 committed state / raw / 结果；
 * - 完整但超出双精度范围的十进制文本（如 1e400）显示明确的数值范围错误：
 *   不解析、不提交、不改写旧 raw / 请求（v2.5.8，解析层不做静默限幅）；
 * - 非法最终值在字段级显示唯一可见错误，blur 不静默回滚；
 * - HALF 模式继续接受 NaN、+Infinity、-Infinity；
 * - 未发生任何编辑的 focus/blur 是严格 no-op：不 dispatch `value/set`、
 *   不改写 raw、不伪造编码请求来源（raw-lossless，Part II §7.6.2 与
 *   DOMAIN_MODEL §6.1 请求来源合同，v2.5.6）。
 */
export default function ValueInput({ vm, dispatch }: Props) {
  const [draft, setDraft] = useState(vm.valueText)
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Dirty is tracked by real onChange transactions — never by comparing
  // parsed numbers (NaN !== NaN, -0, alternate textual forms would misreport).
  const transaction = useEditTransaction()

  useEffect(() => {
    if (!editing && !error) setDraft(vm.valueText)
  }, [vm.valueText, editing, error])

  const handleChange = (text: string) => {
    transaction.markDirty()
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
    if (kind === 'out-of-range') {
      // Complete decimal text beyond the double range (e.g. 1e400): explicit
      // field error, no commit, last committed state/raw stays untouched.
      setError(OUT_OF_RANGE_MESSAGE)
      return
    }
    setError(null)
    if (kind === 'valid' && value !== null) {
      dispatch({ type: 'value/set', value: text })
    }
  }

  const handleBlur = () => {
    // Untouched focus/blur (no onChange at all) is a strict no-op: it must not
    // dispatch value/set, rewrite raw, fabricate an encoding request, or drop
    // a still-visible field error. Only a real edit transaction commits.
    if (!transaction.shouldCommitOnBlur()) {
      setEditing(false)
      return
    }
    const fixed = fixFloatTextOnBlur(draft)
    const { kind, value } = classifyDraft(fixed, vm.mode === 'HALF')
    if (kind === 'invalid' || kind === 'non-finite' || kind === 'out-of-range') {
      // Keep the invalid draft visible together with its error.
      setError(
        kind === 'invalid'
          ? INVALID_MESSAGE
          : kind === 'non-finite'
            ? NON_FINITE_MESSAGE
            : OUT_OF_RANGE_MESSAGE,
      )
    } else {
      setError(null)
      setDraft(fixed)
      if (value !== null) dispatch({ type: 'value/set', value: fixed })
    }
    setEditing(false)
  }

  return (
    <div>
      <label className="mb-1 block text-xs font-medium color-text-muted" htmlFor="value-input">
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
        className="input-surface color-accent w-full rounded-lg px-3 py-2 text-base font-semibold outline-none"
        placeholder="0"
        aria-label="物理值"
      />
      {error && (
        <p id="value-input-error" role="alert" className="mt-1 text-xs color-danger">
          {error}
        </p>
      )}
    </div>
  )
}
