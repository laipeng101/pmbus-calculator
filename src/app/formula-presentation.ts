import type { AppState } from './state'
import { PMBusMath } from '../legacy/pmbus-math'
import { deriveL16Semantics } from './l16-derivation'
import { formatPlainNumber, formatPlainNumberLatex } from './numeric-presentation'
import { RELATIVE_VOLTAGE_OVERFLOW_NOTE, RELATIVE_VOLTAGE_UNDERFLOW_NOTE } from './relative-voltage'
import {
  classifyHalf,
  halfClassGenericLatex,
  halfClassGenericPlainText,
  halfSignPowerLatex,
} from './half-class'

/**
 * Canonical formula presentation.
 *
 * Two contracts live here and must never be confused:
 *  - `plainText` / `latex` are the copy/C-macro contract. This PR keeps their
 *    user-visible output byte-identical to the previous release.
 *  - `equationLatex` / `equationPlainText` are the canonical FIRST-SCREEN
 *    equation for the numeric workspace: symbolic relation → current
 *    substituted values → final current result, or a truthful fail-closed
 *    terminal when no numeric result exists. The workspace renders them
 *    directly and never infers the first screen from auxiliary lines.
 *  - `symbolicLatex` / `symbolicPlainText` are the symbolic-only relation for
 *    auxiliary panels (the DIRECT input helper) — never the first screen.
 */
export interface FormulaPresentation {
  /** Plain-text formula used for copy output and C macro comments (unchanged contract). */
  plainText: string
  /** KaTeX source for the on-screen dynamic formula (unchanged contract). */
  latex: string
  /** Complete first-screen equation (symbolic → substitution → result). */
  equationLatex: string
  equationPlainText: string
  /** Symbolic-only relation for auxiliary panels. */
  symbolicLatex: string
  symbolicPlainText: string
}

/**
 * KaTeX-safe terminal derived from the canonical plain result string. This is a
 * presentation transform of the SAME canonical text the headline displays —
 * never an independent numeric format.
 */
function terminalLatex(text: string): string {
  switch (text) {
    case 'NaN':
      return '\\text{NaN}'
    case '+Infinity':
      return '+\\infty'
    case '-Infinity':
      return '-\\infty'
    default:
      return text
  }
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

const DIRECT_SYMBOLIC_LATEX = 'X = \\frac{1}{m}\\left(Y \\times 10^{-R} - b\\right)'
const DIRECT_SYMBOLIC_PLAIN = 'X = (1/m) × (Y × 10^(-R) − b)'

/**
 * Single source of truth for on-screen formulas.
 *
 * `canonicalResultText` is the canonical headline text (computeValueText). The
 * equation terminal is derived from it, so the equation and the headline can
 * never drift. PMBus calculations are never performed here; only existing
 * decoders are called for display classification.
 */
export function getFormulaPresentation(
  state: AppState,
  canonicalResultText: string,
): FormulaPresentation {
  switch (state.mode) {
    case 'L11': {
      const decoded = PMBusMath.decodeLinear11(state.raw)
      const plainText = `Y=${decoded.y} × 2^${decoded.n}`
      const latex = `X = Y \\times 2^N = ${decoded.y} \\times 2^{${decoded.n}}`
      return {
        plainText,
        latex,
        symbolicLatex: 'X = Y \\times 2^N',
        symbolicPlainText: 'X = Y × 2^N',
        equationPlainText: `X = Y × 2^N = ${decoded.y} × 2^${decoded.n} = ${canonicalResultText}`,
        equationLatex: `${latex} = ${terminalLatex(canonicalResultText)}`,
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
        const latex = '\\text{共享 VOUT_MODE 非 LINEAR，未计算（§8.4）}'
        return {
          plainText,
          latex,
          symbolicLatex: '\\text{需要 LINEAR VOUT_MODE}',
          symbolicPlainText: plainText,
          equationPlainText: plainText,
          equationLatex: latex,
        }
      }
      if (facts.interpretation.kind === 'signed-offset') {
        const { n, y, value } = facts.interpretation
        const plainText = `Y_s=${y} × 2^${n} = ${formatPlainNumber(value)} V`
        const latex = `X_{offset} = Y_s \\times 2^N = ${y} \\times 2^{${n}} = ${formatPlainNumberLatex(value)}`
        return {
          plainText,
          latex,
          symbolicLatex: 'X_{offset} = Y_s \\times 2^N',
          symbolicPlainText: 'X_offset = Y_s × 2^N',
          equationPlainText: `X_offset = Y_s × 2^N = ${y} × 2^${n} = ${canonicalResultText}`,
          equationLatex: `X_{offset} = Y_s \\times 2^N = ${y} \\times 2^{${n}} = ${terminalLatex(canonicalResultText)}`,
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
        const ratioLatex = formatPlainNumberLatex(ratio)
        const percentLatex = formatPlainNumberLatex(ratio * 100)
        const relativeSymbolicLatex = 'R = Y_u \\times 2^N;\\ X = V_{NOM} \\times R'
        const relativeSymbolicPlain = 'R = Y_u × 2^N; X = V_NOM × R'
        if (nominal == null) {
          const plainText = `R=${state.raw} × 2^${n}=${ratioText}（需要 VOUT_COMMAND nominal）`
          const latex = `R = Y_u \\times 2^N = ${state.raw} \\times 2^{${n}} = ${ratioLatex}\\ \\left(\\text{需要 } V_{NOM}\\right)`
          return {
            plainText,
            latex,
            symbolicLatex: 'R = Y_u \\times 2^N',
            symbolicPlainText: 'R = Y_u × 2^N',
            equationPlainText: plainText,
            equationLatex: latex,
          }
        }
        if (finalVoltage.kind === 'overflow' || finalVoltage.kind === 'underflow') {
          const note =
            finalVoltage.kind === 'overflow'
              ? RELATIVE_VOLTAGE_OVERFLOW_NOTE
              : RELATIVE_VOLTAGE_UNDERFLOW_NOTE
          const plainText = `R=${state.raw} × 2^${n}=${ratioText}（${percentText}%）; X=${formatPlainNumber(nominal)}×R=—（${note}）`
          const latex = `R = Y_u \\times 2^N = ${state.raw} \\times 2^{${n}} = ${ratioLatex}\\ (${percentLatex}\\%) \\quad X = V_{NOM} \\times R = ${formatPlainNumberLatex(nominal)} \\times ${ratioLatex} = \\text{—}`
          return {
            plainText,
            latex,
            symbolicLatex: relativeSymbolicLatex,
            symbolicPlainText: relativeSymbolicPlain,
            equationPlainText: plainText,
            equationLatex: latex,
          }
        }
        const nominalLatex = formatPlainNumberLatex(nominal)
        const plainText = `R=${state.raw} × 2^${n}=${ratioText}（${percentText}%）; X=${formatPlainNumber(nominal)}×R=${canonicalResultText} V`
        const latex = `R = Y_u \\times 2^N = ${state.raw} \\times 2^{${n}} = ${ratioLatex}\\ (${percentLatex}\\%) \\quad X = V_{NOM} \\times R = ${nominalLatex} \\times ${ratioLatex} = ${terminalLatex(canonicalResultText)}`
        return {
          plainText,
          latex,
          symbolicLatex: relativeSymbolicLatex,
          symbolicPlainText: relativeSymbolicPlain,
          equationPlainText: plainText,
          equationLatex: latex,
        }
      }

      const { n } = facts.interpretation
      const plainText = `V=${state.raw} × 2^${n}`
      const latex = `X = V \\times 2^N = ${state.raw} \\times 2^{${n}}`
      return {
        plainText,
        latex,
        symbolicLatex: 'X = V \\times 2^N',
        symbolicPlainText: 'X = V × 2^N',
        equationPlainText: `X = V × 2^N = ${state.raw} × 2^${n} = ${canonicalResultText}`,
        equationLatex: `${latex} = ${terminalLatex(canonicalResultText)}`,
      }
    }

    case 'DIRECT': {
      const y = PMBusMath.toSigned(state.raw, 16)
      const { m, b, r } = state.direct

      if (m === 0) {
        const plainText = 'X=(1/m)×(Y×10^(-R)-b)'
        const latex = DIRECT_SYMBOLIC_LATEX
        return {
          plainText,
          latex,
          symbolicLatex: DIRECT_SYMBOLIC_LATEX,
          symbolicPlainText: DIRECT_SYMBOLIC_PLAIN,
          equationPlainText: `${DIRECT_SYMBOLIC_PLAIN}（m = 0 无法计算）`,
          equationLatex: `${DIRECT_SYMBOLIC_LATEX} \\quad \\text{m = 0 无法计算}`,
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
        symbolicLatex: DIRECT_SYMBOLIC_LATEX,
        symbolicPlainText: DIRECT_SYMBOLIC_PLAIN,
        equationPlainText: `${DIRECT_SYMBOLIC_PLAIN} = (1/${formatSignedInt(m)})×(${yTerm}×10^${exponentText}-${bTerm}) = ${canonicalResultText}`,
        equationLatex: `${DIRECT_SYMBOLIC_LATEX} = \\frac{1}{${formatSignedInt(m)}}\\left(${yTerm} \\times 10^{${exponentLatex}} - ${bTerm}\\right) = ${terminalLatex(canonicalResultText)}`,
      }
    }

    case 'HALF':
      return getHalfPresentation(state.raw, canonicalResultText)

    case 'VOUT_MODE': {
      // A VOUT_MODE byte is structured configuration state, not a math
      // equation: it must never be typeset with KaTeX/serif. The result panel
      // renders it through the workspace config rows (UI/data font roles); the
      // plainText contract below only serves copy tooling.
      const hex = state.voutMode.byte.toString(16).toUpperCase().padStart(2, '0')
      return {
        plainText: 'VOUT_MODE 0x' + hex,
        latex: '',
        symbolicLatex: '',
        symbolicPlainText: '',
        equationLatex: '',
        equationPlainText: '',
      }
    }

    default:
      return {
        plainText: '',
        latex: '',
        symbolicLatex: '',
        symbolicPlainText: '',
        equationLatex: '',
        equationPlainText: '',
      }
  }
}

/**
 * HALF presentation: the copy/C-macro strings stay byte-identical to the
 * previous release; the equation adds the class-appropriate symbolic relation
 * in front of the numeric substitution and ends in the canonical result.
 */
function getHalfPresentation(raw: number, canonicalResultText: string): FormulaPresentation {
  const facts = classifyHalf(raw)
  const { sign, exponent, fraction, klass } = facts
  const signText = sign ? '-' : '+'
  const signPowerPlain = `(-1)^{${sign}}`
  // First-screen plain text uses the compact sign form so the symbolic and
  // substituted relations read consistently; the legacy copy strings above
  // keep the braced form unchanged.
  const signPowerPlainEquation = `(-1)^${sign}`
  const signPowerLatex = halfSignPowerLatex(sign)
  const symbolicLatex = halfClassGenericLatex(klass)
  const symbolicPlainText = halfClassGenericPlainText(klass)

  if (klass === 'zero') {
    const terminal = facts.signedZero ?? canonicalResultText
    return {
      plainText: `HALF zero ${signPowerPlain}×0=${signText}0`,
      latex: `X = ${signPowerPlain} \\times 0 = ${signText}0`,
      symbolicLatex,
      symbolicPlainText,
      equationPlainText: `${symbolicPlainText} = ${signPowerPlainEquation} × 0 = ${terminal}`,
      equationLatex: `${symbolicLatex} = ${signPowerLatex} \\times 0 = ${terminal}`,
    }
  }

  if (klass === 'subnormal') {
    const value = PMBusMath.decodeHalf(raw).value
    const valueText = formatPlainNumber(value)
    return {
      plainText: `HALF subnormal ${signPowerPlain}×2^-14×${fraction}/1024=${valueText}`,
      latex: `X = ${signPowerPlain} \\times 2^{-14} \\times \\frac{${fraction}}{2^{10}} = ${formatPlainNumberLatex(value)}`,
      symbolicLatex,
      symbolicPlainText,
      equationPlainText: `${symbolicPlainText} = ${signPowerPlainEquation} × 2^-14 × ${fraction}/1024 = ${canonicalResultText}`,
      equationLatex: `${symbolicLatex} = ${signPowerLatex} \\times 2^{-14} \\times \\frac{${fraction}}{2^{10}} = ${terminalLatex(canonicalResultText)}`,
    }
  }

  if (klass === 'infinity') {
    return {
      plainText: `HALF ${signText}Infinity (E=31,F=0)`,
      latex: `X = ${signPowerPlain} \\times \\infty = ${signText}\\infty \\quad (E=31,\\ F=0)`,
      symbolicLatex,
      symbolicPlainText,
      equationPlainText: `${symbolicPlainText} = ${signPowerPlainEquation} × ∞ = ${signText}∞`,
      equationLatex: `${symbolicLatex} = ${signPowerLatex} \\times \\infty = ${terminalLatex(canonicalResultText)}`,
    }
  }

  if (klass === 'nan') {
    return {
      plainText: `HALF NaN (E=31,F=${fraction})`,
      latex: `X = \\text{NaN} \\quad (E=31,\\ F=${fraction})`,
      symbolicLatex,
      symbolicPlainText,
      equationPlainText: 'X = NaN',
      equationLatex: 'X = \\text{NaN}',
    }
  }

  const value = PMBusMath.decodeHalf(raw).value
  const valueText = formatPlainNumber(value)
  return {
    plainText: `HALF normal ${signPowerPlain}×2^(${exponent}-15)×(1+${fraction}/1024)=${valueText}`,
    latex: `X = ${signPowerPlain} \\times 2^{${exponent}-15} \\times \\left(1 + \\frac{${fraction}}{2^{10}}\\right) = ${formatPlainNumberLatex(value)}`,
    symbolicLatex,
    symbolicPlainText,
    equationPlainText: `${symbolicPlainText} = ${signPowerPlainEquation} × 2^(${exponent}−15) × (1 + ${fraction}/1024) = ${canonicalResultText}`,
    equationLatex: `${symbolicLatex} = ${signPowerLatex} \\times 2^{${exponent}-15} \\times \\left(1 + \\frac{${fraction}}{2^{10}}\\right) = ${terminalLatex(canonicalResultText)}`,
  }
}
