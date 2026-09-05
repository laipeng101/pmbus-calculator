import { describe, expect, it } from 'vitest'
import { getFormulaPresentation } from './formula-presentation'
import { buildCalculationSteps } from './calculation-steps'
import { toCalculatorViewModel } from './view-model'
import { formatPlainNumber, formatPlainNumberLatex, formatSpecial } from './numeric-presentation'
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

interface PresentationVector {
  name: string
  s: AppState
  expectedValueText: string
  /** Formula plainText embeds the decoded value text (in addition to the steps). */
  formulaEmbedsValue?: 'suffix' | 'timesR'
}

/**
 * Characterization vectors across every plain-number value class the three
 * presentation surfaces (result view-model, formula plain text, calculation
 * steps) render today: NaN / ±Infinity / ±0, integers, plain non-integers,
 * 12-significant-digit folding, extreme finite small/large values, DIRECT
 * exponent results and L11/L16 exact / quantized requests.
 */
const VECTORS: PresentationVector[] = [
  // HALF — the only mode whose decode yields specials.
  { name: 'HALF NaN (0x7e00)', s: state({ mode: 'HALF', raw: 0x7e00 }), expectedValueText: 'NaN' },
  {
    name: 'HALF +Infinity (0x7c00)',
    s: state({ mode: 'HALF', raw: 0x7c00 }),
    expectedValueText: '+Infinity',
  },
  {
    name: 'HALF -Infinity (0xfc00)',
    s: state({ mode: 'HALF', raw: 0xfc00 }),
    expectedValueText: '-Infinity',
  },
  // The result text for +0 is '0'; the formula line spells the sign bit as
  // '+0' by construction — that label is not part of the numeric policy.
  { name: 'HALF +0 (0x0000)', s: state({ mode: 'HALF', raw: 0x0000 }), expectedValueText: '0' },
  { name: 'HALF -0 (0x8000)', s: state({ mode: 'HALF', raw: 0x8000 }), expectedValueText: '-0' },
  {
    name: 'HALF subnormal (0x0001)',
    s: state({ mode: 'HALF', raw: 0x0001 }),
    expectedValueText: '5.96046447754e-8',
    formulaEmbedsValue: 'suffix',
  },
  {
    name: 'HALF 12-significant-digit normal (0x8fc3)',
    s: state({ mode: 'HALF', raw: 0x8fc3 }),
    expectedValueText: '-0.000473737716675',
    formulaEmbedsValue: 'suffix',
  },
  {
    name: 'HALF max normal integer (0x7bff)',
    s: state({ mode: 'HALF', raw: 0x7bff }),
    expectedValueText: '65504',
    formulaEmbedsValue: 'suffix',
  },
  {
    name: 'HALF normal fraction (0x3bff)',
    s: state({ mode: 'HALF', raw: 0x3bff }),
    expectedValueText: '0.99951171875',
    formulaEmbedsValue: 'suffix',
  },
  // LINEAR11 — exact, negative, precision-folded and extreme finite values.
  { name: 'L11 integer (0x000c)', s: state({ mode: 'L11', raw: 0x000c }), expectedValueText: '12' },
  {
    name: 'L11 non-integer (0xf819)',
    s: state({ mode: 'L11', raw: 0xf819 }),
    expectedValueText: '12.5',
  },
  {
    name: 'L11 negative integer (0xffe0)',
    s: state({ mode: 'L11', raw: 0xffe0 }),
    expectedValueText: '-16',
  },
  {
    name: 'L11 12-significant-digit small value (0x8bff)',
    s: state({ mode: 'L11', raw: 0x8bff }),
    expectedValueText: '0.0312194824219',
  },
  {
    name: 'L11 extreme large integer (0x7bff)',
    s: state({ mode: 'L11', raw: 0x7bff }),
    expectedValueText: '33521664',
  },
  {
    name: 'L11 quantized request (locked N=-8, request 1.005)',
    s: state({ mode: 'L11', raw: 0xc101, l11: { n: -8, y: 257, autoN: false, valueInput: 1.005 } }),
    expectedValueText: '1.00390625',
  },
  // LINEAR16 — absolute, quantized, relative (finite + overflow) and offset.
  {
    name: 'L16 absolute (0xc000 @ 0x18)',
    s: state({ mode: 'L16', raw: 0xc000, voutMode: { byte: 0x18 } }),
    expectedValueText: '192',
  },
  {
    name: 'L16 absolute fraction (0x3c05 @ 0x18)',
    s: state({ mode: 'L16', raw: 0x3c05, voutMode: { byte: 0x18 } }),
    expectedValueText: '60.01953125',
  },
  {
    name: 'L16 quantized request (raw 0x0001 @ 0x18, request 0.005)',
    s: state({
      mode: 'L16',
      raw: 0x0001,
      voutMode: { byte: 0x18 },
      valueRequest: { mode: 'L16', value: 0.005 },
    }),
    expectedValueText: '0.00390625',
  },
  {
    name: 'L16 relative finite derivation (nominal 12)',
    s: state({
      mode: 'L16',
      raw: 0x0100,
      voutMode: { byte: 0x98 },
      l16: { payloadKind: 'ulinear16', nominalVout: 12 },
    }),
    expectedValueText: '12',
    formulaEmbedsValue: 'timesR',
  },
  {
    name: 'L16 relative overflow (nominal 1e308)',
    s: state({
      mode: 'L16',
      raw: 0x0200,
      voutMode: { byte: 0x98 },
      l16: { payloadKind: 'ulinear16', nominalVout: 1e308 },
    }),
    expectedValueText: '—',
  },
  {
    name: 'L16 SLINEAR16 offset (raw 0x0100 @ 0x18)',
    s: state({
      mode: 'L16',
      raw: 0x0100,
      voutMode: { byte: 0x18 },
      l16: { payloadKind: 'slinear16-offset', nominalVout: null },
    }),
    expectedValueText: '1',
  },
  // DIRECT — plain decimals, exponents and the precision-folded extreme.
  {
    name: 'DIRECT decimal (m=2, b=3, R=-1)',
    s: state({
      mode: 'DIRECT',
      raw: 0x000a,
      direct: { m: 2, b: 3, r: -1, errors: { m: null, b: null, r: null } },
    }),
    expectedValueText: '48.5',
  },
  {
    name: 'DIRECT negative exponent result (m=1, b=0, R=12)',
    s: state({
      mode: 'DIRECT',
      raw: 0x8fc3,
      direct: { m: 1, b: 0, r: 12, errors: { m: null, b: null, r: null } },
    }),
    expectedValueText: '-2.8733e-8',
  },
  {
    name: 'DIRECT extreme large finite (m=1, b=0, R=-128)',
    s: state({
      mode: 'DIRECT',
      raw: 0x0001,
      direct: { m: 1, b: 0, r: -128, errors: { m: null, b: null, r: null } },
    }),
    expectedValueText: '1e+128',
  },
  {
    name: 'DIRECT extreme small finite (m=1, b=0, R=128)',
    s: state({
      mode: 'DIRECT',
      raw: 0x0001,
      direct: { m: 1, b: 0, r: 128, errors: { m: null, b: null, r: null } },
    }),
    expectedValueText: '1e-128',
  },
  {
    name: 'DIRECT precision-folded raw (m=1, b=1, R=17)',
    s: state({
      mode: 'DIRECT',
      raw: 0xffff,
      direct: { m: 1, b: 1, r: 17, errors: { m: null, b: null, r: null } },
    }),
    expectedValueText: '-1',
  },
]

function resultStepOf(s: AppState) {
  return buildCalculationSteps(s).find((step) => step.kind === 'result')
}

describe('plain-number presentation — cross-surface characterization', () => {
  it('renders the same numeric text on the result card and the result step for every value class', () => {
    for (const vector of VECTORS) {
      const vm = toCalculatorViewModel(vector.s)
      const result = resultStepOf(vector.s)
      expect(result, vector.name).toBeDefined()
      expect(vm.valueText, vector.name).toBe(vector.expectedValueText)
      expect(result?.value, vector.name).toBe(vector.expectedValueText)
    }
  })

  it('keeps the formula plain text numerically identical where it embeds the decoded value', () => {
    for (const vector of VECTORS) {
      if (!vector.formulaEmbedsValue) continue
      const vm = toCalculatorViewModel(vector.s)
      const formula = getFormulaPresentation(vector.s)
      if (vector.formulaEmbedsValue === 'suffix') {
        expect(formula.plainText, vector.name).toContain(`=${vm.valueText}`)
      } else {
        expect(formula.plainText, vector.name).toContain(`×R=${vm.valueText} V`)
      }
    }
  })

  it('shows the shared relative-voltage fail-closed marker on all three surfaces', () => {
    const overflow = VECTORS.find((v) => v.name === 'L16 relative overflow (nominal 1e308)')
    expect(overflow).toBeDefined()
    const vm = toCalculatorViewModel(overflow!.s)
    const formula = getFormulaPresentation(overflow!.s)
    const result = resultStepOf(overflow!.s)
    expect(vm.valueText).toBe('—')
    expect(result?.value).toBe('—')
    expect(formula.plainText).toContain('=—（计算结果超出 JavaScript Number 可表示范围）')
  })

  it('formats the quantization error with the same plain-number policy as the result', () => {
    const l16 = toCalculatorViewModel(
      state({
        mode: 'L16',
        raw: 0x0001,
        voutMode: { byte: 0x18 },
        valueRequest: { mode: 'L16', value: 0.005 },
      }),
    )
    const l16Quant = l16.steps.find((step) => step.id.endsWith('-quantization'))
    expect(l16Quant?.plainText).toBe('格式编码量化误差（请求值 − 表示值） = 0.00109375')

    const l11 = toCalculatorViewModel(
      state({ mode: 'L11', raw: 0xc101, l11: { n: -8, y: 257, autoN: false, valueInput: 1.005 } }),
    )
    const l11Quant = l11.steps.find((step) => step.id.endsWith('-quantization'))
    expect(l11Quant?.plainText).toBe('格式编码量化误差（请求值 − 表示值） = 0.00109375')
  })

  it('keeps the DIRECT precision-fold surfaces numerically consistent', () => {
    const folded = state({
      mode: 'DIRECT',
      raw: 0xffff,
      direct: { m: 1, b: 1, r: 17, errors: { m: null, b: null, r: null } },
    })
    const vm = toCalculatorViewModel(folded)
    const steps = buildCalculationSteps(folded)
    const exactRational = steps.find((step) => step.id === 'direct-exact-value')
    const exactDecimal = steps.find((step) => step.id === 'direct-exact-decimal')
    // The binary64 approximation, the result card and the result step agree;
    // the exact rational/decimal lines carry the truth the fold cannot show.
    expect(vm.directFidelity?.approxValueText).toBe(vm.valueText)
    expect(vm.directFidelity?.exactFractionText).toBe('-100000000000000001/100000000000000000')
    expect(exactRational?.value).toBe('-100000000000000001/100000000000000000')
    expect(exactDecimal?.value).toBe('-1.00000000000000001')
  })
})

describe('plain-number policy — canonical contracts', () => {
  it('formatPlainNumber renders every finite class with 12-significant-digit folding', () => {
    expect(formatPlainNumber(0)).toBe('0')
    expect(formatPlainNumber(-0)).toBe('-0')
    expect(formatPlainNumber(12)).toBe('12')
    expect(formatPlainNumber(-16)).toBe('-16')
    expect(formatPlainNumber(12.5)).toBe('12.5')
    expect(formatPlainNumber(0.99951171875)).toBe('0.99951171875')
    expect(formatPlainNumber(0.031219482421875)).toBe('0.0312194824219')
    expect(formatPlainNumber(-0.031219482421875)).toBe('-0.0312194824219')
    expect(formatPlainNumber(1e128)).toBe('1e+128')
    expect(formatPlainNumber(1e-128)).toBe('1e-128')
    expect(formatPlainNumber(5e-324)).toBe('5e-324')
    // Number.MAX_VALUE is mathematically an integer, so the integer branch
    // prints it via toString, not the 12-significant-digit fold.
    expect(formatPlainNumber(Number.MAX_VALUE)).toBe('1.7976931348623157e+308')
    expect(formatPlainNumber(1 / 3)).toBe('0.333333333333')
    expect(formatPlainNumber(0.1 + 0.2)).toBe('0.3')
    expect(formatPlainNumber(Math.PI)).toBe('3.14159265359')
  })

  it('formatPlainNumber owns the special-value text the finite classes compose with', () => {
    expect(formatPlainNumber(NaN)).toBe('NaN')
    expect(formatPlainNumber(Infinity)).toBe('+Infinity')
    expect(formatPlainNumber(-Infinity)).toBe('-Infinity')
  })

  it('formatPlainNumberLatex wraps only the specials, never re-typesets finite numbers', () => {
    expect(formatPlainNumberLatex(NaN)).toBe('\\text{NaN}')
    expect(formatPlainNumberLatex(Infinity)).toBe('+\\infty')
    expect(formatPlainNumberLatex(-Infinity)).toBe('-\\infty')
    // Finite values share the plain policy verbatim (including -0).
    expect(formatPlainNumberLatex(-0)).toBe('-0')
    expect(formatPlainNumberLatex(0)).toBe('0')
    expect(formatPlainNumberLatex(12)).toBe('12')
    expect(formatPlainNumberLatex(0.031219482421875)).toBe('0.0312194824219')
  })

  it('formatSpecial keeps the sign-explicit endpoint text for the quantization readout', () => {
    expect(formatSpecial(NaN)).toBe('NaN')
    expect(formatSpecial(Infinity)).toBe('+Infinity')
    expect(formatSpecial(-Infinity)).toBe('-Infinity')
    expect(formatSpecial(-0)).toBe('-0')
    expect(formatSpecial(0)).toBe('+0')
  })
})
