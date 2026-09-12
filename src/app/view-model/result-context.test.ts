import { describe, expect, test } from 'vitest'
import { INITIAL_STATE, type AppState } from '../state'
import { toCalculatorViewModel } from './index'
import type { ResultContextItemVM } from './types'

function context(overrides: Partial<AppState>): ResultContextItemVM[] {
  return toCalculatorViewModel({ ...INITIAL_STATE, ...overrides }).resultContext
}

function slot(items: ResultContextItemVM[], key: ResultContextItemVM['key']) {
  return items.find((item) => item.key === key)
}

describe('result context — stable four slots', () => {
  test('every mode returns exactly raw / format / parameters / context in order', () => {
    const states: Partial<AppState>[] = [
      { mode: 'L11' },
      { mode: 'L16' },
      { mode: 'DIRECT' },
      { mode: 'HALF' },
      { mode: 'VOUT_MODE' },
    ]
    for (const state of states) {
      const items = context(state)
      expect(items.map((item) => item.key)).toEqual(['raw', 'format', 'parameters', 'context'])
    }
  })

  test('L11 identifies canonical raw, N and its auto/manual source', () => {
    for (const autoN of [true, false]) {
      const items = context({ raw: 0xf819, l11: { ...INITIAL_STATE.l11, autoN } })
      expect(slot(items, 'raw')).toEqual({
        key: 'raw',
        label: 'Raw Word',
        value: '0xF819',
        code: true,
      })
      expect(slot(items, 'format')?.value).toBe('LINEAR11')
      expect(slot(items, 'parameters')?.value).toBe('N = -1')
      expect(slot(items, 'context')?.value).toBe(autoN ? '自动 N' : '手动 N')
    }
  })

  test('all L16 byte × payload combinations retain the actual byte; non-LINEAR never invents N', () => {
    for (const payloadKind of ['ulinear16', 'slinear16-offset'] as const) {
      for (let byte = 0; byte < 256; byte++) {
        const items = context({
          mode: 'L16',
          raw: 0x3412,
          voutMode: { byte },
          l16: { payloadKind, nominalVout: null },
        })
        const text = items.map((item) => item.value).join(' ')
        expect(text).toContain('0x3412')
        expect(text).toContain(`0x${byte.toString(16).padStart(2, '0').toUpperCase()}`)
        if ((byte & 0x60) !== 0) {
          expect(text).toContain('未按 LINEAR16 解释')
          expect(slot(items, 'parameters')?.value).not.toContain('N =')
        } else {
          const parameter = byte & 31
          expect(slot(items, 'parameters')?.value).toContain(
            `N = ${parameter < 16 ? parameter : parameter - 32}`,
          )
        }
      }
    }
  })

  test('relative missing reference differs from a supplied zero', () => {
    const state = { mode: 'L16' as const, raw: 0x0100, voutMode: { byte: 0x98 } }
    expect(slot(context(state), 'context')?.value).toBe('待填标称参考值')
    expect(
      slot(context({ ...state, l16: { ...INITIAL_STATE.l16, nominalVout: 0 } }), 'context')?.value,
    ).toBe('V_NOM = 0 V')
  })

  test('signed offset explains bit7 without asking for a nominal reference', () => {
    const items = context({
      mode: 'L16',
      voutMode: { byte: 0x98 },
      l16: { payloadKind: 'slinear16-offset', nominalVout: null },
    })
    expect(slot(items, 'format')?.value).toBe('SLINEAR16 offset')
    expect(slot(items, 'context')?.value).toBe('有符号偏移；bit7 不参与计算')
    expect(items.map((item) => item.value).join(' ')).not.toContain('待填标称参考值')
  })

  test.each([
    { raw: 0xffff, byte: 0x8f, nominalVout: 1e308 },
    { raw: 1, byte: 0x90, nominalVout: Number.MIN_VALUE },
  ])(
    'relative range failure keeps the reference and flags unavailable result ($byte)',
    ({ raw, byte, nominalVout }) => {
      expect(
        slot(
          context({
            mode: 'L16',
            raw,
            voutMode: { byte },
            l16: { payloadKind: 'ulinear16', nominalVout },
          }),
          'context',
        )?.value,
      ).toContain('派生电压暂无可用结果')
    },
  )

  test('DIRECT shows active coefficients and the device-specific source disclosure', () => {
    const items = context({
      mode: 'DIRECT',
      raw: 0xffff,
      direct: { ...INITIAL_STATE.direct, m: 1, b: 1, r: 12 },
    })
    expect(slot(items, 'parameters')).toEqual({
      key: 'parameters',
      label: '参数',
      value: 'm = 1, b = 1, R = 12',
      code: true,
    })
    expect(slot(items, 'context')).toEqual({
      key: 'context',
      label: '来源',
      value: '器件相关',
      termId: 'direct',
    })
    expect(slot(items, 'raw')).toEqual({
      key: 'raw',
      label: 'Raw Word',
      value: '0xFFFF',
      code: true,
    })
  })

  test('HALF negative zero keeps its raw identity and signed-zero class', () => {
    const items = context({ mode: 'HALF', raw: 0x8000 })
    expect(slot(items, 'raw')?.value).toBe('0x8000')
    expect(slot(items, 'format')?.value).toBe('IEEE 754 binary16')
    expect(slot(items, 'parameters')?.value).toBe('s = 1, E = 0, F = 0')
    expect(slot(items, 'context')?.value).toBe('-0')
  })

  test('VOUT_MODE shows Raw Byte, format, parameter and status without inventing a unit', () => {
    const items = context({ mode: 'VOUT_MODE', voutMode: { byte: 0x18 } })
    expect(slot(items, 'raw')).toEqual({ key: 'raw', label: 'Raw Byte', value: '0x18', code: true })
    expect(slot(items, 'format')?.value).toBe('LINEAR')
    expect(slot(items, 'parameters')?.value).toBe('N = -8')
    expect(slot(items, 'context')?.value).toBe('绝对 LINEAR')
  })

  test('VOUT_MODE non-zero DIRECT/Half parameter surfaces the centralized warning', () => {
    const direct = context({ mode: 'VOUT_MODE', voutMode: { byte: 0x41 } })
    expect(slot(direct, 'parameters')?.value).toBe('bits[4:0] = 00001')
    expect(slot(direct, 'context')?.value).toContain('参数必须为 0')
  })
})
