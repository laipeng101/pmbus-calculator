import { describe, expect, it } from 'vitest'
import { buildCalculationSteps } from './calculation-steps'
import type { AppState } from './state'
import { INITIAL_STATE } from './reducer'

function state(partial: Partial<AppState>): AppState {
  return {
    ...INITIAL_STATE,
    ...partial,
    l11: { ...INITIAL_STATE.l11, ...(partial.l11 ?? {}) },
    l16: { ...INITIAL_STATE.l16, ...(partial.l16 ?? {}) },
    direct: { ...INITIAL_STATE.direct, ...(partial.direct ?? {}) },
  }
}

function kinds(steps: ReturnType<typeof buildCalculationSteps>): string[] {
  return steps.map((s) => s.kind)
}

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
      state({ mode: 'L16', raw: 0x0c00, l16: { voutMode: 0x18 } }),
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
    expect(steps[2]?.plainText).toBe('bits[6:5] mode = LINEAR (0)')
    expect(steps.some((s) => s.kind === 'result' && s.value === '12')).toBe(true)
  })

  it('L16 relative LINEAR explains exponent/ratio but never fakes an absolute result', () => {
    const steps = buildCalculationSteps(
      state({ mode: 'L16', raw: 0x0c00, l16: { voutMode: 0x98 } }),
    )
    expect(steps.some((s) => s.kind === 'result')).toBe(false)
    expect(steps.some((s) => s.kind === 'warning' && s.id === 'l16-unsupported')).toBe(true)
    expect(steps.some((s) => s.plainText.includes('nominal reference'))).toBe(true)
    // 相对 LINEAR 可解释 VOUT_MODE 参数位的指数/比值语义……
    expect(steps.some((s) => s.id === 'l16-n')).toBe(true)
    expect(steps.some((s) => s.id === 'l16-2n')).toBe(true)
    // ……但不得把 raw 标成绝对电压（无 V 字段、无结果）。
    expect(steps.some((s) => s.id === 'l16-v')).toBe(false)
  })

  it('L16 DIRECT/Half (parameter 0) stop at a warning without a fake result', () => {
    for (const voutMode of [0x40, 0x60, 0xe0]) {
      const steps = buildCalculationSteps(state({ mode: 'L16', l16: { voutMode } }))
      expect(
        steps.some((s) => s.kind === 'result'),
        `0x${voutMode.toString(16)}`,
      ).toBe(false)
      expect(
        steps.some((s) => s.kind === 'warning' && s.id === 'l16-unsupported'),
        `0x${voutMode.toString(16)}`,
      ).toBe(true)
      // DIRECT/IEEE Half 不得生成虚假的 LINEAR16 V/N/range/result。
      expect(
        steps.some((s) => s.id === 'l16-v'),
        `0x${voutMode.toString(16)}`,
      ).toBe(false)
      expect(
        steps.some((s) => s.id === 'l16-n'),
        `0x${voutMode.toString(16)}`,
      ).toBe(false)
    }
  })

  it('L16 VID 0x20 (Not Used) 产生 vid 警告且无结果', () => {
    const steps = buildCalculationSteps(state({ mode: 'L16', l16: { voutMode: 0x20 } }))
    expect(steps.some((s) => s.kind === 'result')).toBe(false)
    expect(steps.some((s) => s.kind === 'warning' && s.id === 'l16-vid')).toBe(true)
    expect(steps.some((s) => s.id === 'l16-v')).toBe(false)
  })

  it('L16 relative VID 0xA0 产生 invalid-combination 警告', () => {
    const steps = buildCalculationSteps(state({ mode: 'L16', l16: { voutMode: 0xa0 } }))
    expect(steps.some((s) => s.kind === 'warning' && s.id === 'l16-invalid-combination')).toBe(true)
    expect(steps.some((s) => s.kind === 'result')).toBe(false)
  })

  it('L16 DIRECT/Half 非零参数产生 invalid-parameter 警告', () => {
    for (const voutMode of [0x41, 0x5f, 0x61, 0x7f, 0xc1, 0xe1]) {
      const steps = buildCalculationSteps(state({ mode: 'L16', l16: { voutMode } }))
      expect(
        steps.some((s) => s.kind === 'warning' && s.id === 'l16-invalid-parameter'),
        `0x${voutMode.toString(16)}`,
      ).toBe(true)
      expect(steps.some((s) => s.kind === 'result')).toBe(false)
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
    expect(normal.some((s) => s.plainText.includes('normal'))).toBe(true)
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
