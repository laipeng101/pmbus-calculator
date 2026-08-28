/**
 * Physical-value (float) parsing shared by the reducer and ValueInput.
 *
 * `parseFloatSafe` mirrors the legacy parseFloatSafe behavior (including the
 * HALF literals NaN / +Infinity / -Infinity and the |x| > 1e20 clamp), so the
 * reducer stays the single commit authority.  `isTransitionalFloatText`
 * recognizes half-typed strings like "-", "1." or "1e" so the input component
 * does not flag them as errors on every keystroke.
 *
 * Signed zero (v2.5.7, Part II §7.6): `Number('-.0')` is `-0`, and IEEE 754
 * binary16 keeps `0x8000` (−0) distinct from `0x0000` (+0).  The parser must
 * never collapse the sign of a zero shorthand: `-0` / `-0.0` / `-.0` / `-.00`
 * / `-0e3` all return true `-0`.  Bare dot drafts (`.`, `+.`, `-.`) are
 * incomplete editing states and return `null` (transitional), not `+0`.
 */

export function parseFloatSafe(s: string): number | null {
  s = String(s).trim()
  if (!s) return null
  const lower = s.toLowerCase()
  if (lower === 'nan') return NaN
  if (lower === 'infinity' || lower === '+infinity') return Infinity
  if (lower === '-infinity') return -Infinity
  if (!/^[+-]?(?:(?:\d+\.?\d*)|(?:\.\d+))(?:[eE][+-]?\d+)?$/.test(s)) return null
  let n = Number(s)
  if (Number.isNaN(n)) return null
  if (n > 1e20) n = 1e20
  if (n < -1e20) n = -1e20
  return n
}

/** A string composed only of allowed float characters in order (possibly incomplete). */
const TRANSITIONAL_FLOAT = /^[+-]?((\d+(\.\d*)?)|(\.\d*))?([eE][+-]?\d*)?$/

export function isTransitionalFloatText(input: string): boolean {
  const trimmed = input.trim()
  if (trimmed === '') return true
  if (parseFloatSafe(trimmed) !== null) return false // complete — not transitional
  return TRANSITIONAL_FLOAT.test(trimmed)
}
