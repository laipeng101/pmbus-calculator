/**
 * Calculation steps — supplemental derivation/diagnostics only.
 *
 * The first screen (result workspace) now carries the live fields and ONE
 * complete canonical equation (symbolic relation -> substituted values ->
 * final result). This module therefore returns ONLY what the first screen
 * cannot show: saturation, exact rational/decimal expansions,
 * requested-vs-represented deltas, quantization error, nominal-reference
 * provenance, overflow/underflow and fail-closed domain warnings. An ordinary
 * decode with nothing extra returns an empty list, and the UI then omits the
 * whole container.
 *
 * Components must never recompute these values in JSX; they only render the
 * steps produced here.
 */
import type { AppState } from './state'
import { PMBusMath } from '../legacy/pmbus-math'
import { deriveL16Semantics } from './l16-derivation'
import { computeQuantizationOutcome } from './quantization-error'
import type { QuantizationOutcome } from './quantization-error'
import { formatPlainNumber } from './numeric-presentation'
import { RELATIVE_VOLTAGE_RANGE_NOTE } from './relative-voltage'
import {
  analyzeDirectTextReentry,
  formatExactDecimal,
  formatExactDelta,
  formatExactPercent,
  formatExactRational,
} from './direct-exact'

/** Step text mirrors the shared readout panel wording. */
function quantizationStepValue(outcome: QuantizationOutcome): string {
  // v2.5.12: DIRECT renders the exact rational verdict — a binary64-folded
  // delta must not present a textual zero in the steps either.
  if (outcome.directExact) {
    const exact = outcome.directExact
    switch (outcome.status) {
      case 'exact':
        return '0（精确编码）'
      case 'quantized':
        return `${formatExactDelta(exact.absoluteError)}（约 ${formatExactPercent(exact.relativePercent)}）`
      case 'saturated':
        return `${formatExactDelta(exact.absoluteError)}（已饱和到边界值）`
      default:
        break
    }
  }
  switch (outcome.status) {
    case 'exact':
      return '0（精确编码）'
    case 'quantized':
      return formatPlainNumber(outcome.absoluteError ?? 0)
    case 'saturated':
      return `${formatPlainNumber(outcome.absoluteError ?? 0)}（已饱和到边界值）`
    case 'overflow':
      // overflow means the represented endpoint is ±Infinity (HALF); the
      // canonical policy renders the same signed text the old ternary built.
      return `（有限值编码溢出为 ${formatPlainNumber(outcome.represented)}）`
    case 'special':
      return '（特殊值，量化误差不适用）'
  }
}

export interface CalculationStepVM {
  id: string
  label: string
  plainText: string
  latex?: string
  value?: string
  kind: 'field' | 'formula' | 'intermediate' | 'result' | 'warning'
}

function intermediate(id: string, label: string, value: string): CalculationStepVM {
  return { id, label, plainText: `${label} = ${value}`, value, kind: 'intermediate' }
}

function warningStep(id: string, text: string): CalculationStepVM {
  return { id, label: '提示', plainText: text, kind: 'warning' }
}

/**
 * L11 has no supplemental decode derivation: the first screen already renders
 * the complete equation. Only a saturation warning (when a committed request
 * exists) survives here.
 */
function buildL11Steps(state: AppState): CalculationStepVM[] {
  const steps: CalculationStepVM[] = []
  if (state.l11.valueInput != null && Number.isFinite(state.l11.valueInput)) {
    // auto-N 用全格式全局范围（N=15 极值）判断饱和；锁定 N 用该 N 的
    // Y=-1024..1023 范围判断（Y=1023/-1024 本身是合法边界编码）。
    const { min, max } = state.l11.autoN
      ? { min: PMBusMath.minLinear11(), max: PMBusMath.maxLinear11() }
      : PMBusMath.linear11RangeForN(state.l11.n)
    if (state.l11.valueInput > max || state.l11.valueInput < min) {
      steps.push(
        warningStep(
          'l11-saturation',
          `输入值超出 LINEAR11 可表示范围（${formatPlainNumber(min)} ~ ${formatPlainNumber(max)}），编码器已饱和到极值`,
        ),
      )
    }
  }
  return steps
}

/**
 * L16 keeps only fail-closed / reference diagnostics: a non-LINEAR shared byte,
 * a missing VOUT_COMMAND nominal, or a relative range failure. Ordinary
 * absolute/signed-offset decodes and finite relative decodes return nothing.
 */
function buildL16Steps(state: AppState): CalculationStepVM[] {
  const facts = deriveL16Semantics(state)

  // Fail closed on a non-LINEAR shared byte (v2.5.2, Part II §8.4): the page
  // shows the actual byte and refuses to derive N / results / quantization
  // from an implicit 0x18 substitution.
  if (facts.interpretation.kind === 'non-linear') {
    return [
      warningStep(
        'l16-nonlinear',
        `输出电压命令按 VOUT_MODE 指定的格式解释。当前为 ${facts.analysis.formatName}（PMBus Part II §8.4）。`,
      ),
    ]
  }

  if (facts.interpretation.kind === 'relative-ratio') {
    const { nominal, finalVoltage } = facts.interpretation
    if (nominal == null) {
      return [
        warningStep(
          'l16-relative-nominal-missing',
          '已解出比值 R。请填写 VOUT_COMMAND 标称参考值 V_NOM，再计算电压 X = V_NOM × R。',
        ),
      ]
    }
    if (finalVoltage.kind === 'overflow' || finalVoltage.kind === 'underflow') {
      const note = RELATIVE_VOLTAGE_RANGE_NOTE[finalVoltage.kind]
      return [
        warningStep(
          'l16-relative-range',
          `用标称电压 ${formatPlainNumber(nominal)} V 乘以比值 R。${note}。`,
        ),
      ]
    }
  }

  return []
}

/**
 * DIRECT keeps only the exact-value transaction (rational, terminating or
 * repeating decimal) and the committed request's requested / represented /
 * delta steps. The mechanical 10^-R, Y×10^-R, …−b and 1/m lines are gone —
 * the first-screen equation already shows every one of them.
 */
function buildDirectSteps(
  state: AppState,
  outcome: QuantizationOutcome | null,
): CalculationStepVM[] {
  const y = PMBusMath.toSigned(state.raw, 16)
  const { m, b, r } = state.direct
  if (m === 0) {
    return [warningStep('direct-m-zero', 'm=0：DIRECT 系数 m 不能为 0，无法解码')]
  }

  const steps: CalculationStepVM[] = []
  // v2.5.11, unified v3.1.1: when the DISPLAYED text cannot be re-entered
  // safely (the real typed path encodes it to a different Y), the steps must
  // expose the exact value (fraction and, when it terminates, the exact
  // decimal) so the approximate display can never pass as the whole truth.
  // Same analysis the fidelity/copy/warning surfaces consume — never a
  // locally re-derived verdict.
  const analysis = analyzeDirectTextReentry(y, m, b, r)
  if (analysis && !analysis.displayRoundTripSafe) {
    steps.push(
      intermediate('direct-exact-value', '精确值（有理数）', formatExactRational(analysis.exact)),
    )
    const exactDecimal = formatExactDecimal(analysis.exact)
    steps.push(
      exactDecimal !== null
        ? intermediate('direct-exact-decimal', '精确十进制', exactDecimal)
        : intermediate('direct-exact-decimal', '精确十进制', '（循环小数，无有限精确十进制）'),
    )
  }
  // v2.5.12: the committed request's exact transaction — the same lexeme the
  // reducer encoded, the exact decode of the current raw, and the exact
  // delta — so the steps, the readout panel and raw share one truth.
  const exact = outcome?.directExact
  if (exact) {
    const requestExact = formatExactRational(exact.requested)
    steps.push(
      intermediate(
        'direct-request',
        '用户请求（精确）',
        requestExact === exact.requestedText
          ? exact.requestedText
          : `${exact.requestedText} = ${requestExact}`,
      ),
    )
    steps.push(
      intermediate(
        'direct-exact-represented',
        'raw 精确解码值',
        formatExactDecimal(exact.represented) ?? formatExactRational(exact.represented),
      ),
    )
    steps.push(
      intermediate(
        'direct-exact-delta',
        '精确误差（请求 − 表示）',
        formatExactDelta(exact.absoluteError),
      ),
    )
  }
  return steps
}

/**
 * HALF keeps only the subnormal scale factors and the special-encoding
 * explanations. Zero and normal values have nothing beyond the first-screen
 * equation, so they return an empty list.
 */
function buildHalfSteps(state: AppState): CalculationStepVM[] {
  const raw = state.raw & 0xffff
  const sign = (raw >> 15) & 1
  const exponent = (raw >> 10) & 0x1f
  const fraction = raw & 0x3ff

  if (exponent === 0 && fraction === 0) {
    return []
  }
  if (exponent === 0) {
    // Subnormal: the first screen shows the symbolic relation; expose the two
    // numeric scale factors that make the tiny value interpretable.
    const p = PMBusMath.pow2(-14)
    const fTerm = fraction / 1024
    return [
      intermediate('half-2e', '2^-14', formatPlainNumber(p)),
      intermediate('half-fraction', 'F/1024', formatPlainNumber(fTerm)),
    ]
  }
  if (exponent === 0x1f && fraction === 0) {
    return [
      warningStep(
        'half-infinity',
        `E=31、F=0 是 IEEE 754 binary16 的无穷编码，符号位为 ${sign}（${sign ? '−' : '+'}∞）。`,
      ),
    ]
  }
  if (exponent === 0x1f) {
    return [
      warningStep(
        'half-nan',
        `E=31、F=${fraction}≠0 是 IEEE 754 binary16 的 NaN 编码，不是可计算的数值。`,
      ),
    ]
  }
  return []
}

/**
 * Append the format-encoding quantization intermediate for every mode whose
 * physical value came from an explicit encoding request (L11 included — same
 * provenance contract as the shared readout panel).
 */
function appendQuantizationStep(
  state: AppState,
  steps: CalculationStepVM[],
  outcome: QuantizationOutcome | null,
): void {
  if (outcome) {
    steps.push(
      intermediate(
        `${state.mode.toLowerCase()}-quantization`,
        '格式编码量化误差（请求值 − 表示值）',
        quantizationStepValue(outcome),
      ),
    )
  }
}

export function buildCalculationSteps(state: AppState): CalculationStepVM[] {
  // Resolved once per build so the per-mode builders and the appended
  // quantization step answer the same provenance question.
  const outcome = computeQuantizationOutcome(state)
  const steps = (() => {
    switch (state.mode) {
      case 'L11':
        return buildL11Steps(state)
      case 'L16':
        return buildL16Steps(state)
      case 'DIRECT':
        return buildDirectSteps(state, outcome)
      case 'HALF':
        return buildHalfSteps(state)
      case 'VOUT_MODE':
      default:
        return []
    }
  })()
  appendQuantizationStep(state, steps, outcome)
  return steps
}
