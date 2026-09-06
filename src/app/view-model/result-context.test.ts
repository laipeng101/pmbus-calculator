import { describe, expect, test } from 'vitest'
import { INITIAL_STATE, type AppState } from '../state'
import { toCalculatorViewModel } from './index'

function context(overrides: Partial<AppState>) {
  return toCalculatorViewModel({ ...INITIAL_STATE, ...overrides }).resultContext
}

describe('result context', () => {
  test('L11 identifies canonical raw and its decoded N in both editor modes', () => {
    for (const autoN of [true, false]) {
      const items = context({ raw: 0xf819, l11: { ...INITIAL_STATE.l11, autoN } })
      expect(items).toContainEqual({ label: 'Raw Word', value: '0xF819', code: true })
      expect(items.find((item) => item.label === '指数')?.value).toBe(
        `N = -1（${autoN ? '自动' : '手动'}）`,
      )
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
          expect(text).not.toContain('N =')
        } else {
          const parameter = byte & 31
          expect(text).toContain(`N = ${parameter < 16 ? parameter : parameter - 32}`)
        }
      }
    }
  })

  test('relative missing reference differs from a supplied zero', () => {
    const state = { mode: 'L16' as const, raw: 0x0100, voutMode: { byte: 0x98 } }
    expect(context(state)).toContainEqual({ label: '参考', value: '待填标称参考值' })
    expect(context({ ...state, l16: { ...INITIAL_STATE.l16, nominalVout: 0 } })).toContainEqual({
      label: '参考',
      value: 'V_NOM = 0 V',
    })
  })

  test('signed offset explains bit7 without asking for a nominal reference', () => {
    const items = context({
      mode: 'L16',
      voutMode: { byte: 0x98 },
      l16: { payloadKind: 'slinear16-offset', nominalVout: null },
    })
    expect(items).toContainEqual({ label: '数据解释', value: 'SLINEAR16 offset' })
    expect(items).toContainEqual({ label: '语义', value: '有符号偏移；bit7 不参与计算' })
    expect(items.find((item) => item.label === '参考')).toBeUndefined()
  })

  test.each([
    { raw: 0xffff, byte: 0x8f, nominalVout: 1e308 },
    { raw: 1, byte: 0x90, nominalVout: Number.MIN_VALUE },
  ])(
    'relative range failure is not described as available ($byte)',
    ({ raw, byte, nominalVout }) => {
      expect(
        context({
          mode: 'L16',
          raw,
          voutMode: { byte },
          l16: { payloadKind: 'ulinear16', nominalVout },
        }),
      ).toContainEqual({ label: '状态', value: '派生电压暂无可用结果' })
    },
  )

  test('DIRECT shows active coefficients and requests a datasheet check, without claiming a device profile', () => {
    const items = context({
      mode: 'DIRECT',
      raw: 0xffff,
      direct: { ...INITIAL_STATE.direct, m: 1, b: 1, r: 12 },
    })
    expect(items).toContainEqual({ label: '系数', value: 'm = 1, b = 1, R = 12', code: true })
    expect(items).toContainEqual({ label: '来源', value: '请核对器件数据手册' })
    expect(items).toContainEqual({ label: 'Raw Word', value: '0xFFFF', code: true })
  })

  test('HALF negative zero keeps its raw identity and standard format', () => {
    const items = context({ mode: 'HALF', raw: 0x8000 })
    expect(items).toContainEqual({ label: 'Raw Word', value: '0x8000', code: true })
    expect(items).toContainEqual({ label: '格式', value: 'IEEE 754 binary16' })
  })

  test('all VOUT_MODE bytes show their actual parameter as configuration data', () => {
    for (let byte = 0; byte < 256; byte++) {
      const parameter = byte & 31
      const items = context({ mode: 'VOUT_MODE', voutMode: { byte } })
      expect(items.find((item) => item.label === '参数')?.value).toBe(
        (byte & 0x60) === 0
          ? `N = ${parameter < 16 ? parameter : parameter - 32}`
          : `bits[4:0] = ${parameter.toString(2).padStart(5, '0')}`,
      )
      expect(items.find((item) => item.label === 'Raw Word')).toBeUndefined()
    }
  })
})
