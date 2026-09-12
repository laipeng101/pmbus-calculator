/**
 * Canonical IEEE 754 binary16 display classification (HALF mode).
 *
 * The HALF result workspace shows a class-appropriate generic relation
 * (zero / subnormal / normal / ±Infinity / NaN) plus the live s/E/F fields.
 * This module is the single source for that classification so the formula
 * presentation, the result rows and the calculation steps never re-derive the
 * exponent/fraction decision tree independently. It performs NO encoding or
 * decoding math of its own — the numeric value always comes from the canonical
 * `PMBusMath.decodeHalf`.
 */

export type HalfClass = 'zero' | 'subnormal' | 'normal' | 'infinity' | 'nan'

export interface HalfClassFacts {
  raw: number
  sign: 0 | 1
  exponent: number
  fraction: number
  klass: HalfClass
  /** '+0' / '-0' for zeros; null for every other class (signed zero preserved). */
  signedZero: '+0' | '-0' | null
  /** Compact Chinese-primary class label for the field row. */
  label: string
}

const CLASS_LABELS: Record<HalfClass, string> = {
  zero: '零',
  subnormal: '次正规数',
  normal: '正规数',
  infinity: 'Infinity',
  nan: 'NaN',
}

/** Pure classification of the canonical raw word (never re-implements decode). */
export function classifyHalf(raw: number): HalfClassFacts {
  const bits = raw & 0xffff
  const sign = ((bits >> 15) & 1) as 0 | 1
  const exponent = (bits >> 10) & 0x1f
  const fraction = bits & 0x3ff

  let klass: HalfClass
  if (exponent === 0) {
    klass = fraction === 0 ? 'zero' : 'subnormal'
  } else if (exponent === 0x1f) {
    klass = fraction === 0 ? 'infinity' : 'nan'
  } else {
    klass = 'normal'
  }

  const signedZero = klass === 'zero' ? (sign ? '-0' : '+0') : null
  const label =
    klass === 'infinity'
      ? `${sign ? '-' : '+'}Infinity`
      : klass === 'nan'
        ? 'NaN'
        : klass === 'zero'
          ? sign
            ? '-0'
            : '+0'
          : CLASS_LABELS[klass]

  return { raw: bits, sign, exponent, fraction, klass, signedZero, label }
}

/**
 * Local KaTeX-safe sign-exponent rendering. The exponent stays a semantic
 * superscript but is typeset at text style so `s` does not shrink to an
 * unreadable script size. `\\textstyle` is supported by KaTeX 0.18.4 under
 * `strict: 'error'` and preserves MathML; no global font scaling is involved.
 */
export function halfSignPowerLatex(exponent: number | 's'): string {
  return `(-1)^{\\textstyle ${exponent}}`
}

/** Class-appropriate generic relation typeset by KaTeX (task C). */
export function halfClassGenericLatex(klass: HalfClass): string {
  switch (klass) {
    case 'zero':
      return `X = ${halfSignPowerLatex('s')} \\times 0`
    case 'subnormal':
      return `X = ${halfSignPowerLatex('s')} \\times 2^{-14} \\times \\frac{F}{2^{10}}`
    case 'normal':
      return `X = ${halfSignPowerLatex('s')} \\times 2^{E-15} \\times \\left(1 + \\frac{F}{2^{10}}\\right)`
    case 'infinity':
      return `X = ${halfSignPowerLatex('s')} \\times \\infty`
    case 'nan':
      return 'X = \\text{NaN}'
  }
}

/** Plain-text mirror of the generic relation, used for copy and KaTeX fallback. */
export function halfClassGenericPlainText(klass: HalfClass): string {
  switch (klass) {
    case 'zero':
      return 'X = (-1)^s × 0'
    case 'subnormal':
      return 'X = (-1)^s × 2^-14 × F/1024'
    case 'normal':
      return 'X = (-1)^s × 2^(E−15) × (1 + F/1024)'
    case 'infinity':
      return 'X = (-1)^s × ∞'
    case 'nan':
      return 'X = NaN'
  }
}
