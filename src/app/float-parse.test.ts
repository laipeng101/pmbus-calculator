import { describe, it, expect } from 'vitest'
import { parseFloatSafe, isTransitionalFloatText, classifyFloatText } from './float-parse'

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

  it('keeps finite values beyond ±1e20 unclamped (v2.5.8, no silent clipping)', () => {
    // 1e21 and larger finite doubles pass through unchanged; range handling
    // belongs to the encoders (saturation / overflow), not the parse layer.
    expect(parseFloatSafe('1e20')).toBe(1e20)
    expect(parseFloatSafe('-1e20')).toBe(-1e20)
    expect(parseFloatSafe('1e21')).toBe(1e21)
    expect(parseFloatSafe('-1e21')).toBe(-1e21)
    expect(parseFloatSafe('1e128')).toBe(1e128)
    expect(parseFloatSafe('1e308')).toBe(1e308)
    expect(parseFloatSafe('-1e308')).toBe(-1e308)
  })

  it('rejects complete decimal text that overflows to ±Infinity (v2.5.8)', () => {
    // ±1e400 is syntactically complete but Number() renders it non-finite:
    // it is an explicit range error, never a silently clamped 1e20 request.
    expect(parseFloatSafe('1e400')).toBeNull()
    expect(parseFloatSafe('-1e400')).toBeNull()
  })

  it('keeps HALF explicit literals distinct from decimal overflow (v2.5.8)', () => {
    // The exact texts NaN / ±Infinity are first-class values (Part II §7.6);
    // decimal overflow text is a range error in every mode including HALF.
    expect(parseFloatSafe('Infinity')).toBe(Infinity)
    expect(parseFloatSafe('-Infinity')).toBe(-Infinity)
    expect(parseFloatSafe('1e400')).toBeNull()
  })

  it('treats decimal underflow to zero as a finite conversion result', () => {
    // Number('1e-400') is +0 — finite, so it is a value, not a range error.
    expect(Object.is(parseFloatSafe('1e-400'), 0)).toBe(true)
    expect(Object.is(parseFloatSafe('-1e-400'), -0)).toBe(true)
  })
})

describe('classifyFloatText', () => {
  it('classifies complete finite values', () => {
    expect(classifyFloatText('12')).toEqual({ kind: 'value', value: 12 })
    expect(classifyFloatText(' 1e21 ')).toEqual({ kind: 'value', value: 1e21 })
    expect(classifyFloatText('-1e21')).toEqual({ kind: 'value', value: -1e21 })
    expect(classifyFloatText('.5')).toEqual({ kind: 'value', value: 0.5 })
    const zero = classifyFloatText('-0')
    expect(zero.kind).toBe('value')
    expect(Object.is(zero.kind === 'value' ? zero.value : null, -0)).toBe(true)
  })

  it('classifies HALF literals as values, not range errors', () => {
    expect(classifyFloatText('NaN').kind).toBe('value')
    expect(classifyFloatText('Infinity')).toEqual({ kind: 'value', value: Infinity })
    expect(classifyFloatText('-Infinity')).toEqual({ kind: 'value', value: -Infinity })
  })

  it('classifies decimal overflow as out-of-range', () => {
    expect(classifyFloatText('1e400')).toEqual({ kind: 'out-of-range' })
    expect(classifyFloatText('-1e400')).toEqual({ kind: 'out-of-range' })
    expect(classifyFloatText('1e309')).toEqual({ kind: 'out-of-range' })
  })

  it('classifies empty and half-typed drafts as incomplete', () => {
    expect(classifyFloatText('').kind).toBe('empty')
    for (const input of ['-', '+', '.', '+.', '-.', '1e', '1e+', '12.5e-', '1E-']) {
      expect(classifyFloatText(input).kind, input).toBe('transitional')
    }
  })

  it('classifies definitively invalid text', () => {
    for (const input of ['abc', '1.2.3', '12a', '--1', '1e2.5', 'nan_', 'infinity2']) {
      expect(classifyFloatText(input).kind, input).toBe('invalid')
    }
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

  it('treats out-of-range decimal text as complete, never as a draft (v2.5.8)', () => {
    // Regression guard: removing the magnitude clamp must not make complete
    // overflow text look like "still typing" — 1e400 is a finished input that
    // reports a range error, not a transitional draft.
    expect(isTransitionalFloatText('1e400')).toBe(false)
    expect(isTransitionalFloatText('-1e400')).toBe(false)
  })
})
