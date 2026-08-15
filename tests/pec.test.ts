import { describe, it, expect } from 'vitest'
import { PMBusMath } from '../src/legacy/pmbus-math'

/**
 * SMBus PEC / CRC-8 (poly 0x07, init 0x00, no reflection, no xor-out).
 * The check value for ASCII "123456789" is the published CRC-8/SMBUS check 0xF4.
 */
describe('PEC golden cases', () => {
  it('check value for ASCII "123456789" is 0xF4', () => {
    const bytes = Array.from('123456789').map((ch) => ch.charCodeAt(0))
    expect(PMBusMath.calculatePEC(bytes)).toBe(0xf4)
  })

  it('empty payload -> 0x00', () => {
    expect(PMBusMath.calculatePEC([])).toBe(0)
  })

  it('[0x00] -> 0x00', () => {
    expect(PMBusMath.calculatePEC([0x00])).toBe(0)
  })

  it('[0x5A, 0xA5] -> 0xFC', () => {
    expect(PMBusMath.calculatePEC([0x5a, 0xa5])).toBe(0xfc)
  })

  it('works with Uint8Array input', () => {
    expect(PMBusMath.calculatePEC(new Uint8Array([0x5a, 0xa5]))).toBe(0xfc)
  })
})
