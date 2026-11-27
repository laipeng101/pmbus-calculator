import { describe, expect, it } from 'vitest'
import { formatPlainNumber, formatPlainNumberLatex, formatSpecial } from './numeric-presentation'

describe('plain-number policy — canonical contracts', () => {
  it('formatPlainNumber renders every finite class with 12-significant-digit folding', () => {
    expect(formatPlainNumber(0)).toBe('0')
    expect(formatPlainNumber(-0)).toBe('-0')
    expect(formatPlainNumber(12)).toBe('12')
    expect(formatPlainNumber(-16)).toBe('-16')
    expect(formatPlainNumber(12.5)).toBe('12.5')
    expect(formatPlainNumber(0.99951171875)).toBe('0.99951171875')
    expect(formatPlainNumber(0.031219482421875)).toBe('0.0312194824219')
    expect(formatPlainNumber(-0.031219482421875)).toBe('-0.0312194824219')
    expect(formatPlainNumber(1e128)).toBe('1e+128')
    expect(formatPlainNumber(1e-128)).toBe('1e-128')
    expect(formatPlainNumber(5e-324)).toBe('5e-324')
    // Number.MAX_VALUE is mathematically an integer, so the integer branch
    // prints it via toString, not the 12-significant-digit fold.
    expect(formatPlainNumber(Number.MAX_VALUE)).toBe('1.7976931348623157e+308')
    expect(formatPlainNumber(1 / 3)).toBe('0.333333333333')
    expect(formatPlainNumber(0.1 + 0.2)).toBe('0.3')
    expect(formatPlainNumber(Math.PI)).toBe('3.14159265359')
  })

  it('formatPlainNumber owns the special-value text the finite classes compose with', () => {
    expect(formatPlainNumber(NaN)).toBe('NaN')
    expect(formatPlainNumber(Infinity)).toBe('+Infinity')
    expect(formatPlainNumber(-Infinity)).toBe('-Infinity')
  })

  it('formatPlainNumberLatex wraps only the specials, never re-typesets finite numbers', () => {
    expect(formatPlainNumberLatex(NaN)).toBe('\\text{NaN}')
    expect(formatPlainNumberLatex(Infinity)).toBe('+\\infty')
    expect(formatPlainNumberLatex(-Infinity)).toBe('-\\infty')
    // Finite values share the plain policy verbatim (including -0).
    expect(formatPlainNumberLatex(-0)).toBe('-0')
    expect(formatPlainNumberLatex(0)).toBe('0')
    expect(formatPlainNumberLatex(12)).toBe('12')
    expect(formatPlainNumberLatex(0.031219482421875)).toBe('0.0312194824219')
  })

  it('formatSpecial keeps the sign-explicit endpoint text for the quantization readout', () => {
    expect(formatSpecial(NaN)).toBe('NaN')
    expect(formatSpecial(Infinity)).toBe('+Infinity')
    expect(formatSpecial(-Infinity)).toBe('-Infinity')
    expect(formatSpecial(-0)).toBe('-0')
    expect(formatSpecial(0)).toBe('+0')
  })
})
