import type { AppState } from './state'
import { PMBusMath } from '../legacy/pmbus-math'

export interface FormulaPresentation {
  /** Plain-text formula used for copy output and C macro comments. */
  plainText: string
  /** KaTeX source used for on-screen typeset formulas. */
  latex: string
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

  if (exponent === 0 && fraction === 0) {
    return {
      plainText: `HALF zero ${signText}0`,
      latex: `X = ${signText}0`,
    }
  }

  if (exponent === 0) {
    const value = PMBusMath.decodeHalf(raw).value
    return {
      plainText: `HALF subnormal ${formatNumber(value)}`,
      latex: `X = \\text{subnormal} = ${formatLatexNumber(value)}`,
    }
  }

  if (exponent === 0x1f) {
    if (fraction === 0) {
      return {
        plainText: sign ? 'HALF -Infinity' : 'HALF +Infinity',
        latex: sign ? 'X = -\\infty' : 'X = +\\infty',
      }
    }
    return { plainText: 'HALF NaN', latex: 'X = \\text{NaN}' }
  }

  const value = PMBusMath.decodeHalf(raw).value
  return {
    plainText: `HALF normal ${formatNumber(value)}`,
    latex: `X = \\text{normal} = ${formatLatexNumber(value)}`,
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
      }
    }

    case 'L16': {
      return {
        plainText: `V=${state.raw} × 2^${state.l16.n}`,
        latex: `X = V \\times 2^N = ${state.raw} \\times 2^{${state.l16.n}}`,
      }
    }

    case 'DIRECT': {
      const y = PMBusMath.toSigned(state.raw, 16)
      const { m, b, r } = state.direct

      if (m === 0) {
        return {
          plainText: 'X=(1/m)×(Y×10^(-R)-b)',
          latex: 'X = \\frac{1}{m}\\left(Y \\times 10^{-R} - b\\right)',
        }
      }

      const yTerm = formatDirectTerm(y)
      const bTerm = formatDirectTerm(b)
      const exponentText = formatNegatedDirectExponent(r)
      const plainText = `X=(1/${formatSignedInt(m)})×(${yTerm}×10^${exponentText}-${bTerm})`
      const latex = `X = \\frac{1}{${formatSignedInt(m)}}\\left(${yTerm} \\times 10^{${exponentText}} - ${bTerm}\\right)`

      return { plainText, latex }
    }

    case 'HALF': {
      return getHalfPresentation(state.raw)
    }

    default:
      return { plainText: '', latex: '' }
  }
}
