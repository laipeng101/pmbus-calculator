import { describe, it, expect } from 'vitest'
import { parseFloatSafe, isTransitionalFloatText } from './float-parse'

describe('parseFloatSafe', () => {
  it('parses plain, signed, fractional and scientific notation values', () => {
    expect(parseFloatSafe('12')).toBe(12)
    expect(parseFloatSafe('-5')).toBe(-5)
    expect(parseFloatSafe('12.5')).toBe(12.5)
    expect(parseFloatSafe('1e2')).toBe(100)
    expect(parseFloatSafe('1E-2')).toBe(0.01)
    expect(parseFloatSafe('.5')).toBe(0.5)
  })

  it('parses HALF first-class literals', () => {
    expect(parseFloatSafe('NaN')).toBeNaN()
    expect(parseFloatSafe('Infinity')).toBe(Infinity)
    expect(parseFloatSafe('+Infinity')).toBe(Infinity)
    expect(parseFloatSafe('-Infinity')).toBe(-Infinity)
  })

  it('preserves the sign of zero in signed shorthand (v2.5.7, §7.6)', () => {
    // -0 is a distinct IEEE 754 binary16 code (0x8000); Number('-.0') is -0
    // and the parser must not overwrite its sign with a literal 0.
    for (const input of ['-0', '-0.0', '-.0', '-.00', '-0e3']) {
      const value = parseFloatSafe(input)
      expect(value, input).not.toBeNull()
      expect(Object.is(value, -0), input).toBe(true)
    }
  })

  it('parses unsigned zero shorthand as positive zero', () => {
    for (const input of ['0', '+0', '0.0', '.0', '+.0', '0e3']) {
      const value = parseFloatSafe(input)
      expect(Object.is(value, 0), input).toBe(true)
    }
  })

  it('rejects garbage and multi-dot strings', () => {
    for (const input of ['', 'abc', '1.2.3', '12a', '--1', '1e', 'nan_', 'infinity2']) {
      expect(parseFloatSafe(input), input).toBeNull()
    }
  })

  it('clamps magnitudes beyond 1e20', () => {
    expect(parseFloatSafe('1e400')).toBe(1e20)
    expect(parseFloatSafe('-1e400')).toBe(-1e20)
  })
})

describe('isTransitionalFloatText', () => {
  it('treats half-typed floats as transitional, not invalid', () => {
    for (const input of ['', '-', '+', '.', '+.', '-.', '1e', '1e+', '12.5e-', '1E-']) {
      expect(isTransitionalFloatText(input), input).toBe(true)
    }
  })

  it('treats complete values as non-transitional', () => {
    // Bare dots are transitional (parseFloatSafe -> null); digit-bearing
    // drafts like '+1.' are complete values.
    for (const input of ['0', '12', '-5.5', '-0', '-.0', '1e2', 'NaN', 'Infinity', '+1.']) {
      expect(isTransitionalFloatText(input), input).toBe(false)
    }
  })

  it('treats definitively invalid text as non-transitional', () => {
    for (const input of ['abc', '1.2.3', '12a', '--1', '1e2.5']) {
      expect(isTransitionalFloatText(input), input).toBe(false)
    }
  })
})
