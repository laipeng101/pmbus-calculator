import { describe, expect, test } from 'vitest'
import { INITIAL_STATE, type AppState } from '../state'
import { toCalculatorViewModel } from './index'
import type { ResultContextItemVM, ResultContextParamsVM, ResultContextTextVM } from './types'

function context(overrides: Partial<AppState>): ResultContextItemVM[] {
  return toCalculatorViewModel({ ...INITIAL_STATE, ...overrides }).resultContext
}

function slot(items: ResultContextItemVM[], key: ResultContextItemVM['key']) {
  return items.find((item) => item.key === key)
}

function textSlot(
  items: ResultContextItemVM[],
  key: ResultContextItemVM['key'],
): ResultContextTextVM {
  const item = slot(items, key)
  if (!item || item.kind !== 'text') throw new Error('expected text slot ' + key)
  return item
}

function paramsSlot(
  items: ResultContextItemVM[],
  key: ResultContextItemVM['key'],
): ResultContextParamsVM {
  const item = slot(items, key)
  if (!item || item.kind !== 'params') throw new Error('expected params slot ' + key)
  return item
}

/** Flat text of a context list, including structured parameter pairs. */
function flat(items: ResultContextItemVM[]): string {
  return items
    .map((item) =>
      item.kind === 'params'
        ? item.params.map((pair) => pair.label + ' ' + pair.value).join(' ')
        : item.value,
    )
    .join(' ')
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

  test('L11 identifies canonical raw, structured N and its auto/manual source', () => {
    for (const autoN of [true, false]) {
      const items = context({ raw: 0xf819, l11: { ...INITIAL_STATE.l11, autoN } })
      expect(textSlot(items, 'raw')).toEqual({
        kind: 'text',
        key: 'raw',
        label: 'Raw Word',
        value: '0xF819',
        code: true,
      })
      expect(textSlot(items, 'format')).toEqual({
        kind: 'text',
        key: 'format',
        label: '格式',
        value: 'LINEAR11',
        termId: 'linear11',
      })
      expect(paramsSlot(items, 'parameters')).toEqual({
        kind: 'params',
        key: 'parameters',
        label: '参数',
        params: [{ label: 'N', value: '-1', termId: 'linear11-exponent' }],
      })
      expect(textSlot(items, 'context')).toEqual({
        kind: 'text',
        key: 'context',
        label: '上下文',
        value: autoN ? '自动 N' : '手动 N',
      })
    }
  })

  test('all L16 byte x payload combinations retain the actual byte; non-LINEAR never invents N', () => {
    for (const payloadKind of ['ulinear16', 'slinear16-offset'] as const) {
      for (let byte = 0; byte < 256; byte++) {
        const items = context({
          mode: 'L16',
          raw: 0x3412,
          voutMode: { byte },
          l16: { payloadKind, nominalVout: null },
        })
        const text = flat(items)
        expect(text).toContain('0x3412')
        expect(text).toContain('0x' + byte.toString(16).padStart(2, '0').toUpperCase())
        const parameters = paramsSlot(items, 'parameters')
        if ((byte & 0x60) !== 0) {
          expect(text).toContain('未按 LINEAR16 解释')
          expect(parameters.params.some((pair) => pair.label === 'N')).toBe(false)
        } else {
          const parameter = byte & 31
          const signed = parameter < 16 ? parameter : parameter - 32
          expect(parameters.params).toContainEqual({
            label: 'N',
            value: String(signed),
            termId: 'exponent',
          })
        }
      }
    }
  })

  test('relative missing reference differs from a supplied zero', () => {
    const state = { mode: 'L16' as const, raw: 0x0100, voutMode: { byte: 0x98 } }
    expect(textSlot(context(state), 'context').value).toBe('待填标称参考值')
    expect(
      textSlot(context({ ...state, l16: { ...INITIAL_STATE.l16, nominalVout: 0 } }), 'context')
        .value,
    ).toBe('V_NOM = 0 V')
  })

  test('signed offset explains bit7 without asking for a nominal reference', () => {
    const items = context({
      mode: 'L16',
      voutMode: { byte: 0x98 },
      l16: { payloadKind: 'slinear16-offset', nominalVout: null },
    })
    expect(textSlot(items, 'format')).toEqual({
      kind: 'text',
      key: 'format',
      label: '数据解释',
      value: 'SLINEAR16 offset',
      termId: 'slinear16',
    })
    expect(textSlot(items, 'context').value).toBe('有符号偏移；bit7 不参与计算')
    expect(flat(items)).not.toContain('待填标称参考值')
  })

  test.each([
    { raw: 0xffff, byte: 0x8f, nominalVout: 1e308 },
    { raw: 1, byte: 0x90, nominalVout: Number.MIN_VALUE },
  ])(
    'relative range failure keeps the reference and flags unavailable result ($byte)',
    ({ raw, byte, nominalVout }) => {
      expect(
        textSlot(
          context({
            mode: 'L16',
            raw,
            voutMode: { byte },
            l16: { payloadKind: 'ulinear16', nominalVout },
          }),
          'context',
        ).value,
      ).toContain('派生电压暂无可用结果')
    },
  )

  test('DIRECT shows structured coefficients and the device-specific source disclosure', () => {
    const items = context({
      mode: 'DIRECT',
      raw: 0xffff,
      direct: { ...INITIAL_STATE.direct, m: 1, b: 1, r: 12 },
    })
    expect(paramsSlot(items, 'parameters')).toEqual({
      kind: 'params',
      key: 'parameters',
      label: '参数',
      params: [
        { label: 'm', value: '1', termId: 'direct-m' },
        { label: 'b', value: '1', termId: 'direct-b' },
        { label: 'R', value: '12', termId: 'direct-r' },
      ],
    })
    expect(textSlot(items, 'context')).toEqual({
      kind: 'text',
      key: 'context',
      label: '来源',
      value: '器件相关',
      termId: 'direct',
    })
    expect(textSlot(items, 'raw')).toEqual({
      kind: 'text',
      key: 'raw',
      label: 'Raw Word',
      value: '0xFFFF',
      code: true,
    })
  })

  test('HALF negative zero keeps its raw identity and signed-zero class', () => {
    const items = context({ mode: 'HALF', raw: 0x8000 })
    expect(textSlot(items, 'raw').value).toBe('0x8000')
    expect(textSlot(items, 'format')).toEqual({
      kind: 'text',
      key: 'format',
      label: '格式',
      value: 'IEEE 754 binary16',
      termId: 'binary16',
    })
    expect(paramsSlot(items, 'parameters').params).toEqual([
      { label: 's', value: '1', termId: 'half-s' },
      { label: 'E', value: '0', termId: 'half-e' },
      { label: 'F', value: '0', termId: 'half-f' },
    ])
    expect(textSlot(items, 'context').value).toBe('-0')
  })

  test('VOUT_MODE shows Raw Byte, format, parameter and status without inventing a unit', () => {
    const items = context({ mode: 'VOUT_MODE', voutMode: { byte: 0x18 } })
    expect(textSlot(items, 'raw')).toEqual({
      kind: 'text',
      key: 'raw',
      label: 'Raw Byte',
      value: '0x18',
      code: true,
    })
    expect(textSlot(items, 'format')).toEqual({
      kind: 'text',
      key: 'format',
      label: '格式',
      value: 'LINEAR',
      termId: 'linear',
    })
    expect(paramsSlot(items, 'parameters').params).toEqual([
      { label: 'N', value: '-8', termId: 'exponent' },
    ])
    expect(textSlot(items, 'context').value).toBe('绝对 LINEAR')
  })

  test('VOUT_MODE non-zero DIRECT/Half parameter surfaces the centralized warning', () => {
    const direct = context({ mode: 'VOUT_MODE', voutMode: { byte: 0x41 } })
    expect(paramsSlot(direct, 'parameters').params).toEqual([
      { label: 'bits[4:0]', value: '00001' },
    ])
    expect(textSlot(direct, 'context').value).toContain('参数必须为 0')
  })
})
