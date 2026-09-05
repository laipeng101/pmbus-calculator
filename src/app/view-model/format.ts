import type { BitGroupVM } from './types'

/** Canonical raw word hex ('0x' + 4 uppercase digits). */
export function formatRawHex(raw: number): string {
  return '0x' + (raw & 0xffff).toString(16).toUpperCase().padStart(4, '0')
}

export function formatByteHex(byte: number): string {
  return '0x' + (byte & 0xff).toString(16).toUpperCase().padStart(2, '0')
}

export function byteDigits(byte: number): string {
  return (byte & 0xff).toString(16).toUpperCase().padStart(2, '0')
}

/**
 * Number formatting mirroring legacy formatNumber (12 significant digits).
 * Finite-only: callers own the NaN / ±Infinity presentation (formatSpecial).
 */
export function formatNumber(v: number): string {
  if (Object.is(v, -0)) return '-0'
  if (Number.isInteger(v)) return v.toString()
  return parseFloat(v.toPrecision(12)).toString()
}

export function toBytesLE(raw: number): [number, number] {
  return [raw & 0xff, (raw >> 8) & 0xff]
}

export function toBytesBE(raw: number): [number, number] {
  return [(raw >> 8) & 0xff, raw & 0xff]
}

export function formatBytes(
  bytes: number[],
  opts: { prefix0x?: boolean; space?: boolean } = {},
): string {
  const { prefix0x = true, space = true } = opts
  const parts = bytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0'))
  let result = space ? parts.join(' ') : parts.join('')
  if (prefix0x) result = '0x ' + result
  return result
}

export function buildBitGroups(raw: number): BitGroupVM[] {
  const groups: BitGroupVM[] = []
  for (let nib = 0; nib < 4; nib++) {
    const nibbleValue = (raw >> (12 - nib * 4)) & 0xf
    const bits = []
    for (let b = 0; b < 4; b++) {
      const bitIndex = 15 - (nib * 4 + b)
      bits.push({ index: bitIndex, value: (raw >> bitIndex) & 1 })
    }
    groups.push({
      nibbleIndex: nib,
      hex: nibbleValue.toString(16).toUpperCase(),
      bits,
    })
  }
  return groups
}

/**
 * Signed error rendering. Readable fixed 6-decimals for |x| >= 1e-6 (legacy
 * look), adaptive significant digits below it — any non-zero error must
 * never render as textual zero.
 */
export function formatSignedError(value: number): string {
  if (value === 0) return '+0.000000'
  const body = Math.abs(value) >= 1e-6 ? value.toFixed(6) : formatNumber(value)
  return `${value > 0 ? '+' : ''}${body}`
}

export function formatSpecial(value: number): string {
  if (Number.isNaN(value)) return 'NaN'
  if (value > 0) return '+Infinity'
  if (value < 0) return '-Infinity'
  return Object.is(value, -0) ? '-0' : '+0'
}
