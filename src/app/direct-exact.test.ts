import { describe, expect, it } from 'vitest'
import { PMBusMath } from '../legacy/pmbus-math'
import {
  analyzeDirectRoundTrip,
  analyzeDirectTextReentry,
  checkExactLexemeBoundary,
  decodeDirectExact,
  DIRECT_EXACT_MAX_LEXEME_LENGTH,
  encodeDirectExactFromRational,
  formatExactDelta,
  formatExactPercent,
  formatExactRational,
  formatSignedRationalFixed,
  formatSignedRationalScientific,
  generateSafeDirectReentryText,
  parseDecimalExactRational,
  roundRationalHalfUp,
  type ExactRational,
} from './direct-exact'
import { classifyFloatText } from './float-parse'
import { formatPlainNumber } from './numeric-presentation'

/**
 * v2.5.11 — DIRECT exact-coefficient reference model (BigInt oracle).
 *
 * The tests never let the binary64 product path prove itself: exact values
 * are checked against independent BigInt cross-multiplication identities,
 * exactly-representable decodes are compared bit-exactly against the float
 * decode, and the full 65536-Y sweeps pin the round-trip analysis to the
 * REAL shipped encode/decode pair. Property tests use a fixed seed and a
 * fixed sample count and print reproducible vectors on failure.
 */

/** Independent BigInt invariant: m·X·10^R === Y − b·10^R for X = num/den.
 * Derived per R sign without Math.pow rationals:
 *   R ≥ 0: m·num·10^R === (Y − b·10^R)·den
 *   R < 0: m·num       === (Y·10^(−R) − b)·den   (Y·10^(−R) is an integer)
 */
function decodeIdentityHolds(
  x: ExactRational,
  y: number,
  m: number,
  b: number,
  r: number,
): boolean {
  const Y = BigInt(y)
  const M = BigInt(m)
  const B = BigInt(b)
  if (r >= 0) {
    const p = 10n ** BigInt(r)
    return M * x.numerator * p === (Y - B * p) * x.denominator
  }
  const p = 10n ** BigInt(-r)
  return M * x.numerator === (Y * p - B) * x.denominator
}

/** Y-field equality: ±0 are the same integer field value (raw is identical). */
function sameY(a: number, b: number): boolean {
  return a === b || (a === 0 && b === 0)
}

function expectNormalized(x: ExactRational): void {
  expect(x.denominator > 0n).toBe(true)
  const g = gcdOf(x.numerator < 0n ? -x.numerator : x.numerator, x.denominator)
  expect(g).toBe(1n)
}

function gcdOf(a: bigint, b: bigint): bigint {
  while (b !== 0n) {
    const r = a % b
    a = b
    b = r
  }
  return a
}

/** Deterministic PRNG (mulberry32) so every failure is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const SEED = 0xd15c7

/** Layered corpus: full-65536 sets first, sampled-Y grid second. */
const FULL_SWEEP_COEFFICIENTS: Array<{ m: number; b: number; r: number }> = [
  { m: 1, b: 1, r: 17 }, // the production-site counterexample family
  { m: 1, b: 0, r: 0 }, // identity coefficients (X = Y, always exact in binary64)
  { m: 1, b: 1, r: 12 }, // v3.1.1: display-formatting fold family (29491/65536 unsafe copies)
]

const SAMPLED_GRID: Array<{ m: number; b: number; r: number }> = [
  { m: 2, b: 0, r: 0 }, // terminating dyadic
  { m: 3, b: 1, r: 2 }, // repeating rationals
  { m: -3, b: -1, r: -2 }, // negative m, negative R
  { m: -27293, b: -1178, r: 13 }, // high cancellation error
  { m: -32685, b: -30314, r: 125 }, // large exponent, saturation boundary
  { m: 32767, b: 32767, r: 127 },
  { m: -32768, b: -32768, r: -128 },
]

const SAMPLED_YS = (() => {
  const ys = new Set<number>([-32768, -32767, -1, 0, 1, 32766, 32767])
  for (let y = -32768; y <= 32767; y += 97) ys.add(y)
  return [...ys].sort((a, b) => a - b)
})()

describe('DIRECT exact decode reference (BigInt oracle)', () => {
  it('models the production-site counterexample exactly: m=1,b=1,R=17,Y=-1', () => {
    const exact = decodeDirectExact(-1, 1, 1, 17)
    expect(exact).not.toBeNull()
    expect(formatExactRational(exact!)).toBe('-100000000000000001/100000000000000000')
    expectNormalized(exact!)
    expect(decodeIdentityHolds(exact!, -1, 1, 1, 17)).toBe(true)
    // The binary64 product path folds it onto -1 and re-encodes to Y=0.
    const analysis = analyzeDirectRoundTrip(-1, 1, 1, 17)
    expect(analysis!.approxValue).toBe(-1)
    expect(analysis!.reencodedY).toBe(0)
    expect(analysis!.roundTripSafe).toBe(false)
  })

  it('keeps Y=0 exact and safe under the same coefficients', () => {
    const exact = decodeDirectExact(0, 1, 1, 17)!
    expect(formatExactRational(exact)).toBe('-1')
    const analysis = analyzeDirectRoundTrip(0, 1, 1, 17)
    expect(analysis!.approxValue).toBe(-1)
    expect(analysis!.reencodedY).toBe(0)
    expect(analysis!.roundTripSafe).toBe(true)
  })

  it('returns null for m=0 and never fabricates a rational', () => {
    expect(decodeDirectExact(0, 0, 0, 0)).toBeNull()
    expect(analyzeDirectRoundTrip(-1, 0, 1, 17)).toBeNull()
    expect(() =>
      encodeDirectExactFromRational({ numerator: 1n, denominator: 2n }, 0, 0, 0),
    ).toThrow()
  })

  it('rejects non-integer fields instead of silently truncating', () => {
    expect(() => decodeDirectExact(0.5, 1, 0, 0)).toThrow(TypeError)
    expect(() => decodeDirectExact(1, 1.5, 0, 0)).toThrow(TypeError)
    expect(() => decodeDirectExact(1, 1, 0, 0.5)).toThrow(TypeError)
  })

  it('handles negative m, both R signs and boundary fields via the identity oracle', () => {
    for (const y of [-32768, -1, 0, 1, 32767]) {
      for (const m of [-32768, -1, 1, 32767]) {
        for (const b of [-32768, -1, 0, 1, 32767]) {
          for (const r of [-128, -127, -1, 0, 1, 126, 127]) {
            const exact = decodeDirectExact(y, m, b, r)
            expect(exact, `y=${y} m=${m} b=${b} r=${r}`).not.toBeNull()
            expectNormalized(exact!)
            expect(
              decodeIdentityHolds(exact!, y, m, b, r),
              `identity y=${y} m=${m} b=${b} r=${r}`,
            ).toBe(true)
          }
        }
      }
    }
  })

  it('terminating (m=2) and repeating (m=3) decodes both normalize exactly', () => {
    // m=2, b=0, R=0: X = Y/2 — dyadic, so binary64 is exact and both paths agree.
    for (const y of [-3, -1, 1, 3, 5]) {
      const exact = decodeDirectExact(y, 2, 0, 0)!
      expect(formatExactRational(exact)).toBe(`${y}/2`)
      expect(Number(exact.numerator) / Number(exact.denominator)).toBe(
        PMBusMath.decodeDirect(y, 2, 0, 0).value,
      )
    }
    // m=3, b=0, R=0: X = Y/3 — repeating; the rational stays exact while the
    // binary64 result only approximates it (float 3·(1/3) folds back to 1,
    // proving the double cannot hold 1/3).
    const third = decodeDirectExact(1, 3, 0, 0)!
    expect(formatExactRational(third)).toBe('1/3')
    expect(PMBusMath.decodeDirect(1, 3, 0, 0).value * 3).toBe(1)
    expect(decodeIdentityHolds(third, 1, 3, 0, 0)).toBe(true)
  })

  it('agrees bit-exactly with the float decode when the exact value is representable', () => {
    // X = (Y − b)/m with m = 2^k and R = 0 is dyadic: IEEE division returns
    // the exact value, so both the rational conversion and the float
    // expression must produce the same double.
    for (const m of [1, 2, 4, 8]) {
      for (const b of [-7, 0, 13]) {
        for (const y of [-32768, -255, -1, 0, 1, 255, 32767]) {
          const exact = decodeDirectExact(y, m, b, 0)!
          const rationalNumber = Number(exact.numerator) / Number(exact.denominator)
          expect(rationalNumber, `y=${y} m=${m} b=${b}`).toBe(
            PMBusMath.decodeDirect(y, m, b, 0).value,
          )
        }
      }
    }
  })

  it('stays exact beyond the binary64 precision boundary without crashing', () => {
    // X = 10^128 − 1 (R=-128): an integer far beyond 2^53 — binary64 loses
    // the trailing −1, the rational does not.
    const exact = decodeDirectExact(1, 1, 1, -128)!
    expect(exact.numerator).toBe(10n ** 128n - 1n)
    expect(exact.denominator).toBe(1n)
    expect(PMBusMath.decodeDirect(1, 1, 1, -128).value).toBe(1e128)
    // Subnormal-scale magnitude (R=127): exact and finite, never a fake zero.
    const tiny = decodeDirectExact(1, 1, 0, 127)!
    expect(formatExactRational(tiny)).toBe(`1/${10n ** 127n}`)
    expect(Number(tiny.numerator) / Number(tiny.denominator)).toBe(
      PMBusMath.decodeDirect(1, 1, 0, 127).value,
    )
  })

  it('proves the collision set where distinct Y share one binary64 value', () => {
    // m=1, b=1, R=17: every Y with |Y·1e-17| below half an ulp of 1 folds to
    // exactly −1, so Y=0 and Y=-1 (among others) display the same Number.
    const groups = new Map<number, number[]>()
    for (let y = -32768; y <= 32767; y++) {
      const approx = PMBusMath.decodeDirect(y, 1, 1, 17).value
      const group = groups.get(approx)
      if (group) group.push(y)
      else groups.set(approx, [y])
    }
    const folded = groups.get(-1)!
    expect(folded).toContain(0)
    expect(folded).toContain(-1)
    expect(folded.length).toBeGreaterThan(2)
    // Inside one collision group the re-entry verdicts genuinely differ:
    // Y=0 is safe, Y=-1 has been precision-folded away.
    expect(analyzeDirectRoundTrip(0, 1, 1, 17)!.roundTripSafe).toBe(true)
    expect(analyzeDirectRoundTrip(-1, 1, 1, 17)!.roundTripSafe).toBe(false)
  })
})

describe('Math.round contract reproduction (exact arithmetic)', () => {
  it('matches Math.round half-toward-+∞ semantics on ties', () => {
    // roundRationalHalfUp(n, d) === BigInt(Math.round(n/d)) for dyadic halves.
    const cases: Array<[bigint, bigint, number]> = [
      [1n, 2n, 1], // 0.5 → 1
      [3n, 2n, 2], // 1.5 → 2
      [5n, 2n, 3], // 2.5 → 3
      [-1n, 2n, 0], // -0.5 → -0 (0 as an integer field value)
      [-3n, 2n, -1], // -1.5 → -1
      [-5n, 2n, -2], // -2.5 → -2
      [1n, 1n, 1],
      [-1n, 1n, -1],
    ]
    for (const [n, d, expected] of cases) {
      expect(roundRationalHalfUp(n, d)).toBe(BigInt(expected))
      // Math.round(-0.5) is -0; == treats ±0 as the same integer field value.
      expect(Math.round(Number(n) / Number(d)) == expected).toBe(true)
    }
  })

  it('round-trips every exact decode back to its own Y (identity contract)', () => {
    // X is the exact decode of Y ⇒ (m·X + b)·10^R === Y ⇒ the exact encoder
    // must return Y for every legal field combination.
    for (const { m, b, r } of [...FULL_SWEEP_COEFFICIENTS, ...SAMPLED_GRID]) {
      for (const y of SAMPLED_YS) {
        const exact = decodeDirectExact(y, m, b, r)!
        expect(encodeDirectExactFromRational(exact, m, b, r), `y=${y} m=${m} b=${b} r=${r}`).toBe(y)
      }
    }
  })

  it('agrees with the float Math.round contract for exactly-representable dyadic requests', () => {
    // x = k/2^s with small k and s keeps every float intermediate exact, so
    // the exact encoder and PMBusMath.encodeDirect must agree.
    for (const m of [1, 2, -3, 977]) {
      for (const b of [-3, 0, 5]) {
        for (const r of [0, 1, -2]) {
          for (const [k, s] of [
            [1, 1],
            [3, 2],
            [-7, 3],
            [425, 5],
          ] as const) {
            const x: ExactRational = { numerator: BigInt(k), denominator: 2n ** BigInt(s) }
            const floatValue = k / 2 ** s
            const expected = PMBusMath.encodeDirect(floatValue, m, b, r)
            expect(
              sameY(encodeDirectExactFromRational(x, m, b, r), expected),
              `x=${floatValue} m=${m} b=${b} r=${r}`,
            ).toBe(true)
          }
        }
      }
    }
  })

  it('clamps to the signed 16-bit boundaries like the float encoder', () => {
    const huge: ExactRational = { numerator: 10n ** 30n, denominator: 1n }
    expect(encodeDirectExactFromRational(huge, 1, 0, 0)).toBe(32767)
    expect(encodeDirectExactFromRational({ ...huge, numerator: -huge.numerator }, 1, 0, 0)).toBe(
      -32768,
    )
  })
})

describe('decimal lexeme exact parsing', () => {
  it('parses sign, fraction and exponent into the normalized rational', () => {
    const cases: Array<[string, string]> = [
      ['-1', '-1'],
      ['0.5', '1/2'],
      ['-0.5', '-1/2'],
      ['1.00000000000000001', '100000000000000001/100000000000000000'],
      ['-1.00000000000000001', '-100000000000000001/100000000000000000'],
      ['1e21', `${10n ** 21n}`],
      ['-1e21', `-${10n ** 21n}`],
      ['1e-21', '1/1000000000000000000000'],
      ['12.5e-1', '5/4'],
      ['+3', '3'],
      ['.5', '1/2'],
      ['5.', '5'],
      ['0e-400', '0'],
      ['-0.0e-999', '0'],
    ]
    for (const [text, expected] of cases) {
      const parsed = parseDecimalExactRational(text)
      expect(parsed, text).not.toBeNull()
      expect(formatExactRational(parsed!), text).toBe(expected)
      expectNormalized(parsed!)
    }
  })

  it('keeps -0 sign information off the magnitude but parses true zero texts', () => {
    const negativeZeroText = parseDecimalExactRational('-0')!
    expect(negativeZeroText.numerator).toBe(0n)
    expect(negativeZeroText.denominator).toBe(1n)
  })

  it('rejects NaN/Infinity literals and non-decimal text', () => {
    for (const text of ['NaN', 'Infinity', '-Infinity', 'abc', '', '1e', '1.2.3', '0x10', '--1']) {
      expect(parseDecimalExactRational(text), text).toBeNull()
    }
  })
})

describe('safe re-entry text generation (verified exact encoder)', () => {
  it('returns the exact terminating decimal for the production-site counterexample', () => {
    const exact = decodeDirectExact(-1, 1, 1, 17)!
    const safe = generateSafeDirectReentryText(exact, -1, 1, 1, 17)
    expect(safe).toEqual({ text: '-1.00000000000000001', kind: 'exact' })
    // Independent re-entry proof through the real input classification.
    const classified = classifyFloatText(safe!.text)
    expect(classified).toEqual({ kind: 'value', value: -1 })
    expect(encodeDirectExactFromRational(parseDecimalExactRational(safe!.text)!, 1, 1, 17)).toBe(-1)
  })

  it('prefers the exact expansion over shorter approximations for terminating values', () => {
    // Y=3, m=2, b=0, R=0 → 1.5 exactly; the copy text must be exactly 1.5.
    const exact = decodeDirectExact(3, 2, 0, 0)!
    expect(generateSafeDirectReentryText(exact, 3, 2, 0, 0)).toEqual({
      text: '1.5',
      kind: 'exact',
    })
  })

  it('finds a verified approximation for repeating rationals and labels it honestly', () => {
    // m=3, b=0, R=0, Y=1 → X = 1/3 (repeating). No exact decimal exists, so
    // the first verified nearest-decimal approximation is returned with kind
    // 'approximate' — it must never be presented as the exact value.
    const exact = decodeDirectExact(1, 3, 0, 0)!
    const safe = generateSafeDirectReentryText(exact, 1, 3, 0, 0)
    expect(safe).not.toBeNull()
    expect(safe!.kind).toBe('approximate')
    expect(parseDecimalExactRational(safe!.text)).not.toBeNull()
    expect(encodeDirectExactFromRational(parseDecimalExactRational(safe!.text)!, 3, 0, 0)).toBe(1)
  })

  it('degrades safely (null) when the digit bound cannot be met', () => {
    const exact = decodeDirectExact(1, 3, 0, 0)!
    // 1/3 needs more than 0 fractional digits to re-encode to Y=1.
    expect(generateSafeDirectReentryText(exact, 1, 3, 0, 0, 0)).toBeNull()
  })

  it('generates a verified re-entry text for every Y of the full-sweep corpora', () => {
    for (const { m, b, r } of FULL_SWEEP_COEFFICIENTS) {
      for (let y = -32768; y <= 32767; y++) {
        const exact = decodeDirectExact(y, m, b, r)!
        const safe = generateSafeDirectReentryText(exact, y, m, b, r)
        if (safe === null) {
          throw new Error(`no verified re-entry text: y=${y} m=${m} b=${b} r=${r}`)
        }
        const reparsed = parseDecimalExactRational(safe.text)
        if (!reparsed || encodeDirectExactFromRational(reparsed, m, b, r) !== y) {
          throw new Error(`unverified re-entry text ${safe.text}: y=${y} m=${m} b=${b} r=${r}`)
        }
      }
    }
  })
})

describe('round-trip analysis pinned to the real binary64 pipeline', () => {
  // v2.5.12: each full sweep is its own test — same corpus, same assertions,
  // independent per-test timing so no single test carries two sweeps.
  for (const { m, b, r } of FULL_SWEEP_COEFFICIENTS) {
    it(`roundTripSafe equals the real Number re-encode verdict over the full sweep (m=${m}, b=${b}, r=${r})`, () => {
      const startedAt = Date.now()
      let unsafeCount = 0
      for (let y = -32768; y <= 32767; y++) {
        const analysis = analyzeDirectRoundTrip(y, m, b, r)
        expect(analysis, `y=${y} m=${m} b=${b} r=${r}`).not.toBeNull()
        const realVerdict =
          PMBusMath.encodeDirect(PMBusMath.decodeDirect(y, m, b, r).value, m, b, r) === y
        if (analysis!.roundTripSafe !== realVerdict) {
          throw new Error(
            `roundTripSafe drift: y=${y} m=${m} b=${b} r=${r} analysis=${analysis!.roundTripSafe} real=${realVerdict}`,
          )
        }
        if (!analysis!.roundTripSafe) unsafeCount++
      }
      const elapsedMs = Date.now() - startedAt
      // Layered corpus discipline: record the sweep cost, keep it bounded.
      console.log(`full 65536-Y sweep m=${m} b=${b} r=${r}: ${unsafeCount} unsafe, ${elapsedMs}ms`)
      expect(elapsedMs).toBeLessThan(20_000)
    })
  }

  it('samples the wider coefficient grid against the real pipeline and normalization invariants', () => {
    const startedAt = Date.now()
    const rand = mulberry32(SEED)
    for (const { m, b, r } of SAMPLED_GRID) {
      for (const y of SAMPLED_YS) {
        const analysis = analyzeDirectRoundTrip(y, m, b, r)
        expect(analysis, `y=${y} m=${m} b=${b} r=${r}`).not.toBeNull()
        expectNormalized(analysis!.exact)
        expect(decodeIdentityHolds(analysis!.exact, y, m, b, r)).toBe(true)
        const realVerdict =
          PMBusMath.encodeDirect(PMBusMath.decodeDirect(y, m, b, r).value, m, b, r) === y
        expect(analysis!.roundTripSafe, `y=${y} m=${m} b=${b} r=${r}`).toBe(realVerdict)
      }
    }
    // Fixed-seed fuzz: random fields, fixed sample count, reproducible vectors.
    for (let i = 0; i < 5000; i++) {
      const y = Math.floor(rand() * 65536) - 32768
      const m = Math.floor(rand() * 65537) - 32768
      const b = Math.floor(rand() * 65537) - 32768
      const r = Math.floor(rand() * 256) - 128
      if (m === 0) continue
      const analysis = analyzeDirectRoundTrip(y, m, b, r)
      if (!analysis) throw new Error(`unexpected null analysis: y=${y} m=${m} b=${b} r=${r}`)
      expectNormalized(analysis.exact)
      expect(decodeIdentityHolds(analysis.exact, y, m, b, r)).toBe(true)
      const realVerdict =
        PMBusMath.encodeDirect(PMBusMath.decodeDirect(y, m, b, r).value, m, b, r) === y
      if (analysis.roundTripSafe !== realVerdict) {
        throw new Error(`fuzz drift (seed ${SEED}, sample ${i}): y=${y} m=${m} b=${b} r=${r}`)
      }
    }
    console.log(`sampled grid + 5000-sample fuzz (seed ${SEED}): ${Date.now() - startedAt}ms`)
  })
})

describe('display-text re-entry analysis (v3.1.1 unified typed contract)', () => {
  // The audit's regression families, pinned with exact golden verdicts.
  // displayRoundTripSafe answers the REAL user question — does the text the
  // user sees and copies encode back to the current Y through the same
  // classification + exact encode the reducer uses — while b64RoundTripSafe
  // is retained only as the v2.5.11 diagnostic naming WHERE the loss sits.
  it('F1 display truncation: (1,1,12) Y=-1 display "-1" encodes Y=0 while binary64 round-trips', () => {
    const a = analyzeDirectTextReentry(-1, 1, 1, 12)!
    expect(a.displayText).toBe('-1')
    expect(a.exact).toEqual({ numerator: -1000000000001n, denominator: 1000000000000n })
    expect(a.displayReencodedY).toBe(0)
    expect(a.displayRoundTripSafe).toBe(false)
    expect(a.b64ReencodedY).toBe(-1)
    expect(a.b64RoundTripSafe).toBe(true)
  })

  it('F2 repeating decimal: (3,1,16) Y=0 display "-0.333333333333" encodes Y=10000', () => {
    const a = analyzeDirectTextReentry(0, 3, 1, 16)!
    expect(a.displayText).toBe('-0.333333333333')
    expect(a.exact).toEqual({ numerator: -1n, denominator: 3n })
    expect(a.displayReencodedY).toBe(10000)
    expect(a.displayRoundTripSafe).toBe(false)
    expect(a.b64RoundTripSafe).toBe(true)
  })

  it('F3/F4 risk matrix: neighbor precision and offset cancellation fold through the display', () => {
    // m=1, b=1, R=14, Y=-1: display "-1" → Y=0 (binary64 value round-trips).
    const neighbor = analyzeDirectTextReentry(-1, 1, 1, 14)!
    expect(neighbor.displayText).toBe('-1')
    expect(neighbor.displayReencodedY).toBe(0)
    expect(neighbor.displayRoundTripSafe).toBe(false)
    expect(neighbor.b64RoundTripSafe).toBe(true)
    // m=1, b=32767, R=8, Y=1: display "-32767" → Y=0 (offset cancellation).
    const offset = analyzeDirectTextReentry(1, 1, 32767, 8)!
    expect(offset.displayText).toBe('-32767')
    expect(offset.displayReencodedY).toBe(0)
    expect(offset.displayRoundTripSafe).toBe(false)
    expect(offset.b64RoundTripSafe).toBe(true)
  })

  it('negative m can be display-safe (no noise) — the predicate is per-state, not per-sign', () => {
    // m=-3, b=0, R=0, Y=-1: display "0.333333333333" re-encodes to Y=-1.
    const a = analyzeDirectTextReentry(-1, -3, 0, 0)!
    expect(a.displayText).toBe('0.333333333333')
    expect(a.displayReencodedY).toBe(-1)
    expect(a.displayRoundTripSafe).toBe(true)
  })

  it('the existing (1,1,17) protection family keeps its verdict with lossKind binary64', () => {
    const a = analyzeDirectTextReentry(-1, 1, 1, 17)!
    expect(a.displayText).toBe('-1')
    expect(a.displayReencodedY).toBe(0)
    expect(a.displayRoundTripSafe).toBe(false)
    expect(a.b64RoundTripSafe).toBe(false)
  })

  it('ordinary safe vector stays quiet: (1,0,0) Y=12 round-trips at both layers', () => {
    const a = analyzeDirectTextReentry(12, 1, 0, 0)!
    expect(a.displayText).toBe('12')
    expect(a.displayReencodedY).toBe(12)
    expect(a.displayRoundTripSafe).toBe(true)
    expect(a.b64RoundTripSafe).toBe(true)
  })

  it('displayRoundTripSafe matches an independent typed-path verdict over the (1,1,12) full sweep', () => {
    // The predicate is recomputed in the test from the real pipeline pieces
    // (formatPlainNumber → classify → exact parse → exact encode) so the
    // analysis cannot drift from the contract it claims to answer.
    const startedAt = Date.now()
    let unsafeCount = 0
    for (let y = -32768; y <= 32767; y++) {
      const a = analyzeDirectTextReentry(y, 1, 1, 12)
      expect(a, `y=${y}`).not.toBeNull()
      const text = formatPlainNumber(PMBusMath.decodeDirect(y, 1, 1, 12).value)
      const parsed = parseDecimalExactRational(text)
      const verdict = parsed !== null && encodeDirectExactFromRational(parsed, 1, 1, 12) === y
      if (a!.displayRoundTripSafe !== verdict) {
        throw new Error(
          `display-verdict drift: y=${y} analysis=${a!.displayRoundTripSafe} real=${verdict}`,
        )
      }
      if (!a!.displayRoundTripSafe) unsafeCount++
    }
    // The audit's measured incidence for (1,1,12): 29491 of 65536 copies.
    expect(unsafeCount).toBe(29491)
    console.log(
      `display-reentry sweep (1,1,12): ${unsafeCount} unsafe, ${Date.now() - startedAt}ms`,
    )
  })

  it('FINAL COPY property over (1,1,12) full Y: copied text re-enters to the same raw word', () => {
    // The acceptance contract of the fix: whatever the 物理值 copy hands out
    // (the display text when safe, the verified override otherwise) must
    // survive the REAL typed path with the raw word unchanged. The test
    // re-runs the reducer's pipeline instead of trusting the generator.
    const startedAt = Date.now()
    let overrides = 0
    for (let y = -32768; y <= 32767; y++) {
      const a = analyzeDirectTextReentry(y, 1, 1, 12)!
      const copied = a.displayRoundTripSafe
        ? a.displayText
        : (generateSafeDirectReentryText(a.exact, y, 1, 1, 12)?.text ?? null)
      if (copied === null) throw new Error(`copy degraded to null: y=${y}`)
      if (!a.displayRoundTripSafe) overrides++
      const parsed = classifyFloatText(copied)
      if (parsed.kind !== 'value' || !Number.isFinite(parsed.value)) {
        throw new Error(`copied text not committable: ${copied} (y=${y})`)
      }
      const exact = parseDecimalExactRational(copied)
      const reencodedY = exact === null ? null : encodeDirectExactFromRational(exact, 1, 1, 12)
      const rawBefore = PMBusMath.fromSigned(y, 16)
      const rawAfter = reencodedY === null ? null : PMBusMath.fromSigned(reencodedY, 16)
      if (rawAfter !== rawBefore) {
        throw new Error(`re-entry changes raw: y=${y} copied=${copied} reencodedY=${reencodedY}`)
      }
    }
    expect(overrides).toBe(29491)
    console.log(`final-copy property (1,1,12): ${overrides} overrides, ${Date.now() - startedAt}ms`)
  })
})

describe('exact-rational presentation (v2.5.12)', () => {
  it('formatExactDelta: integer, scientific, terminating, and fraction bands', () => {
    expect(formatExactDelta({ numerator: 1n, denominator: 1n })).toBe('+1')
    expect(formatExactDelta({ numerator: -7233n, denominator: 1n })).toBe('-7233')
    expect(formatExactDelta({ numerator: 0n, denominator: 1n })).toBe('+0.000000')
    // Tiny magnitudes go scientific — never textual zero.
    expect(formatExactDelta({ numerator: 1n, denominator: 10n ** 16n })).toBe('+1e-16')
    expect(formatExactDelta({ numerator: -1n, denominator: 10n ** 19n })).toBe('-1e-19')
    // Very large magnitudes go scientific too.
    expect(formatExactDelta({ numerator: 10n ** 38n, denominator: 1n })).toBe('+1e38')
    // In-band terminating decimal renders exactly.
    expect(formatExactDelta({ numerator: 1n, denominator: 4n })).toBe('+0.25')
    expect(formatExactDelta({ numerator: -1n, denominator: 2000n })).toBe('-0.0005')
    // Repeating rational falls back to the exact fraction.
    expect(formatExactDelta({ numerator: -1n, denominator: 6n })).toBe('-1/6')
  })

  it('formatSignedRationalScientific: exact exponent placement and half-up carry', () => {
    // 100/(1e17+1) ≈ 1e-15 — the counterexample A relative percent.
    expect(formatSignedRationalScientific({ numerator: 100n, denominator: 10n ** 17n + 1n })).toBe(
      '+1e-15',
    )
    expect(formatSignedRationalScientific({ numerator: -1n, denominator: 10n ** 19n })).toBe(
      '-1e-19',
    )
    // In-band mantissa keeps its significant digits.
    expect(formatSignedRationalScientific({ numerator: 996n, denominator: 1000n })).toBe('+9.96e-1')
    // Half-up rounding carries into the next exponent (0.09996 → 1e-1).
    expect(formatSignedRationalScientific({ numerator: 9996n, denominator: 100000n }, 3)).toBe(
      '+1e-1',
    )
  })

  it('formatSignedRationalFixed: half-up on the final digit', () => {
    expect(formatSignedRationalFixed({ numerator: -1n, denominator: 6n }, 4)).toBe('-0.1667')
    expect(formatSignedRationalFixed({ numerator: -100n, denominator: 2469n }, 4)).toBe('-0.0405')
    expect(formatSignedRationalFixed({ numerator: 5n, denominator: 2n }, 3)).toBe('+2.500')
  })

  it('formatExactPercent: fixed band, scientific band, zero, and undefined', () => {
    expect(formatExactPercent({ numerator: -100n, denominator: 2469n })).toBe('-0.0405%')
    expect(formatExactPercent({ numerator: -100n, denominator: 3n })).toBe('-33.3333%')
    expect(formatExactPercent({ numerator: 100n, denominator: 10n ** 17n + 1n })).toBe('1e-15%')
    expect(formatExactPercent({ numerator: 0n, denominator: 1n })).toBe('0.0000%')
    expect(formatExactPercent(null)).toBe('—')
  })
})

describe('exact lexeme boundary (v2.5.12)', () => {
  it('rejects an overlong lexeme at the string boundary, before any BigInt work', () => {
    // Deterministic-length fixture (never committed as a snapshot): a
    // megabyte paste classifies as overlong via pure string checks.
    const huge = `1${'0'.repeat(1_000_000)}`
    const started = Date.now()
    const boundary = checkExactLexemeBoundary(huge)
    const elapsed = Date.now() - started
    // Node v24.19.0 (darwin arm64): string scan of 1 MB is a few ms; the
    // logged duration documents the environment without a brittle assert.
    console.log(`overlong boundary classification of 1MB took ${elapsed}ms`)
    expect(boundary).toEqual({ ok: false, reason: 'overlong' })
    expect(parseDecimalExactRational(huge)).toBeNull()
  })

  it('accepts a lexeme at the maximum allowed length and still parses it', () => {
    const maxText = `1${'0'.repeat(DIRECT_EXACT_MAX_LEXEME_LENGTH - 1)}`
    expect(maxText.length).toBe(DIRECT_EXACT_MAX_LEXEME_LENGTH)
    expect(checkExactLexemeBoundary(maxText)).toEqual({ ok: true })
    const exact = parseDecimalExactRational(maxText)
    expect(exact).toEqual({
      numerator: 10n ** BigInt(DIRECT_EXACT_MAX_LEXEME_LENGTH - 1),
      denominator: 1n,
    })
  })

  it('rejects one character past the limit', () => {
    const over = `1${'0'.repeat(DIRECT_EXACT_MAX_LEXEME_LENGTH)}`
    expect(checkExactLexemeBoundary(over)).toEqual({ ok: false, reason: 'overlong' })
    expect(parseDecimalExactRational(over)).toBeNull()
  })

  it('accepts a lexeme one character below the limit (4095, v2.5.14 boundary audit)', () => {
    const below = `1${'0'.repeat(DIRECT_EXACT_MAX_LEXEME_LENGTH - 2)}`
    expect(below.length).toBe(DIRECT_EXACT_MAX_LEXEME_LENGTH - 1)
    expect(checkExactLexemeBoundary(below)).toEqual({ ok: true })
    expect(parseDecimalExactRational(below)).toEqual({
      numerator: 10n ** BigInt(DIRECT_EXACT_MAX_LEXEME_LENGTH - 2),
      denominator: 1n,
    })
  })

  it('keeps true zeros legal at any exponent while bounding non-zero shifts', () => {
    expect(parseDecimalExactRational('0e-999999999999')).toEqual({
      numerator: 0n,
      denominator: 1n,
    })
    expect(parseDecimalExactRational('-0.0e-999')).toEqual({ numerator: 0n, denominator: 1n })
    expect(checkExactLexemeBoundary('1e99999999999999999999')).toEqual({
      ok: false,
      reason: 'shift-out-of-range',
    })
    expect(checkExactLexemeBoundary('NaN.')).toEqual({ ok: false, reason: 'syntax' })
    expect(checkExactLexemeBoundary('1.5')).toEqual({ ok: true })
  })

  it('keeps every generated safe re-entry text comfortably within the boundary', () => {
    // Sampled guard (the full 531k-text measurement behind the constant is a
    // one-off script): every verified generator output must be parseable.
    let generated = 0
    for (const [m, b, r] of [
      [1, 0, 127],
      [-1, 0, 127],
      [1, 0, -128],
      [2, 1, -128],
      [32767, 0, 127],
      [1, 1, 17],
      [-3, 1, 17],
    ] as Array<[number, number, number]>) {
      for (const y of [-32768, -32767, -1, 0, 1, 32766, 32767]) {
        const exact = decodeDirectExact(y, m, b, r)
        if (!exact) continue
        const safe = generateSafeDirectReentryText(exact, y, m, b, r)
        if (safe === null) continue
        generated++
        expect(safe.text.length, `y=${y} m=${m} b=${b} r=${r}`).toBeLessThanOrEqual(
          DIRECT_EXACT_MAX_LEXEME_LENGTH,
        )
        // The parser must accept its own generator's output.
        expect(parseDecimalExactRational(safe.text)).not.toBeNull()
      }
    }
    expect(generated).toBeGreaterThan(30)
  })
})

describe('raw lexeme resource boundary (v2.5.13)', () => {
  it('rejects a whitespace-padded lexeme whose raw length exceeds the cap — trim buys no budget', () => {
    // The v2.5.12 gap: a padded dispatch payload trimmed to a short valid
    // lexeme and was accepted. The cap now measures the raw string first.
    const padded = `${' '.repeat(DIRECT_EXACT_MAX_LEXEME_LENGTH)}1`
    expect(padded.length).toBe(DIRECT_EXACT_MAX_LEXEME_LENGTH + 1)
    expect(padded.trim()).toBe('1')
    expect(checkExactLexemeBoundary(padded)).toEqual({ ok: false, reason: 'overlong' })
    expect(parseDecimalExactRational(padded)).toBeNull()
  })

  it('accepts a syntactically valid lexeme whose raw length is exactly the cap', () => {
    const padded = `${' '.repeat(DIRECT_EXACT_MAX_LEXEME_LENGTH - 1)}1`
    expect(padded.length).toBe(DIRECT_EXACT_MAX_LEXEME_LENGTH)
    expect(checkExactLexemeBoundary(padded)).toEqual({ ok: true })
    expect(parseDecimalExactRational(padded)).toEqual({ numerator: 1n, denominator: 1n })
  })

  it('refuses a megabyte whitespace-padded payload at the string boundary, with no BigInt work', () => {
    const padded = `${' '.repeat(1_000_000)}1`
    expect(checkExactLexemeBoundary(padded)).toEqual({ ok: false, reason: 'overlong' })
    expect(parseDecimalExactRational(padded)).toBeNull()
  })

  it('keeps short-input whitespace semantics unchanged (signed zero, exponent forms)', () => {
    expect(parseDecimalExactRational('\t 1 \n')).toEqual({ numerator: 1n, denominator: 1n })
    expect(parseDecimalExactRational(' -.0e3 ')).toEqual({ numerator: 0n, denominator: 1n })
    expect(parseDecimalExactRational(' 0e-400 ')).toEqual({ numerator: 0n, denominator: 1n })
  })
})

describe('compensated scientific lexemes (v2.6.2)', () => {
  // The audit vector: a mantissa whose trailing zeros exactly cancel a deep
  // negative exponent is a legal finite request — Number(text) is exactly 1 —
  // yet the v2.5.12 boundary measured the SYNTACTIC shift (exp − fracLen) and
  // rejected it as shift-out-of-range, so the UI classified it valid, the
  // reducer silently no-op'd, and no error appeared anywhere. Trailing-zero
  // cancellation is magnitude-preserving O(n) string work performed BEFORE
  // any BigInt construction; the underflow net must measure the EFFECTIVE
  // shift (shift + trailing zeros), floored at the historical −500 and at a
  // raw-length-derived bound no classify-valid lexeme can cross.
  const AUDIT_VECTOR = `1${'0'.repeat(501)}e-501`

  it('accepts the 507-character audit vector as exact 1/1', () => {
    expect(AUDIT_VECTOR.length).toBe(507)
    expect(Number(AUDIT_VECTOR)).toBe(1)
    expect(checkExactLexemeBoundary(AUDIT_VECTOR)).toEqual({ ok: true })
    expect(parseDecimalExactRational(AUDIT_VECTOR)).toEqual({ numerator: 1n, denominator: 1n })
  })

  it('keeps explicit signs and partial compensation exact', () => {
    expect(parseDecimalExactRational(`-1${'0'.repeat(501)}e-501`)).toEqual({
      numerator: -1n,
      denominator: 1n,
    })
    expect(parseDecimalExactRational(`+1${'0'.repeat(501)}e-501`)).toEqual({
      numerator: 1n,
      denominator: 1n,
    })
    // 451-digit mantissa with 450 trailing zeros: value = 10^450 × 10^-501
    // = 10^-51 — only the compensated part cancels, the rest stays in the
    // effective shift.
    const partial = `1${'0'.repeat(450)}e-501`
    expect(checkExactLexemeBoundary(partial)).toEqual({ ok: true })
    expect(parseDecimalExactRational(partial)).toEqual({
      numerator: 1n,
      denominator: 10n ** 51n,
    })
  })

  it('keeps trailing zeros of a long mantissa exact across e-500/e-501/e-502', () => {
    // mantissa = 1 followed by 500 zeros = 10^500; the 500 trailing zeros
    // cancel 500 orders of the exponent in every row.
    const mantissa = `1${'0'.repeat(500)}`
    expect(Number(`${mantissa}e-500`)).toBe(1)
    expect(parseDecimalExactRational(`${mantissa}e-500`)).toEqual({
      numerator: 1n,
      denominator: 1n,
    })
    expect(parseDecimalExactRational(`${mantissa}e-501`)).toEqual({
      numerator: 1n,
      denominator: 10n,
    })
    expect(parseDecimalExactRational(`${mantissa}e-502`)).toEqual({
      numerator: 1n,
      denominator: 100n,
    })
  })

  it('accepts a classify-valid deep-shift lexeme with significant digits (golden case)', () => {
    // ~9.000…009 × 10^502 × 10^-502: finite non-zero binary64 value with 503
    // significant digits and a syntactic shift of −502. The historical −500
    // net cannot host it; the raw-length-derived bound can — this lexeme is
    // exactly parseable within the same BigInt budget as any 4096-char paste.
    const deep = `9${'0'.repeat(501)}9e-502`
    expect(Number(deep)).toBeGreaterThan(0)
    expect(Number(deep)).toBeLessThan(Infinity)
    expect(checkExactLexemeBoundary(deep)).toEqual({ ok: true })
    const exact = parseDecimalExactRational(deep)
    expect(exact).toEqual({
      numerator: BigInt(`9${'0'.repeat(501)}9`),
      denominator: 10n ** 502n,
    })
  })

  it('keeps the underflow net fail-closed for genuinely deep classify-invalid lexemes', () => {
    // classifyFloatText rejects these as underflow upstream (binary64 ±0);
    // the boundary must keep rejecting them even on a direct dispatch.
    expect(checkExactLexemeBoundary('1e-501')).toEqual({ ok: false, reason: 'shift-out-of-range' })
    expect(parseDecimalExactRational('1e-501')).toBeNull()
    expect(checkExactLexemeBoundary('1e-99999')).toEqual({
      ok: false,
      reason: 'shift-out-of-range',
    })
    // Zeros keep their legal signed-zero contract at any exponent.
    expect(parseDecimalExactRational('-0.0e-999')).toEqual({ numerator: 0n, denominator: 1n })
  })

  it('bounds the compensated BigInt work: stripping only cancels trailing zeros', () => {
    // The constructed BigInt is the STRIPPED mantissa — never larger than the
    // significant digit span; a 4096-char compensated lexeme strips to '1'.
    const compensated = `1${'0'.repeat(4089)}e-4091`
    expect(compensated.length).toBe(DIRECT_EXACT_MAX_LEXEME_LENGTH)
    expect(checkExactLexemeBoundary(compensated)).toEqual({ ok: true })
    expect(parseDecimalExactRational(compensated)).toEqual({ numerator: 1n, denominator: 100n })
  })
})
