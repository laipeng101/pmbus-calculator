/**
 * LINEAR11 golden-case test data.
 *
 * Each case: { raw: number, expected: { n, y, value } }
 * Used for Milestone 3 bidirectional loop validation.
 */

export interface L11Case {
  name: string
  raw: number
  expected: {
    n: number
    y: number
    value: number
  }
}

export const L11_DECODE_CASES: L11Case[] = [
  { name: 'zero', raw: 0x0000, expected: { n: 0, y: 0, value: 0 } },
  { name: 'positive Y=1 N=0', raw: 0x0001, expected: { n: 0, y: 1, value: 1 } },
  { name: 'positive Y=1 N=1', raw: 0x0801, expected: { n: 1, y: 1, value: 2 } },
  { name: 'positive Y=1 N=-1', raw: 0xf801, expected: { n: -1, y: 1, value: 0.5 } },
  { name: 'max positive Y', raw: 0x03ff, expected: { n: 0, y: 1023, value: 1023 } },
  { name: 'max negative Y', raw: 0x0400, expected: { n: 0, y: -1024, value: -1024 } },
  { name: 'max N=15', raw: 0x7801, expected: { n: 15, y: 1, value: 32768 } },
  { name: 'min N=-16', raw: 0x8001, expected: { n: -16, y: 1, value: 1 / 65536 } },
  { name: 'negative value', raw: 0xf802, expected: { n: -1, y: 2, value: 1 } },
]

/**
 * Round-trip cases: physical value → best raw → decode back.
 * Verified against PMBusMath.findBestLinear11().
 */
export interface L11RoundTripCase {
  name: string
  inputValue: number
  expectedRaw: number
  expectedDelta: number
}

export const L11_ROUNDTRIP_CASES: L11RoundTripCase[] = [
  { name: 'integer 1', inputValue: 1, expectedRaw: 0x0001, expectedDelta: 0 },
  { name: 'integer 2', inputValue: 2, expectedRaw: 0x0002, expectedDelta: 0 },
  { name: 'integer 10', inputValue: 10, expectedRaw: 0x000a, expectedDelta: 0 },
  { name: 'fraction 0.5', inputValue: 0.5, expectedRaw: 0xf801, expectedDelta: 0 },
  { name: 'fraction 0.25', inputValue: 0.25, expectedRaw: 0xf001, expectedDelta: 0 },
  { name: 'large 1000', inputValue: 1000, expectedRaw: 0x03e8, expectedDelta: 0 },
  { name: 'negative -1', inputValue: -1, expectedRaw: 0x07ff, expectedDelta: 0 },
  { name: 'negative -10', inputValue: -10, expectedRaw: 0x07f6, expectedDelta: 0 },
  { name: 'zero', inputValue: 0, expectedRaw: 0x0000, expectedDelta: 0 },
]

/**
 * Special / boundary cases that must produce warnings.
 */
export interface L11SpecialCase {
  name: string
  raw: number
  expectedWarningType: 'overflow' | 'info'
}

export const L11_SPECIAL_CASES: L11SpecialCase[] = [
  { name: 'Y=1023 overflow', raw: 0x03ff, expectedWarningType: 'overflow' },
  { name: 'Y=-1024 overflow', raw: 0x0400, expectedWarningType: 'overflow' },
]
