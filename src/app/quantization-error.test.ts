import { describe, expect, it } from 'vitest'
import { computeQuantizationOutcome } from './quantization-error'
import { PMBusMath } from '../legacy/pmbus-math'
import type { AppState } from './state'

const BASE: AppState = {
  mode: 'L11',
  raw: 0,
  commandKey: null,
  voutMode: { byte: 0x18 },
  l11: { n: 0, y: 0, autoN: true, valueInput: null },
  valueRequest: null,
  l16: { payloadKind: 'ulinear16', nominalVout: null },
  direct: { m: 1, b: 0, r: 0, errors: { m: null, b: null, r: null } },
  copy: { prefix0x: true, spaceBetweenBytes: true },
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
      valueRequest: { mode: 'DIRECT', value: 1, text: '1' },
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

  it('returns no outcome for non-LINEAR shared bytes (fail closed, v2.5.2)', () => {
    // §8.4: the output-voltage data format comes from the current VOUT_MODE,
    // so no implicit 0x18 channel exists — no represented value, no outcome.
    for (const byte of [0x20, 0x40, 0x60, 0xe0]) {
      const q = computeQuantizationOutcome(
        make({
          mode: 'L16',
          raw: 0x0001,
          voutMode: { byte },
          valueRequest: { mode: 'L16', value: 0.005 },
        }),
      )
      expect(q, `0x${byte.toString(16)}`).toBeNull()
    }
  })

  it('restores the quantization outcome after an explicit apply of 0x18', () => {
    // Same request shape as the fail-closed case above, but with the shared
    // byte explicitly written to the LINEAR default: the normal ULINEAR16
    // channel is back (N=-8).
    const q = computeQuantizationOutcome(
      make({
        mode: 'L16',
        raw: 0x0001,
        voutMode: { byte: 0x18 },
        valueRequest: { mode: 'L16', value: 0.005 },
      }),
    )
    expect(q?.represented).toBe(0.00390625)
    expect(q?.status).toBe('quantized')
  })

  it('SLINEAR16 offset + 0x98 clamps 200 to the signed boundary (saturated)', () => {
    // Y_s = round(200 × 256) clamps to 32767 → 127.99609375; the bounded
    // signed range makes this saturated/error, never quantized/warn.
    const q = computeQuantizationOutcome(
      make({
        mode: 'L16',
        raw: 0x7fff,
        voutMode: { byte: 0x98 },
        l16: { payloadKind: 'slinear16-offset', nominalVout: null },
        valueRequest: { mode: 'L16', value: 200 },
      }),
    )
    expect(q?.status).toBe('saturated')
    expect(q?.represented).toBe(127.99609375)
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
        valueRequest: { mode: 'DIRECT', value: 1.2345, text: '1.2345' },
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
        valueRequest: { mode: 'DIRECT', value: -1.2345, text: '-1.2345' },
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
        valueRequest: { mode: 'DIRECT', value: 0, text: '0' },
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
        valueRequest: { mode: 'DIRECT', value: 1e9, text: '1e9' },
      }),
    )
    expect(q?.status).toBe('saturated')
    expect(q?.represented).toBe(32.767)
  })
})

describe('computeQuantizationOutcome — DIRECT exact request provenance (v2.5.12)', () => {
  // Hand-built fixture mirroring a reducer transaction: `value` is the
  // classify-float Number of the same lexeme stored in `text`.
  const directExactState = (raw: number, m: number, b: number, r: number, text: string): AppState =>
    make({
      mode: 'DIRECT',
      raw,
      direct: { m, b, r, errors: { m: null, b: null, r: null } },
      valueRequest: { mode: 'DIRECT', value: Number(text), text },
    })

  it('counterexample A: integer request beyond binary64 resolution is quantized with exact +1 delta', () => {
    // m=1, b=0, R=-17: Y = round(100000000000000001 × 10^-17) = 1 → raw 0001.
    // binary64 folds both sides to 1e17 (Number delta 0) — the exact pipeline
    // must still report requested − represented = +1.
    const q = computeQuantizationOutcome(directExactState(0x0001, 1, 0, -17, '100000000000000001'))
    expect(q?.status).toBe('quantized')
    expect(q?.directExact?.requested).toEqual({ numerator: 100000000000000001n, denominator: 1n })
    expect(q?.directExact?.represented).toEqual({ numerator: 100000000000000000n, denominator: 1n })
    expect(q?.directExact?.absoluteError).toEqual({ numerator: 1n, denominator: 1n })
    // relative percent = 100 / (1e17 + 1) — never textual zero.
    expect(q?.directExact?.relativePercent).toEqual({
      numerator: 100n,
      denominator: 100000000000000001n,
    })
    // The Number fields stay folded approximations; they must not decide status.
    expect(q?.absoluteError).toBe(0)
  })

  it('counterexample A negative symmetric: exact −1 delta', () => {
    const q = computeQuantizationOutcome(directExactState(0xffff, 1, 0, -17, '-100000000000000001'))
    expect(q?.status).toBe('quantized')
    expect(q?.directExact?.absoluteError).toEqual({ numerator: -1n, denominator: 1n })
    expect(q?.directExact?.represented).toEqual({
      numerator: -100000000000000000n,
      denominator: 1n,
    })
  })

  it('true exact control: 100000000000000000 re-encodes exactly', () => {
    const q = computeQuantizationOutcome(directExactState(0x0001, 1, 0, -17, '100000000000000000'))
    expect(q?.status).toBe('exact')
    expect(q?.directExact?.absoluteError).toEqual({ numerator: 0n, denominator: 1n })
    expect(q?.directExact?.relativePercent).toEqual({ numerator: 0n, denominator: 1n })
  })

  it('counterexample B: −1.0000000000000000001 → exact −1e-19 delta, quantized', () => {
    // m=1, b=1, R=17: Y = round((−1.0000000000000000001 + 1) × 10^17) =
    // round(−0.01) = 0 → raw 0000, represented −1; the binary64 request
    // folds to −1 and the legacy readout showed a zero error.
    const q = computeQuantizationOutcome(
      directExactState(0x0000, 1, 1, 17, '-1.0000000000000000001'),
    )
    expect(q?.status).toBe('quantized')
    expect(q?.directExact?.requested).toEqual({
      numerator: -10000000000000000001n,
      denominator: 10n ** 19n,
    })
    expect(q?.directExact?.represented).toEqual({ numerator: -1n, denominator: 1n })
    expect(q?.directExact?.absoluteError).toEqual({ numerator: -1n, denominator: 10n ** 19n })
  })

  it('counterexample C upper: 32767.0000000000000001 saturates with exact +1e-16 delta', () => {
    const q = computeQuantizationOutcome(
      directExactState(0x7fff, 1, 0, 0, '32767.0000000000000001'),
    )
    expect(q?.status).toBe('saturated')
    expect(q?.represented).toBe(32767)
    expect(q?.directExact?.absoluteError).toEqual({ numerator: 1n, denominator: 10n ** 16n })
  })

  it('counterexample C lower: −32768.0000000000000001 saturates with exact −1e-16 delta', () => {
    const q = computeQuantizationOutcome(
      directExactState(0x8000, 1, 0, 0, '-32768.0000000000000001'),
    )
    expect(q?.status).toBe('saturated')
    expect(q?.represented).toBe(-32768)
    expect(q?.directExact?.absoluteError).toEqual({ numerator: -1n, denominator: 10n ** 16n })
  })

  it('inside-boundary 32766.9999999999999999 is quantized, never saturated', () => {
    const q = computeQuantizationOutcome(
      directExactState(0x7fff, 1, 0, 0, '32766.9999999999999999'),
    )
    expect(q?.status).toBe('quantized')
    expect(q?.directExact?.absoluteError).toEqual({ numerator: -1n, denominator: 10n ** 16n })
  })

  it('exact endpoints 32767 and −32768 classify exact', () => {
    const hi = computeQuantizationOutcome(directExactState(0x7fff, 1, 0, 0, '32767'))
    expect(hi?.status).toBe('exact')
    expect(hi?.directExact?.relativePercent).toEqual({ numerator: 0n, denominator: 1n })
    const lo = computeQuantizationOutcome(directExactState(0x8000, 1, 0, 0, '-32768'))
    expect(lo?.status).toBe('exact')
  })

  it('Math.round half-up ties stay repository policy: 0.5 → Y=1, −0.5 → Y=0', () => {
    const up = computeQuantizationOutcome(directExactState(0x0001, 1, 0, 0, '0.5'))
    expect(up?.status).toBe('quantized')
    expect(up?.directExact?.absoluteError).toEqual({ numerator: -1n, denominator: 2n })
    // Math.round(−0.5) is −0: the half-toward-+∞ contract encodes Y=0.
    const down = computeQuantizationOutcome(directExactState(0x0000, 1, 0, 0, '-0.5'))
    expect(down?.status).toBe('quantized')
    expect(down?.directExact?.absoluteError).toEqual({ numerator: -1n, denominator: 2n })
  })

  it('negative m orders the exact range endpoints (min −32767, max 32768)', () => {
    const above = computeQuantizationOutcome(directExactState(0x8000, -1, 0, 0, '40000'))
    expect(above?.status).toBe('saturated')
    expect(above?.represented).toBe(32768)
    expect(above?.directExact?.absoluteError).toEqual({ numerator: 7232n, denominator: 1n })
    const below = computeQuantizationOutcome(directExactState(0x7fff, -1, 0, 0, '-40000'))
    expect(below?.status).toBe('saturated')
    expect(below?.represented).toBe(-32767)
    expect(below?.directExact?.absoluteError).toEqual({ numerator: -7233n, denominator: 1n })
  })

  it('R extreme −128: 1e38 quantizes with exact 1e38 delta and 100% relative', () => {
    // Encode (m·X + b)·10^R = 1e38 × 10^−128 → round(1e-90) = 0 → raw 0000.
    const q = computeQuantizationOutcome(directExactState(0x0000, 1, 0, -128, '1e38'))
    expect(q?.status).toBe('quantized')
    expect(q?.directExact?.absoluteError).toEqual({ numerator: 10n ** 38n, denominator: 1n })
    expect(q?.directExact?.relativePercent).toEqual({ numerator: 100n, denominator: 1n })
  })

  it('b≠0 shifts the exact encodable range: request 1 with b=−5, R=127 saturates', () => {
    // Y = round((1−5) × 10^127) clamps to −32768; the exact range sits at
    // 5 ± 3.3e-123, so the request is strictly below the exact minimum.
    const q = computeQuantizationOutcome(directExactState(0x8000, 1, -5, 127, '1'))
    expect(q?.status).toBe('saturated')
    // binary64 collapses the represented value to exactly 5 (5 − 3.3e-123).
    expect(q?.represented).toBe(5)
  })

  it('repeating-decimal error stays exact as a rational (m=3: 0.5 → 2/3, delta −1/6)', () => {
    const q = computeQuantizationOutcome(directExactState(0x0002, 3, 0, 0, '0.5'))
    expect(q?.status).toBe('quantized')
    expect(q?.directExact?.represented).toEqual({ numerator: 2n, denominator: 3n })
    expect(q?.directExact?.absoluteError).toEqual({ numerator: -1n, denominator: 6n })
    expect(q?.directExact?.relativePercent).toEqual({ numerator: -100n, denominator: 3n })
  })

  it('exact-zero requests keep relativePercent null (true zero and signed −0)', () => {
    const zero = computeQuantizationOutcome(directExactState(0x0000, 1, 1, -1, '0'))
    expect(zero?.status).toBe('quantized')
    expect(zero?.directExact?.requested.numerator).toBe(0n)
    expect(zero?.directExact?.relativePercent).toBeNull()
    const signedZero = computeQuantizationOutcome(directExactState(0x0000, 1, 0, 0, '-0'))
    expect(signedZero?.status).toBe('exact')
    expect(signedZero?.directExact?.relativePercent).toBeNull()
  })

  it('m=0 and non-parsing provenance fail closed with no fabricated outcome', () => {
    const mZero = computeQuantizationOutcome(
      make({
        mode: 'DIRECT',
        raw: 1,
        direct: { m: 0, b: 0, r: 0, errors: { m: 'DIRECT 系数 m 不能为 0', b: null, r: null } },
        valueRequest: { mode: 'DIRECT', value: 1, text: '1' },
      }),
    )
    expect(mZero).toBeNull()
    // A provenance whose lexeme no longer parses is unreachable through the
    // reducer (deterministic parse of the stored lexeme); fail closed anyway.
    const stale = computeQuantizationOutcome(
      make({
        mode: 'DIRECT',
        raw: 1,
        valueRequest: { mode: 'DIRECT', value: 1, text: 'not-a-number' },
      }),
    )
    expect(stale).toBeNull()
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
