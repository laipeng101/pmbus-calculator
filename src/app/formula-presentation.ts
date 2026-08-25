import type { AppState } from './state'
import { PMBusMath } from '../legacy/pmbus-math'

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
      const parsed = PMBusMath.parseVoutMode(state.l16.voutMode)
      const canCompute = parsed.mode === 0 && parsed.isRelative === false
      if (canCompute === false) {
        const label = parsed.isRelative ? '相对 LINEAR' : parsed.modeName
        const hex = state.l16.voutMode.toString(16).toUpperCase().padStart(2, '0')
        const plainText = `VOUT_MODE 0x${hex} 为 ${label}；需要参考值或器件 Profile，当前不计算绝对电压`
        const latex = `\\text{VOUT_MODE \\#0x${hex}: ${label} — 需要参考值/器件 Profile}`
        return {
          plainText,
          latex,
          genericLatex: 'X = V \\times 2^N',
          detailLines: singleExpansionLine(plainText, latex),
        }
      }
      const plainText = `V=${state.raw} × 2^${state.l16.n}`
      const latex = `X = V \\times 2^N = ${state.raw} \\times 2^{${state.l16.n}}`
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

    default:
      return { plainText: '', latex: '', genericLatex: '', detailLines: [] }
  }
}
