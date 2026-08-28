import { describe, it, expect } from 'vitest'
import {
  resolveRelativeVoltage,
  RELATIVE_VOLTAGE_OVERFLOW_NOTE,
  RELATIVE_VOLTAGE_UNDERFLOW_NOTE,
} from './relative-voltage'

describe('resolveRelativeVoltage (v2.5.9 §7.3 matrix)', () => {
  it('classifies finite results — including large and subnormal magnitudes', () => {
    // 98 / 0100 | 12 → ratio=1, X=12
    expect(resolveRelativeVoltage(12, 1)).toEqual({ kind: 'finite', value: 12 })
    // 98 / 0100 | 1e308 → finite: a huge but finite nominal must NOT be rejected
    const huge = resolveRelativeVoltage(1e308, 1)
    expect(huge.kind).toBe('finite')
    if (huge.kind === 'finite') expect(huge.value).toBe(1e308)
    // 98 / 0100 | 5e-324 → nonzero finite: subnormal references stay usable
    const subnormal = resolveRelativeVoltage(5e-324, 1)
    expect(subnormal.kind).toBe('finite')
    if (subnormal.kind === 'finite') expect(subnormal.value).toBe(5e-324)
  })

  it('classifies multiplication overflow above Number.MAX_VALUE', () => {
    // 98 / 0200 | 1e308 → ratio=2 → product +Infinity
    expect(resolveRelativeVoltage(1e308, 2)).toEqual({ kind: 'overflow' })
  })

  it('pins the Number.MAX_VALUE ratio=1/2 adjacency', () => {
    const maxValue = Number.MAX_VALUE
    expect(resolveRelativeVoltage(maxValue, 1).kind).toBe('finite')
    expect(resolveRelativeVoltage(maxValue, 2).kind).toBe('overflow')
  })

  it('classifies nonzero-factor underflow to zero', () => {
    // 90 / 0001 | 5e-324 → N=-16 ratio=2^-16; product rounds to 0
    const underflow = resolveRelativeVoltage(5e-324, Math.pow(2, -16))
    expect(underflow.kind).toBe('underflow')
  })

  it('keeps true zeros distinct from underflow', () => {
    // 98 / 0000 | 1e308 → ratio=0 → true zero
    const zeroRatio = resolveRelativeVoltage(1e308, 0)
    expect(zeroRatio.kind).toBe('finite')
    if (zeroRatio.kind === 'finite') expect(zeroRatio.value).toBe(0)
    // 98 / FFFF | 0 → nominal=0 → true zero (decode-only display value)
    const zeroNominal = resolveRelativeVoltage(0, 65535 * Math.pow(2, -8))
    expect(zeroNominal.kind).toBe('finite')
    if (zeroNominal.kind === 'finite') expect(zeroNominal.value).toBe(0)
  })

  it('classifies a missing reference without touching the ratio', () => {
    // 98 / 0200 | null → ratio visible, final voltage missing
    expect(resolveRelativeVoltage(null, 2)).toEqual({ kind: 'missing-reference' })
  })

  it('exposes shared diagnostic notes for every surface', () => {
    expect(RELATIVE_VOLTAGE_OVERFLOW_NOTE).toContain('Number')
    expect(RELATIVE_VOLTAGE_UNDERFLOW_NOTE).toContain('非零')
  })

  it('keeps the input-layer 1e-400 → 0 contract distinct from derivation underflow', () => {
    // The parse layer accepts `1e-400` as +0 (documented v2.5.8 input
    // contract): committed nominal 0 × nonzero ratio is a TRUE zero result,
    // never reported as a derivation underflow.
    expect(resolveRelativeVoltage(0, 2).kind).toBe('finite')
  })
})
