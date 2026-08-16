import type { AppState } from './state'
import { PMBusMath } from '../legacy/pmbus-math'

export interface FormulaPresentation {
  /** Plain-text formula used for copy output and C macro comments. */
  plainText: string
  /** KaTeX source used for on-screen typeset formulas. */
  latex: string
}
function formatLatexNegatedExponent(r: number): string {
  // `10^{-R}` with a negative R must render as 10^{-(-1)}, never 10^--1.
  return r < 0 ? `-(${r})` : `-${r}`
}

/**
 * Single source of truth for on-screen formulas.
 *
 * The `plainText` field intentionally matches the legacy `formulaText`
 * contract used by the copy toolbar and C macro comments.  Only `latex`
 * is typeset in the UI.
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
      const plainText = `X=(1/${m})×(${y}×10^(-${r})-${b})`
      const yLatex = y < 0 ? `(${y})` : String(y)
      const bLatex = b < 0 ? `(${b})` : String(b)
      const mLatex = m < 0 ? `(${m})` : String(m)

      // m = 0 makes the numeric template undefined.  Keep the symbolic
      // formula visible while the existing error/warning explains m = 0.
      const latex =
        m === 0
          ? 'X = \\frac{1}{m}\\left(Y \\times 10^{-R} - b\\right)'
          : `X = \\frac{1}{${mLatex}}\\left(${yLatex} \\times 10^{${formatLatexNegatedExponent(r)}} - ${bLatex}\\right)`

      return { plainText, latex }
    }

    case 'HALF': {
      return {
        plainText: 'IEEE 754 Half-Precision',
        latex: 'X = \\operatorname{decodeHalf}\\!\\left(\\mathrm{raw}\\right)',
      }
    }

    default:
      return { plainText: '', latex: '' }
  }
}
