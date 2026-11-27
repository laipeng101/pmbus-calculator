import { describe, expect, test } from 'vitest'
import { appReducer } from './reducer'
import { INITIAL_STATE, type AppState } from './state'
import { toCalculatorViewModel, type CalculatorViewModel } from './view-model'

const BASE: AppState = { ...INITIAL_STATE, mode: 'L16', raw: 0x0c00 }

function project(overrides: Partial<AppState> = {}) {
  return toCalculatorViewModel({ ...BASE, ...overrides })
}

function firstScreenEquation(vm: CalculatorViewModel) {
  const row = vm.workspace.rows.find((row) => row.key === 'substitution')
  return row?.layout === 'numeric' ? row.plainText : undefined
}

describe('LINEAR16 的首屏结果和复制行为', () => {
  test.each(['ulinear16', 'slinear16-offset'] as const)(
    '%s 显示实际配置字节，并按格式和标称参考值决定是否显示结果',
    (payloadKind) => {
      for (let byte = 0; byte < 256; byte++) {
        const hex = '0x' + byte.toString(16).padStart(2, '0').toUpperCase()
        const vm = project({
          raw: 0x3412,
          voutMode: { byte },
          l16: { payloadKind, nominalVout: null },
        })
        const raw = vm.resultContext.find((item) => item.key === 'raw')
        const parameters = vm.resultContext.find((item) => item.key === 'parameters')
        expect(raw, hex).toMatchObject({ value: '0x3412' })
        expect(vm.voutModeInfo, hex).toMatchObject({ byte, hex })
        expect(parameters, hex).toMatchObject({ kind: 'params' })
        const params = parameters?.kind === 'params' ? parameters.params : []
        expect(params, hex).toContainEqual(
          expect.objectContaining({ label: 'VOUT_MODE', value: hex }),
        )
        const nonLinear = (byte & 0x60) !== 0
        const missingReference = (byte & 0x80) !== 0 && payloadKind === 'ulinear16'
        if (nonLinear) {
          expect(vm.voutModeInfo?.source, hex).toBe('non-linear')
          expect(
            params.some((pair) => pair.label === 'N'),
            hex,
          ).toBe(false)
          expect(vm.nRangeText, hex).toBeUndefined()
          expect(
            vm.resultContext.find((item) => item.key === 'format'),
            hex,
          ).toMatchObject({
            value: '未按 LINEAR16 解释',
          })
        } else {
          const parameter = byte & 0x1f
          const n = parameter < 16 ? parameter : parameter - 32
          expect(params, hex).toContainEqual({ label: 'N', value: String(n), termId: 'exponent' })
          expect(vm.l16Payload?.physicalInputAvailable, hex).toBe(!missingReference)
        }

        if (nonLinear || missingReference) {
          expect(vm.valueText, hex).toBe('—')
          expect(vm.physicalValueCopy, hex).toEqual({
            available: false,
            reason: expect.stringContaining(nonLinear ? 'VOUT_MODE' : '标称参考值'),
          })
        } else {
          expect(vm.valueText, hex).not.toBe('—')
          expect(vm.physicalValueCopy, hex).toBeUndefined()
        }
      }
    },
  )

  test.each([
    { byte: 0x00, exponent: 0, value: '3072', range: '0 ~ 65535' },
    { byte: 0x08, exponent: 8, value: '786432', range: '0 ~ 16776960' },
    { byte: 0x18, exponent: -8, value: '12', range: '0 ~ 255.99609375' },
  ])('绝对 ULINEAR16 在 N=$exponent 时显示结果和可表示范围', (row) => {
    const vm = project({ voutMode: { byte: row.byte } })
    expect(vm.valueText).toBe(row.value)
    expect(firstScreenEquation(vm)).toBe(`X = V × 2^N = 3072 × 2^${row.exponent} = ${row.value}`)
    expect(vm.nRangeText).toBe(row.range)
    expect(vm.l16Payload?.blocked).toBeUndefined()
    expect(vm.physicalValueCopy).toBeUndefined()
    expect(vm.deltaText).toBeUndefined()
    expect(vm.warnings).toEqual([])
    expect(vm.voutModeInfo).toMatchObject({
      isLinear: true,
      isRelative: false,
      mode: 0,
      param: row.byte & 0x1f,
      status: 'ok',
      linearExponent: row.exponent,
    })
  })

  test('以 N=-8 解码无符号数据字的两端边界', () => {
    expect(project({ raw: 0 }).valueText).toBe('0')
    expect(project({ raw: 0xffff }).valueText).toBe('255.99609375')
  })

  test.each([
    { raw: 0x0466, byte: 0x96, nominalVout: 3.3, value: '3.6287109375', ratio: 'R=1126 × 2^-10' },
    { raw: 0x0100, byte: 0x98, nominalVout: 1e308, value: '1e+308', ratio: 'R=256 × 2^-8=1' },
    { raw: 0xffff, byte: 0x83, nominalVout: 1, value: '524280', ratio: 'R=65535 × 2^3=524280' },
    { raw: 0xffff, byte: 0x98, nominalVout: 0, value: '0', ratio: 'R=65535 × 2^-8' },
  ])('用标称电压 $nominalVout V 得到相对电压 $value V', (row) => {
    const vm = project({
      raw: row.raw,
      voutMode: { byte: row.byte },
      l16: { payloadKind: 'ulinear16', nominalVout: row.nominalVout },
    })
    expect(vm.valueText).toBe(row.value)
    const equation = firstScreenEquation(vm)
    expect(equation).toContain(row.ratio)
    expect(equation).toContain(`×R=${row.value} V`)
    expect(vm.nRangeText).toBeUndefined()
    expect(vm.physicalValueCopy).toBeUndefined()
    expect(vm.steps).toEqual([])
    expect(vm.warnings.filter((warning) => warning.id.startsWith('l16-'))).toEqual([])
  })

  test('缺少标称参考值时保留比值并提示填写参考值', () => {
    const vm = project({ voutMode: { byte: 0x98 }, raw: 0x0100 })
    expect(vm.valueText).toBe('—')
    expect(firstScreenEquation(vm)).toBe('R=256 × 2^-8=1（请填写 VOUT_COMMAND 标称参考值）')
    expect(vm.steps.map((step) => step.id)).toEqual(['l16-relative-nominal-missing'])
    expect(vm.steps[0].plainText).toContain('V_NOM')
    expect(vm.physicalValueCopy).toEqual({
      available: false,
      reason: expect.stringContaining('标称参考值'),
    })
    expect(vm.voutModeInfo).toMatchObject({
      isLinear: true,
      isRelative: true,
      status: 'reference-required',
    })
    expect(vm.warnings.map((warning) => warning.id)).toEqual(['vout-mode-relative'])
    expect(vm.l16Payload).toMatchObject({
      kind: 'ulinear16',
      signedOffset: false,
      relativeRatio: true,
      physicalInputAvailable: false,
      requiresNominalReference: true,
    })
  })

  test('相对 ULINEAR16 的比值为零时保留规范提示，有标称值时结果为零', () => {
    const state = { raw: 0, voutMode: { byte: 0x98 } }
    for (const nominalVout of [null, 0, 1e308]) {
      const vm = project({ ...state, l16: { payloadKind: 'ulinear16', nominalVout } })
      const warning = vm.warnings.find((warning) => warning.id === 'l16-relative-zero-ratio')
      expect(warning).toMatchObject({ level: 'warning' })
      expect(warning?.text).toContain('§8.5.2')
      expect(warning?.text).toContain('要求相对值大于 0')
      expect(
        vm.warnings.some((warning) => /^l16-relative-(underflow|overflow)$/.test(warning.id)),
      ).toBe(false)
      if (nominalVout === null) {
        expect(vm.valueText).toBe('—')
        expect(vm.physicalValueCopy?.available).toBe(false)
      } else {
        expect(vm.valueText).toBe('0')
        expect(vm.physicalValueCopy).toBeUndefined()
      }
    }

    for (const [byte, payloadKind] of [
      [0x18, 'ulinear16'],
      [0x98, 'slinear16-offset'],
    ] as const) {
      const vm = project({ raw: 0, voutMode: { byte }, l16: { payloadKind, nominalVout: 12 } })
      expect(vm.warnings.some((warning) => warning.id === 'l16-relative-zero-ratio')).toBe(false)
    }
  })

  test.each([
    {
      raw: 0x0200,
      byte: 0x98,
      nominalVout: 1e308,
      warning: 'overflow',
      reason: '计算结果太大，超出可表示范围',
      ratioEquation: 'R=512 × 2^-8=2（200%）',
      voltageEquation: 'X=1e+308×R=—',
    },
    {
      raw: 1,
      byte: 0x90,
      nominalVout: Number.MIN_VALUE,
      warning: 'underflow',
      reason: '计算下溢',
      ratioEquation: 'R=1 × 2^-16=0.0000152587890625（0.00152587890625%）',
      voltageEquation: 'X=5e-324×R=—',
    },
  ])('相对电压计算失败时，各处显示一致的诊断（$reason）', (row) => {
    const vm = project({
      raw: row.raw,
      voutMode: { byte: row.byte },
      l16: { payloadKind: 'ulinear16', nominalVout: row.nominalVout },
    })
    expect(vm.valueText).toBe('—')
    const equation = firstScreenEquation(vm)
    expect(equation).toContain(row.ratioEquation)
    expect(equation).toContain(`${row.voltageEquation}（${row.reason}`)
    expect(equation).not.toMatch(/Infinity|=0 V/)
    expect(vm.steps.map((step) => step.id)).toEqual(['l16-relative-range'])
    expect(vm.steps[0].plainText).toContain(row.reason)
    expect(vm.steps[0].plainText).not.toMatch(/Infinity|= 0 V/)
    expect(vm.warnings.map((warning) => [warning.id, warning.level])).toEqual([
      [`l16-relative-${row.warning}`, 'warning'],
    ])
    expect(vm.resultContext.find((item) => item.key === 'context')).toMatchObject({
      value: expect.stringContaining('无法计算电压'),
    })
    expect(vm.physicalValueCopy).toEqual({
      available: false,
      reason: expect.stringContaining(row.reason),
    })
  })

  test.each([
    { byte: 0x18, raw: 0x8000, y: -32768, value: '-128' },
    { byte: 0x18, raw: 0x7fff, y: 32767, value: '127.99609375' },
    { byte: 0x18, raw: 0xff00, y: -256, value: '-1' },
    { byte: 0x98, raw: 0xff00, y: -256, value: '-1' },
  ])('配置字节 $byte 不改变有符号偏移的结果 $value V', (row) => {
    const vm = project({
      raw: row.raw,
      voutMode: { byte: row.byte },
      l16: { payloadKind: 'slinear16-offset', nominalVout: 1e308 },
    })
    expect(vm.valueText).toBe(row.value)
    expect(firstScreenEquation(vm)).toBe(`X_offset = Y_s × 2^N = ${row.y} × 2^-8 = ${row.value}`)
    expect(vm.nRangeText).toBe('-128 ~ 127.99609375')
    expect(vm.l16Payload).toMatchObject({
      kind: 'slinear16-offset',
      signedOffset: true,
      relativeRatio: false,
      physicalInputAvailable: true,
      requiresNominalReference: false,
    })
    expect(vm.physicalValueCopy).toBeUndefined()
    expect(vm.steps).toEqual([])
    expect(vm.warnings.filter((warning) => warning.id.startsWith('l16-'))).toEqual([])
  })

  test('ULINEAR16 量化读数按请求值减去表示值计算', () => {
    const state = appReducer(BASE, { type: 'value/set', value: '0.005' })
    const vm = toCalculatorViewModel(state)
    expect(vm.valueText).toBe('0.00390625')
    expect(vm.deltaText).toBe('+0.001094 (21.8750%)')
    expect(vm.deltaKind).toBe('warn')
  })

  test('手动修改 Y_s 清除有符号偏移的量化读数和步骤', () => {
    const state: AppState = {
      ...BASE,
      voutMode: { byte: 0x98 },
      l16: { payloadKind: 'slinear16-offset', nominalVout: null },
    }
    const encoded = appReducer(state, { type: 'value/set', value: '3.3' })
    const pending = toCalculatorViewModel(encoded)
    expect(pending.valueText).toBe('3.30078125')
    expect(pending.deltaText).toBe('-0.000781 (-0.0237%)')
    expect(pending.deltaKind).toBe('warn')
    expect(pending.deltaNote).toBeUndefined()
    expect(pending.steps.map((step) => step.id)).toContain('l16-quantization')

    const edited = toCalculatorViewModel(appReducer(encoded, { type: 'l16/set-slinear-y', y: '1' }))
    expect(edited.deltaText).toBeUndefined()
    expect(edited.deltaKind).toBeUndefined()
    expect(edited.steps.map((step) => step.id)).not.toContain('l16-quantization')
  })
})

describe('LINEAR16 的非 LINEAR 配置提示', () => {
  test.each([
    { byte: 0x20, format: 'VID', blocked: 'vid-profile-required', detail: ['没有可用的电压映射'] },
    {
      byte: 0x3e,
      format: 'VID',
      blocked: 'vid-profile-required',
      detail: ['器件资料中的 VID 码表'],
    },
    {
      byte: 0x40,
      format: 'DIRECT',
      blocked: 'direct-profile-required',
      detail: ['在 DIRECT 页换算', 'm、b、R', '§7.4'],
    },
    {
      byte: 0x60,
      format: 'IEEE Half',
      blocked: 'half-unsupported-in-l16',
      detail: ['切换到 HALF 页', '§8.4.4'],
    },
    { byte: 0x41, format: 'DIRECT', blocked: 'reserved-or-invalid', detail: ['00000b'] },
    { byte: 0x61, format: 'IEEE Half', blocked: 'reserved-or-invalid', detail: ['00000b'] },
    { byte: 0xa0, format: 'VID', blocked: 'vid-relative-invalid', detail: ['§8.5.3'] },
  ])(
    '配置字节 $byte 不进行 LINEAR16 换算，并报告 $blocked',
    ({ byte, format, blocked, detail }) => {
      const vm = project({ voutMode: { byte } })
      expect(vm.valueText).toBe('—')
      const equation = firstScreenEquation(vm)
      expect(equation).toContain('非 LINEAR')
      expect(equation).not.toContain('相对 LINEAR')
      expect(vm.nRangeText).toBeUndefined()
      expect(vm.l16Payload).toMatchObject({
        blocked: { status: blocked },
        nonLinearFormat: format,
        physicalInputAvailable: false,
        nonLinear: true,
        requiresNominalReference: false,
      })
      for (const text of detail) expect(vm.l16Payload?.blocked?.detail).toContain(text)
      expect(vm.warnings[0]).toMatchObject({ id: 'l16-vout-mode-nonlinear', level: 'warning' })
      expect(vm.steps.map((step) => step.id)).toEqual(['l16-nonlinear'])
      expect(vm.deltaText).toBeUndefined()
      if (blocked === 'reserved-or-invalid') {
        expect(vm.warnings[1]).toMatchObject({ id: 'vout-mode-invalid-parameter', level: 'error' })
      }
      if (byte === 0x20) expect(vm.voutModeInfo?.domainStatus).toBe('not-used')
      if (byte === 0x3e) expect(vm.l16Payload?.blocked?.title).toContain('1Eh — 制造商自定义')
    },
  )

  test.each([
    {
      byte: 0x20,
      status: 'vid-offset-prohibited',
      warning: 'vout-mode-vid-offset-prohibited',
      spec: '§13.3 / §13.4',
    },
    {
      byte: 0x3e,
      status: 'vid-offset-prohibited',
      warning: 'vout-mode-vid-offset-prohibited',
      spec: '§13.3 / §13.4',
    },
    {
      byte: 0xa0,
      status: 'vid-relative-invalid',
      warning: 'vout-mode-invalid-combination',
      spec: '§8.5.3',
    },
  ])('VID 配置字节 $byte 在有符号偏移模式中报告错误 $status', (row) => {
    const vm = project({
      voutMode: { byte: row.byte },
      l16: { payloadKind: 'slinear16-offset', nominalVout: null },
    })
    expect(vm.valueText).toBe('—')
    expect(vm.l16Payload?.blocked?.status).toBe(row.status)
    expect(vm.l16Payload?.blocked?.detail).toContain(row.spec)
    expect(vm.warnings[0]).toMatchObject({ id: 'l16-vout-mode-nonlinear' })
    expect(vm.warnings[1]).toMatchObject({ id: row.warning, level: 'error' })
    expect(vm.voutModeInfo?.explanations[0]?.id).toBe('slinear16-bit7-na')
    if (row.status === 'vid-offset-prohibited') {
      expect(vm.l16Payload?.blocked?.detail).toContain('VOUT_TRIM / VOUT_CAL_OFFSET')
    }
  })

  test('显式应用 LINEAR 示例后恢复可表示范围和物理值输入', () => {
    const blocked = { ...BASE, voutMode: { byte: 0x40 } }
    const after = appReducer(blocked, { type: 'l16/apply-calculator-linear-example' })
    const vm = toCalculatorViewModel(after)
    expect(vm.nRangeText).toBe('0 ~ 255.99609375')
    expect(vm.l16Payload?.physicalInputAvailable).toBe(true)
    expect(vm.l16Payload?.blocked).toBeUndefined()
  })
})
