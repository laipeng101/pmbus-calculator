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
    l11: { ...INITIAL_STATE.l11, ...(partial.l11 ?? {}) },
    l16: { ...INITIAL_STATE.l16, ...(partial.l16 ?? {}) },
    direct: { ...INITIAL_STATE.direct, ...(partial.direct ?? {}) },
  }
}

const ALLOWED_LATEX_COMMANDS = new Set([
  'times',
  'frac',
  'left',
  'right',
  'mathrm',
  'text',
  'infty',
  'quad',
])

function latexCommands(latex: string): string[] {
  return Array.from(latex.matchAll(/\\[A-Za-z]+/g), (m) => m[0].slice(1))
}

describe('formula presentation model', () => {
  it('L11 keeps legacy plainText and adds LaTeX with actual values', () => {
    const s = state({ mode: 'L11', raw: 0xf819 })
    const f = getFormulaPresentation(s)

    expect(f.plainText).toBe('Y=25 × 2^-1')
    expect(f.latex).toBe('X = Y \\times 2^N = 25 \\times 2^{-1}')
  })

  it('L16 keeps legacy plainText and adds LaTeX with actual values', () => {
    const s = state({ mode: 'L16', raw: 0, l16: { n: -8, voutMode: 0x18 } })
    const f = getFormulaPresentation(s)

    expect(f.plainText).toBe('V=0 × 2^-8')
    expect(f.latex).toBe('X = V \\times 2^N = 0 \\times 2^{-8}')
  })

  it('DIRECT renders negative R with parentheses, never 10^--1 in LaTeX', () => {
    const s = state({
      mode: 'DIRECT',
      raw: 0x000a,
      direct: { m: 2, b: 3, r: -1, error: null },
    })
    const f = getFormulaPresentation(s)

    expect(f.plainText).toBe('X=(1/2)×(10×10^1-3)')
    expect(f.latex).toBe('X = \\frac{1}{2}\\left(10 \\times 10^{1} - 3\\right)')
    expect(f.latex).not.toContain('10^--1')
    expect(f.latex).not.toContain('10^{--1}')
  })

  it('DIRECT wraps negative coefficients and m in parentheses', () => {
    const s = state({
      mode: 'DIRECT',
      raw: 0x8000,
      direct: { m: -4, b: -3, r: 0, error: null },
    })
    const f = getFormulaPresentation(s)

    expect(f.plainText).toBe('X=(1/(-4))×((-32768)×10^0-(-3))')
    expect(f.latex).toBe('X = \\frac{1}{(-4)}\\left((-32768) \\times 10^{0} - (-3)\\right)')
  })

  it('DIRECT m=0 keeps symbolic LaTeX while plainText contract is unchanged', () => {
    const s = state({
      mode: 'DIRECT',
      raw: 0,
      direct: { m: 0, b: 0, r: 0, error: 'DIRECT 系数 m 不能为 0' },
    })
    const f = getFormulaPresentation(s)

    expect(f.plainText).toBe('X=(1/m)×(Y×10^(-R)-b)')
    expect(f.latex).toBe('X = \\frac{1}{m}\\left(Y \\times 10^{-R} - b\\right)')
  })

  it('HALF special values share the same presentation layer', () => {
    const s = state({ mode: 'HALF', raw: 0x7e00 })
    const f = getFormulaPresentation(s)

    expect(f.plainText).toBe('HALF NaN (E=31,F=512)')
    expect(f.latex).toBe('X = \\text{NaN} \\quad (E=31,\\ F=512)')
  })

  it('HALF zero decomposes sign and value for +0 and -0', () => {
    const plusZero = getFormulaPresentation(state({ mode: 'HALF', raw: 0x0000 }))
    expect(plusZero.plainText).toBe('HALF zero (-1)^{0}×0=+0')
    expect(plusZero.latex).toBe('X = (-1)^{0} \\times 0 = +0')

    const minusZero = getFormulaPresentation(state({ mode: 'HALF', raw: 0x8000 }))
    expect(minusZero.plainText).toBe('HALF zero (-1)^{1}×0=-0')
    expect(minusZero.latex).toBe('X = (-1)^{1} \\times 0 = -0')
  })

  it('HALF subnormal and normal decompose exponent and fraction', () => {
    const subnormal = getFormulaPresentation(state({ mode: 'HALF', raw: 0x0001 }))
    expect(subnormal.plainText).toBe('HALF subnormal (-1)^{0}×2^-14×1/1024=5.96046447754e-8')
    expect(subnormal.latex).toBe(
      'X = (-1)^{0} \\times 2^{-14} \\times \\frac{1}{2^{10}} = 5.96046447754e-8',
    )

    const normal = getFormulaPresentation(state({ mode: 'HALF', raw: 0x3c00 }))
    expect(normal.plainText).toBe('HALF normal (-1)^{0}×2^(15-15)×(1+0/1024)=1')
    expect(normal.latex).toBe(
      'X = (-1)^{0} \\times 2^{15-15} \\times \\left(1 + \\frac{0}{2^{10}}\\right) = 1',
    )
  })

  it('HALF infinities and NaN expose E/F fields', () => {
    const plusInf = getFormulaPresentation(state({ mode: 'HALF', raw: 0x7c00 }))
    expect(plusInf.plainText).toBe('HALF +Infinity (E=31,F=0)')
    expect(plusInf.latex).toBe('X = (-1)^{0} \\times \\infty = +\\infty \\quad (E=31,\\ F=0)')

    const minusInf = getFormulaPresentation(state({ mode: 'HALF', raw: 0xfc00 }))
    expect(minusInf.plainText).toBe('HALF -Infinity (E=31,F=0)')
    expect(minusInf.latex).toBe('X = (-1)^{1} \\times \\infty = -\\infty \\quad (E=31,\\ F=0)')
  })

  it('genericLatex exposes symbolic relations for four modes', () => {
    expect(getFormulaPresentation(state({ mode: 'L11', raw: 0 })).genericLatex).toBe(
      'X = Y \\times 2^N',
    )
    expect(getFormulaPresentation(state({ mode: 'L16', raw: 0 })).genericLatex).toBe(
      'X = V \\times 2^N',
    )
    expect(
      getFormulaPresentation(
        state({ mode: 'DIRECT', raw: 0, direct: { m: 1, b: 0, r: 0, error: null } }),
      ).genericLatex,
    ).toBe('X = \\frac{1}{m}\\left(Y \\times 10^{-R} - b\\right)')
    expect(getFormulaPresentation(state({ mode: 'HALF', raw: 0 })).genericLatex).toBe(
      'X = \\text{IEEE 754 binary16 分段解码}',
    )
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
      state({ mode: 'L16', raw: 0xffff, l16: { n: -16, voutMode: 0x18 } }),
      state({ mode: 'DIRECT', raw: 0x8000, direct: { m: -4, b: -3, r: -128, error: null } }),
      state({ mode: 'DIRECT', raw: 0, direct: { m: 0, b: 0, r: 0, error: null } }),
      state({ mode: 'HALF', raw: 0x7e00 }),
    ]

    for (const s of samples) {
      const { latex } = getFormulaPresentation(s)
      for (const command of latexCommands(latex)) {
        expect(ALLOWED_LATEX_COMMANDS.has(command), `${command} not allowed in ${latex}`).toBe(true)
      }
    }
  })
})
