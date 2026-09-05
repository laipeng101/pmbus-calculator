import { describe, it, expect } from 'vitest'
import { PMBusMath } from '../src/legacy/pmbus-math'
import { appReducer, INITIAL_STATE } from '../src/app/reducer'
import { toCalculatorViewModel } from '../src/app/view-model'
import {
  L11_DECODE_CASES,
  L11_ROUNDTRIP_CASES,
  L11_BOUNDARY_CODES,
} from './fixtures/linear11-cases'

describe('L11 golden decode cases', () => {
  for (const c of L11_DECODE_CASES) {
    it(c.name, () => {
      const r = PMBusMath.decodeLinear11(c.raw)
      expect(r.n).toBe(c.expected.n)
      expect(r.y).toBe(c.expected.y)
      expect(r.value).toBe(c.expected.value)
    })
  }
})

describe('L11 value -> raw roundtrip (auto-N)', () => {
  for (const c of L11_ROUNDTRIP_CASES) {
    it(c.name, () => {
      const state = appReducer(INITIAL_STATE, {
        type: 'value/set',
        value: String(c.inputValue),
      })
      expect(state.raw).toBe(c.expectedRaw)
      expect(state.l11.valueInput).toBe(c.inputValue)

      const decoded = PMBusMath.decodeLinear11(state.raw)
      expect(c.inputValue - decoded.value).toBe(c.expectedDelta)

      const vm = toCalculatorViewModel(state)
      expect(vm.deltaKind).toBe(c.expectedDelta === 0 ? 'ok' : 'warn')
      expect(vm.warnings.some((warning) => warning.id === 'l11-saturation')).toBe(false)
      if (c.expectedDelta !== 0) {
        const sign = c.expectedDelta > 0 ? '+' : ''
        expect(vm.deltaText).toContain(`${sign}${c.expectedDelta.toFixed(6)}`)
        return
      }
      // Exact roundtrip: relative error is 0.0000%; the zero request is the
      // zero-denominator case and must read '—', never a fabricated 0%.
      const expectedText = c.inputValue === 0 ? '+0.000000 (—)' : '+0.000000 (0.0000%)'
      expect(vm.deltaText).toBe(expectedText)
    })
  }
})

describe('L11 boundary codes and saturation', () => {
  for (const c of L11_BOUNDARY_CODES) {
    it(`${c.name} is a legal boundary code, never an overflow marker`, () => {
      const vm = toCalculatorViewModel({
        ...INITIAL_STATE,
        raw: c.raw,
      })
      expect(vm.warnings.find((w) => w.id.startsWith('special-'))).toBeUndefined()
      expect(vm.warnings.some((w) => w.id === 'l11-saturation')).toBe(false)
    })
  }

  it('saturation warning appears only when the requested physical value is out of range', () => {
    const max = PMBusMath.maxLinear11()
    const min = PMBusMath.minLinear11()

    const atMax = toCalculatorViewModel({
      ...INITIAL_STATE,
      raw: 0x7fff,
      l11: { ...INITIAL_STATE.l11, valueInput: max },
    })
    expect(atMax.warnings.some((w) => w.id === 'l11-saturation')).toBe(false)

    const over = toCalculatorViewModel({
      ...INITIAL_STATE,
      raw: 0x7fff,
      l11: { ...INITIAL_STATE.l11, valueInput: max + 1 },
    })
    expect(over.warnings.some((w) => w.id === 'l11-saturation')).toBe(true)

    const under = toCalculatorViewModel({
      ...INITIAL_STATE,
      raw: 0xffff,
      l11: { ...INITIAL_STATE.l11, valueInput: min - 1 },
    })
    expect(under.warnings.some((w) => w.id === 'l11-saturation')).toBe(true)
  })
})
