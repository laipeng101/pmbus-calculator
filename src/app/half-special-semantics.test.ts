import { describe, test, expect } from 'vitest'
import { resolveHalfSpecialSemantics } from './half-special-semantics'
import { toCalculatorViewModel } from './view-model'
import { appReducer } from './reducer'
import { PMBusMath } from '../legacy/pmbus-math'
import type { AppState } from './state'

const BASE: AppState = {
  mode: 'HALF',
  raw: 0,
  commandKey: null,
  voutMode: { byte: 0x18 },
  l11: { n: 0, y: 0, autoN: true, valueInput: null },
  valueRequest: null,
  l16: { payloadKind: 'ulinear16', nominalVout: null },
  direct: { m: 1, b: 0, r: 0, errors: { m: null, b: null, r: null } },
  copy: { prefix0x: true, spaceBetweenBytes: true },
  ui: { theme: 'system', debugOpen: false },
}

function make(overrides: Partial<AppState> = {}): AppState {
  return { ...BASE, ...overrides }
}

describe('resolveHalfSpecialSemantics (PMBus Part II §7.6.2 truth table)', () => {
  test('raw decode provenance: 0x7E00 → NaN semantics', () => {
    const s = resolveHalfSpecialSemantics(PMBusMath.decodeHalf(0x7e00).value)
    expect(s.id).toBe('half-nan')
    expect(s.severity).toBe('warning')
    expect(s.presentable).toBe(true)
    expect(s.specRef).toBe('Part II §7.6.2')
    expect(s.send).toContain('invalid data')
    expect(s.send).toContain('communications fault')
    expect(s.send).toContain('§10.8')
    expect(s.read).toContain('值不可用')
  })

  test('raw decode provenance: 0x7C00 / 0xFC00 → ±Infinity full-scale semantics', () => {
    const pos = resolveHalfSpecialSemantics(PMBusMath.decodeHalf(0x7c00).value)
    expect(pos.id).toBe('half-positive-infinity')
    expect(pos.send).toContain('正满量程')
    expect(pos.read).toContain('正方向饱和')

    const neg = resolveHalfSpecialSemantics(PMBusMath.decodeHalf(0xfc00).value)
    expect(neg.id).toBe('half-negative-infinity')
    expect(neg.send).toContain('负满量程')
    expect(neg.read).toContain('负方向饱和')
  })

  test('finite raw 0x3C00 (1.0) is never presentable', () => {
    const s = resolveHalfSpecialSemantics(PMBusMath.decodeHalf(0x3c00).value)
    expect(s.id).toBe('half-finite')
    expect(s.presentable).toBe(false)
    expect(s.severity).toBe('none')
  })

  test('value provenance: NaN / ±Infinity / finite requests classify identically', () => {
    expect(resolveHalfSpecialSemantics(NaN).id).toBe('half-nan')
    expect(resolveHalfSpecialSemantics(Infinity).id).toBe('half-positive-infinity')
    expect(resolveHalfSpecialSemantics(-Infinity).id).toBe('half-negative-infinity')
    expect(resolveHalfSpecialSemantics(1).id).toBe('half-finite')
    expect(resolveHalfSpecialSemantics(-0).id).toBe('half-finite')
    expect(resolveHalfSpecialSemantics(0).id).toBe('half-finite')
  })

  test('every presentable card lists both interpretations and the no-communication scope', () => {
    for (const value of [NaN, Infinity, -Infinity]) {
      const s = resolveHalfSpecialSemantics(value)
      expect(s.send).toContain('作为写入数据')
      expect(s.read).toContain('作为设备读回值')
      expect(s.scopeNote).toContain('不代表本页已发生任何总线通信')
    }
  })
})

describe('HALF special-value view-model contract (v2.5.5)', () => {
  test('raw 0x7E00 exposes the NaN semantics card', () => {
    const vm = toCalculatorViewModel(make({ raw: 0x7e00 }))
    expect(vm.valueText).toBe('NaN')
    expect(vm.halfSpecial?.id).toBe('half-nan')
    // No provenance yet on the pure raw path: the quantization readout stays
    // hidden (unknown, never fabricated), while the §7.6.2 card still shows.
    expect(vm.deltaText).toBeUndefined()
  })

  test('raw 0x7C00 / 0xFC00 expose ±Infinity cards', () => {
    expect(toCalculatorViewModel(make({ raw: 0x7c00 })).halfSpecial?.id).toBe(
      'half-positive-infinity',
    )
    expect(toCalculatorViewModel(make({ raw: 0xfc00 })).halfSpecial?.id).toBe(
      'half-negative-infinity',
    )
  })

  test('finite raw words never expose a card (no stale warning after raw edit)', () => {
    for (const raw of [0x0000, 0x3c00, 0xbc00, 0x8fc3]) {
      expect(toCalculatorViewModel(make({ raw })).halfSpecial).toBeUndefined()
    }
  })

  test('value-encode path: committing NaN keeps the raw canonical and the card present', () => {
    const after = appReducer(make({ raw: 0x3c00, mode: 'HALF' }), {
      type: 'value/set',
      value: 'NaN',
    })
    expect(after.raw).toBe(0x7e00)
    expect(after.valueRequest).toEqual({ mode: 'HALF', value: NaN })
    const vm = toCalculatorViewModel(after)
    expect(vm.halfSpecial?.id).toBe('half-nan')
    expect(vm.rawHex).toBe('0x7E00')
  })

  test('value-encode path: +Infinity encodes losslessly and keeps its card', () => {
    const after = appReducer(make({ raw: 0x0000, mode: 'HALF' }), {
      type: 'value/set',
      value: '+Infinity',
    })
    expect(after.raw).toBe(0x7c00)
    expect(toCalculatorViewModel(after).halfSpecial?.id).toBe('half-positive-infinity')
  })

  test('non-HALF modes never expose the card', () => {
    expect(toCalculatorViewModel(make({ mode: 'L11', raw: 0x7e00 })).halfSpecial).toBeUndefined()
    expect(toCalculatorViewModel(make({ mode: 'L16', raw: 0x7e00 })).halfSpecial).toBeUndefined()
  })
})
