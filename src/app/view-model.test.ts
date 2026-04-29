import { describe, test, expect } from 'vitest'
import { toCalculatorViewModel } from './view-model'
import type { AppState } from './state'

const BASE: AppState = {
  mode: 'L11',
  raw: 0,
  commandKey: null,
  byteOrder: 'le',
  l11: { n: 0, y: 0, autoN: true },
  l16: { n: -8, voutMode: 0x18 },
  direct: { y: 0, m: 1, b: 0, r: 0 },
  copy: { prefix0x: true, spaceBetweenBytes: true, endian: 'le' },
  ui: { theme: 'system', focusedField: null, debugOpen: false },
}

function make(overrides: Partial<AppState> = {}): AppState {
  return { ...BASE, ...overrides }
}

describe('toCalculatorViewModel', () => {
  describe('mode=L11', () => {
    test('raw=0 produces value 0', () => {
      const vm = toCalculatorViewModel(BASE)
      expect(vm.valueText).toBe('0')
      expect(vm.formulaText).toBe('Y=0 × 2^0')
      expect(vm.rawHex).toBe('0x0000')
    })

    test('raw=0x0001 produces value 1', () => {
      const vm = toCalculatorViewModel(make({ raw: 0x0001 }))
      expect(vm.valueText).toBe('1')
    })

    test('raw=0x0801 produces value 2 (N=1, Y=1)', () => {
      const vm = toCalculatorViewModel(make({ raw: 0x0801 }))
      expect(vm.valueText).toBe('2')
    })
  })

  describe('mode=L16', () => {
    test('raw=0 with default n=-8 produces value 0', () => {
      const vm = toCalculatorViewModel(make({ mode: 'L16' }))
      expect(vm.valueText).toBe('0')
      expect(vm.formulaText).toBe('V=0 × 2^-8')
    })

    test('raw=0x0C00 produces value 12', () => {
      const vm = toCalculatorViewModel(make({ mode: 'L16', raw: 0x0c00 }))
      expect(vm.valueText).toBe('12')
    })
  })

  describe('mode=DIRECT', () => {
    test('default coefficients produce value 0', () => {
      const vm = toCalculatorViewModel(make({ mode: 'DIRECT' }))
      expect(vm.valueText).toBe('0')
    })

    test('m=0 produces NaN and warning', () => {
      const vm = toCalculatorViewModel(
        make({ mode: 'DIRECT', direct: { y: 10, m: 0, b: 0, r: 0 } }),
      )
      expect(vm.valueText).toBe('—')
      expect(vm.warnings.some((w) => w.id === 'direct-m-zero')).toBe(true)
    })

    test('Y=10, m=2, b=0, R=0 produces value 5', () => {
      const vm = toCalculatorViewModel(
        make({ mode: 'DIRECT', direct: { y: 10, m: 2, b: 0, r: 0 } }),
      )
      expect(vm.valueText).toBe('5')
    })
  })

  describe('mode=HALF', () => {
    test('raw=0 produces value 0', () => {
      const vm = toCalculatorViewModel(make({ mode: 'HALF' }))
      expect(vm.valueText).toBe('0')
    })

    test('raw=0x7C00 produces +Infinity', () => {
      const vm = toCalculatorViewModel(make({ mode: 'HALF', raw: 0x7c00 }))
      expect(vm.valueText).toBe('+Infinity')
    })

    test('raw=0xFC00 produces -Infinity', () => {
      const vm = toCalculatorViewModel(make({ mode: 'HALF', raw: 0xfc00 }))
      expect(vm.valueText).toBe('-Infinity')
    })

    test('raw=0x7E00 produces NaN', () => {
      const vm = toCalculatorViewModel(make({ mode: 'HALF', raw: 0x7e00 }))
      expect(vm.valueText).toBe('NaN')
    })
  })

  describe('bit groups', () => {
    test('raw=0xABCD produces 4 nibbles', () => {
      const vm = toCalculatorViewModel(make({ raw: 0xabcd }))
      expect(vm.bitGroups).toHaveLength(4)
      expect(vm.bitGroups[0].hex).toBe('A')
      expect(vm.bitGroups[1].hex).toBe('B')
      expect(vm.bitGroups[2].hex).toBe('C')
      expect(vm.bitGroups[3].hex).toBe('D')
      expect(vm.bitGroups[0].bits).toHaveLength(4)
    })

    test('raw=0x0001 has bit 0 = 1', () => {
      const vm = toCalculatorViewModel(make({ raw: 0x0001 }))
      const bit0 = vm.bitGroups[3].bits.find((b) => b.index === 0)
      expect(bit0?.value).toBe(1)
    })
  })

  describe('copy options', () => {
    test('prefix0x=true produces 0x prefix', () => {
      const vm = toCalculatorViewModel(make({ raw: 0x1234 }))
      expect(vm.rawBytesLE).toMatch(/^0x/)
    })

    test('prefix0x=false omits 0x prefix', () => {
      const vm = toCalculatorViewModel(
        make({ raw: 0x1234, copy: { ...BASE.copy, prefix0x: false } }),
      )
      expect(vm.rawBytesLE).not.toMatch(/^0x/)
    })

    test('spaceBetweenBytes=false omits spaces between bytes', () => {
      const vm = toCalculatorViewModel(
        make({ raw: 0x1234, copy: { ...BASE.copy, spaceBetweenBytes: false } }),
      )
      // prefix0x adds '0x ' (space after prefix), spaceBetweenBytes controls byte separation
      expect(vm.rawBytesLE).toBe('0x 3412')
    })

    test('BE endian swaps bytes', () => {
      const vm = toCalculatorViewModel(make({ raw: 0x1234, byteOrder: 'be' }))
      expect(vm.rawBytesLE).toBe('0x 34 12')
      expect(vm.rawBytesBE).toBe('0x 12 34')
    })
  })

  describe('visibility flags', () => {
    test('L11 shows nRange only', () => {
      const vm = toCalculatorViewModel(BASE)
      expect(vm.visible.nRange).toBe(true)
      expect(vm.visible.voutMode).toBe(false)
      expect(vm.visible.directCoefficients).toBe(false)
      expect(vm.visible.halfNote).toBe(false)
    })

    test('L16 shows voutMode and nRange', () => {
      const vm = toCalculatorViewModel(make({ mode: 'L16' }))
      expect(vm.visible.voutMode).toBe(true)
      expect(vm.visible.nRange).toBe(true)
    })

    test('DIRECT shows directCoefficients', () => {
      const vm = toCalculatorViewModel(make({ mode: 'DIRECT' }))
      expect(vm.visible.directCoefficients).toBe(true)
    })

    test('HALF shows halfNote', () => {
      const vm = toCalculatorViewModel(make({ mode: 'HALF' }))
      expect(vm.visible.halfNote).toBe(true)
    })
  })

  describe('command note', () => {
    test('null commandKey has no note', () => {
      const vm = toCalculatorViewModel(BASE)
      expect(vm.commandNote).toBeUndefined()
    })

    test('STATUS_WORD provides note', () => {
      const vm = toCalculatorViewModel(make({ commandKey: 'STATUS_WORD' }))
      expect(vm.commandNote).toBeTruthy()
    })
  })

  describe('warnings', () => {
    test('default L11 state has Y=0 info warning', () => {
      const vm = toCalculatorViewModel(BASE)
      expect(vm.warnings).toHaveLength(1)
      expect(vm.warnings[0].level).toBe('info')
    })

    test('DIRECT with m=0 has error warning', () => {
      const vm = toCalculatorViewModel(make({ mode: 'DIRECT', direct: { y: 1, m: 0, b: 0, r: 0 } }))
      const warning = vm.warnings.find((w) => w.id === 'direct-m-zero')
      expect(warning?.level).toBe('error')
    })
  })
})
