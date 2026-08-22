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

  it('treats dot-only drafts as explicit zero (legacy behavior)', () => {
    expect(parseFloatSafe('.')).toBe(0)
    expect(parseFloatSafe('-.0')).toBe(0)
    expect(parseFloatSafe('+.')).toBe(0)
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
    for (const input of ['', '-', '+', '1e', '1e+', '12.5e-', '1E-']) {
      expect(isTransitionalFloatText(input), input).toBe(true)
    }
  })

  it('treats complete values as non-transitional', () => {
    // '.', '-.', '+1.' parse via the legacy dot-draft rule (parseFloatSafe -> 0/value),
    // so they are complete, not transitional.
    for (const input of ['0', '12', '-5.5', '1e2', 'NaN', 'Infinity', '.', '-.', '+1.']) {
      expect(isTransitionalFloatText(input), input).toBe(false)
    }
  })

  it('treats definitively invalid text as non-transitional', () => {
    for (const input of ['abc', '1.2.3', '12a', '--1', '1e2.5']) {
      expect(isTransitionalFloatText(input), input).toBe(false)
    }
  })
})
