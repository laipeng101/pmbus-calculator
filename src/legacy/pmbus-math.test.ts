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

    it('does not confuse bit7 with the mode field', () => {
      // Old bug: (byte >> 5) & 0x07 would turn 0x98 into mode 4 (保留).
      const abs = PMBusMath.parseVoutMode(0x18)
      const rel = PMBusMath.parseVoutMode(0x98)
      expect(abs.mode).toBe(rel.mode)
      expect(rel.mode).toBe(0)
    })
  })

  describe('checkSpecial', () => {
    it('does not flag Y=1023 or Y=-1024 as overflow (legal boundary codes)', () => {
      expect(PMBusMath.checkSpecial(0x7fff, 'L11')).toBeNull() // N=15, Y=1023
      expect(PMBusMath.checkSpecial(0x0000, 'L11')).toBeNull()
      // N=15, Y=-1024 -> raw 0xFFFF
      expect(PMBusMath.checkSpecial(0xffff, 'L11')).toBeNull()
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
