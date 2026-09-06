import { describe, test, expect } from 'vitest'
import { toCalculatorViewModel } from './view-model'
import type { AppState } from './state'

// Characterization corpus for the public CalculatorViewModel projection
// (`toCalculatorViewModel`). It locks observable outputs — value text,
// warnings, quantization classification, representable ranges, copy and
// byte serialization — per mode, so that internal restructuring of the
// projection layer cannot silently change user-visible behavior. Every
// expectation here describes current behavior; changing one is a product
// decision, not a test cleanup.

const BASE: AppState = {
  mode: 'L11',
  raw: 0,
  commandKey: null,
  voutMode: { byte: 0x18 },
  l11: { n: 0, y: 0, autoN: true, valueInput: null },
  valueRequest: null,
  l16: { payloadKind: 'ulinear16', nominalVout: null },
  direct: { m: 1, b: 0, r: 0, errors: { m: null, b: null, r: null } },
  copy: { prefix0x: true, spaceBetweenBytes: true },
  ui: { theme: 'system', debugOpen: false, bitMappingOpen: { rawWord: true, voutMode: true } },
}

function make(overrides: Partial<AppState> = {}): AppState {
  return { ...BASE, ...overrides }
}

describe('LINEAR11 characterization', () => {
  test('Y=1023 at N=15 (raw 0x7BFF) is the positive boundary encoding', () => {
    const vm = toCalculatorViewModel(make({ raw: 0x7bff }))
    expect(vm.valueText).toBe('33521664')
    expect(vm.nRangeText).toBe('-33554432 ~ 33521664')
    expect(vm.warnings).toHaveLength(0)
  })

  test('Y=-1024 at N=15 (raw 0x7C00) is the negative boundary encoding', () => {
    const vm = toCalculatorViewModel(make({ raw: 0x7c00 }))
    expect(vm.valueText).toBe('-33554432')
    expect(vm.warnings).toHaveLength(0)
  })

  test('the same word decodes mode-specifically — canonical raw has no per-mode truth', () => {
    // 0x7C00 is Y=-1024/N=15 for LINEAR11 and +Infinity for IEEE Half.
    expect(toCalculatorViewModel(make({ raw: 0x7c00 })).valueText).toBe('-33554432')
    expect(toCalculatorViewModel(make({ mode: 'HALF', raw: 0x7c00 })).valueText).toBe('+Infinity')
  })

  test('L11 saturation diagnostics never leak into other modes', () => {
    const valueInput = 1e9
    for (const mode of ['L16', 'DIRECT', 'HALF', 'VOUT_MODE'] as const) {
      const vm = toCalculatorViewModel(make({ mode, l11: { ...BASE.l11, valueInput } }))
      expect(
        vm.warnings.some((w) => w.id === 'l11-saturation'),
        mode,
      ).toBe(false)
    }
    const l11 = toCalculatorViewModel(make({ l11: { ...BASE.l11, valueInput } }))
    expect(l11.warnings.some((w) => w.id === 'l11-saturation')).toBe(true)
  })
})

describe('LINEAR16 / VOUT_MODE characterization', () => {
  test('wire bytes, MSB-first bytes and bit groups derive from the same canonical word', () => {
    const vm = toCalculatorViewModel(make({ mode: 'L16', raw: 0x1234 }))
    expect(vm.rawHex).toBe('0x1234')
    expect(vm.rawHexDigits).toBe('1234')
    expect(vm.rawWordHex).toBe('0x1234')
    expect(vm.valueText).toBe('18.203125')
    expect(vm.wireBytes).toBe('0x 34 12')
    expect(vm.msbFirstBytes).toBe('0x 12 34')
    expect(vm.bitGroups.map((g) => g.hex)).toEqual(['1', '2', '3', '4'])
  })

  test('VOUT_MODE page: raw fields show the 8-bit byte, serialization follows state.raw', () => {
    // v3.0.0 layering: the byte calculator's Raw Word display is the byte,
    // while byte serialization stays derived from the canonical 16-bit word.
    const vm = toCalculatorViewModel(make({ mode: 'VOUT_MODE', raw: 0x1234 }))
    expect(vm.rawHex).toBe('0x18')
    expect(vm.rawWordHex).toBe('0x18')
    expect(vm.rawHexDigits).toBe('18')
    expect(vm.valueText).toBe('0x18')
    expect(vm.wireBytes).toBe('0x 34 12')
    expect(vm.bitGroups[0].hex).toBe('1')
  })

  test('absolute LINEAR parameter is a signed 5-bit exponent (byte 0x08 → N=8)', () => {
    const vm = toCalculatorViewModel(make({ mode: 'L16', raw: 0x1234, voutMode: { byte: 0x08 } }))
    expect(vm.voutModeInfo?.linearExponent).toBe(8)
    expect(vm.valueText).toBe('1192960')
    expect(vm.nRangeText).toBe('0 ~ 16776960')
  })

  test('copy preferences change only serialization, never raw identity', () => {
    const vm = toCalculatorViewModel(
      make({ mode: 'L16', raw: 0x1234, copy: { prefix0x: false, spaceBetweenBytes: false } }),
    )
    expect(vm.wireBytes).toBe('3412')
    expect(vm.msbFirstBytes).toBe('1234')
    expect(vm.rawWordHex).toBe('0x1234')
    expect(vm.valueText).toBe('18.203125')
  })
})

describe('DIRECT characterization', () => {
  test('negative .5 tie rounds toward +∞ per the Math.round contract', () => {
    // m=1000: requested -1.2345 → Y=Math.round(-1234.5)=-1234 (not -1235),
    // represented -1.234, exact delta requested − represented = -0.0005.
    const vm = toCalculatorViewModel(
      make({
        mode: 'DIRECT',
        raw: 0xfb2e,
        direct: { m: 1000, b: 0, r: 0, errors: { m: null, b: null, r: null } },
        valueRequest: { mode: 'DIRECT', value: -1.2345, text: '-1.2345' },
      }),
    )
    expect(vm.directY).toBe(-1234)
    expect(vm.valueText).toBe('-1.234')
    expect(vm.deltaText).toBe('-0.0005（约 -0.0405%）')
    expect(vm.deltaKind).toBe('warn')
  })

  test('DIRECT exposes no representable-range line', () => {
    expect(toCalculatorViewModel(make({ mode: 'DIRECT' })).nRangeText).toBeUndefined()
  })
})

describe('HALF characterization', () => {
  test('subnormal raw 0x0001 decodes with 12 significant digits and subnormal steps', () => {
    const vm = toCalculatorViewModel(make({ mode: 'HALF', raw: 0x0001 }))
    expect(vm.valueText).toBe('5.96046447754e-8')
    expect(vm.steps.some((s) => s.plainText.includes('次正规数'))).toBe(true)
  })

  test('max subnormal raw 0x03FF and smallest normal 0x0400 bracket the boundary', () => {
    expect(toCalculatorViewModel(make({ mode: 'HALF', raw: 0x03ff })).valueText).toBe(
      '0.0000609755516052',
    )
    expect(toCalculatorViewModel(make({ mode: 'HALF', raw: 0x0400 })).valueText).toBe(
      '0.00006103515625',
    )
  })

  test('midpoint between 0x3C00 and 0x3C01 quantizes to the even neighbor', () => {
    const vm = toCalculatorViewModel(
      make({ mode: 'HALF', raw: 0x3c00, valueRequest: { mode: 'HALF', value: 1.00048828125 } }),
    )
    expect(vm.deltaText).toBe('+0.000488 (0.0488%)')
    expect(vm.deltaKind).toBe('warn')
  })

  test('midpoint between 0x3C01 and 0x3C02 also rounds to the even mantissa', () => {
    const vm = toCalculatorViewModel(
      make({ mode: 'HALF', raw: 0x3c02, valueRequest: { mode: 'HALF', value: 1.00146484375 } }),
    )
    expect(vm.deltaText).toBe('-0.000488 (-0.0488%)')
    expect(vm.deltaKind).toBe('warn')
  })

  test('an exactly representable request classifies ok, not quantized', () => {
    const vm = toCalculatorViewModel(
      make({ mode: 'HALF', raw: 0x3c00, valueRequest: { mode: 'HALF', value: 1 } }),
    )
    expect(vm.deltaText).toBe('+0.000000 (0.0000%)')
    expect(vm.deltaKind).toBe('ok')
  })
})

describe('command reference characterization', () => {
  test('follows_vout_mode command announces its format source as info', () => {
    const vm = toCalculatorViewModel(make({ commandKey: 'VOUT_COMMAND' }))
    expect(vm.commandNote).toContain('跟随 VOUT_MODE')
    const ids = vm.warnings.filter((w) => w.id.startsWith('cmd-')).map((w) => `${w.id}:${w.level}`)
    expect(ids).toEqual(['cmd-note:info', 'cmd-follows-vout-mode:info'])
  })

  test('device_defined command keeps the datasheet requirement as info', () => {
    const vm = toCalculatorViewModel(make({ commandKey: 'READ_VIN' }))
    expect(vm.commandNote).toContain('需要器件数据手册')
    const ids = vm.warnings.filter((w) => w.id.startsWith('cmd-')).map((w) => `${w.id}:${w.level}`)
    expect(ids).toEqual(['cmd-note:info', 'cmd-device-defined:info'])
  })
})

describe('VOUT_MODE byte warning copy characterization', () => {
  test('vid-not-used code 00h warns without a VID profile', () => {
    const vm = toCalculatorViewModel(make({ mode: 'VOUT_MODE', voutMode: { byte: 0x20 } }))
    expect(vm.warnings.map((w) => `${w.id}:${w.level}`)).toEqual(['vout-mode-vid-not-used:warning'])
    expect(vm.warnings[0].text).toContain('VID code 00h 为未使用')
  })

  test('Table-3-listed reserved code states the listing and the family reason', () => {
    // 0x21: VID format, code 01h — listed reserved (future Intel generation).
    const vm = toCalculatorViewModel(make({ mode: 'VOUT_MODE', voutMode: { byte: 0x21 } }))
    expect(vm.warnings.map((w) => `${w.id}:${w.level}`)).toEqual(['vout-mode-vid-reserved:warning'])
    expect(vm.warnings[0].text).toContain('VID code 01h 为保留值')
    expect(vm.warnings[0].text).toContain('Table 3 明列')
    expect(vm.warnings[0].text).not.toContain('未列出')
  })

  test('unlisted reserved code states that it is not in Table 3', () => {
    // 0x25: VID format, code 05h — reserved but not listed in Table 3.
    const vm = toCalculatorViewModel(make({ mode: 'VOUT_MODE', voutMode: { byte: 0x25 } }))
    expect(vm.warnings.map((w) => `${w.id}:${w.level}`)).toEqual(['vout-mode-vid-reserved:warning'])
    expect(vm.warnings[0].text).toContain('Table 3 未列出')
  })

  test('command notes are appended after the byte-level warnings, in order', () => {
    const vm = toCalculatorViewModel(
      make({ mode: 'VOUT_MODE', voutMode: { byte: 0x20 }, commandKey: 'VOUT_COMMAND' }),
    )
    expect(vm.warnings.map((w) => w.id)).toEqual([
      'vout-mode-vid-not-used',
      'cmd-note',
      'cmd-follows-vout-mode',
    ])
  })
})

describe('projection order characterization', () => {
  test('relative ULINEAR16 diagnostics follow the byte-level relative note', () => {
    // Nominal 1e308 × ratio 2 overflows: relative info first, then the
    // derivation-range warning — the historical push order.
    const vm = toCalculatorViewModel(
      make({
        mode: 'L16',
        raw: 0x0200,
        voutMode: { byte: 0x98 },
        l16: { payloadKind: 'ulinear16', nominalVout: 1e308 },
      }),
    )
    expect(vm.warnings.map((w) => `${w.id}:${w.level}`)).toEqual([
      'vout-mode-relative:info',
      'l16-relative-overflow:warning',
    ])
  })

  test('non-linear L16 announces the shared byte before the VID offset prohibition', () => {
    const vm = toCalculatorViewModel(
      make({
        mode: 'L16',
        voutMode: { byte: 0x20 },
        l16: { payloadKind: 'slinear16-offset', nominalVout: null },
      }),
    )
    // L16-specific notices first (§8.4 fail-closed, then the §13.3/§13.4
    // prohibition at error level), then the byte-level code-00h warning.
    expect(vm.warnings.map((w) => `${w.id}:${w.level}`)).toEqual([
      'l16-vout-mode-nonlinear:warning',
      'vout-mode-vid-offset-prohibited:error',
      'vout-mode-vid-not-used:warning',
    ])
  })

  test('payload note precedes the fail-closed note in the explanation list', () => {
    // Both unshifts apply: slinear16-bit7-na lands before l16-nonlinear.
    const vm = toCalculatorViewModel(
      make({
        mode: 'L16',
        voutMode: { byte: 0x20 },
        l16: { payloadKind: 'slinear16-offset', nominalVout: null },
      }),
    )
    const ids = vm.voutModeInfo?.explanations.map((e) => e.id) ?? []
    expect(ids.slice(0, 2)).toEqual(['slinear16-bit7-na', 'l16-nonlinear'])
  })
})
