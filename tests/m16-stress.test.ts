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
    expect(vm.rawBytesLE).toBe('0x C1 A3')
    expect(vm.rawBytesBE).toBe('0x A3 C1')
    expect(vm.formulaText).toBe('Y=961 × 2^-12')
    expect(buildCMacro(null, vm.rawWordHex, vm.formulaText)).toBe(
      '#define RAW_VALUE 0xA3C1 /* Y=961 × 2^-12 */',
    )
    expect(getFormulaPresentation(base({ mode: 'L11', raw: 0xa3c1 })).detailLines).toEqual([
      {
        kind: 'expansion',
        plainText: 'Y=961 × 2^-12',
        latex: 'X = Y \\times 2^N = 961 \\times 2^{-12}',
      },
    ])
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

    const vm = toCalculatorViewModel(
      base({
        mode: 'DIRECT',
        raw: 0x8fc3,
        direct: { m: 1, b: 0, r: 12, errors: { m: null, b: null, r: null } },
      }),
    )
    expect(vm.directY).toBe(-28733)
    expect(vm.valueText).toBe('-2.8733e-8')
    expect(vm.formulaText).toBe('X=(1/1)×((-28733)×10^(-12)-0)')

    const f = getFormulaPresentation(
      base({
        mode: 'DIRECT',
        raw: 0x8fc3,
        direct: { m: 1, b: 0, r: 12, errors: { m: null, b: null, r: null } },
      }),
    )
    expect(f.latex).toBe('X = \\frac{1}{1}\\left((-28733) \\times 10^{-12} - 0\\right)')
    expect(f.latex).not.toContain('10^{(-12)}')
    expect(f.detailLines[0]?.latex).toBe(f.latex)
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

    const vm = toCalculatorViewModel(base({ mode: 'HALF', raw: 0x8fc3 }))
    expect(vm.valueText).toBe('-0.000473737716675')

    const f = getFormulaPresentation(base({ mode: 'HALF', raw: 0x8fc3 }))
    expect(f.plainText).toBe('HALF normal (-1)^{1}×2^(3-15)×(1+963/1024)=-0.000473737716675')
    expect(f.detailLines).toEqual([
      {
        kind: 'summary',
        plainText: 's = 1, E = 3, F = 963',
        latex: 's = 1,\\ E = 3,\\ F = 963',
      },
      {
        kind: 'expansion',
        plainText: 'X = (-1)^{1} × 2^(3-15) × (1 + 963/1024)',
        latex: 'X = (-1)^{1} \\times 2^{3-15} \\times \\left(1 + \\frac{963}{2^{10}}\\right)',
      },
    ])
    // Headline already displays the final value; the expansion must not repeat it.
    expect(f.detailLines[1]?.latex).not.toContain('-0.000473737716675')
  })
})

describe('HALF boundary formula categories', () => {
  const cases = [
    { raw: 0x0000, kind: 'summary', plainText: 's = 0, E = 0, F = 0' },
    { raw: 0x8000, kind: 'summary', plainText: 's = 1, E = 0, F = 0' },
    { raw: 0x0001, kind: 'summary', plainText: 's = 0, E = 0, F = 1' },
    { raw: 0x7bff, kind: 'summary', plainText: 's = 0, E = 30, F = 1023' },
    { raw: 0x7c00, kind: 'summary', plainText: 's = 0, E = 31, F = 0' },
    { raw: 0xfc00, kind: 'summary', plainText: 's = 1, E = 31, F = 0' },
    { raw: 0x7e00, kind: 'summary', plainText: 'E = 31, F = 512' },
  ]

  for (const c of cases) {
    it(`0x${c.raw.toString(16).toUpperCase().padStart(4, '0')} category`, () => {
      const f = getFormulaPresentation(base({ mode: 'HALF', raw: c.raw }))
      const summary = f.detailLines.find((line) => line.kind === 'summary')
      expect(summary?.plainText).toBe(c.plainText)
    })
  }

  it('zero/subnormal/infinity/NaN expansions keep their own semantics', () => {
    const plusZero = getFormulaPresentation(base({ mode: 'HALF', raw: 0x0000 }))
    expect(plusZero.detailLines[1]?.latex).toBe('X = (-1)^{0} \\times 0 = +0')

    const subnormal = getFormulaPresentation(base({ mode: 'HALF', raw: 0x0001 }))
    expect(subnormal.detailLines[1]?.latex).toBe(
      'X = (-1)^{0} \\times 2^{-14} \\times \\frac{1}{2^{10}}',
    )

    const plusInf = getFormulaPresentation(base({ mode: 'HALF', raw: 0x7c00 }))
    expect(plusInf.detailLines[1]?.latex).toBe('X = (-1)^{0} \\times \\infty = +\\infty')

    const nan = getFormulaPresentation(base({ mode: 'HALF', raw: 0x7e00 }))
    expect(nan.detailLines[1]?.latex).toBe('X = \\text{NaN}')
  })
})
