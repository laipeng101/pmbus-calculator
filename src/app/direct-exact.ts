/**
 * DIRECT exact-coefficient reference model (v2.5.11).
 *
 * PMBus Part II §7.4 defines X = (Y × 10^-R − b) / m over signed integer
 * fields. The product decodes it in binary64 and encodes typed values with
 * the legacy `Math.round` + signed-16-bit clamp contract (DOMAIN_MODEL
 * §2.3). For legal coefficient combinations the exact decoded value can need
 * more precision than binary64 carries (m=1, b=1, R=17, Y=-1 decodes to the
 * exact -1.00000000000000001, which binary64 renders as -1): two different Y
 * words then share one displayed Number, and re-entering the displayed value
 * silently lands on a different payload.
 *
 * This module is the small, dependency-free BigInt reference for that
 * boundary. It is a fidelity MODEL, not a rewrite of the encoders:
 *
 * - `decodeDirectExact` — the §7.4 decode as a normalized rational
 *   (denominator always positive, gcd reduced). Never fabricated for m=0.
 * - `analyzeDirectRoundTrip` — whether the REAL binary64 pipeline
 *   (PMBusMath.decodeDirect → PMBusMath.encodeDirect) returns to the
 *   original Y. `roundTripSafe` is computed from the real product functions,
 *   so it is by construction equivalent to the shipped Number behavior.
 * - `parseDecimalExactRational` + `encodeDirectExactFromRational` — the
 *   typed-value path: a complete decimal lexeme is encoded through exact
 *   arithmetic that strictly reproduces the Math.round-half-up + clamp
 *   contract, so re-entering a value can no longer silently fold through a
 *   lossy binary64 intermediate.
 * - `generateSafeDirectReentryText` — a decimal string for the current raw
 *   whose re-entry is VERIFIED (independent parse + exact encode) to return
 *   to the original Y. Terminating decimals prefer their exact expansion;
 *   repeating rationals use a verified finite approximation with a
 *   deterministic digit bound.
 *
 * Everything here uses native BigInt rationals only — no arbitrary-precision
 * framework, no changes to L11/L16/HALF math, no changes to the PMBus
 * formula or the signed field ranges.
 */

import { PMBusMath } from '../legacy/pmbus-math'
import { classifyFloatText } from './float-parse'

export interface ExactRational {
  /** Signed numerator; the sign is carried here. */
  numerator: bigint
  /** Always strictly positive; gcd(|numerator|, denominator) === 1. */
  denominator: bigint
}

/**
 * Memoized 10^exp cache (v2.5.12): the full-Y sweep analyses and the wider
 * coefficient grids request the same powers of ten millions of times, and
 * 10n ** BigInt(exp) is the measured hot spot. Deterministic, no
 * algorithm change; the exponent domain is bounded by the module's callers.
 */
const POW10_CACHE = new Map<number, bigint>()

function pow10(exp: number): bigint {
  const cached = POW10_CACHE.get(exp)
  if (cached !== undefined) return cached
  const value = 10n ** BigInt(exp)
  POW10_CACHE.set(exp, value)
  return value
}

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a
  let y = b < 0n ? -b : b
  while (y !== 0n) {
    const r = x % y
    x = y
    y = r
  }
  return x
}

/** Normalize to denominator > 0 with the fraction fully reduced. */
function normalize(numerator: bigint, denominator: bigint): ExactRational {
  let n = numerator
  let d = denominator
  if (d < 0n) {
    n = -n
    d = -d
  }
  const g = gcd(n, d)
  if (g > 1n) {
    n /= g
    d /= g
  }
  return { numerator: n, denominator: d }
}

function assertIntegerField(name: string, value: number): void {
  if (!Number.isInteger(value)) {
    throw new TypeError(`DIRECT ${name} must be an integer, got ${value}`)
  }
}

/**
 * Exact §7.4 decode: X = (Y × 10^-R − b) / m as a normalized rational.
 * Returns null for m=0 (invalid, never fabricated). Integer formulas are
 * derived per the sign of R — no Math.pow rational generation:
 *
 * - R >= 0: X = (Y − b·10^R) / (m·10^R)
 * - R < 0:  X = (Y·10^(−R) − b) / m
 */
export function decodeDirectExact(
  y: number,
  m: number,
  b: number,
  r: number,
): ExactRational | null {
  assertIntegerField('y', y)
  assertIntegerField('m', m)
  assertIntegerField('b', b)
  assertIntegerField('r', r)
  if (m === 0) return null
  const Y = BigInt(y)
  const M = BigInt(m)
  const B = BigInt(b)
  if (r >= 0) {
    const p = pow10(r)
    return normalize(Y - B * p, M * p)
  }
  const p = pow10(-r)
  return normalize(Y * p - B, M)
}

/**
 * `Math.round` semantics (half toward +∞) for the rational n/d with d > 0:
 * Math.round(x) === floor(x + 1/2) === floor((2n + d) / 2d).
 */
export function roundRationalHalfUp(n: bigint, d: bigint): bigint {
  const num = 2n * n + d
  const den = 2n * d
  const q = num / den
  // BigInt division truncates toward zero; den > 0 so a non-zero remainder
  // with a negative numerator still needs the floor correction.
  if (num % den !== 0n && num < 0n) return q - 1n
  return q
}

/**
 * Exact typed-value encode: Y = clamp(roundHalfUp((m·X + b)·10^R), −32768,
 * 32767). This is the repository's `Math.round` + signed-16-bit clamp
 * contract (DOMAIN_MODEL §2.3) evaluated in exact rational arithmetic — the
 * rounding POLICY is unchanged, only the lossy binary64 intermediate is
 * removed for the lexeme the user actually typed.
 */
export function encodeDirectExactFromRational(
  x: ExactRational,
  m: number,
  b: number,
  r: number,
): number {
  assertIntegerField('m', m)
  assertIntegerField('b', b)
  assertIntegerField('r', r)
  if (m === 0) throw new TypeError('DIRECT coefficient m must be non-zero')
  const M = BigInt(m)
  const B = BigInt(b)
  // (m·X + b) as a rational over x.denominator.
  const num = M * x.numerator + B * x.denominator
  const den = x.denominator
  let yn: bigint
  let yd: bigint
  if (r >= 0) {
    yn = num * pow10(r)
    yd = den
  } else {
    yn = num
    yd = den * pow10(-r)
  }
  const rounded = roundRationalHalfUp(yn, yd)
  const clamped = rounded < -32768n ? -32768n : rounded > 32767n ? 32767n : rounded
  return Number(clamped)
}

// ---- Exact rational arithmetic (v2.5.12) ----
// Closed helper set for the DIRECT quantization domain: every status and
// error value for a committed DIRECT request is derived from these instead
// of binary64 comparisons. Inputs are normalized rationals (denominator > 0,
// gcd 1) as produced by decodeDirectExact / parseDecimalExactRational, and
// outputs are renormalized.

const HUNDRED: ExactRational = { numerator: 100n, denominator: 1n }

export function subtractExact(a: ExactRational, b: ExactRational): ExactRational {
  return normalize(
    a.numerator * b.denominator - b.numerator * a.denominator,
    a.denominator * b.denominator,
  )
}

export function multiplyExact(a: ExactRational, b: ExactRational): ExactRational {
  return normalize(a.numerator * b.numerator, a.denominator * b.denominator)
}

export function divideExact(a: ExactRational, b: ExactRational): ExactRational {
  if (b.numerator === 0n) throw new TypeError('exact rational division by zero')
  return normalize(a.numerator * b.denominator, a.denominator * b.numerator)
}

export function absExact(a: ExactRational): ExactRational {
  return a.numerator < 0n ? { numerator: -a.numerator, denominator: a.denominator } : a
}

/** Three-way comparison of two normalized rationals: −1, 0 or 1. */
export function compareExact(a: ExactRational, b: ExactRational): -1 | 0 | 1 {
  const left = a.numerator * b.denominator
  const right = b.numerator * a.denominator
  return left < right ? -1 : left > right ? 1 : 0
}

/** Percent scale (×100) as an exact rational — shared by the relative error. */
export function exactPercentScale(): ExactRational {
  return HUNDRED
}

/**
 * Exact encodable physical-value range of one coefficient combination: the
 * §7.4 decodes of the signed-16-bit Y extremes, ordered by the sign of m
 * (the decode is strictly monotonic in Y for m ≠ 0). Null for m=0 — no
 * fabricated range.
 */
export function directEncodableRangeExact(
  m: number,
  b: number,
  r: number,
): { min: ExactRational; max: ExactRational } | null {
  if (m === 0) return null
  const lo = decodeDirectExact(-32768, m, b, r)
  const hi = decodeDirectExact(32767, m, b, r)
  if (!lo || !hi) return null
  return m > 0 ? { min: lo, max: hi } : { min: hi, max: lo }
}

/**
 * Maximum accepted length of one DIRECT exact decimal lexeme (v2.5.12).
 *
 * This is an interactive RESOURCE boundary, not a PMBus rule: the exact path
 * must reject absurdly long pasted text before any BigInt work so a paste
 * can never block the main thread. Evidence: the repository's safe re-entry
 * generator produces at most 136-character texts over a 531,932-text
 * measurement sweep (widest denominators included), with a theoretical
 * generator cap of ~607 characters (TERMINATING_EXPANSION_MAX_DIGITS=600
 * plus sign/integer point). 4096 keeps ≥6.7× margin over the theoretical
 * generator cap and ≥30× over the measured maximum, while bounding one
 * lexeme's BigInt construction to ≤ ~13.6k bits. The cap measures the raw
 * caller-provided string (v2.5.13) — the same length the UI input gate sees,
 * before any trim — so surrounding whitespace cannot extend the budget.
 */
export const DIRECT_EXACT_MAX_LEXEME_LENGTH = 4096

/** Complete decimal lexeme accepted by the exact path (same class as classifyFloatText values). */
const EXACT_DECIMAL_SYNTAX = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/

/**
 * Why a lexeme is rejected by the exact parse boundary (v2.5.12). The
 * boundary check is pure string work — O(1) for the length cap, O(n) for the
 * syntax scan — and never constructs a BigInt, so even megabyte pastes are
 * rejected before any big-integer cost.
 */
export type ExactLexemeBoundary =
  | { ok: true }
  | { ok: false; reason: 'overlong' | 'syntax' | 'shift-out-of-range' }

/**
 * Boundary classification of one candidate exact lexeme (v2.5.12). Exported
 * so tests (and future callers) can prove rejection happens BEFORE BigInt
 * construction; `parseDecimalExactRational` consumes this on every call.
 *
 * v2.5.13: the length cap applies to the RAW caller-provided string, BEFORE
 * any trim — one shared resource measure for the UI input gate and the
 * reducer-side dispatch. Whitespace padding can no longer buy extra lexeme
 * budget (`' '.repeat(1_000_000) + '1'` is overlong even though it trims to
 * `'1'`), and short-input whitespace semantics are unchanged.
 */
export function checkExactLexemeBoundary(text: string): ExactLexemeBoundary {
  const raw = String(text)
  if (raw.length > DIRECT_EXACT_MAX_LEXEME_LENGTH) return { ok: false, reason: 'overlong' }
  const s = raw.trim()
  const match = EXACT_DECIMAL_SYNTAX.exec(s)
  if (!match) return { ok: false, reason: 'syntax' }
  const intPart = match[2] ?? ''
  const fracPart = match[3] ?? match[4] ?? ''
  // True zero texts keep the legal signed-zero input contract regardless of
  // exponent extremes (`0e-400`, `-0.0e-999`): the exact rational of a zero
  // magnitude needs no power of ten at all, and the DIRECT field encode of
  // zero is sign-independent (±0 encode to the same integer Y).
  if (!/[1-9]/.test(intPart + fracPart)) return { ok: true }
  const exp = match[5] !== undefined ? Number(match[5]) : 0
  if (!Number.isSafeInteger(exp)) return { ok: false, reason: 'shift-out-of-range' }
  // value = ±digits × 10^(exp − fracLen). Non-zero magnitudes that could
  // overflow binary64 (>1e308) or underflow past the subnormal range are
  // rejected by classifyFloatText upstream (out-of-range / underflow); the
  // bounds below fail closed if such a lexeme ever reaches this path.
  const shift = exp - fracPart.length
  if (shift > 400 || shift < -500) return { ok: false, reason: 'shift-out-of-range' }
  return { ok: true }
}

/**
 * Exact parse of one complete decimal lexeme into a normalized rational.
 * Accepts the same complete-syntax class `classifyFloatText` treats as a
 * value (sign, digits, optional fraction, optional exponent); NaN/Infinity
 * literals and any other text return null so callers can fail closed.
 * v2.5.12: the O(1)/O(n) boundary check (length cap, syntax, exponent
 * shift) runs BEFORE any BigInt construction — an overlong paste is
 * rejected without big-integer cost.
 */
export function parseDecimalExactRational(text: string): ExactRational | null {
  const boundary = checkExactLexemeBoundary(text)
  if (!boundary.ok) return null
  const s = String(text).trim()
  const match = EXACT_DECIMAL_SYNTAX.exec(s)
  if (!match) return null
  const sign = match[1] === '-' ? -1n : 1n
  const intPart = match[2] ?? ''
  const fracPart = match[3] ?? match[4] ?? ''
  // True zero (any exponent, including extremes beyond the shift bounds):
  // the exact rational of a zero magnitude needs no power of ten at all.
  if (!/[1-9]/.test(intPart + fracPart)) return { numerator: 0n, denominator: 1n }
  // Non-zero magnitudes only reach here, so the mantissa digit string is
  // well-formed and bounded by DIRECT_EXACT_MAX_LEXEME_LENGTH.
  const digits = BigInt(intPart + fracPart)
  const exp = match[5] !== undefined ? Number(match[5]) : 0
  // value = ±digits × 10^(exp − fracLen); the shift bounds were verified by
  // the boundary check without any BigInt work.
  const shift = exp - fracPart.length
  if (shift >= 0) return normalize(sign * digits * pow10(shift), 1n)
  return normalize(sign * digits, pow10(-shift))
}

/** Canonical exact-value presentation: "n/d" with a plain integer for d=1. */
export function formatExactRational(x: ExactRational): string {
  if (x.denominator === 1n) return x.numerator.toString()
  return `${x.numerator}/${x.denominator}`
}

// ---- Exact-rational presentation (v2.5.12) ----
// Display conversions for the DIRECT quantization surfaces. They never
// decide a status — that is compareExact's job — but they guarantee a
// non-zero rational can never render as textual zero: tiny magnitudes go
// scientific, terminating decimals render exactly, repeating rationals fall
// back to their exact fraction.

const EXACT_TEN_POW4: ExactRational = { numerator: 1n, denominator: 10n ** 4n }
const EXACT_TEN_POW7: ExactRational = { numerator: 10n ** 7n, denominator: 1n }
/** Longest terminating expansion rendered as a decimal before falling back to the fraction. */
const MAX_EXACT_DECIMAL_CHARS = 24

/**
 * Signed scientific notation with `sigDigits` significant digits (half-up,
 * the repository rounding policy), e.g. 100/(10^17+1) → '+1e-15'. The
 * decimal exponent is found by exact cross-multiplication, never log10.
 */
export function formatSignedRationalScientific(x: ExactRational, sigDigits = 4): string {
  const negative = x.numerator < 0n
  const n = negative ? -x.numerator : x.numerator
  const d = x.denominator
  if (n === 0n) return '+0'
  const digits = (v: bigint): number => v.toString().length
  let e = digits(n) - digits(d)
  // Compare n/d with 10^k exactly (no floating log10).
  const cmpPow10 = (k: number): number => {
    if (k >= 0) {
      const rhs = d * pow10(k)
      return n < rhs ? -1 : n > rhs ? 1 : 0
    }
    const lhs = n * pow10(-k)
    return lhs < d ? -1 : lhs > d ? 1 : 0
  }
  while (cmpPow10(e) < 0) e -= 1
  // 10^e ≤ n/d holds here; raise e while n/d still reaches 10^(e+1).
  while (cmpPow10(e + 1) >= 0) e += 1
  const k = sigDigits - 1 - e
  let s = k >= 0 ? roundRationalHalfUp(n * pow10(k), d) : roundRationalHalfUp(n, d * pow10(-k))
  if (s >= pow10(sigDigits)) {
    s = pow10(sigDigits - 1)
    e += 1
  }
  const str = s.toString().padStart(sigDigits, '0')
  const frac = str.slice(1).replace(/0+$/, '')
  return `${negative ? '-' : '+'}${str[0]}${frac ? `.${frac}` : ''}e${e}`
}

/**
 * Signed fixed-point decimal of a normalized rational with `fracDigits`
 * places (half-up on the final digit), e.g. −1/6 → '-0.1667'.
 */
export function formatSignedRationalFixed(x: ExactRational, fracDigits: number): string {
  const negative = x.numerator < 0n
  const n = negative ? -x.numerator : x.numerator
  const scaled = roundRationalHalfUp(n * pow10(fracDigits), x.denominator)
  const scale = pow10(fracDigits)
  const intPart = scaled / scale
  const frac = (scaled % scale).toString().padStart(fracDigits, '0')
  const body = fracDigits > 0 ? `${intPart}.${frac}` : `${intPart}`
  return `${negative ? '-' : '+'}${body}`
}

/**
 * Signed display for an exact delta: integers stay integers ('+1'), tiny or
 * very large magnitudes go scientific ('+1e-16'), in-band terminating
 * decimals render exactly, repeating rationals fall back to the exact
 * fraction ('-1/6'). A non-zero rational can never render as textual zero.
 */
export function formatExactDelta(x: ExactRational): string {
  const negative = x.numerator < 0n
  const sign = negative ? '-' : '+'
  const abs = { numerator: negative ? -x.numerator : x.numerator, denominator: x.denominator }
  if (abs.numerator === 0n) return '+0.000000'
  if (compareExact(abs, EXACT_TEN_POW4) < 0 || compareExact(abs, EXACT_TEN_POW7) >= 0) {
    return formatSignedRationalScientific(x, 4)
  }
  if (abs.denominator === 1n) return `${sign}${abs.numerator}`
  const decimal = formatExactDecimal(abs)
  if (decimal !== null && decimal.length <= MAX_EXACT_DECIMAL_CHARS) {
    return `${sign}${decimal}`
  }
  return `${sign}${abs.numerator}/${abs.denominator}`
}

/**
 * Signed display for an exact relative percent: fixed 4 decimals in the
 * readable band, scientific outside, '—' for the undefined (exact-zero
 * request) case. Never renders a non-zero percent as textual zero.
 */
export function formatExactPercent(x: ExactRational | null): string {
  if (!x) return '—'
  if (x.numerator === 0n) return '0.0000%'
  const negative = x.numerator < 0n
  const abs = { numerator: negative ? -x.numerator : x.numerator, denominator: x.denominator }
  const body =
    compareExact(abs, EXACT_TEN_POW4) < 0 || compareExact(abs, EXACT_TEN_POW7) >= 0
      ? formatSignedRationalScientific(x, 4)
      : formatSignedRationalFixed(x, 4)
  // The delta already carries the direction; a leading '+' is noise here.
  return `${body.replace(/^\+/, '')}%`
}

/**
 * Exact decimal expansion for a terminating rational (`-1.00000000000000001`
 * style), or null when the value is a repeating decimal — display helper for
 * the fidelity surfaces; re-entry strings still go through the verified
 * generator.
 */
export function formatExactDecimal(x: ExactRational): string | null {
  return terminatingDecimalText(x)
}

/** Round-trip analysis of the REAL binary64 pipeline for one signed Y. */
export interface DirectRoundTripAnalysis {
  /** Original signed Y (the payload word's field value). */
  y: number
  /** Exact §7.4 decode of (y, m, b, r). */
  exact: ExactRational
  /** Real product decode result — PMBusMath.decodeDirect in binary64. */
  approxValue: number
  /** Y the real product encoder assigns to `approxValue`. */
  reencodedY: number
  /** True when re-entry of the displayed binary64 value returns to y. */
  roundTripSafe: boolean
}

/**
 * Analyze one DIRECT field combination through the REAL product functions:
 * `approxValue` is PMBusMath.decodeDirect's binary64 result and
 * `reencodedY` is PMBusMath.encodeDirect's Math.round + clamp verdict on
 * it, so `roundTripSafe` is by construction equivalent to the shipped
 * Number behavior. Null for m=0 (no decode contract).
 */
export function analyzeDirectRoundTrip(
  y: number,
  m: number,
  b: number,
  r: number,
): DirectRoundTripAnalysis | null {
  const exact = decodeDirectExact(y, m, b, r)
  if (!exact) return null
  const approxValue = PMBusMath.decodeDirect(y, m, b, r).value
  const reencodedY = PMBusMath.encodeDirect(approxValue, m, b, r)
  return { y, exact, approxValue, reencodedY, roundTripSafe: reencodedY === y }
}

/**
 * Deterministic search bound for the safe re-entry text. The exact decode X
 * sits at the CENTER of its re-encode acceptance interval, whose T-space
 * half-width is 10^-R / (2|m|); the nearest decimal grid of step 10^-k is
 * therefore guaranteed to contain a verified candidate once
 * 10^-k < 10^-R/|m|, i.e. k > R + log10(|m|). For every legal coefficient
 * combination that is k ≤ 127 + 5 + 1 = 133; 160 leaves margin.
 */
const SAFE_REENTRY_MAX_FRACTION_DIGITS = 160

/** Denominator cap for the exact terminating expansion (m·10^R ≤ ~3.4e132). */
const TERMINATING_EXPANSION_MAX_DIGITS = 600

function reentryVerifies(text: string, y: number, m: number, b: number, r: number): boolean {
  // Full typed-path verification: the text must survive the shared parse
  // classification (a finite committed value) AND its exact rational must
  // encode back to the original Y under the exact Math.round contract.
  const classified = classifyFloatText(text)
  if (classified.kind !== 'value' || !Number.isFinite(classified.value)) return false
  const exact = parseDecimalExactRational(text)
  if (!exact) return false
  return encodeDirectExactFromRational(exact, m, b, r) === y
}

/**
 * Exact decimal expansion for a terminating rational (denominator = 2^a·5^b
 * after reduction), or null when the value does not terminate.
 */
function terminatingDecimalText(x: ExactRational): string | null {
  let d = x.denominator
  let twos = 0
  let fives = 0
  while (d % 2n === 0n) {
    d /= 2n
    twos++
  }
  while (d % 5n === 0n) {
    d /= 5n
    fives++
  }
  if (d !== 1n) return null
  const digits = Math.max(twos, fives)
  if (digits > TERMINATING_EXPANSION_MAX_DIGITS) return null
  const scale = pow10(digits)
  const scaled = (x.numerator < 0n ? -x.numerator : x.numerator) * scale
  if (scaled % x.denominator !== 0n) return null
  const q = scaled / x.denominator
  const intPart = q / scale
  const frac = (q % scale).toString().padStart(digits, '0').replace(/0+$/, '')
  const sign = x.numerator < 0n ? '-' : ''
  if (frac === '') return `${sign}${intPart}`
  return `${sign}${intPart}.${frac}`
}

/** Nearest decimal to x with exactly k fractional digits (round half up). */
function nearestDecimalText(x: ExactRational, k: number): string {
  const scale = pow10(k)
  const scaled = roundRationalHalfUp(x.numerator * scale, x.denominator)
  const negative = scaled < 0n
  const abs = negative ? -scaled : scaled
  if (k === 0) return `${negative ? '-' : ''}${abs}`
  const scaleK = pow10(k)
  const intPart = abs / scaleK
  const frac = (abs % scaleK).toString().padStart(k, '0').replace(/0+$/, '')
  if (frac === '') return `${negative ? '-' : ''}${intPart}`
  return `${negative ? '-' : ''}${intPart}.${frac}`
}

/**
 * Generate a decimal string that provably re-enters to the original Y:
 * terminating decimals prefer their exact expansion; repeating rationals
 * take the first verified nearest-decimal approximation inside the
 * deterministic digit bound. Every candidate — exact or approximate — is
 * re-parsed and re-encoded through the independent exact encoder before it
 * may be returned; null means no verified string exists within the bound
 * and callers must degrade safely (never hand out an unverified string).
 */
export function generateSafeDirectReentryText(
  exact: ExactRational,
  y: number,
  m: number,
  b: number,
  r: number,
  maxFractionDigits: number = SAFE_REENTRY_MAX_FRACTION_DIGITS,
): string | null {
  const terminating = terminatingDecimalText(exact)
  if (terminating !== null && reentryVerifies(terminating, y, m, b, r)) return terminating
  for (let k = 0; k <= maxFractionDigits; k++) {
    const candidate = nearestDecimalText(exact, k)
    if (reentryVerifies(candidate, y, m, b, r)) return candidate
  }
  return null
}
