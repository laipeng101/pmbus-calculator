import { PMBusMath } from '../../legacy/pmbus-math'
import {
  analyzeDirectTextReentry,
  formatExactDecimal,
  formatExactRational,
  generateSafeDirectReentryText,
} from '../direct-exact'
import type { AppState } from '../state'
import type { DirectFidelityVM, WarningVM } from './types'

/**
 * Kind-aware quantization-readout note for a DIRECT state whose displayed
 * text cannot be re-entered safely (v3.1.1): the note names where re-entry
 * breaks (binary64 representation vs display formatting) and labels the
 * copy override honestly — a verified approximation of a repeating rational
 * must never be presented as the exact value.
 */
export function directFoldQuantizationNote(fidelity: DirectFidelityVM): string {
  const loss =
    fidelity.lossKind === 'binary64-representation' ? 'binary64 精度折叠' : '显示格式化截断'
  const copy =
    fidelity.safeReentryText === null
      ? '「物理值」复制已禁用'
      : fidelity.safeReentryKind === 'exact'
        ? '「物理值」复制使用经验证的精确回录文本'
        : '「物理值」复制使用经验证可回录的近似文本'
  return `当前 raw 的显示值为近似（${loss}），直接回输会编码为不同的 raw；${copy}`
}

export function resolveDirectValueText(state: AppState): string {
  if (state.mode !== 'DIRECT' || state.direct.m === 0) return '—'
  const y = PMBusMath.toSigned(state.raw, 16)
  const analysis = analyzeDirectTextReentry(y, state.direct.m, state.direct.b, state.direct.r)
  // Unreachable for legal coefficients (the display text of a finite decode
  // always parses); the null branch keeps the historical '—' fail-closed.
  return analysis === null ? '—' : analysis.displayText
}

/**
 * DIRECT text-re-entry fidelity resolution (v2.5.11, unified v3.1.1): null
 * for every state that is not "DIRECT with m ≠ 0 whose DISPLAYED text
 * re-encodes to a different Y through the real typed path". Single source
 * for the warning, the quantization note, the exact-value steps and the
 * copy override — every surface answers the same question from this
 * resolution, derived from the live raw word and coefficients so it can
 * never go stale. The displayed text itself is the contract subject: it is
 * what the user sees, copies and re-enters, and the reducer encodes text
 * (not Numbers) through the exact path.
 */
export function resolveDirectFidelity(state: AppState): DirectFidelityVM | null {
  if (state.mode !== 'DIRECT' || state.direct.m === 0) return null
  const y = PMBusMath.toSigned(state.raw, 16)
  const analysis = analyzeDirectTextReentry(y, state.direct.m, state.direct.b, state.direct.r)
  if (!analysis || analysis.displayRoundTripSafe) return null
  const safe = generateSafeDirectReentryText(
    analysis.exact,
    y,
    state.direct.m,
    state.direct.b,
    state.direct.r,
  )
  return {
    exactFractionText: formatExactRational(analysis.exact),
    exactDecimalText: formatExactDecimal(analysis.exact),
    approxValueText: analysis.displayText,
    displayReencodedY: analysis.displayReencodedY,
    lossKind: analysis.b64RoundTripSafe ? 'display-formatting' : 'binary64-representation',
    safeReentryText: safe === null ? null : safe.text,
    ...(safe !== null ? { safeReentryKind: safe.kind } : {}),
  }
}

/**
 * v2.5.11, unified v3.1.1: a display text that cannot be re-entered safely
 * must be marked before any re-entry — the text is an approximation whose
 * typed re-entry encodes a different payload (a different request, not a
 * same-value no-op). The message names the exact value, the real re-entry
 * consequence and where the loss sits (binary64 representation vs display
 * formatting); the 物理值 copy promise is kind-aware and degrades honestly
 * when no verified text exists. The field-level m/b/R errors stay in
 * state.direct.errors and are rendered inline next to the corresponding
 * input, never here.
 */
export function resolveDirectFoldWarning(state: AppState): WarningVM | null {
  if (state.mode !== 'DIRECT' || state.direct.m === 0) return null
  const fidelity = resolveDirectFidelity(state)
  if (!fidelity) return null
  const exactText = fidelity.exactDecimalText ?? fidelity.exactFractionText
  const lossClause =
    fidelity.lossKind === 'binary64-representation'
      ? '超出 binary64 物理值的表示精度'
      : '显示格式化截断（显示位数不足以唯一回到当前 raw）'
  const reentryClause =
    fidelity.displayReencodedY === null
      ? '直接回输不会回到当前 raw'
      : `直接回输会编码为 Y=${fidelity.displayReencodedY}`
  const copyClause =
    fidelity.safeReentryText === null
      ? '当前无法生成经验证可回录的文本，「物理值」复制已禁用，请使用 Raw Word / Wire 字节复制'
      : fidelity.safeReentryKind === 'exact'
        ? '「物理值」复制提供经验证可安全回录的精确文本'
        : '「物理值」复制提供经验证可回录的近似文本（当前 raw 的精确值是循环小数）'
  return {
    id: 'direct-precision-fold',
    level: 'warning',
    text: `当前 raw 的精确物理值是 ${exactText}，${lossClause}；显示值 ${fidelity.approxValueText} 是近似值，${reentryClause}——这是一个不同的请求，raw 会随之改变。${copyClause}；直接编辑 raw 或 Y 始终是保留位级真值的权威路径。`,
  }
}

/**
 * v3.1.1: with m=0 there is no decode contract at all — the physical value
 * is '—', so the 物理值 copy must be disabled with an accessible reason
 * instead of copying a placeholder that cannot re-enter.
 */
export function resolveDirectPhysicalValueCopy(
  state: AppState,
): { available: false; reason: string } | undefined {
  if (state.mode !== 'DIRECT' || state.direct.m !== 0) return undefined
  return {
    available: false,
    reason:
      '物理值复制不可用：DIRECT 系数 m=0 无法解码物理值，没有可复制的物理值文本。请使用 Raw Word / Wire 字节复制，或修正系数 m。',
  }
}
