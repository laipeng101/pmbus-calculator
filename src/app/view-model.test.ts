import { describe, test, expect } from 'vitest'
import { toCalculatorViewModel } from './view-model'
import { PMBusMath } from '../legacy/pmbus-math'
import { appReducer } from './reducer'
import { INITIAL_STATE, type AppState } from './state'

const BASE = INITIAL_STATE

function make(overrides: Partial<AppState> = {}): AppState {
  return { ...BASE, ...overrides }
}

describe('toCalculatorViewModel', () => {
  describe('mode=L11', () => {
    test('the same word is decoded by the active format', () => {
      const l11 = toCalculatorViewModel(make({ raw: 0x7c00 }))
      expect(l11.valueText).toBe('-33554432')
      expect(l11.nRangeText).toBe('-33554432 ~ 33521664')
      expect(l11.warnings).toEqual([])
      expect(toCalculatorViewModel(make({ mode: 'HALF', raw: 0x7c00 })).valueText).toBe('+Infinity')
    })

    test('preserves the canonical text of a small and a large LINEAR11 value', () => {
      expect(toCalculatorViewModel(make({ raw: 0x8bff })).valueText).toBe('0.0312194824219')
      expect(toCalculatorViewModel(make({ raw: 0x7bff })).valueText).toBe('33521664')
    })

    test('formula is derived from raw, not stale l11 state', () => {
      const vm = toCalculatorViewModel(make({ raw: 0xf819, l11: { ...BASE.l11, n: 0, y: 0 } }))
      expect(vm.formulaText).toBe('Y=25 × 2^-1')
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

  test.each(['L11', 'L16', 'DIRECT', 'HALF', 'VOUT_MODE'] as const)(
    '%s displays no quantization result without an encoding request',
    (mode) => {
      const vm = toCalculatorViewModel(make({ mode, raw: 0x1000 }))
      expect(vm.deltaText).toBeUndefined()
      expect(vm.deltaKind).toBeUndefined()
    },
  )

  describe('独立 VOUT_MODE 配置页', () => {
    test('结果和位组显示共享的配置字节', () => {
      const vm = toCalculatorViewModel(
        make({ mode: 'VOUT_MODE', raw: 0x1234, voutMode: { byte: 0x18 } }),
      )
      expect(vm.valueText).toBe('0x18')
      expect(vm.valueLabel).toBe('VOUT_MODE 字节')
      expect(vm.voutModePage).toMatchObject({
        hexDigits: '18',
        structureLegal: true,
        calculable: true,
      })
      expect(vm.voutModePage?.nibbles.map((group) => group.hex)).toEqual(['1', '8'])
    })

    test('相对 LINEAR 配置合法，缺少标称参考值时无法计算电压', () => {
      const vm = toCalculatorViewModel(make({ mode: 'VOUT_MODE', voutMode: { byte: 0x98 } }))
      expect(vm.voutModePage?.structureLegal).toBe(true)
      expect(vm.voutModePage?.calculable).toBe(false)
      expect(vm.voutModePage?.statusText).toBe('相对 LINEAR')
    })

    test.each([0x3e, 0x3f])('制造商自定义 VID 配置 %i 需要器件资料', (byte) => {
      const vm = toCalculatorViewModel(make({ mode: 'VOUT_MODE', voutMode: { byte } }))
      expect(vm.voutModePage).toMatchObject({
        structureLegal: true,
        calculable: false,
        requiresExternalData: true,
        vidCodeKind: 'profile-required',
      })
    })

    test.each([
      { byte: 0x20, id: 'vout-mode-vid-not-used', text: 'VID 代码类型 00h 未使用' },
      { byte: 0x21, id: 'vout-mode-vid-reserved', text: '表 3 明列' },
      { byte: 0x25, id: 'vout-mode-vid-reserved', text: '未在 Part II §8.4.2 表 3 列出' },
    ])('keeps the VID warning provenance visible for byte $byte', ({ byte, id, text }) => {
      const vm = toCalculatorViewModel(make({ mode: 'VOUT_MODE', voutMode: { byte } }))
      expect(vm.warnings).toEqual([{ id, level: 'warning', text: expect.stringContaining(text) }])
    })

    test('各类配置分别报告结构是否合法以及是否需要器件资料', () => {
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
  })

  describe('VOUT_MODE 的 IEEE Half 和 DIRECT 状态、警告与说明', () => {
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
      const warningCopy = vm.warnings.map((w) => w.text).join('\n')
      return { vm, page, explanationCopy, warningCopy }
    }

    test('0x60 绝对 Half：状态=标准 binary16；所有表面无 Profile/系数/器件资料语义，无参考值要求', () => {
      const { page, explanationCopy, warningCopy } = voutModePageSurfaces(0x60)
      expect(page?.statusText).toBe('IEEE Half（标准 binary16）')
      expect(page?.structureLegal).toBe(true)
      const everySurface = [page?.statusText ?? '', explanationCopy, warningCopy].join('\n')
      for (const banned of HALF_BANNED) {
        expect(everySurface, 'unexpected copy: ' + banned).not.toContain(banned)
      }
      expect(everySurface).not.toContain('标称参考值')
      expect(warningCopy).not.toContain('相对值必须为正')
      expect(warningCopy).toContain('标准 IEEE 754 binary16')
      expect(warningCopy).toContain('§7.6')
      expect(explanationCopy).toContain('HALF 模式页')
    })

    test('0xE0 相对 Half：需 VOUT_COMMAND 标称参考值（§8.5.2），但仍无 Profile/系数语义', () => {
      const { page, explanationCopy, warningCopy } = voutModePageSurfaces(0xe0)
      expect(page?.statusText).toBe('相对 IEEE Half（需参考值）')
      const everySurface = [page?.statusText ?? '', explanationCopy, warningCopy].join('\n')
      for (const banned of HALF_BANNED) {
        expect(everySurface, 'unexpected copy: ' + banned).not.toContain(banned)
      }
      expect(warningCopy).toContain('标称参考值')
      expect(explanationCopy).toContain('标称参考值')
      expect(warningCopy).toContain('§8.5.2')
      expect(warningCopy).toContain('相对值必须为正')
    })

    test('0x40/0xC0 DIRECT：继续要求器件 m/b/R；相对再加标称参考值', () => {
      const absolute = voutModePageSurfaces(0x40)
      expect(absolute.page?.statusText).toBe('绝对 DIRECT（需 m/b/R 系数）')
      expect(absolute.warningCopy).toContain('m/b/R')
      expect(absolute.warningCopy).toContain('§7.4')
      expect(absolute.warningCopy).not.toContain('相对值必须为正')
      expect(absolute.explanationCopy).toContain('m/b/R')
      for (const surface of [
        absolute.page?.statusText ?? '',
        absolute.explanationCopy,
        absolute.warningCopy,
      ]) {
        expect(surface, '0x40 must not need a nominal reference').not.toContain('标称参考值')
      }

      const relative = voutModePageSurfaces(0xc0)
      expect(relative.page?.statusText).toBe('相对 DIRECT（需系数与参考值）')
      expect(relative.warningCopy).toContain('m/b/R')
      expect(relative.warningCopy).toContain('标称参考值')
      expect(relative.warningCopy).toContain('§8.5.2')
      expect(relative.warningCopy).toContain('相对值必须为正')
      expect(relative.explanationCopy).toContain('m/b/R')
      expect(relative.explanationCopy).toContain('标称参考值')
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
    test.each([
      { hex: '0000', y: 0 },
      { hex: '7FFF', y: 32767 },
      { hex: '8000', y: -32768 },
      { hex: 'FFFF', y: -1 },
    ])('projects the typed word $hex as signed Y=$y', ({ hex, y }) => {
      const state = appReducer(make({ mode: 'DIRECT', raw: 0x5555 }), {
        type: 'raw/set-from-hex',
        hex,
      })
      const vm = toCalculatorViewModel(state)
      expect(vm.directY).toBe(y)
      expect(vm.valueText).toBe(String(y))
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

    test.each([
      { r: -128, text: '1e+128' },
      { r: 127, text: '1e-127' },
    ])('renders the finite magnitude at valid DIRECT exponent R=$r', ({ r, text }) => {
      const vm = toCalculatorViewModel(
        make({ mode: 'DIRECT', raw: 1, direct: { ...BASE.direct, r } }),
      )
      expect(vm.valueText).toBe(text)
    })

    test.each([
      { text: '1.2345', raw: 1235, value: '1.235' },
      { text: '-1.2345', raw: 0xfb2e, value: '-1.234' },
    ])(
      'renders the signed DIRECT midpoint request $text and its exact delta',
      ({ text, raw, value }) => {
        const state = appReducer(make({ mode: 'DIRECT', direct: { ...BASE.direct, m: 1000 } }), {
          type: 'value/set',
          value: text,
        })
        const vm = toCalculatorViewModel(state)
        expect(state.raw).toBe(raw)
        expect(vm.valueText).toBe(value)
        expect(vm.deltaText).toBe('-0.0005（约 -0.0405%）')
        expect(vm.deltaKind).toBe('warn')
        expect(vm.deltaNote).toContain(`用户请求 ${text}`)
        expect(vm.deltaNote).toContain(`raw 精确表示 ${value}`)
      },
    )

    test('exact boundary overshoot renders saturated with a non-zero scientific delta', () => {
      // Counterexample C: 32767.0000000000000001 folds to 32767 in binary64
      // (the legacy readout claimed exact/0); the exact pipeline reports a
      // strictly out-of-range request with an exact +1e-16 delta.
      const vm = toCalculatorViewModel(
        make({
          mode: 'DIRECT',
          raw: 0x7fff,
          direct: { m: 1, b: 0, r: 0, errors: { m: null, b: null, r: null } },
          valueRequest: { mode: 'DIRECT', value: 32767, text: '32767.0000000000000001' },
        }),
      )
      expect(vm.deltaText).toBe('+1e-16（已编码到边界值）')
      expect(vm.deltaKind).toBe('error')
      expect(vm.deltaNote).toContain('用户请求 32767.0000000000000001')
      expect(vm.deltaNote).toContain('已饱和')
    })
  })

  describe('mode=HALF', () => {
    test.each([
      { raw: 0x0000, text: '0' },
      { raw: 0x8000, text: '-0' },
      { raw: 0x0001, text: '5.96046447754e-8' },
      { raw: 0x03ff, text: '0.0000609755516052' },
      { raw: 0x0400, text: '0.00006103515625' },
      { raw: 0x7bff, text: '65504' },
      { raw: 0x7c00, text: '+Infinity' },
      { raw: 0xfc00, text: '-Infinity' },
      { raw: 0x7e00, text: 'NaN' },
    ])('shows HALF word $raw as $text before any explicit encode request', ({ raw, text }) => {
      const vm = toCalculatorViewModel(make({ mode: 'HALF', raw }))
      expect(vm.valueText).toBe(text)
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

    test('a committed HALF special value reports that quantization is inapplicable', () => {
      const state = appReducer(make({ mode: 'HALF' }), { type: 'value/set', value: 'NaN' })
      const nan = toCalculatorViewModel(state)
      expect(nan.deltaText).toBe('NaN → NaN')
      expect(nan.deltaKind).toBe('warn')
      expect(nan.deltaNote).toContain('量化误差不适用')
    })

    test('finite overflow surfaces as an error in the readout and steps', () => {
      const state = appReducer(make({ mode: 'HALF' }), { type: 'value/set', value: '65520' })
      const vm = toCalculatorViewModel(state)
      expect(vm.deltaText).toBe('65520 → +Infinity')
      expect(vm.deltaKind).toBe('error')
      expect(vm.deltaNote).toContain('溢出')
      expect(vm.steps.find((step) => step.id === 'half-quantization')?.plainText).toBe(
        '格式编码量化误差（请求值 − 表示值） = （有限值编码溢出为 +Infinity）',
      )
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

  test('C macro copies the raw word and its formula as RAW_VALUE', () => {
    const vm = toCalculatorViewModel(make({ raw: 0x000c }))
    expect(vm.cMacroText).toBe('#define RAW_VALUE 0x000C /* Y=12 × 2^0 */')
  })

  test.each(['DIRECT', 'L11', 'L16', 'HALF', 'VOUT_MODE'] as const)(
    '%s does not surface DIRECT coefficient errors in the InfoPanel',
    (mode) => {
      const direct = appReducer(make({ mode }), {
        type: 'direct/set-coeff',
        name: 'm',
        value: '2.5',
      })
      expect(direct.direct.errors.m).toBeTruthy()
      expect(toCalculatorViewModel(direct).warnings).toEqual([])
    },
  )

  describe('warnings', () => {
    test('default L11 state has no Y=0 info warning', () => {
      const vm = toCalculatorViewModel(BASE)
      expect(vm.warnings).toHaveLength(0)
    })

    test('auto-N saturation warns just outside the global L11 range', () => {
      for (const [raw, endpoint, outside] of [
        [0x7bff, PMBusMath.maxLinear11(), 1],
        [0x7c00, PMBusMath.minLinear11(), -1],
      ]) {
        const atEndpoint = toCalculatorViewModel(
          make({ raw, l11: { ...BASE.l11, valueInput: endpoint } }),
        )
        expect(atEndpoint.warnings).toHaveLength(0)

        const saturated = toCalculatorViewModel(
          make({ raw, l11: { ...BASE.l11, valueInput: endpoint + outside } }),
        )
        expect(saturated.warnings.some((warning) => warning.id === 'l11-saturation')).toBe(true)
      }
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

    test('LINEAR11 saturation diagnostics stay scoped to LINEAR11', () => {
      const l11 = { ...BASE.l11, valueInput: 1e9 }
      for (const mode of ['L16', 'DIRECT', 'HALF', 'VOUT_MODE'] as const) {
        const vm = toCalculatorViewModel(make({ mode, l11 }))
        expect(
          vm.warnings.some((warning) => warning.id === 'l11-saturation'),
          mode,
        ).toBe(false)
      }
    })
  })
})

describe('量化误差符号与提示等级', () => {
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

describe('DIRECT 显示精度、重输和复制', () => {
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
    // The re-entry verdict is the DISPLAY text's typed encode: "-1" → Y=0.
    expect(vm.directFidelity!.displayReencodedY).toBe(0)
    expect(vm.directFidelity!.lossKind).toBe('binary64-representation')
    expect(vm.directFidelity!.safeReentryText).toBe('-1.00000000000000001')
    expect(vm.directFidelity!.safeReentryKind).toBe('exact')
    // Copy override hands out the verified exact text with the note.
    expect(vm.physicalValueCopyOverride?.text).toBe('-1.00000000000000001')
    expect(vm.physicalValueCopyOverride?.kind).toBe('exact')
    expect(vm.physicalValueCopyOverride?.note).toContain('复制精确值')
    // The InfoPanel warning names the approximation and the re-entry verdict.
    const warning = vm.warnings.find((w) => w.id === 'direct-precision-fold')
    expect(warning).toBeDefined()
    expect(warning!.level).toBe('warning')
    expect(warning!.text).toContain('浮点精度有限')
    expect(warning!.text).toContain('重新输入显示值会得到 Y = 0')
    // The calculation steps carry the exact value lines.
    const steps = vm.steps
    expect(steps.find((s) => s.id === 'direct-exact-value')?.value).toBe(
      '-100000000000000001/100000000000000000',
    )
    expect(steps.find((s) => s.id === 'direct-exact-decimal')?.value).toBe('-1.00000000000000001')
  })

  test('显示位数导致 FFFF 重输偏差时提供精确值和复制文本', () => {
    // The binary64 value round-trips (v2.5.11's guard is blind here), but the
    // displayed text "-1" encodes to Y=0 through the real typed path.
    const vm = toCalculatorViewModel(directWith(0xffff, 1, 1, 12))
    expect(vm.valueText).toBe('-1')
    expect(vm.directFidelity).toBeDefined()
    expect(vm.directFidelity!.lossKind).toBe('display-formatting')
    expect(vm.directFidelity!.displayReencodedY).toBe(0)
    expect(vm.directFidelity!.safeReentryText).toBe('-1.000000000001')
    expect(vm.directFidelity!.safeReentryKind).toBe('exact')
    expect(vm.physicalValueCopyOverride?.text).toBe('-1.000000000001')
    const warning = vm.warnings.find((w) => w.id === 'direct-precision-fold')
    expect(warning).toBeDefined()
    expect(warning!.text).toContain('显示位数有限')
    expect(warning!.text).toContain('重新输入显示值会得到 Y = 0')
    // The exact value rows appear in the steps for the newly-covered family.
    expect(vm.steps.find((s) => s.id === 'direct-exact-value')?.value).toBe(
      '-1000000000001/1000000000000',
    )
    expect(vm.steps.find((s) => s.id === 'direct-exact-decimal')?.value).toBe('-1.000000000001')
  })

  test('循环小数的可重输复制文本注明为近似值', () => {
    const vm = toCalculatorViewModel(directWith(0x0000, 3, 1, 16))
    expect(vm.valueText).toBe('-0.333333333333')
    expect(vm.directFidelity).toBeDefined()
    expect(vm.directFidelity!.lossKind).toBe('display-formatting')
    expect(vm.directFidelity!.displayReencodedY).toBe(10000)
    expect(vm.directFidelity!.exactDecimalText).toBeNull()
    expect(vm.directFidelity!.safeReentryText).toBe('-0.33333333333333333')
    expect(vm.directFidelity!.safeReentryKind).toBe('approximate')
    // Copy note must not present the verified approximation as the exact value.
    expect(vm.physicalValueCopyOverride?.kind).toBe('approximate')
    expect(vm.physicalValueCopyOverride?.note).toContain('循环小数')
    expect(vm.physicalValueCopyOverride?.note).toContain('近似值')
    const warning = vm.warnings.find((w) => w.id === 'direct-precision-fold')
    expect(warning?.text).toContain('重新输入显示值会得到 Y = 10000')
    expect(vm.steps.find((s) => s.id === 'direct-exact-value')?.value).toBe('-1/3')
  })

  test('quiet (1,1,12) states stay noise-free: Y=1 display "-0.999999999999" re-enters safely', () => {
    const vm = toCalculatorViewModel(directWith(0x0001, 1, 1, 12))
    expect(vm.valueText).toBe('-0.999999999999')
    expect(vm.directFidelity).toBeUndefined()
    expect(vm.physicalValueCopyOverride).toBeUndefined()
    expect(vm.warnings.some((w) => w.id === 'direct-precision-fold')).toBe(false)
  })

  test('raw 0000 under the same coefficients is exact and silent (no noise)', () => {
    const vm = toCalculatorViewModel(directWith(0x0000, 1, 1, 17))
    expect(vm.directFidelity).toBeUndefined()
    expect(vm.physicalValueCopyOverride).toBeUndefined()
    expect(vm.physicalValueCopy).toBeUndefined()
    expect(vm.warnings.some((w) => w.id === 'direct-precision-fold')).toBe(false)
    expect(vm.steps.some((s) => s.id === 'direct-exact-value')).toBe(false)
  })

  test('a committed exact request reports its real delta when binary64 rounds it to zero', () => {
    const state = appReducer(directWith(0, 1, 1, 17), {
      type: 'value/set',
      value: '-1.000000000000000011',
    })
    const vm = toCalculatorViewModel(state)
    expect(state.raw).toBe(0xffff)
    expect(vm.deltaText).toContain('-1e-18')
    expect(vm.deltaKind).toBe('warn')
    expect(vm.deltaNote).toContain('量化误差按精确值计算')
  })

  test('preserves the saturation error when the endpoint displays an approximation', () => {
    const state = appReducer(directWith(0, 1, 1, 17), { type: 'value/set', value: '-2' })
    const vm = toCalculatorViewModel(state)

    expect(vm.rawHexDigits).toBe('8000')
    expect(vm.directFidelity?.displayReencodedY).toBe(0)
    expect(vm.deltaKind).toBe('error')
    expect(vm.deltaText).toContain('已编码到边界值')
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

  test('m=0 leaves an inline error, omits quantitative output and disables physical copy', () => {
    const zero = appReducer(directWith(10, 1, 0, 0), {
      type: 'direct/set-coeff',
      name: 'm',
      value: '0',
    })
    const vm = toCalculatorViewModel(zero)
    expect(zero.direct.errors.m).toContain('m 不能为 0')
    expect(vm.valueText).toBe('—')
    expect(vm.deltaText).toBeUndefined()
    expect(vm.warnings).toEqual([])
    expect(vm.directFidelity).toBeUndefined()
    expect(vm.physicalValueCopyOverride).toBeUndefined()
    expect(vm.physicalValueCopy).toEqual({
      available: false,
      reason: expect.stringContaining('m=0'),
    })
  })

  test('copy override is absent for non-DIRECT modes (no cross-mode leak)', () => {
    const vm = toCalculatorViewModel(make({ raw: 0x0001, l11: { ...BASE.l11, valueInput: 1 } }))
    expect(vm.physicalValueCopyOverride).toBeUndefined()
    expect(vm.directFidelity).toBeUndefined()
  })
})
