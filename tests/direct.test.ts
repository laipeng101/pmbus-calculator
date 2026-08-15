import { describe, it, expect } from 'vitest'
import { PMBusMath } from '../src/legacy/pmbus-math'
import { appReducer, INITIAL_STATE } from '../src/app/reducer'
import { toCalculatorViewModel } from '../src/app/view-model'
import type { AppState } from '../src/app/state'

function directState(overrides: Partial<AppState> = {}): AppState {
  return {
    ...INITIAL_STATE,
    mode: 'DIRECT',
    ...overrides,
  }
}

describe('DIRECT golden decode cases (raw is the single source of truth)', () => {
  const cases = [
    { raw: 0x0000, y: 0, value: 0 },
    { raw: 0x0001, y: 1, value: 1 },
    { raw: 0x7fff, y: 32767, value: 32767 },
    { raw: 0x8000, y: -32768, value: -32768 },
    { raw: 0xffff, y: -1, value: -1 },
  ] as const

  for (const c of cases) {
    it(`raw=0x${c.raw.toString(16).toUpperCase().padStart(4, '0')} -> Y=${c.y}, Value=${c.value}`, () => {
      const y = PMBusMath.toSigned(c.raw, 16)
      expect(y).toBe(c.y)

      const vm = toCalculatorViewModel(directState({ raw: c.raw }))
      expect(vm.directY).toBe(c.y)
      expect(vm.valueText).toBe(String(c.value))
    })
  }
})

describe('DIRECT coefficient boundaries', () => {
  it('m/b accept signed 16-bit boundaries, R accepts signed 8-bit boundaries', () => {
    for (const v of [-32768, 32767]) {
      expect(
        appReducer(INITIAL_STATE, { type: 'direct/set-coeff', name: 'm', value: String(v) }).direct
          .m,
      ).toBe(v)
      expect(
        appReducer(INITIAL_STATE, { type: 'direct/set-coeff', name: 'b', value: String(v) }).direct
          .b,
      ).toBe(v)
    }
    for (const v of [-128, 127]) {
      expect(
        appReducer(INITIAL_STATE, { type: 'direct/set-coeff', name: 'r', value: String(v) }).direct
          .r,
      ).toBe(v)
    }
  })

  it('rejects float and out-of-range coefficients with an explicit error', () => {
    expect(
      appReducer(INITIAL_STATE, { type: 'direct/set-coeff', name: 'm', value: '1.5' }).direct.error,
    ).toContain('M 必须是')
    expect(
      appReducer(INITIAL_STATE, { type: 'direct/set-coeff', name: 'm', value: '32768' }).direct
        .error,
    ).toContain('M 必须是')
    expect(
      appReducer(INITIAL_STATE, { type: 'direct/set-coeff', name: 'r', value: '128' }).direct.error,
    ).toContain('R 必须是')
  })

  it('m=0 decodes to NaN and surfaces an error warning', () => {
    const r = PMBusMath.decodeDirect(1, 0, 0, 0)
    expect(Number.isNaN(r.value)).toBe(true)

    const vm = toCalculatorViewModel(directState({ direct: { m: 0, b: 0, r: 0, error: null } }))
    expect(vm.valueText).toBe('—')
    expect(vm.warnings.some((w) => w.id === 'direct-m-zero')).toBe(true)
  })
})

describe('DIRECT bidirectional sync', () => {
  it('Hex -> signed Y / Value', () => {
    const s = appReducer(directState(), { type: 'raw/set-from-hex', hex: '8000' })
    expect(s.raw).toBe(0x8000)
    const vm = toCalculatorViewModel(s)
    expect(vm.directY).toBe(-32768)
    expect(vm.valueText).toBe('-32768')
  })

  it('Y -> raw with clamp', () => {
    expect(appReducer(directState(), { type: 'direct/set-y', y: '32767' }).raw).toBe(0x7fff)
    expect(appReducer(directState(), { type: 'direct/set-y', y: '-32768' }).raw).toBe(0x8000)
    expect(appReducer(directState(), { type: 'direct/set-y', y: '99999' }).raw).toBe(0x7fff)
    expect(appReducer(directState(), { type: 'direct/set-y', y: '-99999' }).raw).toBe(0x8000)
  })

  it('Value -> raw -> Value with legacy Math.round behavior', () => {
    const s = appReducer(directState(), { type: 'value/set', value: '12.5' })
    expect(s.raw).toBe(13) // legacy round-to-nearest-ties-up on Math.round
    expect(toCalculatorViewModel(s).valueText).toBe('13')

    const neg = appReducer(directState(), { type: 'value/set', value: '-5' })
    expect(neg.raw).toBe(0xfffb) // -5 signed 16-bit
    expect(toCalculatorViewModel(neg).valueText).toBe('-5')
  })

  it('bit toggle updates raw and derived Y/Value', () => {
    const s = appReducer(directState(), { type: 'bit/toggle', bit: 15 })
    expect(s.raw).toBe(0x0001)
    const vm = toCalculatorViewModel(s)
    expect(vm.directY).toBe(1)
    expect(vm.valueText).toBe('1')
  })

  it('raw/set clamps 0..65535 without wrapping', () => {
    expect(appReducer(directState(), { type: 'raw/set', raw: 0x1f0f0 }).raw).toBe(65535)
    expect(appReducer(directState(), { type: 'raw/set', raw: -1 }).raw).toBe(0)
  })
})
