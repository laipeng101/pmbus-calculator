import { PMBusMath } from '../../legacy/pmbus-math'
import {
  analyzeDirectTextReentry,
  formatExactDecimal,
  formatExactRational,
  generateSafeDirectReentryText,
} from '../direct-exact'
import type { AppState } from '../state'
import type { CalculatorViewModel, DirectFidelityVM, WarningVM } from './types'

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

export function resolveDirectFoldWarning(fidelity: DirectFidelityVM): WarningVM {
  const loss = fidelity.lossKind === 'binary64-representation' ? '浮点精度有限' : '显示位数有限'
  const reentry =
    fidelity.displayReencodedY === null
      ? '重新输入显示值无法得到当前的 Raw Word。'
      : `重新输入显示值会得到 Y = ${fidelity.displayReencodedY}，改变当前的 Raw Word。`
  return {
    id: 'direct-precision-fold',
    level: 'warning',
    text: `由于${loss}，当前显示为近似值。${reentry}精确值见「计算过程」。`,
  }
}

export function resolveDirectPhysicalValueCopy(
  state: AppState,
  fidelity: DirectFidelityVM | null,
): Pick<CalculatorViewModel, 'physicalValueCopy' | 'physicalValueCopyOverride'> {
  if (state.mode !== 'DIRECT') return {}
  if (state.direct.m === 0) {
    return {
      physicalValueCopy: {
        available: false,
        reason: 'm=0 时无法计算物理值。请修正系数 m，或复制 Raw Word。',
      },
    }
  }
  if (fidelity === null) return {}

  const { safeReentryText, safeReentryKind } = fidelity
  if (safeReentryText === null || !safeReentryKind) {
    return {
      physicalValueCopy: {
        available: false,
        reason: '当前没有可重新输入并保留编码的物理值。请复制 Raw Word。',
      },
    }
  }
  return {
    physicalValueCopyOverride: {
      text: safeReentryText,
      kind: safeReentryKind,
      note:
        safeReentryKind === 'exact'
          ? '「物理值」复制精确值。'
          : '结果是循环小数。「物理值」复制可还原 Raw Word 的近似值。',
    },
  }
}
