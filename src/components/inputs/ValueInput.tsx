import { useEffect, useState } from 'react'
import type { AppAction } from '../../app/actions'
import type { CalculatorViewModel } from '../../app/view-model'
import {
  classifyFloatText,
  resolveFloatTextOnBlur,
  type FloatTextClassification,
} from '../../app/float-parse'
import { DIRECT_EXACT_MAX_LEXEME_LENGTH } from '../../app/direct-exact'
import { useEditTransaction } from '../../app/input-transaction'

interface Props {
  vm: CalculatorViewModel
  dispatch: React.Dispatch<AppAction>
}

type DraftKind = 'valid' | 'transitional' | 'invalid' | 'non-finite' | 'out-of-range' | 'underflow'

const INVALID_MESSAGE = '物理值输入无效：仅支持十进制数字（可含小数与科学计数法）'
const NON_FINITE_MESSAGE = '当前模式不支持 NaN / Infinity，仅 HALF 模式支持这些特殊值'
const OUT_OF_RANGE_MESSAGE =
  '数值超出可表示范围：该十进制文本会转换为 ±Infinity，请输入 JavaScript Number 可表示的有限值'
const UNDERFLOW_MESSAGE =
  '输入下溢：该非零十进制文本会转换为 ±0，请求的量级信息会丢失；请输入 JavaScript Number 可表示的非零有限值（最小到 5e-324），或真正的 0'
const OVERLONG_MESSAGE = `输入过长，未提交：DIRECT 精确十进制文本最多 ${DIRECT_EXACT_MAX_LEXEME_LENGTH} 个字符，旧请求保持不变（这是交互资源边界，不是 PMBus 限制）`

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
    case 'underflow':
      return { kind: 'underflow', value: null }
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
 *   DOMAIN_MODEL §6.1 请求来源合同，v2.5.6）；
 * - 被资源门禁拒绝的编辑候选（v2.5.14）：超长粘贴把当前 focus 事务标为
 *   dirty（此前编辑可能已 dirty），但受控输入保留上一个短草稿——blur/Enter
 *   必须把该状态当作 commit 层 no-op（不派发、不改 raw/请求、不清错误），
 *   否则旧草稿会被当成新候选提交，改写 raw 或丢失精确请求 provenance。
 */
export default function ValueInput({ vm, dispatch }: Props) {
  const [draft, setDraft] = useState(vm.valueText)
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // True while the LATEST edit candidate of the current focus session was
  // rejected by the overlong resource gate. handleChange marks the
  // transaction dirty BEFORE that gate (earlier edits may already have), and
  // the controlled input keeps the previous short draft — so without this
  // marker, blur/Enter would normalize and commit that stale draft as if it
  // were a fresh candidate (v2.5.14: raw/provenance corruption). Only a NEW
  // candidate that passes the gate clears it; the marker survives blur/Enter
  // and dies with the component on mode switch (no cross-mode leakage).
  const [rejectedCandidate, setRejectedCandidate] = useState(false)
  // Dirty is tracked by real onChange transactions — never by comparing
  // parsed numbers (NaN !== NaN, -0, alternate textual forms would misreport).
  const transaction = useEditTransaction()

  useEffect(() => {
    if (!editing && !error) setDraft(vm.valueText)
  }, [vm.valueText, editing, error])

  // v2.5.12 resource boundary (DIRECT exact lexemes only): an overlong draft
  // shows an explicit error and never commits — no truncation, no rewrite to
  // Infinity/0, last committed state/raw and provenance stay untouched. The
  // reducer enforces the same constant defensively, and since v2.5.13 both
  // gates measure the RAW string length (before any trim) so a whitespace-
  // padded dispatch payload cannot bypass the boundary the UI enforces.
  const overlong = (text: string): boolean =>
    vm.mode === 'DIRECT' && text.length > DIRECT_EXACT_MAX_LEXEME_LENGTH

  const handleChange = (text: string) => {
    transaction.markDirty()
    // O(1) resource gate BEFORE the draft state (v2.5.13): an overlong paste
    // is refused outright — it never enters React state (the controlled input
    // keeps the previous draft), no parse/Number pipeline runs, and the
    // committed state/raw/provenance stay untouched (DIRECT only — other
    // modes have no BigInt path and keep their existing contracts).
    if (overlong(text)) {
      setRejectedCandidate(true)
      setError(OVERLONG_MESSAGE)
      return
    }
    // A new short candidate replaces a previously rejected one: from here on
    // blur/Enter follow the normal classification-first contract again, and
    // the new candidate's own kind decides commit vs keep-error.
    setRejectedCandidate(false)
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
    if (kind === 'underflow') {
      // Non-zero decimal text that binary64 rounds to ±0 (e.g. 1e-400):
      // explicit input-underflow error, no commit, no provenance change.
      setError(UNDERFLOW_MESSAGE)
      return
    }
    setError(null)
    if (kind === 'valid' && value !== null) {
      dispatch({ type: 'value/set', value: text })
    }
  }

  const handleBlur = () => {
    // The latest candidate was rejected by the resource gate (v2.5.14):
    // blur/Enter is a commit-layer no-op — no dispatch, no rewrite of
    // raw/parameters/valueRequest, no error clear. The stale short draft
    // stays in the box and the rejection error stays visible; a repeated
    // focus/blur cycle hits this branch again and cannot commit either.
    if (rejectedCandidate) {
      transaction.shouldCommitOnBlur()
      setEditing(false)
      return
    }
    // Untouched focus/blur (no onChange at all) is a strict no-op: it must not
    // dispatch value/set, rewrite raw, fabricate an encoding request, or drop
    // a still-visible field error. Only a real edit transaction commits.
    if (!transaction.shouldCommitOnBlur()) {
      setEditing(false)
      return
    }
    // Resource gate before classification (v2.5.12): an overlong DIRECT
    // draft keeps the error and never commits, whatever its syntax is.
    if (overlong(draft)) {
      setError(OVERLONG_MESSAGE)
      setEditing(false)
      return
    }
    // Classification-first blur decision (v2.5.9): the raw draft is
    // classified BEFORE any normalization, so an invalid draft (`NaN.`,
    // `2..`, `1ee`) keeps its error and never becomes a commit, and only a
    // strictly legal transitional draft normalizes — through the shared
    // decision, never a per-component rewrite.
    const resolution = resolveFloatTextOnBlur(draft)
    if (resolution.kind === 'empty') {
      // Real deletion committed: the physical-value field commits 0.
      setError(null)
      setDraft('0')
      dispatch({ type: 'value/set', value: '0' })
    } else if (resolution.kind === 'commit') {
      if (!Number.isFinite(resolution.value) && vm.mode !== 'HALF') {
        // HALF literals stay rejected outside HALF mode: keep the draft and
        // the error, no commit.
        setError(NON_FINITE_MESSAGE)
      } else if (overlong(resolution.text)) {
        // DIRECT exact lexeme resource boundary: keep the draft and show the
        // explicit error, no commit.
        setError(OVERLONG_MESSAGE)
      } else {
        setError(null)
        setDraft(resolution.text)
        dispatch({ type: 'value/set', value: resolution.text })
      }
    } else {
      // Invalid / out-of-range / input-underflow raw draft (or a defensive
      // fail-closed transitional): keep the original draft together with its
      // error.
      setError(errorForRawKind(resolution.raw.kind))
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
