import type { AppMode, Linear16PayloadKind } from './state'
import { analyzeVoutMode } from '../legacy/vout-mode'

export type BitColorToken = 'n' | 'y' | 'e' | 's'

/**
 * Neutral legend for a 16-bit raw word that the LINEAR16 page does NOT
 * interpret as ULINEAR16 V or SLINEAR16 Y (non-LINEAR shared VOUT_MODE,
 * Part II §8.4). It carries no encoding promise: neither a payload-specific
 * field name nor an implied conversion, so the grid never contradicts the
 * fail-closed card shown next to it.
 */
export const RAW_WORD_NEUTRAL_LABEL = 'raw word [15:0]（未按 LINEAR16 解释）'

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
 *
 * For L16 the caller MUST pass the actual shared `voutModeByte` (v2.5.3):
 * the payload dropdown alone cannot decide the legend — with a non-LINEAR
 * byte (VID / DIRECT / IEEE Half / invalid) the word is raw data and must
 * not be labeled as LINEAR16 V or Y. Without the byte context (callers that
 * predate it), the label falls back to the payload-kind default and stays
 * spec-accurate only where the caller owns the LINEAR guarantee.
 */
export function getBitRegions(
  mode: AppMode,
  payloadKind?: Linear16PayloadKind,
  voutModeByte?: number,
): BitFieldRegion[] {
  switch (mode) {
    case 'L11':
      return [
        { id: 'n', label: '指数 N [15:11]', colorToken: 'n', bitRange: range(15, 11) },
        { id: 'y', label: '尾数 Y [10:0]', colorToken: 'y', bitRange: range(10, 0) },
      ]
    case 'L16': {
      const nonLinearByte =
        voutModeByte !== undefined && Number.isInteger(voutModeByte)
          ? analyzeVoutMode(voutModeByte).format !== 0
          : false
      const label = nonLinearByte
        ? RAW_WORD_NEUTRAL_LABEL
        : payloadKind === 'slinear16-offset'
          ? '有符号值 Y [15:0]'
          : '数值 V [15:0]'
      return [{ id: 'raw', label, colorToken: 'y', bitRange: fullRange16() }]
    }
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
