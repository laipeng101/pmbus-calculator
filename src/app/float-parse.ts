/**
 * Physical-value (float) parsing shared by the reducer, ValueInput and
 * NominalVoutInput.
 *
 * `classifyFloatText` is the single classification source for physical-value
 * drafts; the components and the reducer must consume it instead of keeping
 * their own rule sets (UI_CONVENTIONS §8).  `parseFloatSafe` and
 * `isTransitionalFloatText` remain as thin, behavior-stable wrappers.
 *
 * Magnitude contract (v2.5.8, no silent clipping): a syntactically complete
 * decimal text that converts to a finite JavaScript Number is passed through
 * unchanged — the parse layer never clamps magnitudes.  Values beyond an
 * encoding format's range are handled by the existing encoders (saturation /
 * overflow readouts, DOMAIN_MODEL §6.2), so the request provenance keeps the
 * value the user actually committed.  Complete decimal text that Number()
 * renders non-finite (e.g. `1e400` → Infinity) is `out-of-range`: callers
 * must report an explicit range error, keep the last committed state/raw and
 * never fabricate a new request from it.
 *
 * HALF literals are distinct from decimal overflow (Part II §7.6): the exact
 * texts `NaN` / `Infinity` / `+Infinity` / `-Infinity` are first-class values
 * (`kind: 'value'`), while `1e400` is an out-of-range decimal text in every
 * mode, including HALF.
 *
 * Signed zero (v2.5.7, Part II §7.6): `Number('-.0')` is `-0`, and IEEE 754
 * binary16 keeps `0x8000` (−0) distinct from `0x0000` (+0).  The parser must
 * never collapse the sign of a zero shorthand: `-0` / `-0.0` / `-.0` / `-.00`
 * / `-0e3` all return true `-0`.  Bare dot drafts (`.`, `+.`, `-.`) are
 * incomplete editing states and classify as `transitional`, not `+0`.
 */

export type FloatTextClassification =
  | { kind: 'empty' }
  | { kind: 'value'; value: number }
  | { kind: 'out-of-range' }
  | { kind: 'transitional' }
  | { kind: 'invalid' }

/** Complete float syntax: optional sign, digits with optional fraction, optional exponent. */
const FLOAT_SYNTAX = /^[+-]?(?:(?:\d+\.?\d*)|(?:\.\d+))(?:[eE][+-]?\d+)?$/

/** A string composed only of allowed float characters in order (possibly incomplete). */
const TRANSITIONAL_FLOAT = /^[+-]?((\d+(\.\d*)?)|(\.\d*))?([eE][+-]?\d*)?$/

export function classifyFloatText(input: string): FloatTextClassification {
  const s = String(input).trim()
  if (s === '') return { kind: 'empty' }
  const lower = s.toLowerCase()
  if (lower === 'nan') return { kind: 'value', value: NaN }
  if (lower === 'infinity' || lower === '+infinity') return { kind: 'value', value: Infinity }
  if (lower === '-infinity') return { kind: 'value', value: -Infinity }
  if (!FLOAT_SYNTAX.test(s)) {
    return TRANSITIONAL_FLOAT.test(s) ? { kind: 'transitional' } : { kind: 'invalid' }
  }
  const n = Number(s)
  // FLOAT_SYNTAX guarantees a numeric literal; Number() can only make it
  // ±Infinity (magnitude overflow) or a finite double — underflow to ±0 is a
  // finite conversion result, not a range error.
  if (Number.isNaN(n)) return { kind: 'invalid' }
  if (!Number.isFinite(n)) return { kind: 'out-of-range' }
  return { kind: 'value', value: n }
}

/**
 * Parsed numeric value, or null when the text is empty, transitional,
 * invalid or out of range.  Finite results are never magnitude-clamped.
 */
export function parseFloatSafe(s: string): number | null {
  const parsed = classifyFloatText(s)
  return parsed.kind === 'value' ? parsed.value : null
}

/** True for empty and half-typed drafts; false for complete or invalid text. */
export function isTransitionalFloatText(input: string): boolean {
  const kind = classifyFloatText(input).kind
  return kind === 'empty' || kind === 'transitional'
}

/**
 * Blur normalization for incomplete float drafts (v2.5.7 contract, shared by
 * ValueInput and NominalVoutInput since v2.5.8): '' / '-' / '+' -> '0';
 * trailing 'e' exponent stripped.  A bare trailing dot keeps its sign: the
 * sign is the only information the draft carries, and IEEE 754 keeps `-0`
 * (0x8000) distinct from `+0` (0x0000), Part II §7.6.
 *
 * Callers decide what an empty draft means (ValueInput commits 0; the
 * nominal reference clears to null) — normalize after that decision.
 */
export function fixFloatTextOnBlur(value: string): string {
  value = value.trim()
  if (!value) return '0'
  if (value === '-' || value === '+') return '0'
  if (/[eE][+-]?$/.test(value)) return value.replace(/[eE][+-]?$/, '') || '0'
  if (value.endsWith('.')) {
    const head = value.slice(0, -1)
    if (head === '' || head === '+') return '0'
    if (head === '-') return '-0'
    return head
  }
  return value
}
