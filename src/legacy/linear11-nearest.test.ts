import { describe, it, expect } from 'vitest'
import { PMBusMath } from './pmbus-math'

/**
 * v2.5.10 — findBestLinear11 must return the strictly nearest representable
 * LINEAR11 code (minimal |X − Y×2^N| over all 65536 codes) with one
 * deterministic tie policy for bit-exact error ties: prefer the smaller |N|.
 *
 * PMBus Part II §7.3 fixes only the representation relation X = Y × 2^N;
 * the host-side search and tie policy is a repository contract, not a
 * spec-mandated rounding rule. The former fixed 1e-15 epsilon merged
 * strictly different errors into ties and encoded X = 2^-17 + 1 ulp as
 * 0x0000 even though 0x8001 was strictly nearer.
 */

const TWO_POW_MINUS_16 = 2 ** -16
const TWO_POW_MINUS_17 = 2 ** -17

/** Smallest binary64 strictly greater than x (inputs here are far from 0). */
function nextUp(x: number): number {
  const buf = new ArrayBuffer(8)
  const f64 = new Float64Array(buf)
  const u64 = new BigUint64Array(buf)
  f64[0] = x
  u64[0] = x >= 0 ? u64[0] + 1n : u64[0] - 1n
  return f64[0]
}

/** Largest binary64 strictly smaller than x. */
function nextDown(x: number): number {
  const buf = new ArrayBuffer(8)
  const f64 = new Float64Array(buf)
  const u64 = new BigUint64Array(buf)
  f64[0] = x
  u64[0] = x <= 0 ? u64[0] + 1n : u64[0] - 1n
  return f64[0]
}

/** Decode table for the 65536-code oracle (built once). */
const DECODE_TABLE = (() => {
  const table = new Float64Array(65536)
  for (let raw = 0; raw < 65536; raw++) {
    table[raw] = PMBusMath.decodeLinear11(raw).value
  }
  return table
})()

/** Oracle: global minimum of |X − decode(raw)| over all 65536 LINEAR11 codes. */
function oracleMinError(val: number): number {
  let min = Infinity
  for (let raw = 0; raw < 65536; raw++) {
    const err = Math.abs(val - DECODE_TABLE[raw])
    if (err < min) min = err
  }
  return min
}

function rawOf(best: { n: number; y: number }): number {
  return PMBusMath.encodeLinear11(best.n, best.y)
}

describe('findBestLinear11 — strictly nearest code (v2.5.10)', () => {
  // §4.1 production-site counterexamples: the exact production-site inputs,
  // mirrored for the negative side, plus the two beyond-window controls.
  const VECTORS: Array<{ text: string; raw: number }> = [
    { text: '0.0000076293945312', raw: 0x0000 }, // below 2^-17: zero strictly nearer
    { text: '0.00000762939453125', raw: 0x0000 }, // exact 2^-17: documented tie policy
    { text: '0.0000076293945313', raw: 0x8001 }, // above 2^-17: 2^-16 strictly nearer
    { text: '0.00000762939454', raw: 0x8001 }, // control beyond the old epsilon window
    { text: '-0.0000076293945312', raw: 0x0000 },
    { text: '-0.00000762939453125', raw: 0x0000 },
    { text: '-0.0000076293945313', raw: 0x87ff },
    { text: '-0.00000762939454', raw: 0x87ff },
  ]

  for (const vector of VECTORS) {
    it(`encodes ${vector.text} to 0x${vector.raw.toString(16).toUpperCase().padStart(4, '0')}`, () => {
      const val = Number(vector.text)
      const best = PMBusMath.findBestLinear11(val)
      expect(rawOf(best)).toBe(vector.raw)
      // Returned value/delta must be consistent with the chosen N/Y code.
      // (y = -0 legitimately yields value -0 for the same raw 0x0000.)
      expect(best.value).toBe(best.y * PMBusMath.pow2(best.n))
      expect(best.delta).toBe(val - best.value)
      // The chosen error must equal the true global minimum (oracle).
      expect(Math.abs(best.delta)).toBe(oracleMinError(val))
    })
  }

  it('keeps the documented exact-tie policy at the exact midpoint 2^-17 (smaller |N|)', () => {
    const best = PMBusMath.findBestLinear11(TWO_POW_MINUS_17)
    expect(rawOf(best)).toBe(0x0000)
    // The tie is exact in binary64: both candidates are 2^-17 away.
    expect(Math.abs(TWO_POW_MINUS_17 - 0)).toBe(Math.abs(TWO_POW_MINUS_17 - TWO_POW_MINUS_16))
    expect(Math.abs(best.delta)).toBe(TWO_POW_MINUS_17)
    expect(Math.abs(best.delta)).toBe(oracleMinError(TWO_POW_MINUS_17))
  })

  it('keeps the exact-tie policy at the negative midpoint -2^-17', () => {
    const best = PMBusMath.findBestLinear11(-TWO_POW_MINUS_17)
    expect(rawOf(best)).toBe(0x0000)
    expect(Math.abs(best.delta)).toBe(oracleMinError(-TWO_POW_MINUS_17))
  })

  it('resolves the first representable step above the midpoint strictly to 0x8001', () => {
    const above = nextUp(TWO_POW_MINUS_17)
    const best = PMBusMath.findBestLinear11(above)
    expect(rawOf(best)).toBe(0x8001)
    // Strictly nearer: the distance to 2^-16 is smaller than to zero, and
    // no other code is closer than both.
    expect(above - best.value).toBeLessThan(Math.abs(above - 0))
    expect(Math.abs(above - best.value)).toBe(oracleMinError(above))
  })

  it('resolves the last representable step below the midpoint strictly to 0x0000', () => {
    const below = nextDown(TWO_POW_MINUS_17)
    const best = PMBusMath.findBestLinear11(below)
    expect(rawOf(best)).toBe(0x0000)
    expect(Math.abs(below - best.value)).toBeLessThan(Math.abs(below - TWO_POW_MINUS_16))
    expect(Math.abs(below - best.value)).toBe(oracleMinError(below))
  })

  it('resolves the negative midpoint neighbours strictly (0x87ff / 0x0000)', () => {
    const nearerMin = nextDown(-TWO_POW_MINUS_17) // more negative than -2^-17
    expect(rawOf(PMBusMath.findBestLinear11(nearerMin))).toBe(0x87ff)
    const nearerZero = nextUp(-TWO_POW_MINUS_17) // closer to zero than -2^-17
    expect(rawOf(PMBusMath.findBestLinear11(nearerZero))).toBe(0x0000)
  })

  describe('midpoint adjacency matrix across N and Y parity (oracle-verified)', () => {
    const NS = [-16, -9, -1, 0, 3, 8, 14, 15]
    const YS = [-1024, -513, -512, -2, -1, 0, 1, 2, 511, 512, 1022]

    for (const n of NS) {
      for (const y of YS) {
        if (y + 1 > 1023) continue
        // Exact midpoint between two adjacent N-grid codes:
        // m = (2y+1) × 2^(n-1), exact in binary64 for the ranges sampled.
        const a = y * PMBusMath.pow2(n)
        const b = (y + 1) * PMBusMath.pow2(n)
        const m = a + (b - a) / 2

        it(`midpoint of (N=${n}, Y=${y}) — exact, +1 ulp, −1 ulp all hit the oracle minimum`, () => {
          for (const val of [m, nextUp(m), nextDown(m)]) {
            if (val <= PMBusMath.minLinear11() || val >= PMBusMath.maxLinear11()) continue
            const best = PMBusMath.findBestLinear11(val)
            expect(Math.abs(best.delta), `input ${val}`).toBe(oracleMinError(val))
            expect(rawOf(best), `input ${val}`).toBe(PMBusMath.encodeLinear11(best.n, best.y))
          }
          // When the midpoint is itself representable (|2y+1| ≤ 1023 at
          // N−1 ≥ −16 → code (n−1, 2y+1)), the exact input must encode with
          // zero error. For n = −16 the midpoint would need N = −17, which
          // is out of range, so it is genuinely unrepresentable.
          if (n - 1 >= -16 && Math.abs(2 * y + 1) <= 1023) {
            expect(PMBusMath.findBestLinear11(m).delta).toBe(0)
          }
        })
      }
    }
  })

  describe('upper grid: adjacent codes with no interior candidates (y ≥ 512)', () => {
    it('resolves ±1 ulp around the unrepresentable midpoint to the adjacent codes', () => {
      const n = 8
      const y = 512
      const a = y * PMBusMath.pow2(n)
      const b = (y + 1) * PMBusMath.pow2(n)
      const m = a + (b - a) / 2
      // (2y+1) = 1025 > 1023, so no code sits strictly between a and b.
      expect(rawOf(PMBusMath.findBestLinear11(nextUp(m)))).toBe(PMBusMath.encodeLinear11(n, y + 1))
      expect(rawOf(PMBusMath.findBestLinear11(nextDown(m)))).toBe(PMBusMath.encodeLinear11(n, y))
      expect(rawOf(PMBusMath.findBestLinear11(nextUp(m)))).toBe(
        rawOf(PMBusMath.findBestLinear11(b)),
      )
    })
  })

  describe('existing regular values, saturation and boundaries do not regress', () => {
    it('keeps exact representations on the smallest-|N| code', () => {
      // 12 = 12×2^0 also equals 3×2^2 etc.; the tie policy prefers |N|=0.
      expect(rawOf(PMBusMath.findBestLinear11(12))).toBe(0x000c)
      expect(rawOf(PMBusMath.findBestLinear11(2))).toBe(0x0002)
      expect(rawOf(PMBusMath.findBestLinear11(0.5))).toBe(0xf801)
      expect(rawOf(PMBusMath.findBestLinear11(1000))).toBe(0x03e8)
      expect(rawOf(PMBusMath.findBestLinear11(-10))).toBe(0x07f6)
      expect(rawOf(PMBusMath.findBestLinear11(0))).toBe(0x0000)
    })

    it('saturates at both global extremes with the boundary delta', () => {
      const max = PMBusMath.maxLinear11()
      const bestMax = PMBusMath.findBestLinear11(max)
      expect(bestMax.n).toBe(15)
      expect(bestMax.y).toBe(1023)
      expect(bestMax.delta).toBe(0)
      const min = PMBusMath.minLinear11()
      const bestMin = PMBusMath.findBestLinear11(min)
      expect(bestMin.n).toBe(15)
      expect(bestMin.y).toBe(-1024)
      expect(bestMin.delta).toBe(0)
    })

    it('never returns the zero code for the smallest non-zero magnitudes', () => {
      for (const val of [TWO_POW_MINUS_17, nextUp(TWO_POW_MINUS_17), 5e-324, Number.MIN_VALUE]) {
        const best = PMBusMath.findBestLinear11(val)
        expect(Math.abs(best.delta)).toBe(oracleMinError(val))
        // Below 2^-17 zero is the strict optimum; above it, some non-zero
        // code must be strictly better than zero — never a fabricated tie.
        if (val > TWO_POW_MINUS_17) {
          expect(Math.abs(best.delta)).toBeLessThan(Math.abs(val - 0))
        }
      }
    })
  })
})
