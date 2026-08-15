import { describe, it, expect } from 'vitest'
import { PMBusMath } from '../src/legacy/pmbus-math'
import { appReducer, INITIAL_STATE } from '../src/app/reducer'
import { toCalculatorViewModel } from '../src/app/view-model'

describe('HALF golden decode cases', () => {
  const cases = [
    { raw: 0x0000, value: 0, valueText: '0' },
    { raw: 0x8000, value: -0, valueText: '-0' },
    { raw: 0x0001, value: Math.pow(2, -24), valueText: '5.96046447754e-8' },
    { raw: 0x03ff, value: 1023 * Math.pow(2, -24), valueText: '0.0000609755516052' },
    { raw: 0x0400, value: Math.pow(2, -14), valueText: '0.00006103515625' },
    { raw: 0x3c00, value: 1, valueText: '1' },
    { raw: 0x7bff, value: 65504, valueText: '65504' },
    { raw: 0x7c00, value: Infinity, valueText: '+Infinity' },
    { raw: 0xfc00, value: -Infinity, valueText: '-Infinity' },
  ] as const

  for (const c of cases) {
    it(`raw=0x${c.raw.toString(16).toUpperCase().padStart(4, '0')} -> ${c.valueText}`, () => {
      const r = PMBusMath.decodeHalf(c.raw)
      if (Number.isNaN(c.value)) {
        expect(Number.isNaN(r.value)).toBe(true)
      } else if (!Number.isFinite(c.value)) {
        expect(r.value).toBe(c.value)
      } else {
        expect(r.value).toBeCloseTo(c.value, 15)
      }

      const vm = toCalculatorViewModel({ ...INITIAL_STATE, mode: 'HALF', raw: c.raw })
      expect(vm.valueText).toBe(c.valueText)
    })
  }

  it('NaN raw=0x7E00 decodes to NaN and displays NaN', () => {
    const r = PMBusMath.decodeHalf(0x7e00)
    expect(Number.isNaN(r.value)).toBe(true)
    const vm = toCalculatorViewModel({ ...INITIAL_STATE, mode: 'HALF', raw: 0x7e00 })
    expect(vm.valueText).toBe('NaN')
  })
})

describe('HALF golden encode cases (tie-to-even and boundaries)', () => {
  const cases = [
    { name: '0x0000 positive zero', value: 0, raw: 0x0000 },
    { name: '0x8000 negative zero', value: -0, raw: 0x8000 },
    { name: 'smallest subnormal 0x0001', value: Math.pow(2, -24), raw: 0x0001 },
    { name: 'largest subnormal 0x03FF', value: 1023 * Math.pow(2, -24), raw: 0x03ff },
    { name: 'smallest normal 0x0400', value: Math.pow(2, -14), raw: 0x0400 },
    { name: 'one 0x3C00', value: 1, raw: 0x3c00 },
    { name: 'max finite 0x7BFF', value: 65504, raw: 0x7bff },
    { name: 'overflow threshold -> +Infinity', value: 65520, raw: 0x7c00 },
    { name: 'NaN -> 0x7E00', value: NaN, raw: 0x7e00 },
    { name: 'tie-to-even 1 + 2^-11 -> 0x3C00', value: 1 + Math.pow(2, -11), raw: 0x3c00 },
    { name: 'tie-to-even 1 + 3×2^-11 -> 0x3C02', value: 1 + 3 * Math.pow(2, -11), raw: 0x3c02 },
    { name: 'subnormal half-ulp tie-to-even -> 0x0000', value: Math.pow(2, -25), raw: 0x0000 },
    { name: 'subnormal 1.5 ulp tie-to-even -> 0x0002', value: 3 * Math.pow(2, -25), raw: 0x0002 },
  ] as const

  for (const c of cases) {
    it(c.name, () => {
      expect(PMBusMath.encodeHalf(c.value)).toBe(c.raw)
    })
  }
})

describe('HALF reducer / view-model roundtrip', () => {
  const halfMode = appReducer(INITIAL_STATE, { type: 'mode/set', mode: 'HALF' })

  it('Hex -> Value', () => {
    const s = appReducer(halfMode, { type: 'raw/set-from-hex', hex: '3C00' })
    expect(toCalculatorViewModel(s).valueText).toBe('1')
  })

  it('Value -> raw -> Value', () => {
    const s = appReducer(halfMode, { type: 'value/set', value: '1' })
    expect(s.raw).toBe(0x3c00)
    expect(toCalculatorViewModel(s).valueText).toBe('1')
  })

  it('supports NaN and infinities as first-class values', () => {
    expect(appReducer(halfMode, { type: 'value/set', value: 'NaN' }).raw).toBe(0x7e00)
    expect(appReducer(halfMode, { type: 'value/set', value: 'Infinity' }).raw).toBe(0x7c00)
    expect(appReducer(halfMode, { type: 'value/set', value: '-Infinity' }).raw).toBe(0xfc00)
  })

  it('preserves -0 through raw and view-model', () => {
    const s = appReducer(halfMode, { type: 'value/set', value: '-0' })
    expect(s.raw).toBe(0x8000)
    expect(toCalculatorViewModel(s).valueText).toBe('-0')
  })
})
