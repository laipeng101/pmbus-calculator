import type { AppMode, Linear16PayloadKind } from './state'

export type BitColorToken = 'n' | 'y' | 'e' | 's'

/**
 * A colored field region of a bit editor, used both for on-bit coloring and
 * for the shared legend. "bitRange" holds the true bit positions (LSB = 0),
 * matching the index values carried by the nibble view-models.
 */
export interface BitFieldRegion {
  id: string
  label: string
  colorToken: BitColorToken
  bitRange: readonly number[]
}

function fullRange16(): number[] {
  const bits: number[] = []
  for (let i = 15; i >= 0; i--) bits.push(i)
  return bits
}

function range(start: number, end: number): number[] {
  const bits: number[] = []
  for (let i = start; i >= end; i--) bits.push(i)
  return bits
}

/**
 * Single source of truth for the field regions (and their legend) of every bit
 * editor. The 16-bit L11/DIRECT/HALF grid and the 8-bit VOUT_MODE grid both
 * consume this, so their on-bit colors and legend labels can never drift.
 */
export function getBitRegions(mode: AppMode, payloadKind?: Linear16PayloadKind): BitFieldRegion[] {
  switch (mode) {
    case 'L11':
      return [
        { id: 'n', label: '指数 N [15:11]', colorToken: 'n', bitRange: range(15, 11) },
        { id: 'y', label: '尾数 Y [10:0]', colorToken: 'y', bitRange: range(10, 0) },
      ]
    case 'L16':
      return [
        {
          id: 'v',
          label: payloadKind === 'slinear16-offset' ? '有符号值 Y [15:0]' : '数值 V [15:0]',
          colorToken: 'y',
          bitRange: fullRange16(),
        },
      ]
    case 'DIRECT':
      return [{ id: 'y', label: '数值 Y [15:0]', colorToken: 'y', bitRange: fullRange16() }]
    case 'HALF':
      return [
        { id: 'sign', label: '符号位 [15]', colorToken: 'e', bitRange: [15] },
        { id: 'exponent', label: '指数 [14:10]', colorToken: 'n', bitRange: range(14, 10) },
        { id: 'mantissa', label: '尾数 [9:0]', colorToken: 'y', bitRange: range(9, 0) },
      ]
    case 'VOUT_MODE':
      return [
        { id: 'ar', label: '绝对/相对 [7]', colorToken: 's', bitRange: [7] },
        { id: 'format', label: '格式 [6:5]', colorToken: 'n', bitRange: [6, 5] },
        { id: 'parameter', label: '参数 [4:0]', colorToken: 'y', bitRange: range(4, 0) },
      ]
  }
}
