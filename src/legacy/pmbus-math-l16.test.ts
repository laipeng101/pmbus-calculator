import { describe, expect, it } from 'vitest'
import { PMBusMath } from './pmbus-math'

describe('ULINEAR16 / SLINEAR16 offset golden vectors (M38)', () => {
  it('ULINEAR16 X = Y_u × 2^N with N=-8', () => {
    expect(PMBusMath.decodeUlinear16(0x0100, -8).value).toBe(1)
    expect(PMBusMath.decodeUlinear16(0xff00, -8).value).toBe(255)
    // Official Relative example: raw 0x0466 (1126) => R=1.099609375
    expect(PMBusMath.decodeUlinear16(0x0466, -10).value).toBeCloseTo(1.099609375, 9)
  })

  it('SLINEAR16 offset X_offset = Y_s × 2^N with N=-8 (two\u2019s complement)', () => {
    expect(PMBusMath.decodeSlinear16(0x0100, -8).value).toBe(1)
    expect(PMBusMath.decodeSlinear16(0xff00, -8).value).toBe(-1)
    expect(PMBusMath.decodeSlinear16(0x8000, -8).value).toBe(-128)
    expect(PMBusMath.decodeSlinear16(0x7fff, -8).value).toBeCloseTo(127.99609375, 9)
  })

  it('the same raw 0xFF00 differs by payload kind', () => {
    expect(PMBusMath.decodeUlinear16(0xff00, -8).value).toBe(255)
    expect(PMBusMath.decodeSlinear16(0xff00, -8).value).toBe(-1)
  })

  it('encoders round and clamp to their payload domains', () => {
    expect(PMBusMath.encodeUlinear16(1, -8)).toBe(0x0100)
    expect(PMBusMath.encodeSlinear16(1, -8)).toBe(0x0100)
    expect(PMBusMath.encodeSlinear16(-1, -8)).toBe(0xff00)
    expect(PMBusMath.encodeUlinear16(1e9, -8)).toBe(0xffff)
    expect(PMBusMath.encodeSlinear16(1e9, -8)).toBe(0x7fff)
    expect(PMBusMath.encodeSlinear16(-1e9, -8)).toBe(0x8000)
  })

  it('relative LINEAR ratio is always a positive Y_u payload; raw 0 is non-compliant as a ratio', () => {
    // raw 0 encodes ratio 0, which the caller must flag as non-compliant when
    // interpreting the payload as a Relative ratio (X = V_NOM × R with R > 0).
    expect(PMBusMath.decodeUlinear16(0, 0).value).toBe(0)
    expect(PMBusMath.decodeUlinear16(0, -8).value).toBe(0)
  })
})
