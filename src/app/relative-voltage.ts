/**
 * Relative ULINEAR16 final-voltage classification (v2.5.9).
 *
 * X = V_NOM × R multiplies two finite, non-negative factors: the nominal
 * VOUT_COMMAND reference and the decoded dimensionless ratio. JavaScript
 * Number arithmetic can still leave the representable range — a product
 * above Number.MAX_VALUE becomes ±Infinity, and a product of two nonzero
 * factors below the smallest subnormal rounds to 0. The result card, formula
 * presentation, calculation steps, warnings and the physical-value copy must
 * all answer this question from THIS one classifier (Part II §8.5 relative
 * semantics; the inputs themselves stay accepted — a huge but finite nominal
 * is a legitimate committed reference, not a text error).
 *
 * Input contract: `nominal` is a finite non-negative number or null (the
 * committed `l16.nominalVout`), `ratio` is a finite non-negative number
 * (ULINEAR16 decode). True zero (a zero factor) is a finite result, never
 * misread as underflow. Since v2.5.10 the parse layer rejects non-zero
 * decimals that binary64 underflows to ±0, so a committed zero factor can
 * only come from a true zero text — that input-layer decision is separate
 * from this derivation diagnostics.
 */

export type RelativeVoltageResult =
  /** No nominal reference committed: the ratio is visible, the final voltage is missing. */
  | { kind: 'missing-reference' }
  /** The product is a representable finite number (including a true zero). */
  | { kind: 'finite'; value: number }
  /** Two finite factors multiplied beyond Number.MAX_VALUE (±Infinity product). */
  | { kind: 'overflow' }
  /** Two NONZERO finite factors whose product rounded to 0. */
  | { kind: 'underflow' }

/** Shared diagnostic text for the overflow card / formula / steps / warning. */
export const RELATIVE_VOLTAGE_OVERFLOW_NOTE = '计算结果超出 JavaScript Number 可表示范围'

/** Shared diagnostic text for the underflow card / formula / steps / warning. */
export const RELATIVE_VOLTAGE_UNDERFLOW_NOTE =
  '计算下溢：两个非零有限数相乘的结果被 Number 舍入为 0，不是数学上的精确零'

export function resolveRelativeVoltage(
  nominal: number | null,
  ratio: number,
): RelativeVoltageResult {
  if (nominal === null) return { kind: 'missing-reference' }
  const product = nominal * ratio
  if (Number.isFinite(product)) {
    if (product === 0 && nominal !== 0 && ratio !== 0) return { kind: 'underflow' }
    return { kind: 'finite', value: product }
  }
  return { kind: 'overflow' }
}
