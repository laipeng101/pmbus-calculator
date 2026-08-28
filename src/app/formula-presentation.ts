import type { AppState } from './state'
import { PMBusMath } from '../legacy/pmbus-math'
import { analyzeVoutMode } from '../legacy/vout-mode'
import { effectiveL16VoutMode } from './vout-mode-selector'
import {
  resolveRelativeVoltage,
  RELATIVE_VOLTAGE_OVERFLOW_NOTE,
  RELATIVE_VOLTAGE_UNDERFLOW_NOTE,
} from './relative-voltage'

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

function formatNumber(value: number): string {
  if (Number.isNaN(value)) return 'NaN'
  if (Number.isFinite(value) === false) return value > 0 ? '+Infinity' : '-Infinity'
  if (Object.is(value, -0)) return '-0'
  if (Number.isInteger(value)) return value.toString()
  return parseFloat(value.toPrecision(12)).toString()
}

function formatLatexNumber(value: number): string {
  if (Number.isNaN(value)) return '\\text{NaN}'
  if (Number.isFinite(value) === false) return value > 0 ? '+\\infty' : '-\\infty'
  if (Object.is(value, -0)) return '-0'
  return formatNumber(value)
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
    const valueText = formatNumber(value)
    return {
      plainText: `HALF subnormal ${signPower}×2^-14×${fraction}/1024=${valueText}`,
      latex: `X = ${signPower} \\times 2^{-14} \\times \\frac{${fraction}}{2^{10}} = ${formatLatexNumber(value)}`,
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
  const valueText = formatNumber(value)
  return {
    plainText: `HALF normal ${signPower}×2^(${exponent}-15)×(1+${fraction}/1024)=${valueText}`,
    latex: `X = ${signPower} \\times 2^{${exponent}-15} \\times \\left(1 + \\frac{${fraction}}{2^{10}}\\right) = ${formatLatexNumber(value)}`,
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
      const eff = effectiveL16VoutMode(state)
      // Fail closed on a non-LINEAR shared byte (v2.5.2, §8.4): no pseudo N,
      // no pseudo physical expansion line.
      if (eff.source === 'non-linear') {
        const sharedHex = '0x' + state.voutMode.byte.toString(16).toUpperCase().padStart(2, '0')
        const plainText = `共享 VOUT_MODE ${sharedHex} 非 LINEAR；输出电压命令的数据格式由 VOUT_MODE 决定（§8.4），未计算。`
        return {
          plainText,
          latex: '\\text{共享 VOUT_MODE 非 LINEAR，未计算（§8.4）}',
          genericLatex: '\\text{需要 LINEAR VOUT_MODE}',
          detailLines: [],
        }
      }
      const a = analyzeVoutMode(eff.byte)
      const n = a.linearExponent ?? 0

      // SLINEAR16 offset is a command-payload semantic (VOUT_TRIM /
      // VOUT_CAL_OFFSET); bit7 of VOUT_MODE is NOT part of its math and must
      // not switch the signed offset formula into a "signed ratio".
      if (state.l16.payloadKind === 'slinear16-offset') {
        const y = PMBusMath.toSigned(state.raw, 16)
        const value = PMBusMath.decodeSlinear16(state.raw, n).value
        const plainText = `Y_s=${y} × 2^${n} = ${formatNumber(value)} V`
        const latex = `X_{offset} = Y_s \\times 2^N = ${y} \\times 2^{${n}} = ${formatLatexNumber(value)}`
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

      // ULINEAR16 Relative: ratio R = Y_u × 2^N; final X = V_NOM × R when the
      // nominal reference is available, otherwise the ratio is still shown.
      if (a.isRelative) {
        const ratio = PMBusMath.decodeUlinear16(state.raw, n).value
        const ratioText = formatNumber(ratio)
        const percentText = formatNumber(ratio * 100)
        if (state.l16.nominalVout == null) {
          const plainText = `R=${state.raw} × 2^${n}=${ratioText}（需要 VOUT_COMMAND nominal）`
          const latex = `R = Y_u \\times 2^N = ${state.raw} \\times 2^{${n}} = ${formatLatexNumber(ratio)}\\ \\left(\\text{需要 } V_{NOM}\\right)`
          return {
            plainText,
            latex,
            genericLatex: 'R = Y_u \\times 2^N',
            detailLines: singleExpansionLine(plainText, latex),
          }
        }
        // v2.5.9: the derivation is classified by the shared relative-voltage
        // source — overflow / underflow keep the nominal and ratio visible
        // but never fabricate a final Infinity / zero voltage (the copy
        // contract and the result card consume the same classification).
        const result = resolveRelativeVoltage(state.l16.nominalVout, ratio)
        if (result.kind === 'overflow' || result.kind === 'underflow') {
          const note =
            result.kind === 'overflow'
              ? RELATIVE_VOLTAGE_OVERFLOW_NOTE
              : RELATIVE_VOLTAGE_UNDERFLOW_NOTE
          const plainText = `R=${state.raw} × 2^${n}=${ratioText}（${percentText}%）; X=${formatNumber(state.l16.nominalVout)}×R=—（${note}）`
          const latex = `R = Y_u \\times 2^N = ${state.raw} \\times 2^{${n}} = ${formatLatexNumber(ratio)}\\ (${formatLatexNumber(ratio * 100)}\\%) \\quad X = V_{NOM} \\times R = ${formatLatexNumber(state.l16.nominalVout)} \\times ${formatLatexNumber(ratio)} = \\text{—}`
          return {
            plainText,
            latex,
            genericLatex: 'R = Y_u \\times 2^N;\\ X = V_{NOM} \\times R',
            detailLines: singleExpansionLine(plainText, latex),
          }
        }
        const final = result.kind === 'finite' ? result.value : NaN
        const plainText = `R=${state.raw} × 2^${n}=${ratioText}（${percentText}%）; X=${formatNumber(state.l16.nominalVout)}×R=${formatNumber(final)} V`
        const latex = `R = Y_u \\times 2^N = ${state.raw} \\times 2^{${n}} = ${formatLatexNumber(ratio)}\\ (${formatLatexNumber(ratio * 100)}\\%) \\quad X = V_{NOM} \\times R = ${formatLatexNumber(state.l16.nominalVout)} \\times ${formatLatexNumber(ratio)} = ${formatLatexNumber(final)}`
        return {
          plainText,
          latex,
          genericLatex: 'R = Y_u \\times 2^N;\\ X = V_{NOM} \\times R',
          detailLines: singleExpansionLine(plainText, latex),
        }
      }

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
