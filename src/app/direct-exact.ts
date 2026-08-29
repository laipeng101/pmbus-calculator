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

function pow10(exp: number): bigint {
  return 10n ** BigInt(exp)
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

/**
 * Exact parse of one complete decimal lexeme into a normalized rational.
 * Accepts the same complete-syntax class `classifyFloatText` treats as a
 * value (sign, digits, optional fraction, optional exponent); NaN/Infinity
 * literals and any other text return null so callers can fail closed. The
 * exponent is bounded because the reducer only reaches the exact path after
 * `classifyFloatText` produced a finite Number (|value| < 1.8e308).
 */
export function parseDecimalExactRational(text: string): ExactRational | null {
  const s = String(text).trim()
  const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(s)
  if (!match) return null
  const sign = match[1] === '-' ? -1n : 1n
  const intPart = match[2] ?? ''
  const fracPart = match[3] ?? match[4] ?? ''
  const digits = BigInt(intPart + fracPart || '0')
  // True zero texts keep the legal signed-zero input contract regardless of
  // exponent extremes (`0e-400`, `-0.0e-999`): the exact rational of a zero
  // magnitude needs no power of ten at all, and the DIRECT field encode of
  // zero is sign-independent (±0 encode to the same integer Y).
  if (digits === 0n) return { numerator: 0n, denominator: 1n }
  const exp = match[5] !== undefined ? Number(match[5]) : 0
  if (!Number.isSafeInteger(exp)) return null
  // value = ±digits × 10^(exp − fracLen). Non-zero magnitudes that could
  // overflow binary64 (>1e308) or underflow past the subnormal range are
  // rejected by classifyFloatText upstream (out-of-range / underflow); the
  // bounds below fail closed if such a lexeme ever reaches this path.
  const shift = exp - fracPart.length
  if (shift > 400 || shift < -500) return null
  if (shift >= 0) return normalize(sign * digits * pow10(shift), 1n)
  return normalize(sign * digits, pow10(-shift))
}

/** Canonical exact-value presentation: "n/d" with a plain integer for d=1. */
export function formatExactRational(x: ExactRational): string {
  if (x.denominator === 1n) return x.numerator.toString()
  return `${x.numerator}/${x.denominator}`
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
