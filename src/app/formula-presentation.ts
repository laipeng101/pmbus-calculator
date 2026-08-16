import type { AppState } from './state'
import { PMBusMath } from '../legacy/pmbus-math'

export interface FormulaPresentation {
  /** Plain-text formula used for copy output and C macro comments. */
  plainText: string
  /** KaTeX source used for on-screen dynamic formula. */
  latex: string
  /** KaTeX source for the generic symbol relation shown in the workspace. */
  genericLatex: string
}

function formatSignedInt(value: number): string {
  return value < 0 ? `(${value})` : String(value)
}

function formatNegatedDirectExponent(r: number): string {
  const exponent = -r
  return exponent < 0 ? `(${exponent})` : String(exponent)
}

function formatDirectTerm(value: number): string {
  return value < 0 ? `(${value})` : String(value)
}

interface HalfPresentation {
  plainText: string
  latex: string
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
    }
  }

  if (exponent === 0) {
    const value = PMBusMath.decodeHalf(raw).value
    const valueText = formatNumber(value)
    return {
      plainText: `HALF subnormal ${signPower}×2^-14×${fraction}/1024=${valueText}`,
      latex: `X = ${signPower} \\times 2^{-14} \\times \\frac{${fraction}}{2^{10}} = ${formatLatexNumber(value)}`,
    }
  }

  if (exponent === 0x1f) {
    if (fraction === 0) {
      return {
        plainText: `HALF ${signText}Infinity (E=31,F=0)`,
        latex: `X = ${signPower} \\times \\infty = ${sign ? '-' : '+'}\\infty \\quad (E=31,\\ F=0)`,
      }
    }
    return {
      plainText: `HALF NaN (E=31,F=${fraction})`,
      latex: `X = \\text{NaN} \\quad (E=31,\\ F=${fraction})`,
    }
  }

  const value = PMBusMath.decodeHalf(raw).value
  const valueText = formatNumber(value)
  return {
    plainText: `HALF normal ${signPower}×2^(${exponent}-15)×(1+${fraction}/1024)=${valueText}`,
    latex: `X = ${signPower} \\times 2^{${exponent}-15} \\times \\left(1 + \\frac{${fraction}}{2^{10}}\\right) = ${formatLatexNumber(value)}`,
  }
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
      return {
        plainText: `Y=${decoded.y} × 2^${decoded.n}`,
        latex: `X = Y \\times 2^N = ${decoded.y} \\times 2^{${decoded.n}}`,
        genericLatex: 'X = Y \\times 2^N',
      }
    }

    case 'L16': {
      return {
        plainText: `V=${state.raw} × 2^${state.l16.n}`,
        latex: `X = V \\times 2^N = ${state.raw} \\times 2^{${state.l16.n}}`,
        genericLatex: 'X = V \\times 2^N',
      }
    }

    case 'DIRECT': {
      const y = PMBusMath.toSigned(state.raw, 16)
      const { m, b, r } = state.direct

      if (m === 0) {
        return {
          plainText: 'X=(1/m)×(Y×10^(-R)-b)',
          latex: 'X = \\frac{1}{m}\\left(Y \\times 10^{-R} - b\\right)',
          genericLatex: 'X = \\frac{1}{m}\\left(Y \\times 10^{-R} - b\\right)',
        }
      }

      const yTerm = formatDirectTerm(y)
      const bTerm = formatDirectTerm(b)
      const exponentText = formatNegatedDirectExponent(r)
      const plainText = `X=(1/${formatSignedInt(m)})×(${yTerm}×10^${exponentText}-${bTerm})`
      const latex = `X = \\frac{1}{${formatSignedInt(m)}}\\left(${yTerm} \\times 10^{${exponentText}} - ${bTerm}\\right)`

      return {
        plainText,
        latex,
        genericLatex: 'X = \\frac{1}{m}\\left(Y \\times 10^{-R} - b\\right)',
      }
    }

    case 'HALF': {
      return {
        ...getHalfPresentation(state.raw),
        genericLatex: 'X = \\text{IEEE 754 binary16 分段解码}',
      }
    }

    default:
      return { plainText: '', latex: '', genericLatex: '' }
  }
}
