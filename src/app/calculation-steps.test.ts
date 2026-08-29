import { describe, expect, it } from 'vitest'
import { buildCalculationSteps } from './calculation-steps'
import type { AppState } from './state'
import { INITIAL_STATE } from './reducer'

function state(partial: Partial<AppState>): AppState {
  return {
    ...INITIAL_STATE,
    ...partial,
    voutMode: { ...INITIAL_STATE.voutMode, ...(partial.voutMode ?? {}) },
    l11: { ...INITIAL_STATE.l11, ...(partial.l11 ?? {}) },
    l16: { ...INITIAL_STATE.l16, ...(partial.l16 ?? {}) },
    direct: { ...INITIAL_STATE.direct, ...(partial.direct ?? {}) },
  }
}

function kinds(steps: ReturnType<typeof buildCalculationSteps>): string[] {
  return steps.map((s) => s.kind)
}

describe('buildCalculationSteps — quantization-error step (LINEAR11 parity)', () => {
  it('appends the quantization intermediate after an explicit L16 encode request', () => {
    const steps = buildCalculationSteps(
      state({
        mode: 'L16',
        raw: 0x0001,
        valueRequest: { mode: 'L16', value: 0.005 },
      }),
    )
    const q = steps.at(-1)
    expect(q?.id).toBe('l16-quantization')
    expect(q?.kind).toBe('intermediate')
    expect(q?.label).toBe('格式编码量化误差（请求值 − 表示值）')
    expect(q?.plainText).toContain('= ')
  })

  it('appends the quantization intermediate for DIRECT and HALF requests', () => {
    const direct = buildCalculationSteps(
      state({
        mode: 'DIRECT',
        raw: 1235,
        valueRequest: { mode: 'DIRECT', value: 1.2345, text: '1.2345' },
      }),
    )
    expect(direct.some((s) => s.id === 'direct-quantization' && s.kind === 'intermediate')).toBe(
      true,
    )

    const half = buildCalculationSteps(
      state({ mode: 'HALF', raw: 0x3c05, valueRequest: { mode: 'HALF', value: 1.005 } }),
    )
    expect(half.some((s) => s.id === 'half-quantization' && s.kind === 'intermediate')).toBe(true)
  })

  it('keeps the walkthrough free of a quantization line without an explicit request', () => {
    // No request on any page → no fabricated error line (the panel's ±0
    // baseline is display-only and must not leak into the steps).
    expect(
      buildCalculationSteps(state({ mode: 'L16' })).some((s) => s.id.endsWith('-quantization')),
    ).toBe(false)
    expect(
      buildCalculationSteps(state({ mode: 'DIRECT' })).some((s) => s.id.endsWith('-quantization')),
    ).toBe(false)
    expect(
      buildCalculationSteps(state({ mode: 'HALF' })).some((s) => s.id.endsWith('-quantization')),
    ).toBe(false)
  })

  it('never appends quantization steps on the VOUT_MODE byte calculator', () => {
    const steps = buildCalculationSteps(state({ mode: 'VOUT_MODE' }))
    expect(steps.some((s) => s.id.endsWith('-quantization'))).toBe(false)
  })
})

describe('buildCalculationSteps — unified four-mode skeleton', () => {
  it('L11 exposes fields, formula, intermediates, and result', () => {
    const steps = buildCalculationSteps(state({ mode: 'L11', raw: 0xf819 }))
    expect(kinds(steps)).toEqual(['field', 'field', 'formula', 'intermediate', 'formula', 'result'])
    expect(steps[0]?.label).toContain('N')
    expect(steps[1]?.label).toContain('Y')
    expect(steps[4]?.plainText).toBe('X = 25 × 2^-1')
    expect(steps[5]?.value).toBe('12.5')
  })

  it('L11 saturation adds a warning step only when out of range', () => {
    const max = 1023 * Math.pow(2, 15)
    const saturated = buildCalculationSteps(
      state({ mode: 'L11', l11: { ...INITIAL_STATE.l11, valueInput: max + 1 } }),
    )
    expect(saturated.some((s) => s.kind === 'warning' && s.id === 'l11-saturation')).toBe(true)

    const boundary = buildCalculationSteps(
      state({ mode: 'L11', raw: 0x7fff, l11: { ...INITIAL_STATE.l11, valueInput: max } }),
    )
    expect(boundary.some((s) => s.id === 'l11-saturation')).toBe(false)
  })

  it('L16 absolute LINEAR exposes VOUT_MODE fields and the X = V × 2^N chain', () => {
    const steps = buildCalculationSteps(
      state({ mode: 'L16', raw: 0x0c00, voutMode: { byte: 0x18 } }),
    )
    expect(kinds(steps)).toEqual([
      'field',
      'field',
      'field',
      'field',
      'field',
      'field',
      'formula',
      'intermediate',
      'formula',
      'result',
    ])
    expect(steps[2]?.plainText).toBe('bits[6:5] 格式 = LINEAR (0)')
    expect(steps.some((s) => s.kind === 'result' && s.value === '12')).toBe(true)
  })

  it('L16 relative LINEAR explains exponent/ratio but never fakes an absolute result', () => {
    const steps = buildCalculationSteps(
      state({ mode: 'L16', raw: 0x0c00, voutMode: { byte: 0x98 } }),
    )
    expect(steps.some((s) => s.kind === 'result')).toBe(false)
    expect(steps.some((s) => s.kind === 'warning' && s.id === 'l16-relative-nominal-missing')).toBe(
      true,
    )
    expect(steps.some((s) => s.plainText.includes('标称参考值'))).toBe(true)
    // 相对 LINEAR 可解释 VOUT_MODE 参数位的指数/比值语义……
    expect(steps.some((s) => s.id === 'l16-n')).toBe(true)
    expect(steps.some((s) => s.id === 'l16-2n')).toBe(true)
    expect(steps.some((s) => s.id === 'l16-ratio')).toBe(true)
    // ……但不得把 raw 标成绝对电压（无 V 字段、无结果）。
    expect(steps.some((s) => s.id === 'l16-v')).toBe(false)
  })

  it('L16 relative derivation overflow ends in — with the shared note, never Infinity (v2.5.9)', () => {
    const steps = buildCalculationSteps(
      state({
        mode: 'L16',
        raw: 0x0200,
        voutMode: { byte: 0x98 },
        l16: { payloadKind: 'ulinear16', nominalVout: 1e308 },
      }),
    )
    const final = steps.find((s) => s.id === 'l16-final')
    expect(final?.plainText).toBe('X = 1e+308 × 2 = —（计算结果超出 JavaScript Number 可表示范围）')
    const result = steps.find((s) => s.kind === 'result')
    expect(result?.value).toBe('—')
    expect(steps.some((s) => s.plainText.includes('Infinity'))).toBe(false)
    // Nominal and ratio intermediates stay visible.
    expect(steps.some((s) => s.id === 'l16-nominal' && s.value === '1e+308')).toBe(true)
    expect(steps.some((s) => s.id === 'l16-ratio' && s.value === '2')).toBe(true)
  })

  it('L16 relative derivation underflow ends in — and is not presented as exact zero (v2.5.9)', () => {
    const steps = buildCalculationSteps(
      state({
        mode: 'L16',
        raw: 0x0001,
        voutMode: { byte: 0x90 },
        l16: { payloadKind: 'ulinear16', nominalVout: 5e-324 },
      }),
    )
    const result = steps.find((s) => s.kind === 'result')
    expect(result?.value).toBe('—')
    expect(steps.some((s) => s.plainText.includes('计算下溢'))).toBe(true)
    expect(steps.some((s) => s.plainText.includes('= 0 V'))).toBe(false)
  })

  it('L16 非 LINEAR 共享字节 fail closed：无伪 N、无伪结果（v2.5.2）', () => {
    for (const byte of [0x40, 0x60, 0xe0, 0x20, 0xa0, 0x41, 0xc1, 0xe1]) {
      const steps = buildCalculationSteps(state({ mode: 'L16', raw: 0x0c00, voutMode: { byte } }))
      expect(
        steps.some((s) => s.kind === 'warning' && s.id === 'l16-nonlinear'),
        `0x${byte.toString(16)}`,
      ).toBe(true)
      // §8.4 fail-closed contract: no pseudo N field, no LINEAR V expansion,
      // and never a fabricated result from a substituted 0x18.
      expect(
        steps.some((s) => s.id === 'l16-n'),
        `0x${byte.toString(16)}`,
      ).toBe(false)
      expect(
        steps.some((s) => s.id === 'l16-v'),
        `0x${byte.toString(16)}`,
      ).toBe(false)
      expect(
        steps.some((s) => s.kind === 'result' && s.value === '12'),
        `0x${byte.toString(16)}`,
      ).toBe(false)
    }
  })

  it('L11 手动 N 饱和：超出锁定 N 的 Y 范围时出现饱和提示', () => {
    const manual = state({
      mode: 'L11',
      raw: 0x03ff,
      l11: { ...INITIAL_STATE.l11, autoN: false, n: 0, valueInput: 2000 },
    })
    const steps = buildCalculationSteps(manual)
    expect(steps.some((s) => s.id === 'l11-saturation')).toBe(true)

    const boundary = state({
      mode: 'L11',
      raw: 0x03ff,
      l11: { ...INITIAL_STATE.l11, autoN: false, n: 0, valueInput: 1023 },
    })
    expect(buildCalculationSteps(boundary).some((s) => s.id === 'l11-saturation')).toBe(false)
  })

  it('DIRECT exposes fields, formula, intermediates, and result', () => {
    const steps = buildCalculationSteps(
      state({
        mode: 'DIRECT',
        raw: 10,
        direct: { m: 2, b: 0, r: 0, errors: { m: null, b: null, r: null } },
      }),
    )
    expect(kinds(steps)).toEqual([
      'field',
      'field',
      'field',
      'field',
      'formula',
      'intermediate',
      'intermediate',
      'intermediate',
      'intermediate',
      'formula',
      'result',
    ])
    expect(steps.some((s) => s.kind === 'result' && s.value === '5')).toBe(true)
    expect(steps[5]?.plainText).toBe('10^(-R) = 10^0 = 1')
  })

  it('DIRECT m=0 produces an explicit error step without a result', () => {
    const steps = buildCalculationSteps(
      state({
        mode: 'DIRECT',
        raw: 1,
        direct: { m: 0, b: 0, r: 0, errors: { m: 'DIRECT 系数 m 不能为 0', b: null, r: null } },
      }),
    )
    expect(steps.some((s) => s.kind === 'result')).toBe(false)
    expect(steps.some((s) => s.kind === 'warning' && s.id === 'direct-m-zero')).toBe(true)
  })

  it('HALF exposes S/E/F fields, classification, piecewise formula, and result', () => {
    const normal = buildCalculationSteps(state({ mode: 'HALF', raw: 0x3c00 }))
    expect(normal[0]?.label).toContain('S')
    expect(normal[1]?.label).toContain('E')
    expect(normal[2]?.label).toContain('F')
    expect(normal.some((s) => s.plainText.includes('正规数'))).toBe(true)
    expect(normal.some((s) => s.kind === 'result' && s.value === '1')).toBe(true)

    const minusZero = buildCalculationSteps(state({ mode: 'HALF', raw: 0x8000 }))
    expect(minusZero.some((s) => s.kind === 'result' && s.value === '-0')).toBe(true)
  })

  it('HALF NaN and ±Infinity are classified without crashing', () => {
    for (const raw of [0x7e00, 0x7c00, 0xfc00]) {
      const steps = buildCalculationSteps(state({ mode: 'HALF', raw }))
      expect(steps.length).toBeGreaterThan(3)
    }
  })
})

describe('buildCalculationSteps — VOUT_MODE page DIRECT/Half requirement split (v2.5.4)', () => {
  const HALF_BANNED = ['需器件资料', '器件 Profile', 'm/b/R', 'DIRECT 系数', '设备数据']

  function voutModeSteps(byte: number) {
    return buildCalculationSteps(state({ mode: 'VOUT_MODE', voutMode: { byte } }))
  }

  it('0x60/0xE0 step copy states standard binary16 and never claims device numbers', () => {
    for (const byte of [0x60, 0xe0]) {
      const steps = voutModeSteps(byte)
      const step = steps.find((s) => s.id === 'vout-mode-half')
      expect(step, `0x${byte.toString(16)}`).toBeDefined()
      const copy = steps.map((s) => s.plainText).join('\n')
      expect(copy).toContain('标准 IEEE 754 binary16')
      for (const banned of HALF_BANNED) {
        expect(copy, `0x${byte.toString(16)} unexpected copy: ${banned}`).not.toContain(banned)
      }
    }
    // Absolute Half points at the existing HALF converter; only the relative
    // byte adds the nominal-reference requirement (§8.5.2).
    const absolute = voutModeSteps(0x60)
      .map((s) => s.plainText)
      .join('\n')
    expect(absolute).toContain('HALF 模式页')
    expect(absolute).not.toContain('标称参考值')
    const relative = voutModeSteps(0xe0)
      .map((s) => s.plainText)
      .join('\n')
    expect(relative).toContain('标称参考值')
    expect(relative).toContain('§8.5.2')
  })

  it('0x40/0xC0 step copy keeps the device m/b/R requirement', () => {
    for (const byte of [0x40, 0xc0]) {
      const steps = voutModeSteps(byte)
      expect(
        steps.some((s) => s.id === 'vout-mode-direct'),
        `0x${byte.toString(16)}`,
      ).toBe(true)
      const copy = steps.map((s) => s.plainText).join('\n')
      expect(copy).toContain('m/b/R')
      expect(copy).toContain('器件')
    }
    expect(voutModeSteps(0x40).some((s) => s.plainText.includes('标称参考值'))).toBe(false)
    expect(voutModeSteps(0xc0).some((s) => s.plainText.includes('标称参考值'))).toBe(true)
  })

  it('0x61/0xE1 keep the invalid-parameter step without any format requirement branch', () => {
    for (const byte of [0x61, 0xe1]) {
      const steps = voutModeSteps(byte)
      expect(steps.some((s) => s.id === 'vout-mode-half')).toBe(false)
      expect(steps.some((s) => s.id === 'vout-mode-direct')).toBe(false)
      expect(
        steps.some((s) => s.plainText.includes('00000b')),
        `0x${byte.toString(16)}`,
      ).toBe(true)
    }
  })
})
