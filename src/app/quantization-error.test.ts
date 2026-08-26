import { describe, expect, it } from 'vitest'
import { computeQuantizationOutcome } from './quantization-error'
import { PMBusMath } from '../legacy/pmbus-math'
import type { AppState } from './state'

const BASE: AppState = {
  mode: 'L11',
  raw: 0,
  commandKey: null,
  byteOrder: 'le',
  voutMode: { byte: 0x18 },
  l11: { n: 0, y: 0, autoN: true, valueInput: null },
  valueRequest: null,
  l16: { payloadKind: 'ulinear16', nominalVout: null },
  direct: { m: 1, b: 0, r: 0, errors: { m: null, b: null, r: null } },
  copy: { prefix0x: true, spaceBetweenBytes: true, endian: 'le' },
  ui: { theme: 'system', debugOpen: false },
}

function make(overrides: Partial<AppState> = {}): AppState {
  return { ...BASE, ...overrides }
}

describe('computeQuantizationOutcome — provenance contract (all modes)', () => {
  it('returns null without an explicit request — never a fabricated zero', () => {
    // Initial state, raw/bit edits, cleared provenance: error unknown.
    expect(computeQuantizationOutcome(BASE)).toBeNull()
    expect(computeQuantizationOutcome(make({ mode: 'L16', raw: 0x0c00 }))).toBeNull()
    expect(computeQuantizationOutcome(make({ mode: 'DIRECT', raw: 1235 }))).toBeNull()
    expect(computeQuantizationOutcome(make({ mode: 'HALF', raw: 0x3c05 }))).toBeNull()
  })

  it('returns null for pages without a decodable physical value', () => {
    expect(computeQuantizationOutcome(make({ mode: 'VOUT_MODE' }))).toBeNull()
    // Relative ULINEAR16 is a ratio; no physical request error applies.
    const relative = make({
      mode: 'L16',
      voutMode: { byte: 0x98 },
      valueRequest: { mode: 'L16', value: 3.3 },
    })
    expect(computeQuantizationOutcome(relative)).toBeNull()
    // DIRECT m=0 has no inverse transform.
    const mZero = make({
      mode: 'DIRECT',
      direct: { ...BASE.direct, m: 0 },
      valueRequest: { mode: 'DIRECT', value: 1 },
    })
    expect(computeQuantizationOutcome(mZero)).toBeNull()
  })

  it('mode-tagged requests never cross-contaminate pages', () => {
    const stale = { mode: 'L16' as const, value: 42 }
    for (const mode of ['L11', 'DIRECT', 'HALF'] as const) {
      expect(computeQuantizationOutcome(make({ mode, valueRequest: stale }))).toBeNull()
    }
  })
})

describe('computeQuantizationOutcome — LINEAR11', () => {
  it('reports exact and quantized round-to-nearest outcomes', () => {
    const exact = computeQuantizationOutcome(
      make({ raw: 0x0001, l11: { ...BASE.l11, valueInput: 1 } }),
    )
    expect(exact).toMatchObject({ status: 'exact', requested: 1, represented: 1, absoluteError: 0 })
    expect(exact?.relativeError).toBe(0)

    const quantized = computeQuantizationOutcome(
      make({ raw: 0x0001, l11: { ...BASE.l11, valueInput: 0.999999 } }),
    )
    expect(quantized?.status).toBe('quantized')
    expect(quantized?.absoluteError).toBeCloseTo(-1e-6, 15)
    expect(quantized?.relativeError).toBeCloseTo(-0.0001, 6)
  })

  it('classifies out-of-range encodes as saturated with boundary values', () => {
    // auto-N: full-format range; 1e10 saturates to N=15, Y=1023.
    const saturated = computeQuantizationOutcome(
      make({
        raw: PMBusMath.encodeLinear11(15, 1023),
        l11: { n: 15, y: 1023, autoN: true, valueInput: 1e10 },
      }),
    )
    expect(saturated?.status).toBe('saturated')
    expect(saturated?.represented).toBe(1023 * PMBusMath.pow2(15))
    expect(saturated?.absoluteError).toBeGreaterThan(0)

    // Locked N: per-N range [-512, 511.5] at N=-1.
    const locked = computeQuantizationOutcome(
      make({
        raw: PMBusMath.encodeLinear11(-1, 1023),
        l11: { n: -1, y: 1023, autoN: false, valueInput: 600 },
      }),
    )
    expect(locked?.status).toBe('saturated')
    expect(locked?.represented).toBe(511.5)
  })

  it('keeps legacy boundary encodes free of saturation claims', () => {
    // Y=1023 at N=0 with an in-range request is a legal boundary, not saturation.
    const boundary = computeQuantizationOutcome(
      make({ raw: 0x03ff, l11: { ...BASE.l11, valueInput: 1023 } }),
    )
    expect(boundary?.status).toBe('exact')
  })
})

describe('computeQuantizationOutcome — LINEAR16', () => {
  it('absolute ULINEAR16 golden vector: N=-8, 0.005 → 0.00390625', () => {
    const q = computeQuantizationOutcome(
      make({
        mode: 'L16',
        raw: PMBusMath.encodeUlinear16(0.005, -8),
        voutMode: { byte: 0x18 },
        valueRequest: { mode: 'L16', value: 0.005 },
      }),
    )
    expect(q).toMatchObject({
      status: 'quantized',
      requested: 0.005,
      represented: 0.00390625,
    })
    expect(q?.absoluteError).toBeCloseTo(0.00109375, 15)
    expect(q?.relativeError).toBeCloseTo(21.875, 10)
  })

  it('classifies clamped encodes as saturated on both range ends', () => {
    // Below range: requested -1 clamps to raw=0 → represented 0.
    const low = computeQuantizationOutcome(
      make({
        mode: 'L16',
        raw: 0,
        voutMode: { byte: 0x18 },
        valueRequest: { mode: 'L16', value: -1 },
      }),
    )
    expect(low?.status).toBe('saturated')
    expect(low?.represented).toBe(0)

    // Above range: requested 300 clamps to 65535 → 255.99609375 at N=-8.
    const high = computeQuantizationOutcome(
      make({
        mode: 'L16',
        raw: 0xffff,
        voutMode: { byte: 0x18 },
        valueRequest: { mode: 'L16', value: 300 },
      }),
    )
    expect(high?.status).toBe('saturated')
    expect(high?.represented).toBe(255.99609375)
  })

  it('computes against the fallback 0x18 for real non-LINEAR shared bytes', () => {
    // 0x20 (DIRECT fmt) / 0x40 (IEEE Half fmt) / 0x60 (VID) fall back to 0x18;
    // the outcome must use N=-8, not refuse to compute. UI labels the fallback.
    for (const byte of [0x20, 0x40, 0x60]) {
      const q = computeQuantizationOutcome(
        make({
          mode: 'L16',
          raw: 0x0001,
          voutMode: { byte },
          valueRequest: { mode: 'L16', value: 0.005 },
        }),
      )
      expect(q?.represented, `0x${byte.toString(16)}`).toBe(0.00390625)
      expect(q?.status, `0x${byte.toString(16)}`).toBe('quantized')
    }
  })

  it('SLINEAR16 offset keeps signed semantics even when bit7 is relative', () => {
    // 0x98 = relative LINEAR; payload kind wins for the offset semantics
    // (Part II §13.3/§13.4: bit7 does not participate in the offset math).
    const q = computeQuantizationOutcome(
      make({
        mode: 'L16',
        raw: PMBusMath.encodeSlinear16(3.3, -8),
        voutMode: { byte: 0x98 },
        l16: { payloadKind: 'slinear16-offset', nominalVout: null },
        valueRequest: { mode: 'L16', value: 3.3 },
      }),
    )
    expect(q?.represented).toBe(3.30078125)
    expect(q?.absoluteError).toBeCloseTo(-0.00078125, 15)
    expect(q?.status).toBe('quantized')
  })
})

describe('computeQuantizationOutcome — DIRECT', () => {
  it('golden vector: m=1000, 1.2345 → 1.235, error −0.0005', () => {
    const q = computeQuantizationOutcome(
      make({
        mode: 'DIRECT',
        raw: 1235,
        direct: { m: 1000, b: 0, r: 0, errors: { m: null, b: null, r: null } },
        valueRequest: { mode: 'DIRECT', value: 1.2345 },
      }),
    )
    expect(q).toMatchObject({ status: 'quantized', represented: 1.235 })
    expect(q?.absoluteError).toBeCloseTo(-0.0005, 14)
  })

  it('negative tie: −1.2345 → −1.234 (legacy round-half-up), error −0.0005', () => {
    const q = computeQuantizationOutcome(
      make({
        mode: 'DIRECT',
        raw: PMBusMath.fromSigned(-1234, 16),
        direct: { m: 1000, b: 0, r: 0, errors: { m: null, b: null, r: null } },
        valueRequest: { mode: 'DIRECT', value: -1.2345 },
      }),
    )
    expect(q?.represented).toBe(-1.234)
    expect(q?.absoluteError).toBeCloseTo(-0.0005, 14)
    expect(q?.status).toBe('quantized')
  })

  it('zero request with non-zero represented: absolute kept, relative undefined', () => {
    // m=1, b=1, R=-1: X=0 → Y=round((0+1)×10^-1)=0 → decode −1.
    // requested − represented = +1; relative error for a zero denominator
    // is undefined and must never render as 0%.
    const q = computeQuantizationOutcome(
      make({
        mode: 'DIRECT',
        raw: 0,
        direct: { m: 1, b: 1, r: -1, errors: { m: null, b: null, r: null } },
        valueRequest: { mode: 'DIRECT', value: 0 },
      }),
    )
    expect(q).toMatchObject({ status: 'quantized', requested: 0, represented: -1 })
    expect(q?.absoluteError).toBe(1)
    expect(q?.relativeError).toBeNull()
  })

  it('classifies Y-domain clamping as saturated', () => {
    const q = computeQuantizationOutcome(
      make({
        mode: 'DIRECT',
        raw: 0x7fff,
        direct: { m: 1000, b: 0, r: 0, errors: { m: null, b: null, r: null } },
        valueRequest: { mode: 'DIRECT', value: 1e9 },
      }),
    )
    expect(q?.status).toBe('saturated')
    expect(q?.represented).toBe(32.767)
  })
})

describe('computeQuantizationOutcome — IEEE Half', () => {
  it('golden vector: 1.005 → 1.0048828125', () => {
    const q = computeQuantizationOutcome(
      make({
        mode: 'HALF',
        raw: 0x3c05,
        valueRequest: { mode: 'HALF', value: 1.005 },
      }),
    )
    expect(q?.status).toBe('quantized')
    expect(q?.represented).toBeCloseTo(1.0048828125, 15)
    expect(q?.absoluteError).toBeCloseTo(0.0001171875, 15)
  })

  it('subnormal tie-to-even: 2^-25 → +0 with a non-zero, fully relative error', () => {
    const tiny = 2 ** -25
    const q = computeQuantizationOutcome(
      make({
        mode: 'HALF',
        raw: PMBusMath.encodeHalf(tiny),
        valueRequest: { mode: 'HALF', value: tiny },
      }),
    )
    expect(q?.status).toBe('quantized')
    expect(q?.represented).toBe(0)
    expect(q?.absoluteError).toBe(tiny)
    expect(q?.absoluteError).not.toBe(0)
    expect(q?.relativeError).toBeCloseTo(100, 10)
  })

  it('smallest subnormal encodes exactly', () => {
    const q = computeQuantizationOutcome(
      make({
        mode: 'HALF',
        raw: PMBusMath.encodeHalf(2 ** -24),
        valueRequest: { mode: 'HALF', value: 2 ** -24 },
      }),
    )
    expect(q?.status).toBe('exact')
    expect(q?.absoluteError).toBe(0)
  })

  it('finite overflow: 65520 → +Infinity must surface as overflow, never hide', () => {
    const q = computeQuantizationOutcome(
      make({
        mode: 'HALF',
        raw: PMBusMath.encodeHalf(65520),
        valueRequest: { mode: 'HALF', value: 65520 },
      }),
    )
    expect(q?.status).toBe('overflow')
    expect(q?.represented).toBe(Number.POSITIVE_INFINITY)
    expect(q?.absoluteError).toBeNull()
    expect(q?.relativeError).toBeNull()
  })

  it('max finite encodes exactly; signed zero keeps its sign with undefined relative', () => {
    const maxFinite = computeQuantizationOutcome(
      make({
        mode: 'HALF',
        raw: 0x7bff,
        valueRequest: { mode: 'HALF', value: 65504 },
      }),
    )
    expect(maxFinite?.status).toBe('exact')

    const negativeZero = computeQuantizationOutcome(
      make({
        mode: 'HALF',
        raw: 0x8000,
        valueRequest: { mode: 'HALF', value: -0 },
      }),
    )
    // requested −0 − represented −0 → 0; relative for a zero denominator is null.
    expect(negativeZero?.status).toBe('exact')
    expect(negativeZero?.absoluteError).toBe(0)
    expect(negativeZero?.relativeError).toBeNull()
  })

  it('special-value requests classify instead of vanishing', () => {
    const nan = computeQuantizationOutcome(
      make({
        mode: 'HALF',
        raw: PMBusMath.encodeHalf(NaN),
        valueRequest: { mode: 'HALF', value: NaN },
      }),
    )
    expect(nan?.status).toBe('special')

    const posInf = computeQuantizationOutcome(
      make({
        mode: 'HALF',
        raw: 0x7c00,
        valueRequest: { mode: 'HALF', value: Number.POSITIVE_INFINITY },
      }),
    )
    expect(posInf?.status).toBe('special')
    expect(posInf?.represented).toBe(Number.POSITIVE_INFINITY)
  })
})
