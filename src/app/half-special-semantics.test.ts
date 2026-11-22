import { expect, test } from 'vitest'
import { INITIAL_STATE } from './state'
import { toCalculatorViewModel } from './view-model'

test.each([
  [0x7e00, 'half-nan', '无效数据', '数值不可用'],
  [0x7c00, 'half-positive-infinity', '正满量程', '正方向饱和'],
  [0xfc00, 'half-negative-infinity', '负满量程', '负方向饱和'],
] as const)('HALF raw %i describes the device write and read behavior', (raw, id, write, read) => {
  const { halfSpecial } = toCalculatorViewModel({ ...INITIAL_STATE, mode: 'HALF', raw })
  expect(halfSpecial).toMatchObject({
    id,
    write: expect.stringContaining(write),
    read: expect.stringContaining(read),
  })
})

test('the HALF device notice appears only for special values in HALF mode', () => {
  for (const raw of [0x0000, 0x8000, 0x3c00, 0xbc00]) {
    expect(
      toCalculatorViewModel({ ...INITIAL_STATE, mode: 'HALF', raw }).halfSpecial,
    ).toBeUndefined()
  }
  expect(toCalculatorViewModel({ ...INITIAL_STATE, raw: 0x7e00 }).halfSpecial).toBeUndefined()
})
