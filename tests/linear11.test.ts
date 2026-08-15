import { describe, it, expect } from 'vitest'
import { PMBusMath } from '../src/legacy/pmbus-math'
import { appReducer, INITIAL_STATE } from '../src/app/reducer'
import { toCalculatorViewModel } from '../src/app/view-model'
import { L11_DECODE_CASES, L11_ROUNDTRIP_CASES, L11_SPECIAL_CASES } from './fixtures/linear11-cases'

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
      expect(decoded.value).toBeCloseTo(c.inputValue, 10)

      const vm = toCalculatorViewModel(state)
      expect(vm.deltaKind).toBe('ok')
      expect(vm.deltaText).toBe('+0.000000 (0.0000%)')
    })
  }
})

describe('L11 special-value warnings', () => {
  for (const c of L11_SPECIAL_CASES) {
    it(c.name, () => {
      const vm = toCalculatorViewModel({
        ...INITIAL_STATE,
        raw: c.raw,
      })
      const warning = vm.warnings.find((w) => w.id.startsWith('special-'))
      expect(warning).toBeDefined()
      if (c.expectedWarningType === 'overflow') {
        expect(warning?.level).toBe('warning')
      } else {
        expect(warning?.level).toBe('info')
      }
    })
  }
})
