import { describe, expect, it } from 'vitest'
import { getBitRegions, RAW_WORD_NEUTRAL_LABEL } from './bit-regions'

describe('M39 shared bit field regions', () => {
  it('L11 exposes 指数 N [15:11] and 尾数 Y [10:0]', () => {
    const r = getBitRegions('L11')
    expect(r.map((x) => x.label)).toEqual(['指数 N [15:11]', '尾数 Y [10:0]'])
    expect(r[0]!.bitRange).toEqual([15, 14, 13, 12, 11])
    expect(r[1]!.bitRange[0]).toBe(10)
    expect(r[1]!.bitRange[r[1]!.bitRange.length - 1]).toBe(0)
  })

  it('L16 legend reflects payload kind for LINEAR bytes (0x18 / 0x98)', () => {
    expect(getBitRegions('L16', 'ulinear16', 0x18)[0]!.label).toBe('数值 V [15:0]')
    expect(getBitRegions('L16', 'slinear16-offset', 0x18)[0]!.label).toBe('有符号值 Y [15:0]')
    // Relative LINEAR keeps payload semantics — bit7 stays absolute/relative,
    // the word itself is still V or Y.
    expect(getBitRegions('L16', 'ulinear16', 0x98)[0]!.label).toBe('数值 V [15:0]')
  })

  it('L16 legend is neutral for every non-LINEAR byte regardless of payload kind', () => {
    // VID legal, VID manufacturer-specific, DIRECT, IEEE Half, relative VID
    // and invalid-parameter states all fail closed — their raw word must not
    // be labeled with a LINEAR16 V/Y encoding promise.
    const nonLinearBytes = [0x20, 0x3e, 0x40, 0x60, 0xa0, 0x41] as const
    for (const byte of nonLinearBytes) {
      for (const payloadKind of ['ulinear16', 'slinear16-offset'] as const) {
        const regions = getBitRegions('L16', payloadKind, byte)
        expect(regions[0]!.label, `0x${byte.toString(16)} + ${payloadKind}`).toBe(
          RAW_WORD_NEUTRAL_LABEL,
        )
        expect(regions[0]!.label, `0x${byte.toString(16)}`).not.toContain('数值 V')
        expect(regions[0]!.label, `0x${byte.toString(16)}`).not.toContain('有符号值 Y')
      }
    }
  })

  it('DIRECT exposes a single 数值 Y [15:0] region', () => {
    const r = getBitRegions('DIRECT')
    expect(r).toHaveLength(1)
    expect(r[0]!.label).toBe('数值 Y [15:0]')
    expect(r[0]!.bitRange).toHaveLength(16)
  })

  it('HALF exposes 符号位/指数/尾数 with distinct color tokens', () => {
    const r = getBitRegions('HALF')
    expect(r.map((x) => x.label)).toEqual(['符号位 [15]', '指数 [14:10]', '尾数 [9:0]'])
    expect(r[0]!.colorToken).toBe('e')
    expect(r[1]!.colorToken).toBe('n')
    expect(r[2]!.colorToken).toBe('y')
  })

  it('VOUT_MODE exposes 绝对/相对/格式/参数 and 8-bit ranges', () => {
    const r = getBitRegions('VOUT_MODE')
    expect(r.map((x) => x.label)).toEqual(['绝对/相对 [7]', '格式 [6:5]', '参数 [4:0]'])
    expect(r[0]!.bitRange).toEqual([7])
    expect(r[1]!.bitRange).toEqual([6, 5])
    expect(r[2]!.bitRange).toEqual([4, 3, 2, 1, 0])
    expect(r[0]!.colorToken).toBe('s')
    expect(r[1]!.colorToken).toBe('n')
    expect(r[2]!.colorToken).toBe('y')
  })
})
