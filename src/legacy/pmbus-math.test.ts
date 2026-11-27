import { describe, expect, it } from 'vitest'
import { PMBusMath } from './pmbus-math'
import { analyzeVoutMode } from './vout-mode'

describe('LINEAR11', () => {
  it.each([
    { raw: 0x0000, n: 0, y: 0, value: 0 },
    { raw: 0x0001, n: 0, y: 1, value: 1 },
    { raw: 0x0801, n: 1, y: 1, value: 2 },
    { raw: 0xf801, n: -1, y: 1, value: 0.5 },
    { raw: 0x03ff, n: 0, y: 1023, value: 1023 },
    { raw: 0x0400, n: 0, y: -1024, value: -1024 },
    { raw: 0x7801, n: 15, y: 1, value: 32768 },
    { raw: 0x8001, n: -16, y: 1, value: 2 ** -16 },
    { raw: 0xfffe, n: -1, y: -2, value: -1 },
    { raw: 0xe0c0, n: -4, y: 192, value: 12 },
  ])('raw $raw encodes N=$n and Y=$y ($value)', ({ raw, n, y, value }) => {
    expect(PMBusMath.decodeLinear11(raw)).toEqual({ n, y, value })
    expect(PMBusMath.encodeLinear11(n, y)).toBe(raw)
  })

  it.each([
    { n: 0, min: -1024, max: 1023 },
    { n: -4, min: -64, max: 63.9375 },
    { n: 15, min: -33554432, max: 33521664 },
  ])('computes the signed Y range at N=$n', ({ n, min, max }) => {
    expect(PMBusMath.linear11RangeForN(n)).toEqual({ min, max })
  })
})

describe('ULINEAR16 and SLINEAR16', () => {
  it('uses the same word as unsigned ULINEAR16 and signed SLINEAR16 offset', () => {
    expect(PMBusMath.decodeUlinear16(0xff00, -8)).toEqual({ v: 0xff00, n: -8, value: 255 })
    expect(PMBusMath.decodeSlinear16(0xff00, -8)).toEqual({ y: -256, n: -8, value: -1 })
    expect(PMBusMath.decodeSlinear16(0x8000, -8).value).toBe(-128)
    expect(PMBusMath.decodeSlinear16(0x7fff, -8).value).toBe(127.99609375)
  })

  it('encodes the 3.3 V nominal VOUT_COMMAND example (PMBus 1.3.1 Part II §8.5.2)', () => {
    expect(PMBusMath.encodeUlinear16(3.3, -10)).toBe(3379)
    expect(PMBusMath.decodeUlinear16(3379, -10).value).toBe(3379 / 1024)
  })

  it('decodes the relative VOUT_MARGIN_HIGH example (PMBus 1.3.1 Part II §8.5.2)', () => {
    const { isRelative, linearExponent } = analyzeVoutMode(0x96)
    expect(isRelative).toBe(true)
    expect(linearExponent).toBe(-10)
    expect(PMBusMath.decodeUlinear16(0x0466, linearExponent!).value).toBe(1.099609375)
  })

  it('rounds and clamps values within the unsigned and signed payload domains', () => {
    expect(PMBusMath.encodeUlinear16(0.001, -8)).toBe(0)
    expect(PMBusMath.encodeUlinear16(1, -8)).toBe(0x0100)
    expect(PMBusMath.encodeUlinear16(13, 2)).toBe(3)
    expect(PMBusMath.encodeUlinear16(14, 2)).toBe(4)
    expect(PMBusMath.encodeUlinear16(-1, 0)).toBe(0)
    expect(PMBusMath.encodeUlinear16(1e9, -8)).toBe(0xffff)
    expect(PMBusMath.encodeSlinear16(3.3, -8)).toBe(0x034d)
    expect(PMBusMath.encodeSlinear16(-1, -8)).toBe(0xff00)
    expect(PMBusMath.encodeSlinear16(1e9, -8)).toBe(0x7fff)
    expect(PMBusMath.encodeSlinear16(-1e9, -8)).toBe(0x8000)
  })

  it('keeps an in-range unsigned roundtrip within half an LSB', () => {
    for (const n of [-10, -8, -1, 0, 2]) {
      for (const value of [0.001, 1, 3.3, 12, 100, 70000]) {
        if (value > 65535 * 2 ** n) continue
        const payload = PMBusMath.encodeUlinear16(value, n)
        expect(Number.isInteger(payload), `${value} at N=${n}`).toBe(true)
        expect(Math.abs(PMBusMath.decodeUlinear16(payload, n).value - value)).toBeLessThanOrEqual(
          2 ** n / 2,
        )
      }
    }
  })
})

describe('PMBusMath compatibility helpers', () => {
  it('supports exponents beyond the signed shift range and fractional exponents', () => {
    expect(PMBusMath.pow2(31)).toBe(2 ** 31)
    expect(PMBusMath.pow2(-31)).toBe(2 ** -31)
    expect(PMBusMath.pow2(31.5)).toBe(2 ** 31.5)
  })

  it('retains the unsigned LINEAR16 compatibility interface', () => {
    expect(PMBusMath.encodeLinear16(3.3, -10)).toBe(3379)
    expect(PMBusMath.decodeLinear16(3379, -10)).toEqual({
      v: 3379,
      n: -10,
      value: 3379 / 1024,
    })
  })

  it.each([
    [0x98, 0, 'LINEAR', true, 24, -8],
    [0x20, 1, 'VID', false, 0, null],
    [0x40, 2, 'DIRECT', false, 0, null],
    [0xe0, 3, 'IEEE Half Float', true, 0, 'IEEE Half'],
  ] as const)(
    'keeps the compatibility parser fields for byte %i (%s, %s)',
    (byte, mode, modeName, isRelative, param, linearExponent) => {
      expect(PMBusMath.parseVoutMode(byte)).toMatchObject({
        byte,
        mode,
        modeName,
        isRelative,
        param,
        linearExponent,
      })
    },
  )

  it('returns NaN for DIRECT with m=0 in the binary64 decode', () => {
    expect(PMBusMath.decodeDirect(100, 0, 0, 0).value).toBeNaN()
  })
})
