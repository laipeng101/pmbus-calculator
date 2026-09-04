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

  /**
   * Complete SMBus word transactions (SMBus 3.0 §6.4): the PEC input is the
   * full wire-ordered message — every address byte with its R/W bit, the
   * command byte, and the data bytes — excluding the PEC byte itself. Word
   * data is transmitted low byte first (SMBus 3.0 §6.5.4/§6.5.5). The
   * expected values follow from the CRC-8 parameters above; the specification
   * does not publish worked transaction examples.
   */
  it('write word: 0xB4 (0x5A+W), 0x21, word 0x1234 as 0x34 0x12 (low byte first) -> 0x3B', () => {
    expect(PMBusMath.calculatePEC([0xb4, 0x21, 0x34, 0x12])).toBe(0x3b)
  })

  it('combined read: 0xB4 (0x5A+W), 0x21, 0xB5 (repeated start 0x5A+R), 0x34 0x12 -> 0x6F', () => {
    // Both address phases (write 0xB4 and repeated-start read 0xB5) are part
    // of the PEC message (SMBus 3.0 §6.4.1.3); data stays low byte first
    // (word 0x1234 -> 0x34 0x12).
    expect(PMBusMath.calculatePEC([0xb4, 0x21, 0xb5, 0x34, 0x12])).toBe(0x6f)
  })
})
