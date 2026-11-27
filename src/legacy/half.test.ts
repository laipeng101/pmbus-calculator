import { describe, expect, it } from 'vitest'
import { PMBusMath } from './pmbus-math'

describe('IEEE 754 binary16 decode', () => {
  it.each([
    { raw: 0x0000, value: 0 },
    { raw: 0x8000, value: -0 },
    { raw: 0x0001, value: 2 ** -24 },
    { raw: 0x03ff, value: 1023 * 2 ** -24 },
    { raw: 0x0400, value: 2 ** -14 },
    { raw: 0x3c00, value: 1 },
    { raw: 0x7bff, value: 65504 },
    { raw: 0x7c00, value: Infinity },
    { raw: 0xfc00, value: -Infinity },
  ])('decodes $raw to $value', ({ raw, value }) => {
    expect(PMBusMath.decodeHalf(raw).value).toBe(value)
  })

  it('decodes a NaN payload', () => {
    expect(PMBusMath.decodeHalf(0x7e00).value).toBeNaN()
  })
})

describe('HALF golden encode cases (tie-to-even and boundaries)', () => {
  const cases = [
    { name: '0x0000 positive zero', value: 0, raw: 0x0000 },
    { name: '0x8000 negative zero', value: -0, raw: 0x8000 },
    { name: 'smallest subnormal 0x0001', value: Math.pow(2, -24), raw: 0x0001 },
    { name: 'largest subnormal 0x03FF', value: 1023 * Math.pow(2, -24), raw: 0x03ff },
    { name: 'smallest normal 0x0400', value: Math.pow(2, -14), raw: 0x0400 },
    { name: 'one 0x3C00', value: 1, raw: 0x3c00 },
    { name: 'max finite 0x7BFF', value: 65504, raw: 0x7bff },
    { name: 'overflow threshold -> +Infinity', value: 65520, raw: 0x7c00 },
    { name: 'NaN -> 0x7E00', value: NaN, raw: 0x7e00 },
    { name: 'tie-to-even 1 + 2^-11 -> 0x3C00', value: 1 + Math.pow(2, -11), raw: 0x3c00 },
    { name: 'tie-to-even 1 + 3×2^-11 -> 0x3C02', value: 1 + 3 * Math.pow(2, -11), raw: 0x3c02 },
    { name: 'subnormal half-ulp tie-to-even -> 0x0000', value: Math.pow(2, -25), raw: 0x0000 },
    { name: 'subnormal 1.5 ulp tie-to-even -> 0x0002', value: 3 * Math.pow(2, -25), raw: 0x0002 },
    { name: 'subnormal tie carries to normal -> 0x0400', value: 1023.5 * 2 ** -24, raw: 0x0400 },
  ] as const

  for (const c of cases) {
    it(c.name, () => {
      expect(PMBusMath.encodeHalf(c.value)).toBe(c.raw)
    })
  }
})
