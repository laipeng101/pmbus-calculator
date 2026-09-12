import { describe, expect, test } from 'vitest'
import { INITIAL_STATE, type AppState } from './state'
import { toCalculatorViewModel } from './view-model'
import type { CalculatorViewModel } from './view-model'
import type { ConfigResultRowVM, NumericResultRowVM } from './view-model/types'

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

function numeric(vm: CalculatorViewModel, index: number): NumericResultRowVM {
  const row = vm.workspace.rows[index]
  if (!row || row.layout !== 'numeric') throw new Error('expected numeric row at ' + index)
  return row
}

function config(vm: CalculatorViewModel, index: number): ConfigResultRowVM {
  const row = vm.workspace.rows[index]
  if (!row || row.layout !== 'config') throw new Error('expected config row at ' + index)
  return row
}

function textOf(row: ConfigResultRowVM): string {
  return row.segments.map((segment) => segment.text).join('')
}

describe('unified result workspace', () => {
  test('numeric modes keep fields + one equation; VOUT_MODE keeps the config walkthrough', () => {
    const numericModes: AppState['mode'][] = ['L11', 'L16', 'DIRECT', 'HALF']
    for (const mode of numericModes) {
      const vm = toCalculatorViewModel(withState({ mode }))
      expect(vm.workspace.layout).toBe('numeric')
      expect(vm.workspace.rows.map((row) => row.key)).toEqual(['fields', 'substitution'])
    }

    const vout = toCalculatorViewModel(withState({ mode: 'VOUT_MODE' }))
    expect(vout.workspace.layout).toBe('config')
    expect(vout.workspace.rows.map((row) => row.key)).toEqual(['fields', 'bitParse', 'result'])
  })

  test('L11 field row exposes canonical N and Y with their glossary terms', () => {
    const vm = toCalculatorViewModel(withState({ mode: 'L11', raw: 0xf819 }))
    expect(numeric(vm, 0).fields).toEqual([
      { label: 'N', value: '-1', code: true, termId: 'linear11-exponent' },
      { label: 'Y', value: '25', code: true, termId: 'linear11-y' },
    ])
  })

  test('L16 absolute field row exposes payload, N and the shared VOUT_MODE byte', () => {
    const vm = toCalculatorViewModel(
      withState({ mode: 'L16', raw: 0x0064, voutMode: { byte: 0x18 } }),
    )
    expect(numeric(vm, 0).fields).toEqual([
      { label: 'V', value: '100', code: true, termId: 'ulinear16-v' },
      { label: 'N', value: '-8', code: true, termId: 'exponent' },
      { label: 'VOUT_MODE', value: '0x18', code: true, termId: 'vout-mode' },
    ])
    expect(numeric(vm, 1).latex).toContain('100')
    expect(numeric(vm, 1).latex?.endsWith('= 0.390625')).toBe(true)
  })

  test('non-LINEAR L16 fails closed: no pseudo N and no fabricated equation', () => {
    const vm = toCalculatorViewModel(
      withState({ mode: 'L16', raw: 0x3412, voutMode: { byte: 0x38 } }),
    )
    expect(vm.valueText).toBe('—')
    expect(numeric(vm, 0).fields).toEqual([
      { label: 'VOUT_MODE', value: '0x38', code: true, termId: 'vout-mode' },
      { label: '格式', value: 'VID' },
    ])
    expect(JSON.stringify(vm.workspace.rows)).not.toContain('"N"')
    expect(numeric(vm, 1).latex).toContain('共享 VOUT_MODE 非 LINEAR')
    expect(vm.workspace.direction).toBeUndefined()
  })

  test('DIRECT field row exposes Y, m, b, R and m=0 fails closed explicitly', () => {
    const vm = toCalculatorViewModel(
      withState({
        mode: 'DIRECT',
        raw: 0x000a,
        direct: { ...INITIAL_STATE.direct, m: 2, b: 3, r: -1 },
      }),
    )
    expect(numeric(vm, 0).fields).toEqual([
      { label: 'Y', value: '10', code: true, termId: 'direct-y' },
      { label: 'm', value: '2', code: true, termId: 'direct-m' },
      { label: 'b', value: '3', code: true, termId: 'direct-b' },
      { label: 'R', value: '-1', code: true, termId: 'direct-r' },
    ])

    const zero = toCalculatorViewModel(
      withState({ mode: 'DIRECT', raw: 0, direct: { ...INITIAL_STATE.direct, m: 0 } }),
    )
    expect(zero.valueText).toBe('—')
    expect(numeric(zero, 1).latex).toContain('m = 0 无法计算')
    expect(zero.workspace.direction).toBeUndefined()
  })

  test('HALF field row exposes s, E, F and preserves signed zero in the equation', () => {
    const plusZero = toCalculatorViewModel(withState({ mode: 'HALF', raw: 0x0000 }))
    expect(numeric(plusZero, 0).fields).toEqual([
      { label: 's', value: '0', code: true, termId: 'half-s' },
      { label: 'E', value: '0', code: true, termId: 'half-e' },
      { label: 'F', value: '0', code: true, termId: 'half-f' },
      { label: '类别', value: '+0' },
    ])
    expect(numeric(plusZero, 1).latex).toContain('= +0')

    const minusZero = toCalculatorViewModel(withState({ mode: 'HALF', raw: 0x8000 }))
    expect(numeric(minusZero, 0).fields?.[3]).toEqual({ label: '类别', value: '-0' })
    expect(numeric(minusZero, 1).latex).toContain('(-1)^{\\textstyle 1}')
    expect(numeric(minusZero, 1).latex?.endsWith('= -0')).toBe(true)
  })

  test('VOUT_MODE rows are configuration rows with no KaTeX source', () => {
    const vm = toCalculatorViewModel(withState({ mode: 'VOUT_MODE', voutMode: { byte: 0x18 } }))
    for (let index = 0; index < 3; index += 1) {
      const row = config(vm, index)
      expect(row.presentation).toBe('config')
      expect(textOf(row).length).toBeGreaterThan(0)
      for (const segment of row.segments) {
        expect(['ui', 'data']).toContain(segment.role)
      }
    }
    expect(textOf(config(vm, 1))).toBe('0x18 = 0 | 00 | 11000')
    const classification = textOf(config(vm, 2))
    expect(classification).toContain('绝对值')
    expect(classification).toContain('LINEAR')
    expect(classification).toContain('N = -8')
  })

  test('VOUT_MODE non-zero DIRECT parameter carries the centralized validity warning', () => {
    const vm = toCalculatorViewModel(withState({ mode: 'VOUT_MODE', voutMode: { byte: 0x41 } }))
    expect(textOf(config(vm, 2))).toContain('参数必须为 0')
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
