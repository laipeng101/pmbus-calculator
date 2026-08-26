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
        l16: { voutMode: 0x18 },
      })
      expect(vm.valueText).toBe(c.valueText)
    })
  }
})

describe('L16 golden encode cases', () => {
  it('Value -> raw with N=-8', () => {
    const s = appReducer(
      { ...INITIAL_STATE, mode: 'L16', l16: { voutMode: 0x18 } },
      { type: 'value/set', value: '12' },
    )
    expect(s.raw).toBe(0x0c00)
  })

  it('fractional Value -> raw with N=-8', () => {
    const s = appReducer(
      { ...INITIAL_STATE, mode: 'L16', l16: { voutMode: 0x18 } },
      { type: 'value/set', value: '12.5' },
    )
    expect(s.raw).toBe(0x0c80)
  })

  it('clamps Value to 0..65535 range', () => {
    const base = { ...INITIAL_STATE, mode: 'L16' as const, l16: { voutMode: 0x18 } }
    expect(appReducer(base, { type: 'value/set', value: '-1' }).raw).toBe(0)
    expect(appReducer(base, { type: 'value/set', value: '999999' }).raw).toBe(0xffff)
  })

  it('VOUT_MODE 0x18 -> N=-8 and 0x17 -> N=-9', () => {
    expect(PMBusMath.parseVoutMode(0x18).linearExponent).toBe(-8)
    expect(PMBusMath.parseVoutMode(0x17).linearExponent).toBe(-9)
  })
})

describe('VOUT_MODE bit layout (PMBus Part II §8.3)', () => {
  const cases = [
    { byte: 0x18, mode: 0, modeName: 'LINEAR', isRelative: false, param: 0x18, n: -8 },
    { byte: 0x98, mode: 0, modeName: 'LINEAR', isRelative: true, param: 0x18, n: -8 },
    { byte: 0x20, mode: 1, modeName: 'VID', isRelative: false, param: 0, n: null },
    { byte: 0x40, mode: 2, modeName: 'DIRECT', isRelative: false, param: 0, n: null },
    {
      byte: 0x60,
      mode: 3,
      modeName: 'IEEE Half Float',
      isRelative: false,
      param: 0,
      n: 'IEEE Half',
    },
    {
      byte: 0xe0,
      mode: 3,
      modeName: 'IEEE Half Float',
      isRelative: true,
      param: 0,
      n: 'IEEE Half',
    },
  ] as const

  for (const c of cases) {
    it(`0x${c.byte.toString(16).toUpperCase().padStart(2, '0')} -> mode=${c.mode} relative=${c.isRelative}`, () => {
      const parsed = PMBusMath.parseVoutMode(c.byte)
      expect(parsed.mode).toBe(c.mode)
      expect(parsed.modeName).toBe(c.modeName)
      expect(parsed.isRelative).toBe(c.isRelative)
      expect(parsed.param).toBe(c.param)
      expect(parsed.linearExponent).toBe(c.n)
    })
  }

  it('non-absolute-LINEAR VOUT_MODE must not produce a fake LINEAR16 value in the view model', () => {
    for (const voutMode of [0x98, 0x20, 0x40, 0x60, 0xe0]) {
      const vm = toCalculatorViewModel({
        ...INITIAL_STATE,
        mode: 'L16',
        raw: 0x0c00,
        l16: { voutMode },
      })
      expect(vm.valueText, `0x${voutMode.toString(16)}`).toBe('—')
    }
  })

  it('0x18 (absolute LINEAR) still computes a voltage', () => {
    const vm = toCalculatorViewModel({
      ...INITIAL_STATE,
      mode: 'L16',
      raw: 0x0c00,
      l16: { voutMode: 0x18 },
    })
    expect(vm.valueText).toBe('12')
  })
})
