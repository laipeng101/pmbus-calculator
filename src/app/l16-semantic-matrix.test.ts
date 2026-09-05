/**
 * Cross-surface L16/VOUT semantic matrix — behavior lock (v3.1.x).
 *
 * Every case drives one AppState through the integrated view-model and locks
 * the output contract of ALL presentation surfaces at once: result value
 * text, formula plain text, calculation steps, warnings, payload context,
 * n-range line and the physical-value copy availability. The semantic
 * classification facts behind these surfaces are asserted separately in
 * l16-derivation.test.ts; this file guarantees the consuming surfaces keep
 * their exact current output while the derivation underneath is unified.
 *
 * Matrix (docs/DOMAIN_MODEL.md §2.2/§3; Part II §8.4/§8.5/§13.3/§13.4):
 *  1  absolute LINEAR                    9  signed-offset payload (absolute + relative byte)
 *  2  relative LINEAR + finite nominal  10  non-LINEAR VID (not-used / 1Eh profile-required)
 *  3  relative LINEAR + nominal missing 11  non-LINEAR DIRECT
 *  4  relative LINEAR + nominal = 0     12  non-LINEAR IEEE Half
 *  5  relative ratio = 0                13  invalid/reserved byte combinations
 *  7  relative overflow                 14  device-data requirement fail-closed
 *  8  relative underflow                15  representative raw boundaries
 */
import { describe, test, expect } from 'vitest'
import { toCalculatorViewModel } from './view-model'
import type { AppState } from './state'

const BASE: AppState = {
  mode: 'L16',
  raw: 0x0c00,
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

describe('L16 semantic matrix — absolute LINEAR (shared byte 0x18, N=-8)', () => {
  test('case 1: raw 0x0C00 decodes 12 on every surface', () => {
    const vm = toCalculatorViewModel(BASE)
    expect(vm.valueText).toBe('12')
    expect(vm.formulaText).toBe('V=3072 × 2^-8')
    expect(vm.nRangeText).toBe('0 ~ 255.99609375')
    const result = vm.steps.find((s) => s.id === 'result')
    expect(result?.value).toBe('12')
    expect(vm.warnings.filter((w) => w.id.startsWith('l16-'))).toEqual([])
    expect(vm.physicalValueCopy).toBeUndefined()
    expect(vm.deltaText).toBeUndefined()
  })

  test('case 15: unsigned boundaries 0x0000 and 0xFFFF', () => {
    expect(toCalculatorViewModel(make({ raw: 0x0000 })).valueText).toBe('0')
    expect(toCalculatorViewModel(make({ raw: 0xffff })).valueText).toBe('255.99609375')
    expect(toCalculatorViewModel(make({ raw: 0xffff })).nRangeText).toBe('0 ~ 255.99609375')
  })

  test('case 15b: shared byte 0x00 (absolute LINEAR, N=0) is the all-zero edge', () => {
    const vm = toCalculatorViewModel(make({ voutMode: { byte: 0x00 }, raw: 0x0c00 }))
    expect(vm.valueText).toBe('3072')
    expect(vm.formulaText).toBe('V=3072 × 2^0')
    expect(vm.nRangeText).toBe('0 ~ 65535')
    expect(vm.steps.find((s) => s.id === 'result')?.value).toBe('3072')
    expect(vm.warnings.filter((w) => w.id.startsWith('l16-'))).toEqual([])
  })
})

describe('L16 semantic matrix — relative ULINEAR16 (byte 0x83, N=3)', () => {
  const REL = make({
    voutMode: { byte: 0x83 },
    raw: 0x0002,
    l16: { payloadKind: 'ulinear16', nominalVout: 5 },
  })

  test('case 2/6: finite nominal → final voltage 80 on every surface', () => {
    const vm = toCalculatorViewModel(REL)
    expect(vm.valueText).toBe('80')
    expect(vm.formulaText).toBe('R=2 × 2^3=16（1600%）; X=5×R=80 V')
    expect(vm.nRangeText).toBeUndefined()
    const result = vm.steps.find((s) => s.id === 'result')
    expect(result?.value).toBe('80')
    expect(vm.steps.find((s) => s.id === 'l16-ratio')?.value).toBe('16')
    expect(vm.physicalValueCopy).toBeUndefined()
    expect(vm.warnings.filter((w) => w.id.startsWith('l16-'))).toEqual([])
  })

  test('case 3: missing nominal → ratio only, result —, missing-reference warning', () => {
    const vm = toCalculatorViewModel(make({ voutMode: { byte: 0x83 }, raw: 0x0002 }))
    expect(vm.valueText).toBe('—')
    expect(vm.formulaText).toBe('R=2 × 2^3=16（需要 VOUT_COMMAND nominal）')
    expect(vm.steps.find((s) => s.id === 'l16-relative-nominal-missing')?.kind).toBe('warning')
    expect(vm.steps.find((s) => s.id === 'result')).toBeUndefined()
    expect(vm.physicalValueCopy).toBeUndefined()
  })

  test('case 4: nominal = 0 → exact zero result, no false diagnostics', () => {
    const vm = toCalculatorViewModel(
      make({
        voutMode: { byte: 0x83 },
        raw: 0x0002,
        l16: { payloadKind: 'ulinear16', nominalVout: 0 },
      }),
    )
    expect(vm.valueText).toBe('0')
    expect(vm.formulaText).toBe('R=2 × 2^3=16（1600%）; X=0×R=0 V')
    expect(vm.steps.find((s) => s.id === 'result')?.value).toBe('0')
    expect(vm.warnings.filter((w) => w.id.startsWith('l16-'))).toEqual([])
    expect(vm.physicalValueCopy).toBeUndefined()
  })

  test('case 5: ratio = 0 → exact zero value plus §8.5.2 compliance warning', () => {
    const vm = toCalculatorViewModel(
      make({
        voutMode: { byte: 0x83 },
        raw: 0x0000,
        l16: { payloadKind: 'ulinear16', nominalVout: 5 },
      }),
    )
    expect(vm.valueText).toBe('0')
    expect(vm.formulaText).toBe('R=0 × 2^3=0（0%）; X=5×R=0 V')
    const diag = vm.warnings.find((w) => w.id === 'l16-relative-zero-ratio')
    expect(diag?.level).toBe('warning')
    expect(diag?.text).toContain('§8.5.2')
    expect(vm.physicalValueCopy).toBeUndefined()
  })

  test('case 15c: relative raw boundary 0xFFFF → max ratio stays a finite fact', () => {
    const vm = toCalculatorViewModel(
      make({
        voutMode: { byte: 0x83 },
        raw: 0xffff,
        l16: { payloadKind: 'ulinear16', nominalVout: 1 },
      }),
    )
    expect(vm.valueText).toBe('524280')
    expect(vm.formulaText).toBe('R=65535 × 2^3=524280（52428000%）; X=1×R=524280 V')
    expect(vm.steps.find((s) => s.id === 'result')?.value).toBe('524280')
    expect(vm.warnings.filter((w) => w.id.startsWith('l16-'))).toEqual([])
    expect(vm.physicalValueCopy).toBeUndefined()
  })

  test('case 7: overflow → — everywhere, warning, copy disabled', () => {
    const vm = toCalculatorViewModel(
      make({
        voutMode: { byte: 0x83 },
        raw: 0x0002,
        l16: { payloadKind: 'ulinear16', nominalVout: 1e308 },
      }),
    )
    expect(vm.valueText).toBe('—')
    expect(vm.formulaText).toBe(
      'R=2 × 2^3=16（1600%）; X=1e+308×R=—（计算结果超出 JavaScript Number 可表示范围）',
    )
    expect(vm.steps.find((s) => s.id === 'result')?.value).toBe('—')
    expect(vm.warnings.find((w) => w.id === 'l16-relative-overflow')?.level).toBe('warning')
    expect(vm.physicalValueCopy?.available).toBe(false)
    expect(vm.physicalValueCopy?.reason).toContain('计算结果超出 JavaScript Number 可表示范围')
  })

  test('case 8: nonzero-factor underflow → — everywhere, warning, copy disabled', () => {
    const vm = toCalculatorViewModel(
      make({
        voutMode: { byte: 0x90 },
        raw: 0x0001,
        l16: { payloadKind: 'ulinear16', nominalVout: 1e-320 },
      }),
    )
    expect(vm.valueText).toBe('—')
    expect(vm.formulaText).toContain(
      '计算下溢：两个非零有限数相乘的结果被 Number 舍入为 0，不是数学上的精确零',
    )
    expect(vm.steps.find((s) => s.id === 'result')?.value).toBe('—')
    expect(vm.warnings.find((w) => w.id === 'l16-relative-underflow')?.level).toBe('warning')
    expect(vm.physicalValueCopy?.available).toBe(false)
    expect(vm.physicalValueCopy?.reason).toContain('计算下溢')
  })
})

describe('L16 semantic matrix — SLINEAR16 offset payload', () => {
  test('case 9: signed offset on absolute byte 0x18, raw 0xFFFF → -1 × 2^-8', () => {
    const vm = toCalculatorViewModel(
      make({ raw: 0xffff, l16: { payloadKind: 'slinear16-offset', nominalVout: null } }),
    )
    expect(vm.valueText).toBe('-0.00390625')
    expect(vm.formulaText).toBe('Y_s=-1 × 2^-8 = -0.00390625 V')
    expect(vm.nRangeText).toBe('-128 ~ 127.99609375')
    expect(vm.steps.find((s) => s.id === 'l16-vout-mode-bit7-na')?.value).toBe(
      '不适用（有符号偏移量）',
    )
    expect(vm.steps.find((s) => s.id === 'result')?.value).toBe('-0.00390625')
    expect(vm.l16Payload?.signedOffset).toBe(true)
    expect(vm.l16Payload?.relativeRatio).toBe(false)
  })

  test('case 9b: signed offset on a relative byte 0x98 keeps payload math and no ratio path', () => {
    const vm = toCalculatorViewModel(
      make({
        voutMode: { byte: 0x98 },
        raw: 0xffff,
        l16: { payloadKind: 'slinear16-offset', nominalVout: null },
      }),
    )
    expect(vm.valueText).toBe('-0.00390625')
    expect(vm.nRangeText).toBe('-128 ~ 127.99609375')
    expect(vm.steps.find((s) => s.id === 'l16-vout-mode-bit7-na')).toBeDefined()
    expect(vm.steps.find((s) => s.id === 'l16-ratio')).toBeUndefined()
    expect(vm.warnings.filter((w) => w.id.startsWith('l16-'))).toEqual([])
  })

  test('case 15: signed boundaries 0x8000 and 0x7FFF', () => {
    const off = (raw: number) =>
      toCalculatorViewModel(
        make({ raw, l16: { payloadKind: 'slinear16-offset', nominalVout: null } }),
      ).valueText
    expect(off(0x8000)).toBe('-128')
    expect(off(0x7fff)).toBe('127.99609375')
  })
})

describe('L16 semantic matrix — non-LINEAR shared bytes fail closed (§8.4)', () => {
  test.each([
    { label: 'VID not-used', byte: 0x20, blocked: 'vid-profile-required' },
    { label: 'VID 1Eh manufacturer', byte: 0x3e, blocked: 'vid-profile-required' },
    { label: 'DIRECT', byte: 0x40, blocked: 'direct-profile-required' },
    { label: 'IEEE Half', byte: 0x60, blocked: 'half-unsupported-in-l16' },
    { label: 'DIRECT nonzero param', byte: 0x41, blocked: 'reserved-or-invalid' },
    { label: 'Half nonzero param', byte: 0x61, blocked: 'reserved-or-invalid' },
    { label: 'relative VID', byte: 0xa0, blocked: 'vid-relative-invalid' },
  ] as const)(
    'case 10-13: $label 0x$byte → no value, no pseudo N, blocked card $blocked',
    ({ byte, blocked }) => {
      const vm = toCalculatorViewModel(make({ voutMode: { byte } }))
      expect(vm.valueText).toBe('—')
      expect(vm.formulaText).toBe(
        `共享 VOUT_MODE 0x${byte.toString(16).toUpperCase().padStart(2, '0')} 非 LINEAR；输出电压命令的数据格式由 VOUT_MODE 决定（§8.4），未计算。`,
      )
      expect(vm.nRangeText).toBeUndefined()
      expect(vm.l16Payload?.blocked?.status).toBe(blocked)
      expect(vm.l16Payload?.physicalInputAvailable).toBe(false)
      expect(vm.l16Payload?.nonLinear).toBe(true)
      expect(vm.warnings.find((w) => w.id === 'l16-vout-mode-nonlinear')).toBeDefined()
      expect(vm.steps.find((s) => s.id === 'l16-nonlinear')?.kind).toBe('warning')
      expect(vm.steps.find((s) => s.id === 'result')).toBeUndefined()
      expect(vm.deltaText).toBeUndefined()
    },
  )

  test('case 14: profile requirement is reported without fabricating device data', () => {
    const vm = toCalculatorViewModel(make({ voutMode: { byte: 0x3e } }))
    expect(vm.l16Payload?.blocked?.detailLines.join('\n')).toContain('器件资料')
    expect(vm.l16Payload?.requiresNominalReference).toBe(false)
  })
})
