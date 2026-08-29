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

    test('non-LINEAR shared VOUT_MODE fails closed for L16 (v2.5.2)', () => {
      for (const byte of [0x20, 0x40, 0x60, 0xe0]) {
        const vm = toCalculatorViewModel(make({ mode: 'L16', raw: 0x0c00, voutMode: { byte } }))
        expect(vm.voutModeInfo?.source, `0x${byte.toString(16)}`).toBe('non-linear')
        // The displayed byte is the ACTUAL shared byte — never a substituted 0x18.
        expect(vm.voutModeInfo?.byte, `0x${byte.toString(16)}`).toBe(byte)
        expect(vm.valueText, `0x${byte.toString(16)}`).toBe('—')
        expect(vm.nRangeText, `0x${byte.toString(16)}`).toBeUndefined()
        expect(vm.l16Payload?.physicalInputAvailable, `0x${byte.toString(16)}`).toBe(false)
        expect(vm.l16Payload?.nonLinear, `0x${byte.toString(16)}`).toBe(true)
        expect(
          vm.warnings.some((w) => w.id === 'l16-vout-mode-nonlinear'),
          `0x${byte.toString(16)}`,
        ).toBe(true)
        expect(vm.deltaText, `0x${byte.toString(16)}`).toBeUndefined()
      }
    })

    test('0x18 只表述为计算器示例；「默认/回退」只允许出现在否定免责语境（v2.5.7 反词）', () => {
      // Surfaces must never CALL 0x18 a default or claim an auto-fallback.
      // Negated disclaimers ("不是 PMBus 规范默认值") are the only allowed use
      // of the word 默认 — every occurrence must sit in a negation context.
      for (const byte of [0x20, 0x40, 0x60, 0xe0]) {
        const vm = toCalculatorViewModel(make({ mode: 'L16', raw: 0x0c00, voutMode: { byte } }))
        const surfaces = [
          ...(vm.voutModeInfo?.explanations ?? []).map((e) => `${e.title}\n${e.detail}`),
          ...vm.warnings.map((w) => w.text),
          vm.l16Payload?.blocked?.title ?? '',
          ...(vm.l16Payload?.blocked?.detailLines ?? []),
        ]
        for (const text of surfaces) {
          // The old standalone action phrasing must be gone entirely.
          expect(text, `0x${byte.toString(16)}`).not.toContain('应用默认 VOUT_MODE')
          expect(text, `0x${byte.toString(16)}`).not.toContain('回退')
          expect(text, `0x${byte.toString(16)}`).not.toContain('fallback 0x18')
          for (const m of text.matchAll(/默认/g)) {
            const before = text.slice(Math.max(0, (m.index ?? 0) - 14), m.index ?? 0)
            expect(before, `0x${byte.toString(16)}: 默认 without negation in ${text}`).toMatch(
              /不是|并非|不代表|非 $|非$/,
            )
          }
        }
        // The recovery entry must name the byte as the calculator's example
        // value with its absolute/N=-8 semantics and an explicit disclaimer.
        const joined = surfaces.join('\n')
        expect(joined).toContain('计算器 LINEAR 示例 0x18')
        expect(joined).toContain('不是 PMBus 规范默认值')
      }
    })

    test('VID 0x20 + ULINEAR16：VID 合法但缺 profile（v2.5.3），绝不宣称输出电压命令总体禁止 VID', () => {
      const vm = toCalculatorViewModel(make({ mode: 'L16', voutMode: { byte: 0x20 } }))
      expect(vm.voutModeInfo?.source).toBe('non-linear')
      expect(vm.voutModeInfo?.domainStatus).toBe('not-used')
      expect(vm.l16Payload?.nonLinearFormat).toBe('VID')
      // v2.5.3 discriminated contract: legal format, missing profile — NOT a
      // prohibition.
      expect(vm.l16Payload?.blocked?.status).toBe('vid-profile-required')
      expect(vm.l16Payload?.blocked?.title).toContain('VID 格式')
      const copy = [
        vm.l16Payload?.blocked?.title,
        ...(vm.l16Payload?.blocked?.detailLines ?? []),
      ].join('\n')
      expect(copy).toContain('不是被禁止的数据格式')
      expect(copy).toContain('§8.4.2')
      expect(copy).not.toContain('输出电压相关命令禁止')
      expect(copy).not.toContain('禁止使用 VID')
      // Fail-closed numerics unchanged: no input, no range, no quantization.
      expect(vm.l16Payload?.physicalInputAvailable).toBe(false)
      expect(vm.nRangeText).toBeUndefined()
      expect(vm.valueText).toBe('—')
      expect(vm.warnings.some((w) => w.id === 'l16-vout-mode-nonlinear')).toBe(true)
    })

    test('VID 0x3E + ULINEAR16：制造商自定义 code 合法，映射来自器件资料；不称保留或禁止', () => {
      const vm = toCalculatorViewModel(make({ mode: 'L16', voutMode: { byte: 0x3e } }))
      expect(vm.l16Payload?.blocked?.status).toBe('vid-profile-required')
      expect(vm.l16Payload?.blocked?.title).toContain('1Eh — 制造商自定义（需器件资料）')
      const copy = [
        vm.l16Payload?.blocked?.title,
        ...(vm.l16Payload?.blocked?.detailLines ?? []),
      ].join('\n')
      expect(copy).toContain('器件资料')
      // Manufacturer-specific codes are legal — they must not be called
      // reserved or prohibited anywhere in the card copy.
      expect(copy).not.toContain('保留')
      expect(copy).not.toContain('输出电压相关命令禁止')
      expect(copy).not.toContain('该命令组合被禁止')
    })

    test.each([
      ['0x20', 0x20],
      ['0x3e', 0x3e],
    ] as const)(
      'VID %s + SLINEAR16：二补码偏移命令按 §13.3/§13.4 规范禁止（error 级）',
      (_hex, byte) => {
        const vm = toCalculatorViewModel(
          make({
            mode: 'L16',
            voutMode: { byte },
            l16: { ...BASE.l16, payloadKind: 'slinear16-offset' },
          }),
        )
        expect(vm.l16Payload?.blocked?.status).toBe('vid-offset-prohibited')
        const copy = [
          vm.l16Payload?.blocked?.title,
          ...(vm.l16Payload?.blocked?.detailLines ?? []),
        ].join('\n')
        expect(copy).toContain('§13.3 / §13.4')
        expect(copy).toContain('VOUT_TRIM / VOUT_CAL_OFFSET')
        // Prohibition scope is limited to the two offset commands; VID itself
        // stays a legal format per §8.4.2 — never claim a global ban.
        expect(copy).toContain('禁止范围仅限这两条二补码偏移命令')
        expect(copy).not.toContain('输出电压相关命令禁止使用 VID')
        // Spec-level violation announces an error-level warning.
        expect(
          vm.warnings.some(
            (w) => w.id === 'vout-mode-vid-offset-prohibited' && w.level === 'error',
          ),
        ).toBe(true)
        expect(vm.l16Payload?.physicalInputAvailable).toBe(false)
        expect(vm.valueText).toBe('—')
      },
    )

    test.each(['ulinear16', 'slinear16-offset'] as const)(
      'relative VID 0xA0 + %s：字节组合无效（§8.5.3），不落入偏移禁止或 profile 分支',
      (payloadKind) => {
        const vm = toCalculatorViewModel(
          make({
            mode: 'L16',
            voutMode: { byte: 0xa0 },
            l16: { ...BASE.l16, payloadKind },
          }),
        )
        expect(vm.l16Payload?.blocked?.status).toBe('vid-relative-invalid')
        const copy = [
          vm.l16Payload?.blocked?.title,
          ...(vm.l16Payload?.blocked?.detailLines ?? []),
        ].join('\n')
        expect(copy).toContain('§8.5.3')
        expect(
          vm.warnings.some((w) => w.id === 'vout-mode-invalid-combination' && w.level === 'error'),
        ).toBe(true)
        expect(vm.formulaText).not.toContain('相对 LINEAR')
        expect(vm.formulaText).toContain('非 LINEAR')
      },
    )

    test('DIRECT 0x40 / IEEE Half 0x60：合法格式但本页无 profile，fail-closed 不猜 N', () => {
      const direct = toCalculatorViewModel(make({ mode: 'L16', voutMode: { byte: 0x40 } }))
      expect(direct.l16Payload?.blocked?.status).toBe('direct-profile-required')
      const directCopy = [
        direct.l16Payload?.blocked?.title,
        ...(direct.l16Payload?.blocked?.detailLines ?? []),
      ].join('\n')
      expect(directCopy).toContain('DIRECT')
      expect(directCopy).toContain('m / b / R')
      expect(directCopy).toContain('§7.4')
      expect(directCopy).not.toContain('被禁止')

      const half = toCalculatorViewModel(make({ mode: 'L16', voutMode: { byte: 0x60 } }))
      expect(half.l16Payload?.blocked?.status).toBe('half-unsupported-in-l16')
      const halfCopy = [
        half.l16Payload?.blocked?.title,
        ...(half.l16Payload?.blocked?.detailLines ?? []),
      ].join('\n')
      expect(halfCopy).toContain('IEEE Half 是合法的输出电压数据格式')
      expect(halfCopy).toContain('§8.4.4')
      expect(halfCopy).not.toContain('被禁止')

      // Same contract for the signed-offset payload interpretation.
      const directOffset = toCalculatorViewModel(
        make({
          mode: 'L16',
          voutMode: { byte: 0x40 },
          l16: { ...BASE.l16, payloadKind: 'slinear16-offset' },
        }),
      )
      expect(directOffset.l16Payload?.blocked?.status).toBe('direct-profile-required')
    })

    test('非法参数 0x41/0x61：reserved-or-invalid 合同；error 级警告保持', () => {
      for (const byte of [0x41, 0x61]) {
        const vm = toCalculatorViewModel(make({ mode: 'L16', raw: 0x0c00, voutMode: { byte } }))
        expect(vm.l16Payload?.blocked?.status).toBe('reserved-or-invalid')
        expect(vm.l16Payload?.blocked?.detailLines.join('')).toContain('00000b')
        expect(
          vm.warnings.some((w) => w.id === 'vout-mode-invalid-parameter' && w.level === 'error'),
          `0x${byte.toString(16)}`,
        ).toBe(true)
      }
    })

    test('LINEAR 字节永不出现 blocked 卡：0x18 绝对值与 0x98 偏移恢复完整输入', () => {
      const abs = toCalculatorViewModel(make({ mode: 'L16', raw: 0x0c00 }))
      expect(abs.l16Payload?.blocked).toBeUndefined()
      expect(abs.l16Payload?.physicalInputAvailable).toBe(true)

      const offset = toCalculatorViewModel(
        make({
          mode: 'L16',
          raw: 0x034d,
          voutMode: { byte: 0x98 },
          l16: { ...BASE.l16, payloadKind: 'slinear16-offset' },
        }),
      )
      expect(offset.l16Payload?.blocked).toBeUndefined()
      expect(offset.l16Payload?.physicalInputAvailable).toBe(true)
      expect(offset.valueText).toBe('3.30078125')
    })

    test('DIRECT/Half 非法/非零参数共享字节在 L16 fail-closed 且 error 级保持', () => {
      for (const byte of [0x41, 0x5f, 0x61, 0x7f, 0xc1, 0xe1]) {
        const vm = toCalculatorViewModel(make({ mode: 'L16', raw: 0x0c00, voutMode: { byte } }))
        expect(vm.voutModeInfo?.source, `0x${byte.toString(16)}`).toBe('non-linear')
        expect(vm.valueText, `0x${byte.toString(16)}`).toBe('—')
        expect(vm.l16Payload?.nonLinear, `0x${byte.toString(16)}`).toBe(true)
      }
      // invalid-parameter / invalid-combination warnings stay at error level.
      const invalid = toCalculatorViewModel(make({ mode: 'L16', voutMode: { byte: 0x41 } }))
      expect(
        invalid.warnings.some((w) => w.id === 'vout-mode-invalid-parameter' && w.level === 'error'),
      ).toBe(true)
    })

    test('relative VID 0xA0 共享字节在 L16 fail-closed 且绝不显示相对 LINEAR', () => {
      const vm = toCalculatorViewModel(make({ mode: 'L16', voutMode: { byte: 0xa0 } }))
      expect(vm.voutModeInfo?.source).toBe('non-linear')
      expect(vm.warnings.some((w) => w.id === 'vout-mode-invalid-combination')).toBe(true)
      expect(vm.formulaText).not.toContain('相对 LINEAR')
      expect(vm.formulaText).toContain('非 LINEAR')
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

  test('relative ULINEAR16 derivation overflow is diagnosed everywhere (v2.5.9)', () => {
    // 98 / 0200 | 1e308: ratio=2, product = +Infinity → no fabricated result.
    const vm = toCalculatorViewModel(
      make({
        mode: 'L16',
        raw: 0x0200,
        voutMode: { byte: 0x98 },
        l16: { payloadKind: 'ulinear16', nominalVout: 1e308 },
      }),
    )
    expect(vm.valueText).toBe('—')
    expect(vm.steps.some((s) => s.id === 'result' && s.value === '—')).toBe(true)
    expect(vm.steps.some((s) => s.plainText.includes('Infinity'))).toBe(false)
    expect(vm.formulaText).toContain('计算结果超出 JavaScript Number 可表示范围')
    expect(vm.formulaText).toContain('1e+308')
    expect(vm.formulaText).not.toContain('Infinity')
    expect(vm.warnings.some((w) => w.id === 'l16-relative-overflow' && w.level === 'warning')).toBe(
      true,
    )
    expect(vm.physicalValueCopy?.available).toBe(false)
    expect(vm.physicalValueCopy?.reason).toContain('Number')
    // Nominal and ratio stay visible on every surface.
    expect(vm.steps.some((s) => s.id === 'l16-nominal' && s.value === '1e+308')).toBe(true)
    expect(vm.steps.some((s) => s.id === 'l16-ratio')).toBe(true)
  })

  test('relative ULINEAR16 derivation underflow is diagnosed, not shown as exact zero (v2.5.9)', () => {
    // 90 / 0001 | 5e-324: ratio=2^-16, product rounds to 0 with nonzero factors.
    const vm = toCalculatorViewModel(
      make({
        mode: 'L16',
        raw: 0x0001,
        voutMode: { byte: 0x90 },
        l16: { payloadKind: 'ulinear16', nominalVout: 5e-324 },
      }),
    )
    expect(vm.valueText).toBe('—')
    expect(vm.steps.some((s) => s.id === 'result' && s.value === '—')).toBe(true)
    expect(vm.formulaText).toContain('计算下溢')
    expect(vm.warnings.some((w) => w.id === 'l16-relative-underflow')).toBe(true)
    expect(vm.physicalValueCopy?.available).toBe(false)
  })

  test('relative ULINEAR16 true zeros stay finite and copyable (v2.5.9)', () => {
    // 98 / 0000 | 1e308: ratio=0 → true zero, never underflow.
    const zeroRatio = toCalculatorViewModel(
      make({
        mode: 'L16',
        raw: 0x0000,
        voutMode: { byte: 0x98 },
        l16: { payloadKind: 'ulinear16', nominalVout: 1e308 },
      }),
    )
    expect(zeroRatio.valueText).toBe('0')
    expect(zeroRatio.physicalValueCopy).toBeUndefined()
    expect(zeroRatio.warnings.some((w) => w.id === 'l16-relative-overflow')).toBe(false)
    expect(zeroRatio.warnings.some((w) => w.id === 'l16-relative-underflow')).toBe(false)
    // 98 / FFFF | 0: nominal=0 (decode-only) → true zero.
    const zeroNominal = toCalculatorViewModel(
      make({
        mode: 'L16',
        raw: 0xffff,
        voutMode: { byte: 0x98 },
        l16: { payloadKind: 'ulinear16', nominalVout: 0 },
      }),
    )
    expect(zeroNominal.valueText).toBe('0')
    expect(zeroNominal.physicalValueCopy).toBeUndefined()
  })

  test('huge finite nominal with ratio=1 stays fully computed and copyable (v2.5.9)', () => {
    // 98 / 0100 | 1e308: finite result — a large committed reference is not a
    // range error and must not disable the physical-value copy.
    const vm = toCalculatorViewModel(
      make({
        mode: 'L16',
        raw: 0x0100,
        voutMode: { byte: 0x98 },
        l16: { payloadKind: 'ulinear16', nominalVout: 1e308 },
      }),
    )
    expect(vm.valueText).toBe('1e+308')
    expect(vm.physicalValueCopy).toBeUndefined()
    expect(vm.steps.some((s) => s.id === 'result' && s.value === '1e+308')).toBe(true)
  })

  test('SLINEAR16 offset under relative byte keeps its signed result and copy (v2.5.9)', () => {
    const vm = toCalculatorViewModel(
      make({
        mode: 'L16',
        raw: 0x0200,
        voutMode: { byte: 0x98 },
        l16: { payloadKind: 'slinear16-offset', nominalVout: 1e308 },
      }),
    )
    // Y_s = 512, N = -8 → X_offset = 2 — the signed payload ignores bit7 and
    // the nominal channel entirely; no derivation-range diagnostics appear.
    expect(vm.valueText).toBe('2')
    expect(vm.physicalValueCopy).toBeUndefined()
    expect(vm.warnings.some((w) => w.id === 'l16-relative-overflow')).toBe(false)
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

  describe('mode=L16 SLINEAR16 offset under bit7 (v2.5.1 P1-A/P1-B)', () => {
    const makeRelativeSlinear = () =>
      make({
        mode: 'L16',
        voutMode: { byte: 0x98 },
        l16: { payloadKind: 'slinear16-offset', nominalVout: null },
      })

    test('physical input contract: signed offset available, nominal not required', () => {
      const vm = toCalculatorViewModel(makeRelativeSlinear())
      expect(vm.l16Payload).toMatchObject({
        kind: 'slinear16-offset',
        signedOffset: true,
        relativeRatio: false,
        physicalInputAvailable: true,
        requiresNominalReference: false,
      })
      // Signed range at N=-8, labelled even though the byte is relative.
      expect(vm.nRangeText).toBe('-128 ~ 127.99609375')
    })

    test('3.3 request quantizes with the P1-A vector and full panel context', () => {
      const vm = toCalculatorViewModel(
        make({
          ...makeRelativeSlinear(),
          raw: 0x034d,
          valueRequest: { mode: 'L16', value: 3.3 },
        }),
      )
      expect(vm.valueText).toBe('3.30078125')
      expect(vm.deltaText).toBe('-0.000781 (-0.0237%)')
      expect(vm.deltaKind).toBe('warn')
      expect(vm.deltaNote).toBeUndefined() // byte is LINEAR: no fallback note
      // Walkthrough carries the quantization intermediate for the request.
      expect(vm.steps.some((st) => st.id === 'l16-quantization')).toBe(true)
    })

    test('manual Y_s edit invalidates provenance across panel and steps', () => {
      // Reducer state after value/set 3.3 then l16/set-slinear-y 1.
      const vm = toCalculatorViewModel(
        make({
          ...makeRelativeSlinear(),
          raw: 0x0001,
          valueRequest: null,
        }),
      )
      expect(vm.deltaText).toBeUndefined()
      expect(vm.deltaKind).toBeUndefined()
      expect(vm.deltaNote).toBeUndefined()
      expect(vm.steps.some((st) => st.id === 'l16-quantization')).toBe(false)
    })

    test('relative ULINEAR16 context still requires the nominal reference', () => {
      const vm = toCalculatorViewModel(make({ mode: 'L16', voutMode: { byte: 0x98 } }))
      expect(vm.l16Payload).toMatchObject({
        kind: 'ulinear16',
        signedOffset: false,
        relativeRatio: true,
        physicalInputAvailable: false,
        requiresNominalReference: true,
      })
      expect(vm.nRangeText).toBeUndefined()
    })
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

    test('v2.5.5: 0x3E/0x3F are structure-legal, not calculable, and need external data', () => {
      for (const byte of [0x3e, 0x3f]) {
        const vm = toCalculatorViewModel(make({ mode: 'VOUT_MODE', voutMode: { byte } }))
        expect(vm.voutModePage?.structureLegal, `0x${byte.toString(16)}`).toBe(true)
        expect(vm.voutModePage?.calculable, `0x${byte.toString(16)}`).toBe(false)
        expect(vm.voutModePage?.requiresExternalData, `0x${byte.toString(16)}`).toBe(true)
        expect(vm.voutModePage?.vidCodeKind, `0x${byte.toString(16)}`).toBe('profile-required')
      }
    })

    test('v2.5.5 legality/external-data matrix across representative bytes', () => {
      const rows: Array<{
        byte: number
        structureLegal: boolean
        requiresExternalData: boolean
      }> = [
        { byte: 0x18, structureLegal: true, requiresExternalData: false },
        { byte: 0x98, structureLegal: true, requiresExternalData: false },
        { byte: 0x40, structureLegal: true, requiresExternalData: true },
        { byte: 0xc0, structureLegal: true, requiresExternalData: true },
        { byte: 0x60, structureLegal: true, requiresExternalData: false },
        { byte: 0xe0, structureLegal: true, requiresExternalData: false },
        { byte: 0x20, structureLegal: false, requiresExternalData: false },
        { byte: 0x24, structureLegal: false, requiresExternalData: false },
        { byte: 0x3e, structureLegal: true, requiresExternalData: true },
        { byte: 0xa0, structureLegal: false, requiresExternalData: false },
        { byte: 0x61, structureLegal: false, requiresExternalData: false },
      ]
      for (const row of rows) {
        const vm = toCalculatorViewModel(make({ mode: 'VOUT_MODE', voutMode: { byte: row.byte } }))
        expect(vm.voutModePage?.structureLegal, `0x${row.byte.toString(16)}`).toBe(
          row.structureLegal,
        )
        expect(vm.voutModePage?.requiresExternalData, `0x${row.byte.toString(16)}`).toBe(
          row.requiresExternalData,
        )
      }
    })

    test('byte calculator hides the 16-bit raw/byte-order UI', () => {
      const vm = toCalculatorViewModel(make({ mode: 'VOUT_MODE' }))
      expect(vm.visible.byteCalculator).toBe(true)
      expect(vm.visible.voutMode).toBe(false)
    })
  })

  describe('v2.5.4 VOUT_MODE 状态/警告/说明/步骤的 Half↔DIRECT 对比矩阵', () => {
    // IEEE Half is standard binary16 (Part II §7.6/§8.4.4): no user-visible
    // surface may claim a device profile. DIRECT keeps the m/b/R requirement
    // (§7.4); relative bytes keep the nominal-reference wording (§8.5.2).
    const HALF_BANNED = ['需器件资料', '器件 Profile', 'm/b/R', 'DIRECT 系数', '设备数据']

    function voutModePageSurfaces(byte: number) {
      const vm = toCalculatorViewModel(make({ mode: 'VOUT_MODE', voutMode: { byte } }))
      const page = vm.voutModePage
      expect(page).toBeDefined()
      const explanationCopy = (page?.explanations ?? [])
        .map((e) => `${e.title} ${e.detail}`)
        .join('\n')
      const stepCopy = vm.steps.map((s) => s.plainText).join('\n')
      const warningCopy = vm.warnings.map((w) => w.text).join('\n')
      return { vm, page, explanationCopy, stepCopy, warningCopy }
    }

    test('0x60 绝对 Half：状态=标准 binary16；所有表面无 Profile/系数/器件资料语义，无参考值要求', () => {
      const { page, explanationCopy, stepCopy, warningCopy } = voutModePageSurfaces(0x60)
      expect(page?.statusText).toBe('IEEE Half（标准 binary16）')
      expect(page?.structureLegal).toBe(true)
      const everySurface = [page?.statusText ?? '', explanationCopy, stepCopy, warningCopy].join(
        '\n',
      )
      for (const banned of HALF_BANNED) {
        expect(everySurface, 'unexpected copy: ' + banned).not.toContain(banned)
      }
      expect(everySurface).not.toContain('标称参考值')
      expect(warningCopy).toContain('标准 IEEE 754 binary16')
      expect(warningCopy).toContain('§7.6')
      expect(explanationCopy).toContain('标准 IEEE 754 binary16')
      expect(stepCopy).toContain('标准 IEEE 754 binary16')
      expect(stepCopy).toContain('HALF 模式页')
    })

    test('0xE0 相对 Half：需 VOUT_COMMAND 标称参考值（§8.5.2），但仍无 Profile/系数语义', () => {
      const { page, explanationCopy, stepCopy, warningCopy } = voutModePageSurfaces(0xe0)
      expect(page?.statusText).toBe('相对 IEEE Half（需参考值）')
      const everySurface = [page?.statusText ?? '', explanationCopy, stepCopy, warningCopy].join(
        '\n',
      )
      for (const banned of HALF_BANNED) {
        expect(everySurface, 'unexpected copy: ' + banned).not.toContain(banned)
      }
      // v2.5.5: per-surface — each requirement surface itself carries the
      // nominal-reference wording, not just the concatenation.
      expect(warningCopy).toContain('标称参考值')
      expect(explanationCopy).toContain('标称参考值')
      expect(stepCopy).toContain('标称参考值')
      expect(warningCopy).toContain('§8.5.2')
    })

    test('0x40/0xC0 DIRECT：继续要求器件 m/b/R；相对再加标称参考值', () => {
      const absolute = voutModePageSurfaces(0x40)
      expect(absolute.page?.statusText).toBe('绝对 DIRECT（需 m/b/R 系数）')
      expect(absolute.warningCopy).toContain('m/b/R')
      expect(absolute.warningCopy).toContain('§7.4')
      expect(absolute.explanationCopy).toContain('m/b/R')
      for (const surface of [
        absolute.page?.statusText ?? '',
        absolute.explanationCopy,
        absolute.stepCopy,
        absolute.warningCopy,
      ]) {
        expect(surface, '0x40 must not need a nominal reference').not.toContain('标称参考值')
      }

      const relative = voutModePageSurfaces(0xc0)
      expect(relative.page?.statusText).toBe('相对 DIRECT（需系数与参考值）')
      // v2.5.5: the InfoPanel warning ITSELF states both the m/b/R
      // coefficients and the VOUT_COMMAND nominal reference (§8.5.2);
      // explanations and steps each carry both too.
      expect(relative.warningCopy).toContain('m/b/R')
      expect(relative.warningCopy).toContain('标称参考值')
      expect(relative.warningCopy).toContain('§8.5.2')
      expect(relative.explanationCopy).toContain('m/b/R')
      expect(relative.explanationCopy).toContain('标称参考值')
      expect(relative.stepCopy).toContain('m/b/R')
      expect(relative.stepCopy).toContain('标称参考值')
    })

    test('0x61/0xE1 参数非法：保持 error 级与 00000b 约束，不落入任何格式要求分支', () => {
      for (const byte of [0x61, 0xe1]) {
        const { vm, warningCopy } = voutModePageSurfaces(byte)
        expect(vm.voutModePage?.structureLegal).toBe(false)
        expect(
          vm.warnings.some((w) => w.id === 'vout-mode-invalid-parameter' && w.level === 'error'),
          `0x${byte.toString(16)}`,
        ).toBe(true)
        expect(warningCopy).toContain('00000b')
        expect(vm.warnings.some((w) => w.id === 'vout-mode-half-standard')).toBe(false)
        expect(vm.warnings.some((w) => w.id === 'vout-mode-direct-profile')).toBe(false)
      }
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
          valueRequest: { mode: 'DIRECT', value: 1.2345, text: '1.2345' },
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

    test('L16 relative LINEAR（缺 nominal）与 non-LINEAR steps contain no result', () => {
      const rel = toCalculatorViewModel(
        make({ mode: 'L16', raw: 0x0c00, voutMode: { byte: 0x98 } }),
      )
      expect(rel.steps.some((s) => s.kind === 'result')).toBe(false)

      // Non-LINEAR shared bytes fail closed: the walkthrough shows the
      // fail-closed warning and never derives a LINEAR result (v2.5.2).
      for (const byte of [0x20, 0x40, 0x60, 0xe0]) {
        const vm = toCalculatorViewModel(make({ mode: 'L16', raw: 0x0c00, voutMode: { byte } }))
        expect(
          vm.steps.some((s) => s.kind === 'result'),
          `0x${byte.toString(16)}`,
        ).toBe(false)
        expect(
          vm.steps.some((s) => s.id === 'l16-nonlinear'),
          `0x${byte.toString(16)}`,
        ).toBe(true)
        expect(
          vm.steps.some((s) => s.id === 'l16-n'),
          `0x${byte.toString(16)}`,
        ).toBe(false)
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

    test('L16 relative LINEAR 与 non-LINEAR 不提供 nRangeText；显式 0x18 后恢复', () => {
      const rel = toCalculatorViewModel(
        make({ mode: 'L16', raw: 0x0c00, voutMode: { byte: 0x98 } }),
      )
      expect(rel.nRangeText).toBeUndefined()

      // Non-LINEAR shared bytes have no pseudo LINEAR range (v2.5.2).
      for (const byte of [0x20, 0x40, 0x60, 0xe0]) {
        const vm = toCalculatorViewModel(make({ mode: 'L16', raw: 0x0c00, voutMode: { byte } }))
        expect(vm.nRangeText, `0x${byte.toString(16)}`).toBeUndefined()
      }

      // Only an explicit apply of the default byte restores the range.
      const applied = toCalculatorViewModel(
        make({ mode: 'L16', raw: 0x0c00, voutMode: { byte: 0x18 } }),
      )
      expect(applied.nRangeText).toBe('0 ~ 255.99609375')
    })

    test('L16 relative LINEAR 步骤解释指数/比值语义但不展示 V 字段与结果（缺 nominal）', () => {
      const vm = toCalculatorViewModel(make({ mode: 'L16', raw: 0x0c00, voutMode: { byte: 0x98 } }))
      expect(vm.steps.some((s) => s.id === 'l16-n')).toBe(true)
      expect(vm.steps.some((s) => s.id === 'l16-2n')).toBe(true)
      expect(vm.steps.some((s) => s.id === 'l16-ratio')).toBe(true)
      expect(vm.steps.some((s) => s.id === 'l16-v')).toBe(false)
      expect(vm.steps.some((s) => s.kind === 'result')).toBe(false)
    })

    test('L16 非 LINEAR 共享字节 fail-closed：无伪 N、无伪 V、无结果（v2.5.2）', () => {
      for (const byte of [0x20, 0x40, 0x60, 0xe0, 0x41, 0x61]) {
        const vm = toCalculatorViewModel(make({ mode: 'L16', raw: 0x0c00, voutMode: { byte } }))
        expect(
          vm.steps.some((s) => s.id === 'l16-nonlinear'),
          `0x${byte.toString(16)}`,
        ).toBe(true)
        expect(
          vm.steps.some((s) => s.id === 'l16-v'),
          `0x${byte.toString(16)}`,
        ).toBe(false)
        expect(
          vm.steps.some((s) => s.id === 'l16-n'),
          `0x${byte.toString(16)}`,
        ).toBe(false)
        expect(
          vm.steps.some((s) => s.kind === 'result'),
          `0x${byte.toString(16)}`,
        ).toBe(false)
        expect(
          vm.steps.some((s) => s.id === 'l16-quantization'),
          `0x${byte.toString(16)}`,
        ).toBe(false)
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

describe('DIRECT precision-fidelity contract (v2.5.11)', () => {
  const directWith = (
    raw: number,
    m: number,
    b: number,
    r: number,
    valueRequest: AppState['valueRequest'] = null,
  ): AppState =>
    make({
      mode: 'DIRECT',
      raw,
      valueRequest,
      direct: { m, b, r, errors: { m: null, b: null, r: null } },
    })

  test('precision-folded raw FFFF exposes the fidelity contract on every surface', () => {
    // m=1, b=1, R=17, Y=-1: exact -1.00000000000000001, binary64 displays -1.
    const vm = toCalculatorViewModel(directWith(0xffff, 1, 1, 17))
    expect(vm.directFidelity).toBeDefined()
    expect(vm.directFidelity!.exactFractionText).toBe('-100000000000000001/100000000000000000')
    expect(vm.directFidelity!.exactDecimalText).toBe('-1.00000000000000001')
    expect(vm.directFidelity!.approxValueText).toBe('-1')
    expect(vm.directFidelity!.reencodedY).toBe(0)
    expect(vm.directFidelity!.safeReentryText).toBe('-1.00000000000000001')
    // Copy override hands out the verified exact text with the note.
    expect(vm.physicalValueCopyOverride?.text).toBe('-1.00000000000000001')
    expect(vm.physicalValueCopyOverride?.note).toContain('-1.00000000000000001')
    // The InfoPanel warning names the approximation and the re-entry verdict.
    const warning = vm.warnings.find((w) => w.id === 'direct-precision-fold')
    expect(warning).toBeDefined()
    expect(warning!.level).toBe('warning')
    expect(warning!.text).toContain('-1.00000000000000001')
    expect(warning!.text).toContain('Y=0')
    expect(warning!.text).toContain('不同的请求')
    // The calculation steps carry the exact value lines.
    const steps = vm.steps
    expect(steps.find((s) => s.id === 'direct-exact-value')?.value).toBe(
      '-100000000000000001/100000000000000000',
    )
    expect(steps.find((s) => s.id === 'direct-exact-decimal')?.value).toBe('-1.00000000000000001')
  })

  test('raw 0000 under the same coefficients is exact and silent (no noise)', () => {
    const vm = toCalculatorViewModel(directWith(0x0000, 1, 1, 17))
    expect(vm.directFidelity).toBeUndefined()
    expect(vm.physicalValueCopyOverride).toBeUndefined()
    expect(vm.physicalValueCopy).toBeUndefined()
    expect(vm.warnings.some((w) => w.id === 'direct-precision-fold')).toBe(false)
    expect(vm.steps.some((s) => s.id === 'direct-exact-value')).toBe(false)
  })

  test('quantization readout flags the folded state even with a zero binary64 delta', () => {
    // Committing the exact lexeme keeps FFFF: requested Number -1 vs
    // represented -1 is binary64-exact, but the folded state must not read
    // as a clean ok/exact result.
    const vm = toCalculatorViewModel(
      directWith(0xffff, 1, 1, 17, { mode: 'DIRECT', value: -1, text: '-1' }),
    )
    expect(vm.deltaText).toBe('+0.000000 (0.0000%)')
    expect(vm.deltaKind).toBe('warn')
    expect(vm.deltaNote).toContain('精度折叠')
  })

  test('safe ordinary vector keeps ok kind and no fold note', () => {
    const vm = toCalculatorViewModel(
      directWith(12, 1, 0, 0, { mode: 'DIRECT', value: 12, text: '12' }),
    )
    expect(vm.deltaText).toBe('+0.000000 (0.0000%)')
    expect(vm.deltaKind).toBe('ok')
    expect(vm.deltaNote).toBeUndefined()
  })

  test('fidelity is recomputed live when raw switches between 0000 and FFFF', () => {
    const safe = toCalculatorViewModel(directWith(0x0000, 1, 1, 17))
    const unsafe = toCalculatorViewModel(directWith(0xffff, 1, 1, 17))
    expect(safe.directFidelity).toBeUndefined()
    expect(unsafe.directFidelity).toBeDefined()
  })

  test('changing coefficients recomputes the verdict (old analysis never lingers)', () => {
    // R=0 makes every Y exact: the same raw word that folds at R=17 is safe
    // at R=0.
    const folded = toCalculatorViewModel(directWith(0xffff, 1, 1, 17))
    const safe = toCalculatorViewModel(directWith(0xffff, 1, 1, 0))
    expect(folded.directFidelity).toBeDefined()
    expect(safe.directFidelity).toBeUndefined()
  })

  test('m=0 keeps the inline-only error and exposes no fidelity surface', () => {
    const vm = toCalculatorViewModel(
      make({
        mode: 'DIRECT',
        raw: 10,
        direct: { m: 0, b: 0, r: 0, errors: { m: 'DIRECT 系数 m 不能为 0', b: null, r: null } },
      }),
    )
    expect(vm.directFidelity).toBeUndefined()
    expect(vm.physicalValueCopyOverride).toBeUndefined()
  })

  test('copy override is absent for non-DIRECT modes (no cross-mode leak)', () => {
    const vm = toCalculatorViewModel(make({ raw: 0x0001, l11: { ...BASE.l11, valueInput: 1 } }))
    expect(vm.physicalValueCopyOverride).toBeUndefined()
    expect(vm.directFidelity).toBeUndefined()
  })
})
