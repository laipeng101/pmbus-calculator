import { PMBusMath } from '../../legacy/pmbus-math'
import {
  analyzeDirectRoundTrip,
  formatExactDecimal,
  formatExactRational,
  generateSafeDirectReentryText,
} from '../direct-exact'
import type { AppState } from '../state'
import type { DirectFidelityVM, WarningVM } from './types'
import { formatPlainNumber } from '../numeric-presentation'

/**
 * Shared note for the quantization readout in a precision-folded DIRECT
 * state (v2.5.11): the binary64 delta can honestly be zero while the
 * displayed value still cannot be re-entered safely.
 */
export const DIRECT_PRECISION_FOLD_DELTA_NOTE =
  '当前 raw 的显示值为 binary64 近似（精度折叠），直接回输会编码为不同的 raw；「物理值」复制使用经验证的精确回录文本'

export function resolveDirectValueText(state: AppState): string {
  const y = PMBusMath.toSigned(state.raw, 16)
  const r = PMBusMath.decodeDirect(y, state.direct.m, state.direct.b, state.direct.r)
  return Number.isNaN(r.value) ? '—' : formatPlainNumber(r.value)
}

/**
 * DIRECT precision-fidelity resolution (v2.5.11): null for every state that
 * is not "DIRECT with m ≠ 0 whose exact decode precision-folds in binary64".
 * Single source for the warning, the quantization note, the exact-value
 * steps and the copy override — every surface answers the same fidelity
 * question from this resolution, derived from the live raw word and
 * coefficients so it can never go stale.
 */
export function resolveDirectFidelity(state: AppState): DirectFidelityVM | null {
  if (state.mode !== 'DIRECT' || state.direct.m === 0) return null
  const y = PMBusMath.toSigned(state.raw, 16)
  const analysis = analyzeDirectRoundTrip(y, state.direct.m, state.direct.b, state.direct.r)
  if (!analysis || analysis.roundTripSafe) return null
  const safeReentryText = generateSafeDirectReentryText(
    analysis.exact,
    y,
    state.direct.m,
    state.direct.b,
    state.direct.r,
  )
  return {
    exactFractionText: formatExactRational(analysis.exact),
    exactDecimalText: formatExactDecimal(analysis.exact),
    approxValueText: formatPlainNumber(analysis.approxValue),
    reencodedY: analysis.reencodedY,
    safeReentryText,
  }
}

/**
 * v2.5.11: a precision-folded decode must be marked before any re-entry —
 * the displayed value is an approximation and directly re-entering it
 * encodes a different payload (a different request, not a same-value
 * no-op). The field-level m/b/R errors stay in state.direct.errors and are
 * rendered inline next to the corresponding input, never here.
 */
export function resolveDirectFoldWarning(state: AppState): WarningVM | null {
  if (state.mode !== 'DIRECT' || state.direct.m === 0) return null
  const fidelity = resolveDirectFidelity(state)
  if (!fidelity) return null
  const exactText = fidelity.exactDecimalText ?? fidelity.exactFractionText
  return {
    id: 'direct-precision-fold',
    level: 'warning',
    text: `当前 raw 的精确物理值是 ${exactText}，超出 binary64 物理值的表示精度；显示值 ${fidelity.approxValueText} 是近似值，直接回输会按仓库舍入合同编码为 Y=${fidelity.reencodedY}——这是一个不同的请求，raw 会随之改变。「物理值」复制提供经精确编码验证、可安全回录的文本；直接编辑 raw 或 Y 始终是保留位级真值的权威路径。`,
  }
}
