import { describe, expect, it } from 'vitest'
import { buildCalculationSteps } from './calculation-steps'
import { appReducer } from './reducer'
import { INITIAL_STATE, type AppState } from './state'

function state(partial: Partial<AppState>): AppState {
  return { ...INITIAL_STATE, ...partial }
}

function encodeSteps(start: AppState, value: string) {
  return buildCalculationSteps(appReducer(start, { type: 'value/set', value }))
}

function ids(steps: ReturnType<typeof buildCalculationSteps>): string[] {
  return steps.map((step) => step.id)
}

describe('计算步骤的补充诊断', () => {
  it('普通解码和 VOUT_MODE 配置不增加计算步骤', () => {
    for (const sample of [
      { mode: 'L11', raw: 0xf819 },
      { mode: 'L16', raw: 0x0c00, voutMode: { byte: 0x18 } },
      { mode: 'DIRECT', raw: 10, direct: { ...INITIAL_STATE.direct, m: 2 } },
      { mode: 'HALF', raw: 0x0000 },
      { mode: 'HALF', raw: 0x3c00 },
      { mode: 'VOUT_MODE' },
    ] as const) {
      expect(buildCalculationSteps(state(sample)), sample.mode).toEqual([])
    }
  })

  it.each([
    { mode: '自动', start: INITIAL_STATE, max: 1023 * 2 ** 15 },
    {
      mode: '手动',
      start: appReducer(INITIAL_STATE, { type: 'l11/toggle-auto-n' }),
      max: 1023,
    },
  ])('LINEAR11 $mode N 仅在超出可表示范围后提示饱和', ({ start, max }) => {
    const saturated = encodeSteps(start, String(max + 1))
    expect(ids(saturated)).toEqual(['l11-saturation', 'l11-quantization'])
    expect(saturated[0].kind).toBe('warning')
    expect(ids(encodeSteps(start, String(max)))).toEqual(['l11-quantization'])
  })

  it('DIRECT 的 m=0 只显示无法解码的诊断', () => {
    const direct = appReducer(state({ mode: 'DIRECT', raw: 1 }), {
      type: 'direct/set-coeff',
      name: 'm',
      value: '0',
    })
    expect(buildCalculationSteps(direct)).toEqual([
      expect.objectContaining({ id: 'direct-m-zero', kind: 'warning' }),
    ])
  })

  it('HALF 的次正规数显示比例因子，特殊编码显示语义说明', () => {
    const subnormal = buildCalculationSteps(state({ mode: 'HALF', raw: 0x0001 }))
    expect(ids(subnormal)).toEqual(['half-2e', 'half-fraction'])
    expect(subnormal[0]).toMatchObject({ label: '2^-14', value: '0.00006103515625' })

    for (const [raw, id] of [
      [0x7e00, 'half-nan'],
      [0x7c00, 'half-infinity'],
      [0xfc00, 'half-infinity'],
    ] as const) {
      expect(ids(buildCalculationSteps(state({ mode: 'HALF', raw }))), raw.toString(16)).toEqual([
        id,
      ])
    }
  })
})

describe('编码请求的量化步骤', () => {
  const manual = appReducer(INITIAL_STATE, { type: 'l11/toggle-auto-n' })
  const l11 = appReducer(manual, { type: 'l11/set-n', n: '-8' })

  it.each([
    { start: l11, input: '1.005', id: 'l11-quantization', delta: '0.00109375' },
    {
      start: state({ mode: 'L16', voutMode: { byte: 0x18 } }),
      input: '0.005',
      id: 'l16-quantization',
      delta: '0.00109375',
    },
    {
      start: state({ mode: 'HALF' }),
      input: '1.005',
      id: 'half-quantization',
      delta: '0.0001171875',
    },
  ])('从实际编码请求得到 $id', ({ start, input, id, delta }) => {
    const label = '格式编码量化误差（请求值 − 表示值）'
    expect(encodeSteps(start, input)).toEqual([
      expect.objectContaining({
        id,
        kind: 'intermediate',
        label,
        plainText: `${label} = ${delta}`,
      }),
    ])
  })

  it.each([
    {
      input: '1.2345',
      direct: { ...INITIAL_STATE.direct, m: 1000 },
      request: '1.2345 = 2469/2000',
      represented: '1.235',
      delta: '-0.0005',
      quantization: '-0.0005（约 -0.0405%）',
    },
    {
      input: '100000000000000001',
      direct: { ...INITIAL_STATE.direct, r: -17 },
      request: '100000000000000001',
      represented: '100000000000000000',
      delta: '+1',
      quantization: '+1（约 1e-15%）',
    },
    {
      input: '0.5',
      direct: { ...INITIAL_STATE.direct, m: 3 },
      request: '0.5 = 1/2',
      represented: '2/3',
      delta: '-1/6',
      quantization: '-1/6（约 -33.3333%）',
    },
  ])('DIRECT 请求 $input 显示精确表示值和误差', (row) => {
    const steps = encodeSteps(state({ mode: 'DIRECT', direct: row.direct }), row.input)
    expect(steps).toEqual([
      expect.objectContaining({ id: 'direct-request', value: row.request }),
      expect.objectContaining({ id: 'direct-exact-represented', value: row.represented }),
      expect.objectContaining({ id: 'direct-exact-delta', value: row.delta }),
      expect.objectContaining({
        id: 'direct-quantization',
        kind: 'intermediate',
        value: row.quantization,
      }),
    ])
  })
})
