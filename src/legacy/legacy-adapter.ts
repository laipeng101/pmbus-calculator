/**
 * Legacy Adapter — bridge between legacy PMBusMath / metadata and the new app state model.
 *
 * This layer:
 * - Wraps PMBusMath for typed consumption
 * - Provides command metadata lookups
 * - Is the ONLY place where PMBusMath is called from the UI layer
 */

import { PMBusMath } from './pmbus-math'
import { getCommandConfig, type AppMode, type CommandMeta } from './command-metadata'

export type { AppMode, CommandMeta }
export { PMBusMath, getCommandConfig }

export interface CalculatorViewModel {
  mode: AppMode
  valueText: string
  rawHex: string
  rawBytesLE: string
  rawBytesBE: string
  formulaText: string
  deltaText?: string
  deltaKind?: 'ok' | 'warn' | 'error'
  warnings: Array<{ id: string; level: 'info' | 'warning' | 'error'; text: string }>
  commandNote?: string
  visible: {
    voutMode: boolean
    directCoefficients: boolean
    halfNote: boolean
    nRange: boolean
  }
}

export interface BitGroupViewModel {
  nibbleIndex: number
  hex: string
  bits: Array<{
    index: number
    value: number
    label?: string
  }>
}

/** Format a 16-bit raw value as hex string */
export function formatRawHex(raw: number): string {
  return '0x' + (raw & 0xffff).toString(16).toUpperCase().padStart(4, '0')
}

/** Split raw value into LE bytes */
export function toBytesLE(raw: number): [number, number] {
  const lo = raw & 0xff
  const hi = (raw >> 8) & 0xff
  return [lo, hi]
}

/** Split raw value into BE bytes */
export function toBytesBE(raw: number): [number, number] {
  const hi = (raw >> 8) & 0xff
  const lo = raw & 0xff
  return [hi, lo]
}

/** Format bytes as hex string with optional prefix and spacing */
export function formatBytes(
  bytes: number[],
  opts: { prefix0x?: boolean; space?: boolean; endian?: 'le' | 'be' } = {},
): string {
  const { prefix0x = true, space = true } = opts
  const parts = bytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0'))
  let result = space ? parts.join(' ') : parts.join('')
  if (prefix0x) result = '0x' + (space ? '' : '') + result
  return result
}

/** Build bit groups (nibble grouping) for a 16-bit raw value */
export function buildBitGroups(raw: number): BitGroupViewModel[] {
  const groups: BitGroupViewModel[] = []
  for (let nib = 0; nib < 4; nib++) {
    const nibbleValue = (raw >> (12 - nib * 4)) & 0xf
    const bits = []
    for (let b = 0; b < 4; b++) {
      const bitIndex = 15 - (nib * 4 + b)
      bits.push({
        index: bitIndex,
        value: (raw >> bitIndex) & 1,
      })
    }
    groups.push({
      nibbleIndex: nib,
      hex: nibbleValue.toString(16).toUpperCase(),
      bits,
    })
  }
  return groups
}

/** Placeholder: derive full CalculatorViewModel from AppState */
export function toCalculatorViewModel(
  _state: unknown,
): CalculatorViewModel {
  // TODO: implement when AppState is wired up
  return {
    mode: 'L11',
    valueText: '—',
    rawHex: '0x0000',
    rawBytesLE: '0x00 00',
    rawBytesBE: '0x00 00',
    formulaText: 'Y × 2^N',
    warnings: [],
    visible: {
      voutMode: false,
      directCoefficients: false,
      halfNote: false,
      nRange: true,
    },
  }
}
