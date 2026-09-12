import { describe, expect, test } from 'vitest'
import { INITIAL_STATE, type AppState } from './state'
import { toCalculatorViewModel } from './view-model'

function withState(partial: Partial<AppState>): AppState {
  return {
    ...INITIAL_STATE,
    ...partial,
    l11: { ...INITIAL_STATE.l11, ...(partial.l11 ?? {}) },
    l16: { ...INITIAL_STATE.l16, ...(partial.l16 ?? {}) },
    direct: { ...INITIAL_STATE.direct, ...(partial.direct ?? {}) },
    voutMode: { ...INITIAL_STATE.voutMode, ...(partial.voutMode ?? {}) },
  }
}

describe('unified result workspace', () => {
  test('all five modes expose the same three-row skeleton in the same order', () => {
    const modes: AppState['mode'][] = ['L11', 'L16', 'DIRECT', 'HALF', 'VOUT_MODE']
    for (const mode of modes) {
      const vm = toCalculatorViewModel(withState({ mode }))
      expect(vm.workspace.rows.map((row) => row.key)).toEqual(['fields', 'generic', 'substitution'])
    }
  })

  test('L11 field row exposes canonical N and Y', () => {
    const vm = toCalculatorViewModel(withState({ mode: 'L11', raw: 0xf819 }))
    expect(vm.workspace.rows[0]?.fields).toEqual([
      { label: 'N', value: '-1', code: true },
      { label: 'Y', value: '25', code: true },
    ])
  })

  test('L16 absolute field row exposes payload, N and the shared VOUT_MODE byte', () => {
    const vm = toCalculatorViewModel(
      withState({ mode: 'L16', raw: 0x0064, voutMode: { byte: 0x18 } }),
    )
    expect(vm.workspace.rows[0]?.fields).toEqual([
      { label: 'V', value: '100', code: true },
      { label: 'N', value: '-8', code: true },
      { label: 'VOUT_MODE', value: '0x18', code: true },
    ])
    expect(vm.workspace.rows[1]?.latex).toBe('X = V \\times 2^N')
    expect(vm.workspace.rows[2]?.latex).toContain('100')
  })

  test('non-LINEAR L16 fails closed: no pseudo N and no value', () => {
    const vm = toCalculatorViewModel(
      withState({ mode: 'L16', raw: 0x3412, voutMode: { byte: 0x38 } }),
    )
    expect(vm.valueText).toBe('—')
    expect(vm.workspace.rows[0]?.fields).toEqual([
      { label: 'VOUT_MODE', value: '0x38', code: true },
      { label: '格式', value: 'VID' },
    ])
    expect(JSON.stringify(vm.workspace.rows)).not.toContain('"N"')
    expect(vm.workspace.direction).toBeUndefined()
  })

  test('DIRECT field row exposes Y, m, b, R and m=0 keeps the generic relation', () => {
    const vm = toCalculatorViewModel(
      withState({
        mode: 'DIRECT',
        raw: 0x000a,
        direct: { ...INITIAL_STATE.direct, m: 2, b: 3, r: -1 },
      }),
    )
    expect(vm.workspace.rows[0]?.fields).toEqual([
      { label: 'Y', value: '10', code: true },
      { label: 'm', value: '2', code: true },
      { label: 'b', value: '3', code: true },
      { label: 'R', value: '-1', code: true },
    ])

    const zero = toCalculatorViewModel(
      withState({ mode: 'DIRECT', raw: 0, direct: { ...INITIAL_STATE.direct, m: 0 } }),
    )
    expect(zero.valueText).toBe('—')
    expect(zero.workspace.rows[1]?.latex).toBe(
      'X = \\frac{1}{m}\\left(Y \\times 10^{-R} - b\\right)',
    )
    expect(zero.workspace.direction).toBeUndefined()
  })

  test('HALF field row exposes s, E, F and the class label, preserving signed zero', () => {
    const plusZero = toCalculatorViewModel(withState({ mode: 'HALF', raw: 0x0000 }))
    expect(plusZero.workspace.rows[0]?.fields).toEqual([
      { label: 's', value: '0', code: true },
      { label: 'E', value: '0', code: true },
      { label: 'F', value: '0', code: true },
      { label: '类别', value: '+0' },
    ])
    const minusZero = toCalculatorViewModel(withState({ mode: 'HALF', raw: 0x8000 }))
    expect(minusZero.workspace.rows[0]?.fields?.[3]).toEqual({ label: '类别', value: '-0' })
    expect(minusZero.workspace.rows[1]?.latex).toBe('X = (-1)^s \\times 0')
  })

  test('VOUT_MODE rows are configuration rows with no KaTeX source', () => {
    const vm = toCalculatorViewModel(withState({ mode: 'VOUT_MODE', voutMode: { byte: 0x18 } }))
    expect(vm.workspace.rows.map((row) => row.presentation)).toEqual(['config', 'config', 'config'])
    for (const row of vm.workspace.rows) {
      expect(row.latex).toBeUndefined()
      expect(row.plainText).toBeUndefined()
      expect(row.segments?.length).toBeGreaterThan(0)
      for (const segment of row.segments ?? []) {
        expect(['ui', 'data']).toContain(segment.role)
      }
    }
    const parse = vm.workspace.rows[1]?.segments?.map((segment) => segment.text).join('')
    expect(parse).toBe('0x18 = 0 | 00 | 11000')
    const classification = vm.workspace.rows[2]?.segments?.map((s) => s.text).join('')
    expect(classification).toContain('绝对值')
    expect(classification).toContain('LINEAR')
    expect(classification).toContain('N = -8')
  })

  test('VOUT_MODE non-zero DIRECT parameter carries the centralized validity warning', () => {
    const vm = toCalculatorViewModel(withState({ mode: 'VOUT_MODE', voutMode: { byte: 0x41 } }))
    const classification = vm.workspace.rows[2]?.segments?.map((s) => s.text).join('')
    expect(classification).toContain('参数必须为 0')
  })

  test('direction provenance comes only from committed request state', () => {
    const decode = toCalculatorViewModel(withState({ mode: 'L11', raw: 0x1234 }))
    expect(decode.workspace.direction).toEqual({ kind: 'decode', label: '解码 Raw → 值' })

    const l11Encode = toCalculatorViewModel(
      withState({ mode: 'L11', l11: { ...INITIAL_STATE.l11, valueInput: 3 } }),
    )
    expect(l11Encode.workspace.direction?.kind).toBe('encode')

    const directEncode = toCalculatorViewModel(
      withState({
        mode: 'DIRECT',
        valueRequest: { mode: 'DIRECT', value: 1, text: '1' },
      }),
    )
    expect(directEncode.workspace.direction?.kind).toBe('encode')

    const vout = toCalculatorViewModel(withState({ mode: 'VOUT_MODE' }))
    expect(vout.workspace.direction).toBeUndefined()
  })
})
