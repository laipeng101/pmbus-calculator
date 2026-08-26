import { describe, test, expect } from 'vitest'
import { toCalculatorViewModel } from './view-model'
import { PMBusMath } from '../legacy/pmbus-math'
import type { AppState } from './state'

const BASE: AppState = {
  mode: 'L11',
  raw: 0,
  commandKey: null,
  byteOrder: 'le',
  voutMode: { byte: 0x18 },
  l11: { n: 0, y: 0, autoN: true, valueInput: null },
  valueRequest: null,
  l16: { payloadKind: 'ulinear16', nominalVout: null },
  direct: { m: 1, b: 0, r: 0, errors: { m: null, b: null, r: null } },
  copy: { prefix0x: true, spaceBetweenBytes: true, endian: 'le' },
  ui: { theme: 'system', debugOpen: false },
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

    test('formula is derived from raw, not stale l11 state', () => {
      const vm = toCalculatorViewModel(make({ raw: 0xf819, l11: { ...BASE.l11, n: 0, y: 0 } }))
      expect(vm.formulaText).toBe('Y=25 × 2^-1')
    })

    test('raw=0xF801 (N=-1, Y=1) formats to 0.5', () => {
      const vm = toCalculatorViewModel(make({ raw: 0xf801 }))
      expect(vm.valueText).toBe('0.5')
    })

    test('delta panel stays hidden without a value edit — no fabricated zero', () => {
      const vm = toCalculatorViewModel(BASE)
      expect(vm.deltaText).toBeUndefined()
      expect(vm.deltaKind).toBeUndefined()
    })

    test('delta reports the quantization error from the requested value', () => {
      const vm = toCalculatorViewModel(make({ raw: 0x0000, l11: { ...BASE.l11, valueInput: 1 } }))
      expect(vm.deltaText).toBe('+1.000000 (100.0000%)')
      expect(vm.deltaKind).toBe('warn')
    })

    test('nRangeText reflects the current N range', () => {
      const vm = toCalculatorViewModel(make({ raw: 0x0801 }))
      expect(vm.nRangeText).toBe('-2048 ~ 2046')
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

    test('voutModeInfo reports absolute LINEAR and exponent for 0x18', () => {
      const vm = toCalculatorViewModel(make({ mode: 'L16', voutMode: { byte: 0x18 } }))
      expect(vm.voutModeInfo?.hex).toBe('0x18')
      expect(vm.voutModeInfo?.isLinear).toBe(true)
      expect(vm.voutModeInfo?.isRelative).toBe(false)
      expect(vm.voutModeInfo?.mode).toBe(0)
      expect(vm.voutModeInfo?.param).toBe(0x18)
      expect(vm.voutModeInfo?.status).toBe('ok')
      expect(vm.voutModeInfo?.linearExponent).toBe(-8)
    })

    test('relative LINEAR VOUT_MODE 0x98 is not computed as an absolute voltage', () => {
      const vm = toCalculatorViewModel(make({ mode: 'L16', raw: 0x0c00, voutMode: { byte: 0x98 } }))
      expect(vm.voutModeInfo?.isLinear).toBe(true)
      expect(vm.voutModeInfo?.isRelative).toBe(true)
      expect(vm.voutModeInfo?.status).toBe('reference-required')
      expect(vm.valueText).toBe('—')
      expect(vm.warnings.some((w) => w.id === 'vout-mode-relative')).toBe(true)
      expect(vm.warnings.some((w) => w.id === 'l16-vout-mode-nonlinear')).toBe(false)
    })

    test('non-LINEAR shared VOUT_MODE falls back to default 0x18 for L16', () => {
      for (const byte of [0x20, 0x40, 0x60, 0xe0]) {
        const vm = toCalculatorViewModel(make({ mode: 'L16', raw: 0x0c00, voutMode: { byte } }))
        expect(vm.voutModeInfo?.source, `0x${byte.toString(16)}`).toBe('fallback-default')
        expect(vm.voutModeInfo?.byte, `0x${byte.toString(16)}`).toBe(0x18)
        expect(vm.valueText, `0x${byte.toString(16)}`).toBe('12')
        expect(
          vm.warnings.some((w) => w.id === 'l16-vout-mode-fallback'),
          `0x${byte.toString(16)}`,
        ).toBe(true)
      }
    })

    test('VID 0x20 共享字节在 L16 显示 fallback 而非伪造 VID 电压', () => {
      const vm = toCalculatorViewModel(make({ mode: 'L16', voutMode: { byte: 0x20 } }))
      expect(vm.voutModeInfo?.source).toBe('fallback-default')
      expect(vm.voutModeInfo?.domainStatus).toBe('valid')
      expect(vm.voutModeInfo?.statusText).toBe('绝对 LINEAR')
      expect(vm.warnings.some((w) => w.id === 'l16-vout-mode-fallback')).toBe(true)
    })

    test('DIRECT/Half 参数非零共享字节在 L16 fallback 到 0x18', () => {
      for (const byte of [0x41, 0x5f, 0x61, 0x7f, 0xc1, 0xe1]) {
        const vm = toCalculatorViewModel(make({ mode: 'L16', raw: 0x0c00, voutMode: { byte } }))
        expect(vm.voutModeInfo?.source, `0x${byte.toString(16)}`).toBe('fallback-default')
        expect(vm.valueText, `0x${byte.toString(16)}`).toBe('12')
      }
    })

    test('relative VID 0xA0 共享字节在 L16 fallback 且绝不显示相对 LINEAR', () => {
      const vm = toCalculatorViewModel(make({ mode: 'L16', voutMode: { byte: 0xa0 } }))
      expect(vm.voutModeInfo?.source).toBe('fallback-default')
      expect(vm.warnings.some((w) => w.id === 'l16-vout-mode-fallback')).toBe(true)
      expect(vm.formulaText).not.toContain('相对 LINEAR')
    })

    test('nRangeText reflects 0..65535×2^N', () => {
      const vm = toCalculatorViewModel(make({ mode: 'L16' }))
      expect(vm.nRangeText).toBe('0 ~ 255.99609375')
    })

    test('rawHex is byte-swapped in BE mode', () => {
      const vm = toCalculatorViewModel(make({ mode: 'L16', raw: 0x1234, byteOrder: 'be' }))
      expect(vm.rawHex).toBe('0x3412')
    })

    test('rawWordHex stays un-swapped regardless of byte order', () => {
      const vm = toCalculatorViewModel(make({ mode: 'L16', raw: 0x1234, byteOrder: 'be' }))
      expect(vm.rawWordHex).toBe('0x1234')
    })

    test('quantization panel stays hidden without an explicit request (no fabricated zero)', () => {
      const vm = toCalculatorViewModel(make({ mode: 'L16' }))
      expect(vm.deltaText).toBeUndefined()
    })

    test('quantization error reports the round-to-nearest ULINEAR16 error', () => {
      // N=-8 (VOUT_MODE 0x18): requested 0.005 → Y=1 → represented 0.00390625.
      const vm = toCalculatorViewModel(
        make({
          mode: 'L16',
          raw: 0x0001,
          voutMode: { byte: 0x18 },
          valueRequest: { mode: 'L16', value: 0.005 },
        }),
      )
      expect(vm.deltaText).toBe('+0.001094 (21.8750%)')
      expect(vm.deltaKind).toBe('warn')
    })

    test('relative ULINEAR16 hides the panel; SLINEAR16 offset ignores bit7 relative', () => {
      // Relative ULINEAR16 is a ratio — no physical request error applies.
      const relative = toCalculatorViewModel(make({ mode: 'L16', voutMode: { byte: 0x98 } }))
      expect(relative.deltaText).toBeUndefined()

      // SLINEAR16 offset (Part II §13.3/§13.4): bit7 does not participate,
      // so a committed offset request still quantizes against the payload.
      const slinearRequest = make({
        mode: 'L16',
        raw: 0x034d, // Y_s=845 → 3.30078125 at N=-8
        voutMode: { byte: 0x98 },
        l16: { payloadKind: 'slinear16-offset', nominalVout: null },
        valueRequest: { mode: 'L16', value: 3.3 },
      })
      const offset = toCalculatorViewModel(slinearRequest)
      expect(offset.deltaText).toBe('-0.000781 (-0.0237%)')
      expect(offset.deltaKind).toBe('warn')
    })
  })

  test('relative ULINEAR16 ratio with nominal reference computes X = V_NOM × R', () => {
    const vm = toCalculatorViewModel(
      make({
        mode: 'L16',
        raw: 0x0466,
        voutMode: { byte: 0x96 },
        l16: { payloadKind: 'ulinear16', nominalVout: 3.3 },
      }),
    )
    expect(vm.valueText).toBe('3.6287109375')
    expect(vm.formulaText).toContain('R=1126 × 2^-10')
  })

  test('relative ULINEAR16 without nominal reference shows ratio but no final result', () => {
    const vm = toCalculatorViewModel(make({ mode: 'L16', raw: 0x0466, voutMode: { byte: 0x96 } }))
    expect(vm.valueText).toBe('—')
    expect(vm.steps.some((s) => s.id === 'l16-ratio')).toBe(true)
    expect(vm.steps.some((s) => s.kind === 'result')).toBe(false)
  })

  test('SLINEAR16 offset ignores VOUT_MODE bit7 (raw 0xFF00 stays -1 V at N=-8)', () => {
    for (const byte of [0x18, 0x98]) {
      const vm = toCalculatorViewModel(
        make({
          mode: 'L16',
          raw: 0xff00,
          voutMode: { byte },
          l16: { payloadKind: 'slinear16-offset', nominalVout: null },
        }),
      )
      expect(vm.valueText, `0x${byte.toString(16)}`).toBe('-1')
      expect(vm.formulaText, `0x${byte.toString(16)}`).toContain('Y_s=-256 × 2^-8 = -1 V')
    }
  })

  describe('mode=VOUT_MODE (standalone byte calculator)', () => {
    test('valueText is the canonical byte hex and valueLabel is VOUT_MODE 字节', () => {
      const vm = toCalculatorViewModel(make({ mode: 'VOUT_MODE' }))
      expect(vm.valueText).toBe('0x18')
      expect(vm.valueLabel).toBe('VOUT_MODE 字节')
      expect(vm.rawHexDigits).toBe('18')
    })

    test('voutModePage exposes nibbles, structureLegal and calculable', () => {
      const vm = toCalculatorViewModel(make({ mode: 'VOUT_MODE', voutMode: { byte: 0x18 } }))
      expect(vm.voutModePage?.hexDigits).toBe('18')
      expect(vm.voutModePage?.nibbles).toHaveLength(2)
      expect(vm.voutModePage?.nibbles[0].hex).toBe('1')
      expect(vm.voutModePage?.nibbles[1].hex).toBe('8')
      expect(vm.voutModePage?.structureLegal).toBe(true)
      expect(vm.voutModePage?.calculable).toBe(true)
    })

    test('relative LINEAR byte is structure-legal but not calculable without a nominal reference', () => {
      const vm = toCalculatorViewModel(make({ mode: 'VOUT_MODE', voutMode: { byte: 0x98 } }))
      expect(vm.voutModePage?.structureLegal).toBe(true)
      expect(vm.voutModePage?.calculable).toBe(false)
      expect(vm.voutModePage?.statusText).toBe('相对 LINEAR（需参考值）')
    })

    test('byte calculator hides the 16-bit raw/byte-order UI', () => {
      const vm = toCalculatorViewModel(make({ mode: 'VOUT_MODE' }))
      expect(vm.visible.byteCalculator).toBe(true)
      expect(vm.visible.voutMode).toBe(false)
    })
  })

  describe('mode=DIRECT', () => {
    test('default coefficients produce value 0', () => {
      const vm = toCalculatorViewModel(make({ mode: 'DIRECT' }))
      expect(vm.valueText).toBe('0')
    })

    test('m=0 produces NaN value text without an InfoPanel warning (inline-only error)', () => {
      const vm = toCalculatorViewModel(
        make({
          mode: 'DIRECT',
          raw: 10,
          direct: {
            m: 0,
            b: 0,
            r: 0,
            errors: { m: 'DIRECT 系数 m 不能为 0', b: null, r: null },
          },
        }),
      )
      expect(vm.valueText).toBe('—')
      expect(vm.warnings.some((w) => w.id === 'direct-m-zero')).toBe(false)
    })

    test('raw=0x000A (Y=10), m=2, b=0, R=0 produces value 5', () => {
      const vm = toCalculatorViewModel(
        make({
          mode: 'DIRECT',
          raw: 10,
          direct: { m: 2, b: 0, r: 0, errors: { m: null, b: null, r: null } },
        }),
      )
      expect(vm.valueText).toBe('5')
      expect(vm.directY).toBe(10)
    })

    test('raw=0x8000 is signed Y=-32768 in DIRECT mode', () => {
      const vm = toCalculatorViewModel(
        make({
          mode: 'DIRECT',
          raw: 0x8000,
          direct: { m: 1, b: 0, r: 0, errors: { m: null, b: null, r: null } },
        }),
      )
      expect(vm.directY).toBe(-32768)
    })

    test('quantization panel stays hidden without an explicit request (no fabricated zero)', () => {
      const vm = toCalculatorViewModel(make({ mode: 'DIRECT' }))
      expect(vm.deltaText).toBeUndefined()
    })

    test('quantization error reports the legacy DIRECT rounding error', () => {
      // m=1000: requested 1.2345 → Y=round(1234.5)=1235 → represented 1.235.
      const vm = toCalculatorViewModel(
        make({
          mode: 'DIRECT',
          raw: 1235,
          direct: { m: 1000, b: 0, r: 0, errors: { m: null, b: null, r: null } },
          valueRequest: { mode: 'DIRECT', value: 1.2345 },
        }),
      )
      expect(vm.valueText).toBe('1.235')
      expect(vm.deltaText).toBe('-0.000500 (-0.0405%)')
      expect(vm.deltaKind).toBe('warn')
    })

    test('m=0 hides the quantization panel together with the value', () => {
      const vm = toCalculatorViewModel(
        make({
          mode: 'DIRECT',
          direct: { m: 0, b: 0, r: 0, errors: { m: 'DIRECT 系数 m 不能为 0', b: null, r: null } },
        }),
      )
      expect(vm.deltaText).toBeUndefined()
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

    test('raw=0x8000 preserves negative zero', () => {
      const vm = toCalculatorViewModel(make({ mode: 'HALF', raw: 0x8000 }))
      expect(vm.valueText).toBe('-0')
    })

    test('raw=0x0000 preserves positive zero', () => {
      const vm = toCalculatorViewModel(make({ mode: 'HALF', raw: 0x0000 }))
      expect(vm.valueText).toBe('0')
    })

    test('quantization panel stays hidden without an explicit request (no fabricated zero)', () => {
      const vm = toCalculatorViewModel(make({ mode: 'HALF' }))
      expect(vm.deltaText).toBeUndefined()
    })

    test('quantization error reports binary16 rounding from an explicit request', () => {
      // 1.005 → nearest binary16 is 0x3C05 = 1.0048828125.
      const vm = toCalculatorViewModel(
        make({
          mode: 'HALF',
          raw: 0x3c05,
          valueRequest: { mode: 'HALF', value: 1.005 },
        }),
      )
      expect(vm.deltaText).toBe('+0.000117 (0.0117%)')
      expect(vm.deltaKind).toBe('warn')
    })

    test('special values: no request hides, committed special requests classify', () => {
      // NaN / ±Infinity payload without provenance → hidden (error unknown).
      expect(toCalculatorViewModel(make({ mode: 'HALF', raw: 0x7e00 })).deltaText).toBeUndefined()
      expect(toCalculatorViewModel(make({ mode: 'HALF', raw: 0x7c00 })).deltaText).toBeUndefined()

      // Committed NaN request → explicit special classification, not silence.
      const nanRequest = make({
        mode: 'HALF',
        raw: 0x7e00,
        valueRequest: { mode: 'HALF', value: NaN },
      })
      const nan = toCalculatorViewModel(nanRequest)
      expect(nan.deltaText).toBe('NaN → NaN')
      expect(nan.deltaKind).toBe('warn')
      expect(nan.deltaNote).toContain('量化误差不适用')
    })

    test('finite overflow surfaces as an error instead of hiding', () => {
      const overflow = toCalculatorViewModel(
        make({
          mode: 'HALF',
          raw: 0x7c00,
          valueRequest: { mode: 'HALF', value: 65520 },
        }),
      )
      expect(overflow.deltaText).toBe('65520 → +Infinity')
      expect(overflow.deltaKind).toBe('error')
      expect(overflow.deltaNote).toContain('溢出')
    })
  })

  describe('calculation steps (unified four-mode skeleton)', () => {
    test('L11 steps include fields, formula, intermediate, result', () => {
      const vm = toCalculatorViewModel(make({ raw: 0xf819 }))
      expect(vm.steps.some((s) => s.kind === 'field' && s.label.includes('N'))).toBe(true)
      expect(vm.steps.some((s) => s.kind === 'field' && s.label.includes('Y'))).toBe(true)
      expect(vm.steps.some((s) => s.kind === 'formula' && s.plainText.includes('2^N'))).toBe(true)
      expect(vm.steps.some((s) => s.kind === 'intermediate' && s.label === '2^N')).toBe(true)
      expect(vm.steps.some((s) => s.kind === 'result' && s.value === '12.5')).toBe(true)
    })

    test('L16 steps expose VOUT_MODE fields and result for absolute LINEAR', () => {
      const vm = toCalculatorViewModel(make({ mode: 'L16', raw: 0x0c00 }))
      expect(vm.steps.some((s) => s.label.includes('VOUT_MODE'))).toBe(true)
      expect(vm.steps.some((s) => s.label.includes('格式'))).toBe(true)
      expect(vm.steps.some((s) => s.kind === 'result' && s.value === '12')).toBe(true)
    })

    test('L16 relative LINEAR（缺 nominal）steps contain no result; fallback does', () => {
      const rel = toCalculatorViewModel(
        make({ mode: 'L16', raw: 0x0c00, voutMode: { byte: 0x98 } }),
      )
      expect(rel.steps.some((s) => s.kind === 'result')).toBe(false)

      for (const byte of [0x20, 0x40, 0x60, 0xe0]) {
        const vm = toCalculatorViewModel(make({ mode: 'L16', raw: 0x0c00, voutMode: { byte } }))
        expect(
          vm.steps.some((s) => s.kind === 'result'),
          `0x${byte.toString(16)}`,
        ).toBe(true)
      }
    })

    test('DIRECT steps expose M/B/R/Y fields and result', () => {
      const vm = toCalculatorViewModel(
        make({
          mode: 'DIRECT',
          raw: 10,
          direct: { m: 2, b: 0, r: 0, errors: { m: null, b: null, r: null } },
        }),
      )
      expect(vm.steps.some((s) => s.label === 'Y（16 位有符号整数）')).toBe(true)
      expect(vm.steps.some((s) => s.label === 'M（斜率）')).toBe(true)
      expect(vm.steps.some((s) => s.kind === 'result' && s.value === '5')).toBe(true)
    })

    test('HALF steps expose S/E/F fields and classification', () => {
      const vm = toCalculatorViewModel(make({ mode: 'HALF', raw: 0x3c00 }))
      expect(vm.steps.some((s) => s.label.includes('S'))).toBe(true)
      expect(vm.steps.some((s) => s.label.includes('E'))).toBe(true)
      expect(vm.steps.some((s) => s.label.includes('F'))).toBe(true)
      expect(vm.steps.some((s) => s.plainText.includes('正规数'))).toBe(true)
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

  describe('C macro text', () => {
    test('no command uses RAW_VALUE', () => {
      const vm = toCalculatorViewModel(make({ raw: 0x000c }))
      expect(vm.cMacroText).toBe('#define RAW_VALUE 0x000C /* Y=12 × 2^0 */')
    })

    test('selected command uses sanitized command name', () => {
      const vm = toCalculatorViewModel(make({ raw: 0x000c, commandKey: 'VOUT_COMMAND' }))
      expect(vm.cMacroText).toBe('#define VOUT_COMMAND 0x000C /* Y=12 × 2^0 */')
    })
  })

  describe('DIRECT error visibility (inline-only, no InfoPanel duplication)', () => {
    test('coefficient errors never surface as InfoPanel warnings in any mode', () => {
      for (const mode of ['DIRECT', 'L11', 'L16', 'HALF'] as const) {
        const vm = toCalculatorViewModel(
          make({
            mode,
            direct: {
              m: 1,
              b: 0,
              r: 0,
              errors: { m: 'm 必须是 -32768..32767 的整数', b: null, r: null },
            },
          }),
        )
        expect(
          vm.warnings.find((w) => w.id === 'direct-coeff-error'),
          mode,
        ).toBeUndefined()
      }
    })

    test('m=0 error is inline-only: no direct-m-zero InfoPanel warning', () => {
      const vm = toCalculatorViewModel(
        make({
          mode: 'DIRECT',
          raw: 1,
          direct: {
            m: 0,
            b: 0,
            r: 0,
            errors: { m: 'DIRECT 系数 m 不能为 0', b: null, r: null },
          },
        }),
      )
      expect(vm.warnings.find((w) => w.id === 'direct-m-zero')).toBeUndefined()
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
    test('default L11 state has no Y=0 info warning', () => {
      const vm = toCalculatorViewModel(BASE)
      expect(vm.warnings).toHaveLength(0)
    })

    test('Y=1023/-1024 boundary codes are not flagged as overflow', () => {
      // N=15, Y=1023 -> 0x7FFF ; N=15, Y=-1024 -> 0xFFFF
      expect(toCalculatorViewModel(make({ raw: 0x7fff })).warnings).toHaveLength(0)
      expect(toCalculatorViewModel(make({ raw: 0xffff })).warnings).toHaveLength(0)
    })

    test('L11 saturation warning appears only when the requested value is out of range', () => {
      const inRange = toCalculatorViewModel(
        make({ raw: 0x7fff, l11: { ...BASE.l11, valueInput: PMBusMath.maxLinear11() } }),
      )
      expect(inRange.warnings.some((w) => w.id === 'l11-saturation')).toBe(false)

      const saturated = toCalculatorViewModel(
        make({ raw: 0x7fff, l11: { ...BASE.l11, valueInput: PMBusMath.maxLinear11() + 1 } }),
      )
      expect(saturated.warnings.some((w) => w.id === 'l11-saturation')).toBe(true)

      const negative = toCalculatorViewModel(
        make({ raw: 0xffff, l11: { ...BASE.l11, valueInput: PMBusMath.minLinear11() - 1 } }),
      )
      expect(negative.warnings.some((w) => w.id === 'l11-saturation')).toBe(true)
    })

    test('autoN=true 用全格式全局可表示范围判断饱和', () => {
      // autoN 编码器在全局极值（N=15）饱和；全局范围内不报警。
      const auto = { ...BASE.l11, autoN: true, valueInput: PMBusMath.maxLinear11() }
      expect(
        toCalculatorViewModel(make({ raw: 0x7fff, l11: auto })).warnings.some(
          (w) => w.id === 'l11-saturation',
        ),
      ).toBe(false)
      // 全局范围之外才报警（即使该值对某个锁定 N 仍在 Y 范围内）。
      const overGlobal = {
        ...BASE.l11,
        autoN: true,
        valueInput: PMBusMath.maxLinear11() + 1,
      }
      expect(
        toCalculatorViewModel(make({ raw: 0x7fff, l11: overGlobal })).warnings.some(
          (w) => w.id === 'l11-saturation',
        ),
      ).toBe(true)
    })

    test('autoN=false 按锁定 N 的 Y=-1024..1023 范围判断饱和', () => {
      const n0 = PMBusMath.linear11RangeForN(0)
      // 边界值（Y=1023 / Y=-1024）不报警。
      const atMax = toCalculatorViewModel(
        make({ raw: 0x03ff, l11: { ...BASE.l11, autoN: false, n: 0, valueInput: n0.max } }),
      )
      expect(atMax.warnings.some((w) => w.id === 'l11-saturation')).toBe(false)
      const atMin = toCalculatorViewModel(
        make({ raw: 0x0400, l11: { ...BASE.l11, autoN: false, n: 0, valueInput: n0.min } }),
      )
      expect(atMin.warnings.some((w) => w.id === 'l11-saturation')).toBe(false)

      // 超出该 N 范围（但仍在全格式全局范围内）必须报警。
      const over = toCalculatorViewModel(
        make({ raw: 0x03ff, l11: { ...BASE.l11, autoN: false, n: 0, valueInput: n0.max + 1 } }),
      )
      expect(over.warnings.some((w) => w.id === 'l11-saturation')).toBe(true)
      const under = toCalculatorViewModel(
        make({ raw: 0x0400, l11: { ...BASE.l11, autoN: false, n: 0, valueInput: n0.min - 1 } }),
      )
      expect(under.warnings.some((w) => w.id === 'l11-saturation')).toBe(true)
    })

    test('L16 relative LINEAR 不提供 nRangeText；fallback 后恢复范围', () => {
      const rel = toCalculatorViewModel(
        make({ mode: 'L16', raw: 0x0c00, voutMode: { byte: 0x98 } }),
      )
      expect(rel.nRangeText).toBeUndefined()

      for (const byte of [0x20, 0x40, 0x60, 0xe0]) {
        const vm = toCalculatorViewModel(make({ mode: 'L16', raw: 0x0c00, voutMode: { byte } }))
        expect(vm.nRangeText, `0x${byte.toString(16)}`).toBe('0 ~ 255.99609375')
      }
    })

    test('L16 relative LINEAR 步骤解释指数/比值语义但不展示 V 字段与结果（缺 nominal）', () => {
      const vm = toCalculatorViewModel(make({ mode: 'L16', raw: 0x0c00, voutMode: { byte: 0x98 } }))
      expect(vm.steps.some((s) => s.id === 'l16-n')).toBe(true)
      expect(vm.steps.some((s) => s.id === 'l16-2n')).toBe(true)
      expect(vm.steps.some((s) => s.id === 'l16-ratio')).toBe(true)
      expect(vm.steps.some((s) => s.id === 'l16-v')).toBe(false)
      expect(vm.steps.some((s) => s.kind === 'result')).toBe(false)
    })

    test('L16 非 LINEAR 共享字节 fallback 到 0x18 并生成 LINEAR16 步骤', () => {
      for (const byte of [0x20, 0x40, 0x60, 0xe0]) {
        const vm = toCalculatorViewModel(make({ mode: 'L16', raw: 0x0c00, voutMode: { byte } }))
        expect(
          vm.steps.some((s) => s.id === 'l16-fallback'),
          `0x${byte.toString(16)}`,
        ).toBe(true)
        expect(
          vm.steps.some((s) => s.id === 'l16-v'),
          `0x${byte.toString(16)}`,
        ).toBe(true)
        expect(
          vm.steps.some((s) => s.id === 'l16-n'),
          `0x${byte.toString(16)}`,
        ).toBe(true)
        expect(
          vm.steps.some((s) => s.kind === 'result'),
          `0x${byte.toString(16)}`,
        ).toBe(true)
      }
    })
  })
})

describe('M16 quantization-error sign semantics', () => {
  test('small negative delta is informational (warn), never danger', () => {
    const vm = toCalculatorViewModel(
      make({ raw: 0x0001, l11: { ...BASE.l11, valueInput: 0.999999 } }),
    )
    expect(vm.deltaText).toBe('-0.000001 (-0.0001%)')
    expect(vm.deltaKind).toBe('warn')
  })

  test('larger negative delta is also warn — the sign never implies danger', () => {
    const vm = toCalculatorViewModel(make({ raw: 0x0001, l11: { ...BASE.l11, valueInput: 0.98 } }))
    expect(vm.deltaText).toBe('-0.020000 (-2.0408%)')
    expect(vm.deltaKind).toBe('warn')
  })
})
