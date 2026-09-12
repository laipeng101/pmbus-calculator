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

function ids(steps: ReturnType<typeof buildCalculationSteps>): string[] {
  return steps.map((s) => s.id)
}

function directCoeffs(m: number, b: number, r: number) {
  return { m, b, r, errors: { m: null, b: null, r: null } }
}

describe('buildCalculationSteps — diagnostics-only contract', () => {
  it('ordinary decode adds no supplemental steps for any numeric mode', () => {
    expect(buildCalculationSteps(state({ mode: 'L11', raw: 0xf819 }))).toEqual([])
    expect(
      buildCalculationSteps(state({ mode: 'L16', raw: 0x0c00, voutMode: { byte: 0x18 } })),
    ).toEqual([])
    expect(
      buildCalculationSteps(state({ mode: 'DIRECT', raw: 10, direct: directCoeffs(2, 0, 0) })),
    ).toEqual([])
    expect(buildCalculationSteps(state({ mode: 'HALF', raw: 0x0000 }))).toEqual([])
    expect(buildCalculationSteps(state({ mode: 'HALF', raw: 0x3c00 }))).toEqual([])
  })

  it('L11 adds a saturation warning plus the shared quantization step when a request exceeds the range', () => {
    const max = 1023 * Math.pow(2, 15)
    const saturated = buildCalculationSteps(
      state({ mode: 'L11', l11: { ...INITIAL_STATE.l11, valueInput: max + 1 } }),
    )
    expect(ids(saturated)).toEqual(['l11-saturation', 'l11-quantization'])
    expect(saturated[0]?.kind).toBe('warning')

    const boundary = buildCalculationSteps(
      state({ mode: 'L11', raw: 0x7fff, l11: { ...INITIAL_STATE.l11, valueInput: max } }),
    )
    expect(ids(boundary)).toEqual(['l11-quantization'])
  })

  it('L11 手动 N 饱和：超出锁定 N 的 Y 范围时出现饱和提示', () => {
    const manual = state({
      mode: 'L11',
      raw: 0x03ff,
      l11: { ...INITIAL_STATE.l11, autoN: false, n: 0, valueInput: 2000 },
    })
    expect(ids(buildCalculationSteps(manual))).toEqual(['l11-saturation', 'l11-quantization'])

    const boundary = state({
      mode: 'L11',
      raw: 0x03ff,
      l11: { ...INITIAL_STATE.l11, autoN: false, n: 0, valueInput: 1023 },
    })
    expect(ids(buildCalculationSteps(boundary))).toEqual(['l11-quantization'])
  })

  it('L16 relative without a nominal reference keeps only the reference warning', () => {
    const steps = buildCalculationSteps(
      state({ mode: 'L16', raw: 0x0c00, voutMode: { byte: 0x98 } }),
    )
    expect(ids(steps)).toEqual(['l16-relative-nominal-missing'])
    expect(steps[0]?.plainText).toContain('V_NOM')
  })

  it('L16 relative overflow/underflow keep only the range diagnostic, never Infinity', () => {
    const overflow = buildCalculationSteps(
      state({
        mode: 'L16',
        raw: 0x0200,
        voutMode: { byte: 0x98 },
        l16: { payloadKind: 'ulinear16', nominalVout: 1e308 },
      }),
    )
    expect(ids(overflow)).toEqual(['l16-relative-range'])
    expect(overflow[0]?.plainText).toContain('计算结果超出 JavaScript Number 可表示范围')
    expect(overflow.some((s) => s.plainText.includes('Infinity'))).toBe(false)

    const underflow = buildCalculationSteps(
      state({
        mode: 'L16',
        raw: 0x0001,
        voutMode: { byte: 0x90 },
        l16: { payloadKind: 'ulinear16', nominalVout: 5e-324 },
      }),
    )
    expect(ids(underflow)).toEqual(['l16-relative-range'])
    expect(underflow[0]?.plainText).toContain('计算下溢')
    expect(underflow.some((s) => s.plainText.includes('= 0 V'))).toBe(false)
  })

  it('L16 非 LINEAR 共享字节 fail closed：无伪 N、无伪 V、无伪结果（v2.5.2）', () => {
    for (const byte of [0x40, 0x60, 0xe0, 0x20, 0xa0, 0x41, 0xc1, 0xe1]) {
      const steps = buildCalculationSteps(state({ mode: 'L16', raw: 0x0c00, voutMode: { byte } }))
      const tag = '0x' + byte.toString(16)
      expect(ids(steps), tag).toEqual(['l16-nonlinear'])
      expect(
        steps.some((s) => s.id === 'l16-n' || s.id === 'l16-v'),
        tag,
      ).toBe(false)
    }
  })

  it('DIRECT m=0 produces an explicit error step only', () => {
    const steps = buildCalculationSteps(
      state({
        mode: 'DIRECT',
        raw: 1,
        direct: { m: 0, b: 0, r: 0, errors: { m: 'DIRECT 系数 m 不能为 0', b: null, r: null } },
      }),
    )
    expect(ids(steps)).toEqual(['direct-m-zero'])
    expect(steps[0]?.kind).toBe('warning')
  })

  it('HALF keeps only subnormal scale factors and special-encoding notes', () => {
    const subnormal = buildCalculationSteps(state({ mode: 'HALF', raw: 0x0001 }))
    expect(ids(subnormal)).toEqual(['half-2e', 'half-fraction'])
    expect(subnormal[0]?.value).toBe('0.00006103515625')

    expect(ids(buildCalculationSteps(state({ mode: 'HALF', raw: 0x7e00 })))).toEqual(['half-nan'])
    expect(ids(buildCalculationSteps(state({ mode: 'HALF', raw: 0x7c00 })))).toEqual([
      'half-infinity',
    ])
    expect(ids(buildCalculationSteps(state({ mode: 'HALF', raw: 0xfc00 })))).toEqual([
      'half-infinity',
    ])
  })
})

describe('buildCalculationSteps — quantization-error step (shared provenance)', () => {
  it('appends the quantization intermediate after an explicit L16 encode request', () => {
    const steps = buildCalculationSteps(
      state({
        mode: 'L16',
        raw: 0x0001,
        valueRequest: { mode: 'L16', value: 0.005 },
      }),
    )
    expect(ids(steps)).toEqual(['l16-quantization'])
    const q = steps.at(-1)
    expect(q?.kind).toBe('intermediate')
    expect(q?.label).toBe('格式编码量化误差（请求值 − 表示值）')
    expect(q?.plainText).toContain('= ')
  })

  it('appends the quantization intermediate for L11, DIRECT and HALF requests', () => {
    const l11 = buildCalculationSteps(
      state({
        mode: 'L11',
        raw: 0xc101,
        l11: { ...INITIAL_STATE.l11, n: -8, y: 257, autoN: false, valueInput: 1.005 },
      }),
    )
    expect(l11.some((s) => s.id === 'l11-quantization' && s.kind === 'intermediate')).toBe(true)

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

describe('buildCalculationSteps — DIRECT exact request transaction (v2.5.12)', () => {
  it('exposes request, exact represented value, and exact delta for a committed lexeme', () => {
    // Counterexample A: raw encodes exactly, but the binary64 delta folds to
    // zero — the steps must still carry the exact +1 verdict.
    const steps = buildCalculationSteps(
      state({
        mode: 'DIRECT',
        raw: 0x0001,
        direct: directCoeffs(1, 0, -17),
        valueRequest: { mode: 'DIRECT', value: 1e17, text: '100000000000000001' },
      }),
    )
    expect(steps.find((s) => s.id === 'direct-request')?.value).toBe('100000000000000001')
    expect(steps.find((s) => s.id === 'direct-exact-represented')?.value).toBe('100000000000000000')
    expect(steps.find((s) => s.id === 'direct-exact-delta')?.value).toBe('+1')
    const quantization = steps.find((s) => s.id === 'direct-quantization')
    expect(quantization?.value).toBe('+1（约 1e-15%）')
  })

  it('shows the lexeme alongside its exact rational when the two differ', () => {
    const steps = buildCalculationSteps(
      state({
        mode: 'DIRECT',
        raw: 0x0002,
        direct: directCoeffs(3, 0, 0),
        valueRequest: { mode: 'DIRECT', value: 0.5, text: '0.5' },
      }),
    )
    expect(steps.find((s) => s.id === 'direct-request')?.value).toBe('0.5 = 1/2')
    expect(steps.find((s) => s.id === 'direct-exact-represented')?.value).toBe('2/3')
    expect(steps.find((s) => s.id === 'direct-exact-delta')?.value).toBe('-1/6')
    expect(steps.find((s) => s.id === 'direct-quantization')?.value).toBe('-1/6（约 -33.3333%）')
  })

  it('omits the request transaction steps without provenance', () => {
    const steps = buildCalculationSteps(
      state({
        mode: 'DIRECT',
        raw: 0x0001,
        direct: directCoeffs(1, 0, -17),
      }),
    )
    expect(steps.some((s) => s.id === 'direct-request')).toBe(false)
    expect(steps.some((s) => s.id === 'direct-exact-represented')).toBe(false)
    expect(steps.some((s) => s.id === 'direct-exact-delta')).toBe(false)
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
      const tag = '0x' + byte.toString(16)
      const step = steps.find((s) => s.id === 'vout-mode-half')
      expect(step, tag).toBeDefined()
      const copy = steps.map((s) => s.plainText).join('\n')
      expect(copy).toContain('标准 IEEE 754 binary16')
      for (const banned of HALF_BANNED) {
        expect(copy, tag + ' unexpected copy: ' + banned).not.toContain(banned)
      }
    }
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
        '0x' + byte.toString(16),
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
        '0x' + byte.toString(16),
      ).toBe(true)
    }
  })
})
