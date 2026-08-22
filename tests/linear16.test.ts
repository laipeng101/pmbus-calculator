import { describe, it, expect } from 'vitest'
import { PMBusMath } from '../src/legacy/pmbus-math'
import { appReducer, INITIAL_STATE } from '../src/app/reducer'
import { toCalculatorViewModel } from '../src/app/view-model'

describe('L16 golden decode cases', () => {
  const cases = [
    { raw: 0x0000, n: -8, value: 0, valueText: '0' },
    { raw: 0x0001, n: -8, value: 1 / 256, valueText: '0.00390625' },
    { raw: 0x0c00, n: -8, value: 12, valueText: '12' },
    { raw: 0x0c80, n: -8, value: 12.5, valueText: '12.5' },
    { raw: 0xffff, n: -8, value: 255.99609375, valueText: '255.99609375' },
  ] as const

  for (const c of cases) {
    it(`raw=0x${c.raw.toString(16).toUpperCase().padStart(4, '0')}, N=${c.n} -> ${c.valueText}`, () => {
      const r = PMBusMath.decodeLinear16(c.raw, c.n)
      expect(r.v).toBe(c.raw)
      expect(r.value).toBeCloseTo(c.value, 12)

      const vm = toCalculatorViewModel({
        ...INITIAL_STATE,
        mode: 'L16',
        raw: c.raw,
        l16: { n: c.n, voutMode: 0x18 },
      })
      expect(vm.valueText).toBe(c.valueText)
    })
  }
})

describe('L16 golden encode cases', () => {
  it('Value -> raw with N=-8', () => {
    const s = appReducer(
      { ...INITIAL_STATE, mode: 'L16', l16: { n: -8, voutMode: 0x18 } },
      { type: 'value/set', value: '12' },
    )
    expect(s.raw).toBe(0x0c00)
  })

  it('fractional Value -> raw with N=-8', () => {
    const s = appReducer(
      { ...INITIAL_STATE, mode: 'L16', l16: { n: -8, voutMode: 0x18 } },
      { type: 'value/set', value: '12.5' },
    )
    expect(s.raw).toBe(0x0c80)
  })

  it('clamps Value to 0..65535 range', () => {
    const base = { ...INITIAL_STATE, mode: 'L16' as const, l16: { n: -8, voutMode: 0x18 } }
    expect(appReducer(base, { type: 'value/set', value: '-1' }).raw).toBe(0)
    expect(appReducer(base, { type: 'value/set', value: '999999' }).raw).toBe(0xffff)
  })

  it('VOUT_MODE 0x18 -> N=-8 and 0x17 -> N=-9', () => {
    expect(PMBusMath.parseVoutMode(0x18).linearExponent).toBe(-8)
    expect(PMBusMath.parseVoutMode(0x17).linearExponent).toBe(-9)
  })
})
