import { describe, it, expect } from 'vitest'
import { PMBusMath } from '../src/legacy/pmbus-math'
import { appReducer, INITIAL_STATE } from '../src/app/reducer'
import { toCalculatorViewModel } from '../src/app/view-model'

const L11_DECODE_CASES = [
  { name: 'zero', raw: 0x0000, expected: { n: 0, y: 0, value: 0 } },
  { name: 'positive Y=1 N=0', raw: 0x0001, expected: { n: 0, y: 1, value: 1 } },
  { name: 'positive Y=1 N=1', raw: 0x0801, expected: { n: 1, y: 1, value: 2 } },
  { name: 'positive Y=1 N=-1', raw: 0xf801, expected: { n: -1, y: 1, value: 0.5 } },
  { name: 'max positive Y', raw: 0x03ff, expected: { n: 0, y: 1023, value: 1023 } },
  { name: 'max negative Y', raw: 0x0400, expected: { n: 0, y: -1024, value: -1024 } },
  { name: 'max N=15', raw: 0x7801, expected: { n: 15, y: 1, value: 32768 } },
  { name: 'min N=-16', raw: 0x8001, expected: { n: -16, y: 1, value: 1 / 65536 } },
  { name: 'negative value', raw: 0xfffe, expected: { n: -1, y: -2, value: -1 } },
]

const L11_ROUNDTRIP_CASES = [
  { name: 'integer 1', inputValue: 1, expectedRaw: 0x0001, expectedDelta: 0 },
  { name: 'integer 2', inputValue: 2, expectedRaw: 0x0002, expectedDelta: 0 },
  { name: 'integer 10', inputValue: 10, expectedRaw: 0x000a, expectedDelta: 0 },
  { name: 'fraction 0.5', inputValue: 0.5, expectedRaw: 0xf801, expectedDelta: 0 },
  { name: 'fraction 0.25', inputValue: 0.25, expectedRaw: 0xf001, expectedDelta: 0 },
  { name: 'large 1000', inputValue: 1000, expectedRaw: 0x03e8, expectedDelta: 0 },
  { name: 'negative -1', inputValue: -1, expectedRaw: 0x07ff, expectedDelta: 0 },
  { name: 'negative -10', inputValue: -10, expectedRaw: 0x07f6, expectedDelta: 0 },
  { name: 'zero', inputValue: 0, expectedRaw: 0x0000, expectedDelta: 0 },
  {
    name: 'positive boundary tie prefers N=0',
    inputValue: 1023.5,
    expectedRaw: 0x03ff,
    expectedDelta: 0.5,
  },
  {
    name: 'negative boundary tie prefers N=0',
    inputValue: -1025,
    expectedRaw: 0x0400,
    expectedDelta: -1,
  },
]

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
