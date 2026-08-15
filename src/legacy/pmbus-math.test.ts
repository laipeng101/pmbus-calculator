import { describe, it, expect } from 'vitest'
import { PMBusMath } from './pmbus-math'

describe('PMBusMath — smoke tests (mechanical migration)', () => {
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

  describe('findBestLinear11', () => {
    it('finds exact representation for 12.0', () => {
      const best = PMBusMath.findBestLinear11(12.0)
      expect(best.delta).toBe(0)
      expect(best.value).toBe(12)
    })

    it('saturates very large positive values to the max LINEAR11 code', () => {
      const best = PMBusMath.findBestLinear11(100000000)
      expect(best.n).toBe(15)
      expect(best.y).toBe(1023)
      expect(best.value).toBe(PMBusMath.maxLinear11())
      expect(best.delta).toBe(100000000 - PMBusMath.maxLinear11())
    })

    it('saturates very negative values to the min LINEAR11 code', () => {
      const best = PMBusMath.findBestLinear11(-100000000)
      expect(best.n).toBe(15)
      expect(best.y).toBe(-1024)
      expect(best.value).toBe(PMBusMath.minLinear11())
      expect(best.delta).toBe(-100000000 - PMBusMath.minLinear11())
    })
  })

  describe('decodeLinear16', () => {
    it('decodes 0x0C00 with N=-8 to 12.0', () => {
      const r = PMBusMath.decodeLinear16(0x0c00, -8)
      expect(r.value).toBeCloseTo(12, 10)
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

  describe('decodeHalf', () => {
    it('decodes 0x0000 to +0', () => {
      expect(PMBusMath.decodeHalf(0x0000).value).toBe(0)
    })

    it('decodes 0x7C00 to +Infinity', () => {
      expect(PMBusMath.decodeHalf(0x7c00).value).toBe(Infinity)
    })

    it('decodes 0xFC00 to -Infinity', () => {
      expect(PMBusMath.decodeHalf(0xfc00).value).toBe(-Infinity)
    })

    it('decodes 0x7E00 to NaN', () => {
      expect(PMBusMath.decodeHalf(0x7e00).value).toBeNaN()
    })
  })

  describe('encodeHalf', () => {
    it('rounds 1 + 2^-11 to 0x3C00 (tie-to-even)', () => {
      expect(PMBusMath.encodeHalf(1 + Math.pow(2, -11))).toBe(0x3c00)
    })

    it('rounds 1 + 3×2^-11 to 0x3C02 (mantissa 1.5 -> tie-to-even)', () => {
      expect(PMBusMath.encodeHalf(1 + 3 * Math.pow(2, -11))).toBe(0x3c02)
    })

    it('encodes max finite half 65504 as 0x7BFF', () => {
      expect(PMBusMath.encodeHalf(65504)).toBe(0x7bff)
    })

    it('overflows values >= 65520 to +Infinity', () => {
      expect(PMBusMath.encodeHalf(65520)).toBe(0x7c00)
    })

    it('encodes subnormal half-ulp tie to even zero', () => {
      // 2^-25 is exactly half of the smallest subnormal ulp (2^-24).
      expect(PMBusMath.encodeHalf(Math.pow(2, -25))).toBe(0x0000)
    })

    it('encodes a subnormal value above half ulp to 0x0002 (1.5 ulp tie-to-even)', () => {
      expect(PMBusMath.encodeHalf(3 * Math.pow(2, -25))).toBe(0x0002)
    })
  })

  describe('parseVoutMode', () => {
    it('parses 0x18 as LINEAR with N=-8', () => {
      const r = PMBusMath.parseVoutMode(0x18)
      expect(r.mode).toBe(0)
      expect(r.modeName).toBe('LINEAR')
      expect(r.linearExponent).toBe(-8)
    })
  })

  describe('calculatePEC', () => {
    it('calculates consistent CRC for known byte arrays', () => {
      const crc1 = PMBusMath.calculatePEC([0x5a, 0xa5])
      expect(typeof crc1).toBe('number')
      expect(crc1).toBeGreaterThanOrEqual(0)
      expect(crc1).toBeLessThanOrEqual(0xff)
    })
  })
})
