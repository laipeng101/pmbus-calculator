import type { AppState } from './state'
import { PMBusMath } from '../legacy/pmbus-math'
import { deriveL16Semantics } from './l16-derivation'
import { formatPlainNumber, formatPlainNumberLatex } from './numeric-presentation'
import { RELATIVE_VOLTAGE_OVERFLOW_NOTE, RELATIVE_VOLTAGE_UNDERFLOW_NOTE } from './relative-voltage'

export interface FormulaPresentation {
  /** Plain-text formula used for copy output and C macro comments. */
  plainText: string
  /** KaTeX source used for on-screen dynamic formula. */
  latex: string
  /** KaTeX source for the generic symbol relation shown in the workspace. */
  genericLatex: string
  /**
   * Structured on-screen formula lines. The headline value is displayed
   * separately, so HALF expansion lines intentionally do not repeat the final
   * decimal value. `plainText`/`latex` above remain the copy/C-macro contract.
   */
  detailLines: FormulaDetailLine[]
}

export interface FormulaDetailLine {
  kind: 'summary' | 'expansion'
  plainText: string
  latex: string
}

function formatSignedInt(value: number): string {
  return value < 0 ? `(${value})` : String(value)
}

/** Plain-text exponent for DIRECT: keep the legacy copy/C-macro contract. */
function formatNegatedDirectExponent(r: number): string {
  const exponent = -r
  return exponent < 0 ? `(${exponent})` : String(exponent)
}

/** LaTeX exponent for DIRECT: negative exponents render as 10^{-12}, not 10^{(-12)}. */
function formatDirectExponentLatex(r: number): string {
  return String(-r)
}

function formatDirectTerm(value: number): string {
  return value < 0 ? `(${value})` : String(value)
}

interface HalfPresentation {
  plainText: string
  latex: string
  detailLines: FormulaDetailLine[]
}

function halfSummaryLine(sign: number, exponent: number, fraction: number): FormulaDetailLine {
  const plainText = `s = ${sign}, E = ${exponent}, F = ${fraction}`
  return {
    kind: 'summary',
    plainText,
    latex: `s = ${sign},\\ E = ${exponent},\\ F = ${fraction}`,
  }
}

function getHalfPresentation(raw: number): HalfPresentation {
  const sign = (raw >> 15) & 1
  const exponent = (raw >> 10) & 0x1f
  const fraction = raw & 0x3ff
  const signText = sign ? '-' : '+'
  const signPower = `(-1)^{${sign}}`

  if (exponent === 0 && fraction === 0) {
    return {
      plainText: `HALF zero ${signPower}×0=${signText}0`,
      latex: `X = ${signPower} \\times 0 = ${signText}0`,
      detailLines: [
        halfSummaryLine(sign, exponent, fraction),
        {
          kind: 'expansion',
          plainText: `X = ${signPower} × 0 = ${signText}0`,
          latex: `X = ${signPower} \\times 0 = ${signText}0`,
        },
      ],
    }
  }

  if (exponent === 0) {
    const value = PMBusMath.decodeHalf(raw).value
    const valueText = formatPlainNumber(value)
    return {
      plainText: `HALF subnormal ${signPower}×2^-14×${fraction}/1024=${valueText}`,
      latex: `X = ${signPower} \\times 2^{-14} \\times \\frac{${fraction}}{2^{10}} = ${formatPlainNumberLatex(value)}`,
      detailLines: [
        halfSummaryLine(sign, exponent, fraction),
        {
          kind: 'expansion',
          plainText: `X = ${signPower} × 2^-14 × ${fraction}/1024`,
          latex: `X = ${signPower} \\times 2^{-14} \\times \\frac{${fraction}}{2^{10}}`,
        },
      ],
    }
  }

  if (exponent === 0x1f) {
    if (fraction === 0) {
      return {
        plainText: `HALF ${signText}Infinity (E=31,F=0)`,
        latex: `X = ${signPower} \\times \\infty = ${sign ? '-' : '+'}\\infty \\quad (E=31,\\ F=0)`,
        detailLines: [
          halfSummaryLine(sign, exponent, fraction),
          {
            kind: 'expansion',
            plainText: `X = ${signPower} × ∞ = ${sign ? '-' : '+'}∞`,
            latex: `X = ${signPower} \\times \\infty = ${sign ? '-' : '+'}\\infty`,
          },
        ],
      }
    }
    return {
      plainText: `HALF NaN (E=31,F=${fraction})`,
      latex: `X = \\text{NaN} \\quad (E=31,\\ F=${fraction})`,
      detailLines: [
        {
          kind: 'summary',
          plainText: `E = 31, F = ${fraction}`,
          latex: `E = 31,\\ F = ${fraction}`,
        },
        {
          kind: 'expansion',
          plainText: 'X = NaN',
          latex: 'X = \\text{NaN}',
        },
      ],
    }
  }

  const value = PMBusMath.decodeHalf(raw).value
  const valueText = formatPlainNumber(value)
  return {
    plainText: `HALF normal ${signPower}×2^(${exponent}-15)×(1+${fraction}/1024)=${valueText}`,
    latex: `X = ${signPower} \\times 2^{${exponent}-15} \\times \\left(1 + \\frac{${fraction}}{2^{10}}\\right) = ${formatPlainNumberLatex(value)}`,
    detailLines: [
      halfSummaryLine(sign, exponent, fraction),
      {
        kind: 'expansion',
        plainText: `X = ${signPower} × 2^(${exponent}-15) × (1 + ${fraction}/1024)`,
        latex: `X = ${signPower} \\times 2^{${exponent}-15} \\times \\left(1 + \\frac{${fraction}}{2^{10}}\\right)`,
      },
    ],
  }
}

function singleExpansionLine(plainText: string, latex: string): FormulaDetailLine[] {
  return [{ kind: 'expansion', plainText, latex }]
}

/**
 * Single source of truth for on-screen formulas.
 *
 * `plainText` is the readable copy/C-macro comment.  `latex` is typeset only
 * in the UI by KaTeX.  PMBus calculations are never performed here; only
 * existing decoders are called for display classification.
 */
export function getFormulaPresentation(state: AppState): FormulaPresentation {
  switch (state.mode) {
    case 'L11': {
      const decoded = PMBusMath.decodeLinear11(state.raw)
      const plainText = `Y=${decoded.y} × 2^${decoded.n}`
      const latex = `X = Y \\times 2^N = ${decoded.y} \\times 2^{${decoded.n}}`
      return {
        plainText,
        latex,
        genericLatex: 'X = Y \\times 2^N',
        detailLines: singleExpansionLine(plainText, latex),
      }
    }

    case 'L16': {
      // The interpretation facts (payload × shared byte, relative ratio,
      // nominal, overflow/underflow) come from the canonical derivation —
      // this surface only renders them (ADR 0006).
      const facts = deriveL16Semantics(state)
      // Fail closed on a non-LINEAR shared byte (v2.5.2, §8.4): no pseudo N,
      // no pseudo physical expansion line.
      if (facts.interpretation.kind === 'non-linear') {
        const sharedHex = '0x' + facts.analysis.byte.toString(16).toUpperCase().padStart(2, '0')
        const plainText = `共享 VOUT_MODE ${sharedHex} 非 LINEAR；输出电压命令的数据格式由 VOUT_MODE 决定（§8.4），未计算。`
        return {
          plainText,
          latex: '\\text{共享 VOUT_MODE 非 LINEAR，未计算（§8.4）}',
          genericLatex: '\\text{需要 LINEAR VOUT_MODE}',
          detailLines: [],
        }
      }
      if (facts.interpretation.kind === 'signed-offset') {
        const { n, y, value } = facts.interpretation
        const plainText = `Y_s=${y} × 2^${n} = ${formatPlainNumber(value)} V`
        const latex = `X_{offset} = Y_s \\times 2^N = ${y} \\times 2^{${n}} = ${formatPlainNumberLatex(value)}`
        return {
          plainText,
          latex,
          genericLatex: 'X_{offset} = Y_s \\times 2^N',
          detailLines: singleExpansionLine(
            `Y_s=${y} × 2^${n}（bit7 N/A for signed offset payload）`,
            `Y_s = ${y} \\times 2^{${n}} \\quad (\\text{bit7 N/A for signed offset payload})`,
          ),
        }
      }

      if (facts.interpretation.kind === 'relative-ratio') {
        // Ratio R = Y_u × 2^N; final X = V_NOM × R when the nominal reference
        // is available, otherwise the ratio is still shown. Overflow /
        // underflow keep the nominal and ratio visible but never fabricate a
        // final Infinity / zero voltage (v2.5.9; the result card, steps and
        // copy contract consume the same classification).
        const { n, ratio, nominal, finalVoltage } = facts.interpretation
        const ratioText = formatPlainNumber(ratio)
        const percentText = formatPlainNumber(ratio * 100)
        if (nominal == null) {
          const plainText = `R=${state.raw} × 2^${n}=${ratioText}（需要 VOUT_COMMAND nominal）`
          const latex = `R = Y_u \\times 2^N = ${state.raw} \\times 2^{${n}} = ${formatPlainNumberLatex(ratio)}\\ \\left(\\text{需要 } V_{NOM}\\right)`
          return {
            plainText,
            latex,
            genericLatex: 'R = Y_u \\times 2^N',
            detailLines: singleExpansionLine(plainText, latex),
          }
        }
        if (finalVoltage.kind === 'overflow' || finalVoltage.kind === 'underflow') {
          const note =
            finalVoltage.kind === 'overflow'
              ? RELATIVE_VOLTAGE_OVERFLOW_NOTE
              : RELATIVE_VOLTAGE_UNDERFLOW_NOTE
          const plainText = `R=${state.raw} × 2^${n}=${ratioText}（${percentText}%）; X=${formatPlainNumber(nominal)}×R=—（${note}）`
          const latex = `R = Y_u \\times 2^N = ${state.raw} \\times 2^{${n}} = ${formatPlainNumberLatex(ratio)}\\ (${formatPlainNumberLatex(ratio * 100)}\\%) \\quad X = V_{NOM} \\times R = ${formatPlainNumberLatex(nominal)} \\times ${formatPlainNumberLatex(ratio)} = \\text{—}`
          return {
            plainText,
            latex,
            genericLatex: 'R = Y_u \\times 2^N;\\ X = V_{NOM} \\times R',
            detailLines: singleExpansionLine(plainText, latex),
          }
        }
        const final = finalVoltage.kind === 'finite' ? finalVoltage.value : NaN
        const plainText = `R=${state.raw} × 2^${n}=${ratioText}（${percentText}%）; X=${formatPlainNumber(nominal)}×R=${formatPlainNumber(final)} V`
        const latex = `R = Y_u \\times 2^N = ${state.raw} \\times 2^{${n}} = ${formatPlainNumberLatex(ratio)}\\ (${formatPlainNumberLatex(ratio * 100)}\\%) \\quad X = V_{NOM} \\times R = ${formatPlainNumberLatex(nominal)} \\times ${formatPlainNumberLatex(ratio)} = ${formatPlainNumberLatex(final)}`
        return {
          plainText,
          latex,
          genericLatex: 'R = Y_u \\times 2^N;\\ X = V_{NOM} \\times R',
          detailLines: singleExpansionLine(plainText, latex),
        }
      }

      const { n } = facts.interpretation
      const plainText = `V=${state.raw} × 2^${n}`
      const latex = `X = V \\times 2^N = ${state.raw} \\times 2^{${n}}`
      return {
        plainText,
        latex,
        genericLatex: 'X = V \\times 2^N',
        detailLines: singleExpansionLine(plainText, latex),
      }
    }

    case 'DIRECT': {
      const y = PMBusMath.toSigned(state.raw, 16)
      const { m, b, r } = state.direct

      if (m === 0) {
        const plainText = 'X=(1/m)×(Y×10^(-R)-b)'
        const latex = 'X = \\frac{1}{m}\\left(Y \\times 10^{-R} - b\\right)'
        return {
          plainText,
          latex,
          genericLatex: 'X = \\frac{1}{m}\\left(Y \\times 10^{-R} - b\\right)',
          detailLines: singleExpansionLine(plainText, latex),
        }
      }

      const yTerm = formatDirectTerm(y)
      const bTerm = formatDirectTerm(b)
      const exponentText = formatNegatedDirectExponent(r)
      const exponentLatex = formatDirectExponentLatex(r)
      const plainText = `X=(1/${formatSignedInt(m)})×(${yTerm}×10^${exponentText}-${bTerm})`
      const latex = `X = \\frac{1}{${formatSignedInt(m)}}\\left(${yTerm} \\times 10^{${exponentLatex}} - ${bTerm}\\right)`

      return {
        plainText,
        latex,
        genericLatex: 'X = \\frac{1}{m}\\left(Y \\times 10^{-R} - b\\right)',
        detailLines: singleExpansionLine(plainText, latex),
      }
    }

    case 'HALF': {
      return {
        ...getHalfPresentation(state.raw),
        genericLatex: 'X = \\text{IEEE 754 binary16 分段解码}',
      }
    }

    case 'VOUT_MODE': {
      // A VOUT_MODE byte is structured configuration state, not a math
      // equation: it must never be typeset with KaTeX/serif. The result panel
      // renders it through VoutModeConfigSummary (UI/data font roles); the
      // plainText contract below only serves copy tooling.
      const hex = state.voutMode.byte.toString(16).toUpperCase().padStart(2, '0')
      return {
        plainText: 'VOUT_MODE 0x' + hex,
        latex: '',
        genericLatex: '',
        detailLines: [],
      }
    }

    default:
      return { plainText: '', latex: '', genericLatex: '', detailLines: [] }
  }
}
