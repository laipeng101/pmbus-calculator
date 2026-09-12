import { describe, expect, it } from 'vitest'
import { PMBusMath } from '../src/legacy/pmbus-math'
import { toCalculatorViewModel } from '../src/app/view-model'
import { getFormulaPresentation } from '../src/app/formula-presentation'
import { buildCMacro } from '../src/app/copy-utils'
import type { AppState } from '../src/app/state'
import { INITIAL_STATE } from '../src/app/reducer'

function base(partial: Partial<AppState> = {}): AppState {
  return {
    ...INITIAL_STATE,
    ...partial,
    voutMode: { ...INITIAL_STATE.voutMode, ...(partial.voutMode ?? {}) },
    l11: { ...INITIAL_STATE.l11, ...(partial.l11 ?? {}) },
    l16: { ...INITIAL_STATE.l16, ...(partial.l16 ?? {}) },
    direct: { ...INITIAL_STATE.direct, ...(partial.direct ?? {}) },
  }
}

describe('M16 non-zero stress golden cases', () => {
  it('LINEAR11 raw=0xA3C1 decodes to Y=961, N=-12, value=0.234619140625', () => {
    const r = PMBusMath.decodeLinear11(0xa3c1)
    expect(r.y).toBe(961)
    expect(r.n).toBe(-12)
    expect(r.value).toBeCloseTo(0.234619140625, 15)

    const vm = toCalculatorViewModel(base({ mode: 'L11', raw: 0xa3c1 }))
    expect(vm.valueText).toBe('0.234619140625')
    expect(vm.rawHex).toBe('0xA3C1')
    expect(vm.wireBytes).toBe('0x C1 A3')
    expect(vm.msbFirstBytes).toBe('0x A3 C1')
    expect(vm.formulaText).toBe('Y=961 × 2^-12')
    expect(buildCMacro(null, vm.rawWordHex, vm.formulaText)).toBe(
      '#define RAW_VALUE 0xA3C1 /* Y=961 × 2^-12 */',
    )

    const f = getFormulaPresentation(base({ mode: 'L11', raw: 0xa3c1 }), vm.valueText)
    expect(f.equationPlainText).toBe('X = Y × 2^N = 961 × 2^-12 = 0.234619140625')
    expect(f.equationLatex).toBe('X = Y \\times 2^N = 961 \\times 2^{-12} = 0.234619140625')
  })

  it('LINEAR16 raw=0x8FC3 with VOUT_MODE=0x13 decodes to V=36803, N=-13, value≈4.49255371094', () => {
    expect(PMBusMath.parseVoutMode(0x13).linearExponent).toBe(-13)
    const r = PMBusMath.decodeLinear16(0x8fc3, -13)
    expect(r.v).toBe(36803)
    expect(r.n).toBe(-13)
    expect(r.value).toBeCloseTo(4.49255371094, 11)

    const vm = toCalculatorViewModel(base({ mode: 'L16', raw: 0x8fc3, voutMode: { byte: 0x13 } }))
    expect(vm.valueText).toBe('4.49255371094')
    expect(vm.voutModeInfo?.hex).toBe('0x13')
    expect(vm.voutModeInfo?.linearExponent).toBe(-13)
    expect(vm.formulaText).toBe('V=36803 × 2^-13')
  })

  it('DIRECT raw=0x8FC3 with m=1, b=0, R=12 decodes to Y=-28733, value=-2.8733e-8', () => {
    const y = PMBusMath.toSigned(0x8fc3, 16)
    expect(y).toBe(-28733)
    const r = PMBusMath.decodeDirect(y, 1, 0, 12)
    expect(r.value).toBeCloseTo(-2.8733e-8, 16)

    const state = base({
      mode: 'DIRECT',
      raw: 0x8fc3,
      direct: { m: 1, b: 0, r: 12, errors: { m: null, b: null, r: null } },
    })
    const vm = toCalculatorViewModel(state)
    expect(vm.directY).toBe(-28733)
    expect(vm.valueText).toBe('-2.8733e-8')
    expect(vm.formulaText).toBe('X=(1/1)×((-28733)×10^(-12)-0)')

    const f = getFormulaPresentation(state, vm.valueText)
    expect(f.latex).toBe('X = \\frac{1}{1}\\left((-28733) \\times 10^{-12} - 0\\right)')
    expect(f.latex).not.toContain('10^{(-12)}')
    // The canonical equation repeats the symbolic relation, then the same
    // substitution, and ends in the canonical headline value.
    expect(f.equationLatex).toBe(
      'X = \\frac{1}{m}\\left(Y \\times 10^{-R} - b\\right) = \\frac{1}{1}\\left((-28733) \\times 10^{-12} - 0\\right) = -2.8733e-8',
    )
  })

  it('HALF raw=0x8FC3 decodes to sign=1, exponent=3, fraction=963, value≈-0.000473737716675', () => {
    const sign = (0x8fc3 >> 15) & 1
    const exponent = (0x8fc3 >> 10) & 0x1f
    const fraction = 0x8fc3 & 0x3ff
    expect(sign).toBe(1)
    expect(exponent).toBe(3)
    expect(fraction).toBe(963)

    const r = PMBusMath.decodeHalf(0x8fc3)
    expect(r.value).toBeCloseTo(-0.000473737716675, 15)

    const state = base({ mode: 'HALF', raw: 0x8fc3 })
    const vm = toCalculatorViewModel(state)
    expect(vm.valueText).toBe('-0.000473737716675')

    const f = getFormulaPresentation(state, vm.valueText)
    expect(f.plainText).toBe('HALF normal (-1)^{1}×2^(3-15)×(1+963/1024)=-0.000473737716675')
    // The first screen now ends in the final value; the sign exponent is
    // typeset at text style so the superscript stays readable.
    expect(f.equationLatex).toContain('(-1)^{\\textstyle 1}')
    expect(f.equationLatex).toContain('2^{3-15}')
    expect(f.equationLatex.endsWith('= -0.000473737716675')).toBe(true)
  })
})

describe('HALF boundary formula categories', () => {
  it('signed zeros keep their sign in the equation terminal', () => {
    const plusZeroState = base({ mode: 'HALF', raw: 0x0000 })
    const plusZero = getFormulaPresentation(
      plusZeroState,
      toCalculatorViewModel(plusZeroState).valueText,
    )
    expect(plusZero.equationLatex).toContain('= +0')

    const minusZeroState = base({ mode: 'HALF', raw: 0x8000 })
    const minusZero = getFormulaPresentation(
      minusZeroState,
      toCalculatorViewModel(minusZeroState).valueText,
    )
    expect(minusZero.equationLatex).toContain('= -0')
  })

  it('infinities terminate in their signed infinity', () => {
    const plusInfState = base({ mode: 'HALF', raw: 0x7c00 })
    const plusInf = getFormulaPresentation(
      plusInfState,
      toCalculatorViewModel(plusInfState).valueText,
    )
    expect(plusInf.equationLatex).toContain('= +\\infty')

    const minusInfState = base({ mode: 'HALF', raw: 0xfc00 })
    const minusInf = getFormulaPresentation(
      minusInfState,
      toCalculatorViewModel(minusInfState).valueText,
    )
    expect(minusInf.equationLatex).toContain('= -\\infty')
  })

  it('NaN keeps a single truthful terminal', () => {
    const state = base({ mode: 'HALF', raw: 0x7e00 })
    const f = getFormulaPresentation(state, toCalculatorViewModel(state).valueText)
    expect(f.equationLatex).toBe('X = \\text{NaN}')
  })

  it('subnormal exposes fraction and terminal value', () => {
    const state = base({ mode: 'HALF', raw: 0x0001 })
    const f = getFormulaPresentation(state, toCalculatorViewModel(state).valueText)
    expect(f.equationLatex).toContain('2^{-14}')
    expect(f.equationLatex).toContain('\\frac{1}{2^{10}}')
    expect(f.equationLatex.endsWith('= 5.96046447754e-8')).toBe(true)
  })

  it('max normal exposes exponent and fraction and ends in the value', () => {
    const state = base({ mode: 'HALF', raw: 0x7bff })
    const f = getFormulaPresentation(state, toCalculatorViewModel(state).valueText)
    expect(f.equationLatex).toContain('2^{30-15}')
    expect(f.equationLatex).toContain('\\frac{1023}{2^{10}}')
    expect(f.equationLatex.endsWith('= 65504')).toBe(true)
  })
})
