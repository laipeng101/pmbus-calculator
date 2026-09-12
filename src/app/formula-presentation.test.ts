import { describe, expect, it } from 'vitest'
import { getFormulaPresentation } from './formula-presentation'
import { toCalculatorViewModel } from './view-model'
import { buildCMacro } from './copy-utils'
import type { AppState } from './state'
import { INITIAL_STATE } from './reducer'

function state(partial: Partial<AppState> & { mode: AppState['mode'] }): AppState {
  return {
    ...INITIAL_STATE,
    ...partial,
    voutMode: { ...INITIAL_STATE.voutMode, ...(partial.voutMode ?? {}) },
    l11: { ...INITIAL_STATE.l11, ...(partial.l11 ?? {}) },
    l16: { ...INITIAL_STATE.l16, ...(partial.l16 ?? {}) },
    direct: { ...INITIAL_STATE.direct, ...(partial.direct ?? {}) },
  }
}

function direct(m: number, b: number, r: number) {
  return { m, b, r, errors: { m: null, b: null, r: null } }
}

/** Render through the canonical equation contract: the headline IS the terminal. */
function formula(s: AppState) {
  return getFormulaPresentation(s, toCalculatorViewModel(s).valueText)
}

const ALLOWED_LATEX_COMMANDS = new Set([
  'times',
  'frac',
  'left',
  'right',
  'mathrm',
  'text',
  'textstyle',
  'infty',
  'quad',
])

function latexCommands(latex: string): string[] {
  return Array.from(latex.matchAll(/\\[A-Za-z]+/g), (m) => m[0].slice(1))
}

describe('formula presentation model', () => {
  it('L11 keeps legacy plainText and adds LaTeX with actual values', () => {
    const f = formula(state({ mode: 'L11', raw: 0xf819 }))
    expect(f.plainText).toBe('Y=25 × 2^-1')
    expect(f.latex).toBe('X = Y \\times 2^N = 25 \\times 2^{-1}')
  })

  it('L16 keeps legacy plainText and adds LaTeX with actual values', () => {
    const f = formula(state({ mode: 'L16', raw: 0, voutMode: { byte: 0x18 } }))
    expect(f.plainText).toBe('V=0 × 2^-8')
    expect(f.latex).toBe('X = V \\times 2^N = 0 \\times 2^{-8}')
  })

  it('DIRECT renders negative R with parentheses, never 10^--1 in LaTeX', () => {
    const f = formula(state({ mode: 'DIRECT', raw: 0x000a, direct: direct(2, 3, -1) }))
    expect(f.plainText).toBe('X=(1/2)×(10×10^1-3)')
    expect(f.latex).toBe('X = \\frac{1}{2}\\left(10 \\times 10^{1} - 3\\right)')
    expect(f.latex).not.toContain('10^--1')
    expect(f.latex).not.toContain('10^{--1}')
  })

  it('DIRECT wraps negative coefficients and m in parentheses', () => {
    const f = formula(state({ mode: 'DIRECT', raw: 0x8000, direct: direct(-4, -3, 0) }))
    expect(f.plainText).toBe('X=(1/(-4))×((-32768)×10^0-(-3))')
    expect(f.latex).toBe('X = \\frac{1}{(-4)}\\left((-32768) \\times 10^{0} - (-3)\\right)')
  })

  it('DIRECT m=0 keeps the symbolic relation and fails closed explicitly', () => {
    const f = formula(state({ mode: 'DIRECT', raw: 0, direct: direct(0, 0, 0) }))
    expect(f.plainText).toBe('X=(1/m)×(Y×10^(-R)-b)')
    expect(f.latex).toBe('X = \\frac{1}{m}\\left(Y \\times 10^{-R} - b\\right)')
    expect(f.equationPlainText).toContain('m = 0 无法计算')
    expect(f.equationLatex).toContain('\\text{m = 0 无法计算}')
  })

  it('HALF special values share the same presentation layer', () => {
    const f = formula(state({ mode: 'HALF', raw: 0x7e00 }))
    expect(f.plainText).toBe('HALF NaN (E=31,F=512)')
    expect(f.latex).toBe('X = \\text{NaN} \\quad (E=31,\\ F=512)')
  })

  it('HALF zero decomposes sign and value for +0 and -0', () => {
    const plusZero = formula(state({ mode: 'HALF', raw: 0x0000 }))
    expect(plusZero.plainText).toBe('HALF zero (-1)^{0}×0=+0')
    expect(plusZero.latex).toBe('X = (-1)^{0} \\times 0 = +0')
    expect(plusZero.equationPlainText).toContain('= +0')
    expect(plusZero.equationLatex).toContain('(-1)^{\\textstyle s}')
    expect(plusZero.equationLatex).toContain('= +0')

    const minusZero = formula(state({ mode: 'HALF', raw: 0x8000 }))
    expect(minusZero.plainText).toBe('HALF zero (-1)^{1}×0=-0')
    expect(minusZero.latex).toBe('X = (-1)^{1} \\times 0 = -0')
    expect(minusZero.equationLatex).toContain('= -0')
  })

  it('HALF subnormal and normal decompose exponent and fraction', () => {
    const subnormal = formula(state({ mode: 'HALF', raw: 0x0001 }))
    expect(subnormal.plainText).toBe('HALF subnormal (-1)^{0}×2^-14×1/1024=5.96046447754e-8')
    expect(subnormal.latex).toBe(
      'X = (-1)^{0} \\times 2^{-14} \\times \\frac{1}{2^{10}} = 5.96046447754e-8',
    )

    const normal = formula(state({ mode: 'HALF', raw: 0x3c00 }))
    expect(normal.plainText).toBe('HALF normal (-1)^{0}×2^(15-15)×(1+0/1024)=1')
    expect(normal.latex).toBe(
      'X = (-1)^{0} \\times 2^{15-15} \\times \\left(1 + \\frac{0}{2^{10}}\\right) = 1',
    )
  })

  it('HALF infinities and NaN expose E/F fields', () => {
    const plusInf = formula(state({ mode: 'HALF', raw: 0x7c00 }))
    expect(plusInf.plainText).toBe('HALF +Infinity (E=31,F=0)')
    expect(plusInf.latex).toBe('X = (-1)^{0} \\times \\infty = +\\infty \\quad (E=31,\\ F=0)')

    const minusInf = formula(state({ mode: 'HALF', raw: 0xfc00 }))
    expect(minusInf.plainText).toBe('HALF -Infinity (E=31,F=0)')
    expect(minusInf.latex).toBe('X = (-1)^{1} \\times \\infty = -\\infty \\quad (E=31,\\ F=0)')
  })

  it('canonical equation is symbolic -> substitution -> final result', () => {
    const l11 = formula(state({ mode: 'L11', raw: 0x3ce6 }))
    expect(l11.equationPlainText).toBe('X = Y × 2^N = -794 × 2^7 = -101632')
    expect(l11.equationLatex).toBe('X = Y \\times 2^N = -794 \\times 2^{7} = -101632')

    const l16 = formula(state({ mode: 'L16', raw: 0x3ce6, voutMode: { byte: 0x18 } }))
    expect(l16.equationPlainText).toBe('X = V × 2^N = 15590 × 2^-8 = 60.8984375')
    expect(l16.equationLatex).toBe('X = V \\times 2^N = 15590 \\times 2^{-8} = 60.8984375')

    const directRow = formula(state({ mode: 'DIRECT', raw: 0x3ce6, direct: direct(1, 0, 0) }))
    expect(directRow.equationPlainText).toBe(
      'X = (1/m) × (Y × 10^(-R) − b) = (1/1)×(15590×10^0-0) = 15590',
    )
    expect(directRow.equationLatex).toBe(
      'X = \\frac{1}{m}\\left(Y \\times 10^{-R} - b\\right) = \\frac{1}{1}\\left(15590 \\times 10^{0} - 0\\right) = 15590',
    )

    const half = formula(state({ mode: 'HALF', raw: 0x3ce6 }))
    expect(half.equationPlainText).toBe(
      'X = (-1)^s × 2^(E−15) × (1 + F/1024) = (-1)^0 × 2^(15−15) × (1 + 230/1024) = 1.224609375',
    )
    expect(half.equationLatex).toBe(
      'X = (-1)^{\\textstyle s} \\times 2^{E-15} \\times \\left(1 + \\frac{F}{2^{10}}\\right) = (-1)^{\\textstyle 0} \\times 2^{15-15} \\times \\left(1 + \\frac{230}{2^{10}}\\right) = 1.224609375',
    )
  })

  it('equation terminal is bound to the canonical headline (no second format)', () => {
    const vectors: AppState[] = [
      state({ mode: 'L11', raw: 0x3ce6 }),
      state({ mode: 'L16', raw: 0x3ce6, voutMode: { byte: 0x18 } }),
      state({ mode: 'DIRECT', raw: 0x3ce6, direct: direct(1, 0, 0) }),
      state({ mode: 'HALF', raw: 0x3ce6 }),
    ]
    for (const s of vectors) {
      const vm = toCalculatorViewModel(s)
      const f = getFormulaPresentation(s, vm.valueText)
      expect(f.equationPlainText.endsWith('= ' + vm.valueText)).toBe(true)
    }
  })

  it('symbolic relations expose the pure relation, never the first screen', () => {
    expect(formula(state({ mode: 'L11', raw: 0 })).symbolicLatex).toBe('X = Y \\times 2^N')
    expect(formula(state({ mode: 'L16', raw: 0, voutMode: { byte: 0x18 } })).symbolicLatex).toBe(
      'X = V \\times 2^N',
    )
    expect(formula(state({ mode: 'DIRECT', raw: 0, direct: direct(1, 0, 0) })).symbolicLatex).toBe(
      'X = \\frac{1}{m}\\left(Y \\times 10^{-R} - b\\right)',
    )
    expect(formula(state({ mode: 'L11', raw: 0 })).symbolicPlainText).toBe('X = Y × 2^N')
    expect(
      formula(state({ mode: 'L16', raw: 0, voutMode: { byte: 0x18 } })).symbolicPlainText,
    ).toBe('X = V × 2^N')
  })

  it('HALF symbolic relations render the sign exponent at text style', () => {
    const cases = [
      { raw: 0x0000, latex: 'X = (-1)^{\\textstyle s} \\times 0' },
      {
        raw: 0x0001,
        latex: 'X = (-1)^{\\textstyle s} \\times 2^{-14} \\times \\frac{F}{2^{10}}',
      },
      {
        raw: 0x3c00,
        latex:
          'X = (-1)^{\\textstyle s} \\times 2^{E-15} \\times \\left(1 + \\frac{F}{2^{10}}\\right)',
      },
      { raw: 0x7c00, latex: 'X = (-1)^{\\textstyle s} \\times \\infty' },
      { raw: 0x7e00, latex: 'X = \\text{NaN}' },
    ]
    for (const c of cases) {
      const presentation = formula(state({ mode: 'HALF', raw: c.raw }))
      expect(presentation.symbolicLatex, '0x' + c.raw.toString(16)).toBe(c.latex)
      for (const command of latexCommands(presentation.symbolicLatex)) {
        expect(ALLOWED_LATEX_COMMANDS.has(command), command).toBe(true)
      }
    }
  })

  it('L16 non-LINEAR fails closed without fabricating N or a formula', () => {
    const f = formula(state({ mode: 'L16', raw: 0x3412, voutMode: { byte: 0x38 } }))
    expect(f.equationLatex).toContain('共享 VOUT_MODE 非 LINEAR')
    expect(f.equationLatex).not.toContain('\\times 2^')
    expect(f.equationPlainText).not.toContain('N =')
  })

  it('existing formulaText and C macro output remain compatible', () => {
    const s = state({ mode: 'L11', raw: 0x000c })
    const vm = toCalculatorViewModel(s)
    expect(vm.formulaText).toBe('Y=12 × 2^0')
    expect(vm.formulaLatex).toBe('X = Y \\times 2^N = 12 \\times 2^{0}')
    expect(buildCMacro('VOUT_COMMAND', vm.rawWordHex, vm.formulaText)).toBe(
      '#define VOUT_COMMAND 0x000C /* Y=12 × 2^0 */',
    )
  })

  it('KaTeX templates only use the safe common subset', () => {
    const samples = [
      state({ mode: 'L11', raw: 0xf819 }),
      state({ mode: 'L16', raw: 0xffff, voutMode: { byte: 0x18 } }),
      state({ mode: 'DIRECT', raw: 0x8000, direct: direct(-4, -3, -128) }),
      state({ mode: 'DIRECT', raw: 0, direct: direct(0, 0, 0) }),
      state({ mode: 'HALF', raw: 0x7e00 }),
      state({ mode: 'HALF', raw: 0x3ce6 }),
    ]
    for (const s of samples) {
      const f = formula(s)
      for (const latex of [f.latex, f.equationLatex, f.symbolicLatex]) {
        for (const command of latexCommands(latex)) {
          expect(ALLOWED_LATEX_COMMANDS.has(command), command + ' not allowed in ' + latex).toBe(
            true,
          )
        }
      }
    }
  })
})

describe('relative ULINEAR16 equation diagnostics', () => {
  it('without a nominal shows the ratio only, never a stale voltage (v2.5.8)', () => {
    const f = formula(state({ mode: 'L16', raw: 0x0100, voutMode: { byte: 0x98 } }))
    expect(f.equationPlainText).toBe('R=256 × 2^-8=1（需要 VOUT_COMMAND nominal）')
    expect(f.equationPlainText).not.toMatch(/X=/)
    expect(f.equationLatex).toContain('\\text{需要 } V_{NOM}')

    const withNominal = state({
      mode: 'L16',
      raw: 0x0100,
      voutMode: { byte: 0x98 },
      l16: { payloadKind: 'ulinear16', nominalVout: 12 },
    })
    expect(formula(withNominal).equationPlainText).toBe('R=256 × 2^-8=1（100%）; X=12×R=12 V')
  })

  it('overflow keeps nominal and ratio but never fabricates a final voltage (v2.5.9)', () => {
    const f = formula(
      state({
        mode: 'L16',
        raw: 0x0200,
        voutMode: { byte: 0x98 },
        l16: { payloadKind: 'ulinear16', nominalVout: 1e308 },
      }),
    )
    expect(f.equationPlainText).toContain('=—（计算结果超出 JavaScript Number 可表示范围）')
    expect(f.equationPlainText).not.toContain('Infinity')
    expect(f.equationLatex).toContain('= \\text{—}')
  })

  it('underflow reports the shared underflow diagnostic (v2.5.9)', () => {
    const f = formula(
      state({
        mode: 'L16',
        raw: 0x0001,
        voutMode: { byte: 0x90 },
        l16: { payloadKind: 'ulinear16', nominalVout: 5e-324 },
      }),
    )
    expect(f.equationPlainText).toContain('=—（计算下溢')
    expect(f.equationPlainText).not.toMatch(/=0 V/)
  })
})
