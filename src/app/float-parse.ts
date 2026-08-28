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
 *
 * Blur contract (v2.5.9, classification-first): `resolveFloatTextOnBlur` is
 * the single blur decision shared by ValueInput and NominalVoutInput. It
 * classifies the RAW draft BEFORE any normalization, so an invalid draft
 * (`NaN.`, `NaNe`, `Infinitye`, `2..`, `12..`, `1ee`) resolves to
 * `keep-error` and can never be repaired into a commit. Only strictly legal
 * transitional drafts normalize, and normalization must yield a complete
 * value or the blur fails closed. The legal transitional set is exactly:
 * empty, a standalone sign, a bare dot (optionally signed), and a
 * digit-bearing decimal mantissa followed by an unfinished exponent
 * (`1e`, `1e+`, `1e-`). Strings without a digit-bearing mantissa (`e`,
 * `e+`, `.e`, `-e+`) are invalid, never transitional.
 */

export type FloatTextClassification =
  | { kind: 'empty' }
  | { kind: 'value'; value: number }
  | { kind: 'out-of-range' }
  | { kind: 'transitional' }
  | { kind: 'invalid' }

/** Complete float syntax: optional sign, digits with optional fraction, optional exponent. */
const FLOAT_SYNTAX = /^[+-]?(?:(?:\d+\.?\d*)|(?:\.\d+))(?:[eE][+-]?\d+)?$/

/**
 * Strictly legal incomplete editing states (v2.5.9): a standalone sign, a
 * bare dot with optional sign, or a digit-bearing mantissa followed by an
 * UNFINISHED exponent (`e` / `e+` / `e-` with no digits yet). The mantissa
 * alternative requires at least one digit, so `e`, `e+`, `.e`, `-e+`, `1ee`
 * and `1e++` never match — they are invalid, not transitional.
 */
const TRANSITIONAL_FLOAT = /^[+-]$|^[+-]?\.$|^[+-]?(?:\d+\.?\d*|\.\d+)[eE][+-]?$/

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
 *
 * v2.5.9 guard: this function is classification-constrained. It normalizes
 * ONLY the strictly legal transitional drafts (empty, standalone sign, bare
 * dot, digit-bearing mantissa with unfinished exponent) and returns every
 * other input unchanged — blur normalization must never repair invalid text
 * (`NaN.` stays `NaN.`; it must not become `NaN`).
 */
export function fixFloatTextOnBlur(value: string): string {
  const s = value.trim()
  if (!(s === '' || s === '-' || s === '+' || TRANSITIONAL_FLOAT.test(s))) return s
  if (!s) return '0'
  if (s === '-' || s === '+') return '0'
  if (/[eE][+-]?$/.test(s)) return s.replace(/[eE][+-]?$/, '') || '0'
  if (s.endsWith('.')) {
    const head = s.slice(0, -1)
    if (head === '' || head === '+') return '0'
    if (head === '-') return '-0'
    return head
  }
  return s
}

/**
 * Resolution of one blur transaction (v2.5.9). The field decides what an
 * empty draft means; everything else comes from this shared decision so the
 * two input components cannot grow divergent blur rules again.
 */
export type FloatBlurResolution =
  /** Raw draft is empty: the field commits its own empty semantics. */
  | { kind: 'empty' }
  /**
   * A complete value draft or a legal transitional that normalized to a
   * complete value: commit `text` (whose parsed value is `value`).
   */
  | { kind: 'commit'; text: string; value: number }
  /**
   * Invalid or out-of-range raw draft — or a transitional whose
   * normalization failed to produce a complete value. Keep the ORIGINAL
   * draft and its error; never commit, never clear the error, never
   * restore a previous display value from here.
   */
  | { kind: 'keep-error'; raw: FloatTextClassification }

/**
 * Shared blur decision (v2.5.9, classification-first): classify the RAW
 * draft before any normalization, then normalize only legal transitional
 * drafts and require normalization to yield a complete value. This is the
 * function that makes "invalid drafts stay invalid on blur" structural
 * instead of a per-component convention.
 */
export function resolveFloatTextOnBlur(rawDraft: string): FloatBlurResolution {
  const raw = classifyFloatText(rawDraft)
  switch (raw.kind) {
    case 'empty':
      return { kind: 'empty' }
    case 'value':
      return { kind: 'commit', text: rawDraft.trim(), value: raw.value }
    case 'transitional': {
      const normalized = fixFloatTextOnBlur(rawDraft)
      const normalizedClass = classifyFloatText(normalized)
      if (normalizedClass.kind !== 'value') {
        // Fail closed: a legal transitional must normalize to an acceptable
        // complete value; anything else keeps the error instead of clearing
        // it and silently restoring the previous display value.
        return { kind: 'keep-error', raw }
      }
      return { kind: 'commit', text: normalized, value: normalizedClass.value }
    }
    case 'out-of-range':
    case 'invalid':
      return { kind: 'keep-error', raw }
  }
}
