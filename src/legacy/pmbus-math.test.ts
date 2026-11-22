import { describe, it, expect } from 'vitest'
import { PMBusMath } from './pmbus-math'

describe('PMBusMath', () => {
  describe('decodeLinear11', () => {
    it('decodes 0x0000 to zero', () => {
      const r = PMBusMath.decodeLinear11(0x0000)
      expect(r.n).toBe(0)
      expect(r.y).toBe(0)
      expect(r.value).toBe(0)
    })

    it('decodes known example: 0xE0C0 -> N=-4, Y=192 -> 12.0V', () => {
      // 12.0V in L11: best fit is N=-4, Y=192 (192 * 2^-4 = 12)
      const r = PMBusMath.decodeLinear11(0xe0c0)
      expect(r.n).toBe(-4)
      expect(r.y).toBe(192)
      expect(r.value).toBeCloseTo(12, 10)
    })
  })

  describe('encodeLinear11', () => {
    it('roundtrips zero', () => {
      const raw = PMBusMath.encodeLinear11(0, 0)
      const r = PMBusMath.decodeLinear11(raw)
      expect(r.value).toBe(0)
    })
  })
  describe('pow2', () => {
    it('uses Math.pow fallback for exponents outside the 32-bit shift range', () => {
      expect(PMBusMath.pow2(31)).toBe(Math.pow(2, 31))
      expect(PMBusMath.pow2(-31)).toBe(Math.pow(2, -31))
      expect(PMBusMath.pow2(31.5)).toBe(Math.pow(2, 31.5))
    })
  })

  describe('encodeLinear16', () => {
    it('clamps to the unsigned 16-bit range at N=0', () => {
      expect(PMBusMath.encodeLinear16(0, 0)).toBe(0)
      expect(PMBusMath.encodeLinear16(12, 0)).toBe(12)
      expect(PMBusMath.encodeLinear16(-1, 0)).toBe(0)
      expect(PMBusMath.encodeLinear16(70000, 0)).toBe(65535)
    })

    it('scales by 2^N per the ULINEAR16 payload contract (Part II §8.4.1: Y_u = X / 2^N)', () => {
      expect(PMBusMath.encodeLinear16(1, -8)).toBe(0x0100)
      expect(PMBusMath.encodeLinear16(12, 2)).toBe(3)
    })

    it('encodes the PMBus Part II §8.5.2 worked example (3.3 V, N=-10)', () => {
      expect(PMBusMath.encodeLinear16(3.3, -10)).toBe(3379)
      expect(PMBusMath.decodeLinear16(3379, -10).value).toBe(3379 / 1024)
    })

    it('rounds to the nearest payload integer', () => {
      expect(PMBusMath.encodeLinear16(13, 2)).toBe(3)
      expect(PMBusMath.encodeLinear16(14, 2)).toBe(4)
    })

    it('saturates to the payload bounds outside the representable range', () => {
      expect(PMBusMath.encodeLinear16(0, -8)).toBe(0)
      expect(PMBusMath.encodeLinear16(0.001, -8)).toBe(0)
      expect(PMBusMath.encodeLinear16(65535 * Math.pow(2, -8), -8)).toBe(0xffff)
      expect(PMBusMath.encodeLinear16(70000, -8)).toBe(0xffff)
      expect(PMBusMath.encodeLinear16(1e9, -8)).toBe(0xffff)
    })

    it('round-trips through decodeLinear16 within half an LSB for non-saturated payloads', () => {
      const ns = [-10, -8, -1, 0, 2]
      const vs = [0.001, 1, 3.3, 12, 100, 70000]
      for (const n of ns) {
        for (const v of vs) {
          const payload = PMBusMath.encodeLinear16(v, n)
          expect(Number.isInteger(payload)).toBe(true)
          if (payload > 0 && payload < 65535) {
            const decoded = PMBusMath.decodeLinear16(payload, n).value
            expect(Math.abs(decoded - v)).toBeLessThanOrEqual(Math.pow(2, n) / 2)
          }
        }
      }
    })

    it('matches the canonical encodeUlinear16 contract for the same inputs', () => {
      const ns = [-10, -8, -1, 0, 2]
      const vs = [0.001, 1, 3.3, 12, 100, 65535 * Math.pow(2, -8), 70000]
      for (const n of ns) {
        for (const v of vs) {
          expect(PMBusMath.encodeLinear16(v, n)).toBe(PMBusMath.encodeUlinear16(v, n))
        }
      }
    })
  })

  describe('decodeDirect', () => {
    it('returns NaN when m=0', () => {
      const r = PMBusMath.decodeDirect(100, 0, 0, 0)
      expect(r.value).toBeNaN()
    })

    it('decodes Y=100, m=1, b=0, R=0 to 100', () => {
      const r = PMBusMath.decodeDirect(100, 1, 0, 0)
      expect(r.value).toBe(100)
    })
  })

  describe('parseVoutMode (PMBus Part II §8.3 bit layout)', () => {
    it('parses 0x18 as absolute LINEAR with N=-8', () => {
      const r = PMBusMath.parseVoutMode(0x18)
      expect(r.mode).toBe(0)
      expect(r.modeName).toBe('LINEAR')
      expect(r.isRelative).toBe(false)
      expect(r.param).toBe(0x18)
      expect(r.linearExponent).toBe(-8)
    })

    it('parses 0x98 as relative LINEAR with N=-8 (bit7=relative, bits6:5=00)', () => {
      const r = PMBusMath.parseVoutMode(0x98)
      expect(r.mode).toBe(0)
      expect(r.modeName).toBe('LINEAR')
      expect(r.isRelative).toBe(true)
      expect(r.param).toBe(0x18)
      expect(r.linearExponent).toBe(-8)
    })

    it('parses 0x20 as VID (mode=01, param=0, no linear exponent)', () => {
      const r = PMBusMath.parseVoutMode(0x20)
      expect(r.mode).toBe(1)
      expect(r.modeName).toBe('VID')
      expect(r.isRelative).toBe(false)
      expect(r.param).toBe(0)
      expect(r.linearExponent).toBeNull()
    })

    it('parses 0x40 as DIRECT (mode=10, param=0)', () => {
      const r = PMBusMath.parseVoutMode(0x40)
      expect(r.mode).toBe(2)
      expect(r.modeName).toBe('DIRECT')
      expect(r.isRelative).toBe(false)
      expect(r.param).toBe(0)
      expect(r.linearExponent).toBeNull()
    })

    it('parses 0x60 as IEEE Half Float (mode=11, param=0)', () => {
      const r = PMBusMath.parseVoutMode(0x60)
      expect(r.mode).toBe(3)
      expect(r.modeName).toBe('IEEE Half Float')
      expect(r.isRelative).toBe(false)
      expect(r.param).toBe(0)
      expect(r.linearExponent).toBe('IEEE Half')
    })

    it('parses 0xE0 as relative IEEE Half Float (bit7=relative, bits6:5=11)', () => {
      const r = PMBusMath.parseVoutMode(0xe0)
      expect(r.mode).toBe(3)
      expect(r.modeName).toBe('IEEE Half Float')
      expect(r.isRelative).toBe(true)
      expect(r.param).toBe(0)
      expect(r.linearExponent).toBe('IEEE Half')
    })
  })

  describe('linear11RangeForN (手动 N 饱和判断范围)', () => {
    it('N=0 时范围是 -1024..1023（Y=-1024..1023 × 2^0）', () => {
      expect(PMBusMath.linear11RangeForN(0)).toEqual({ min: -1024, max: 1023 })
    })

    it('N=-4 时范围是 -64..63.9375', () => {
      expect(PMBusMath.linear11RangeForN(-4)).toEqual({
        min: -1024 * Math.pow(2, -4),
        max: 1023 * Math.pow(2, -4),
      })
    })

    it('N=15 时与全格式全局极值一致（auto-N 饱和基准）', () => {
      expect(PMBusMath.linear11RangeForN(15).min).toBe(PMBusMath.minLinear11())
      expect(PMBusMath.linear11RangeForN(15).max).toBe(PMBusMath.maxLinear11())
    })
  })
})
