import { describe, it, expect } from 'vitest'
import {
  parseFloatSafe,
  isTransitionalFloatText,
  classifyFloatText,
  fixFloatTextOnBlur,
  resolveFloatTextOnBlur,
} from './float-parse'

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

  it('rejects non-zero decimals that binary64 underflows to ±0 (v2.5.10 contract change)', () => {
    // v2.5.9 and earlier treated Number('1e-400') = +0 as a legal value,
    // silently rewriting a non-zero request into a zero fact. v2.5.10 makes
    // that an explicit input-underflow range error (see the dedicated
    // describe below); true zero texts and the smallest subnormal keep the
    // signed-zero value contract.
    expect(parseFloatSafe('1e-400')).toBeNull()
    expect(parseFloatSafe('-1e-400')).toBeNull()
    expect(Object.is(parseFloatSafe('0e-400'), 0)).toBe(true)
    expect(Object.is(parseFloatSafe('-0e400'), -0)).toBe(true)
    expect(parseFloatSafe('5e-324')).toBe(5e-324)
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

  it('never treats exponent fragments without a digit-bearing mantissa as transitional (v2.5.9)', () => {
    // The v2.5.8 transitional regex accepted `e` / `e+` / `.e` / `-e+` and the
    // blur path then coerced bare `e` to 0. These strings have no valid
    // decimal mantissa, so they are invalid, never legal transitional states.
    for (const input of ['e', 'e+', 'e-', 'E', 'E+', '+e', '-e+', '-e-', '.e', '-.e', '+.e']) {
      expect(classifyFloatText(input).kind, input).toBe('invalid')
    }
  })

  it('never treats malformed exponent continuations as transitional (v2.5.9)', () => {
    for (const input of ['1ee', '1Ee', '1e++', '1e+-', '12.5e-e', '1.5e2.5']) {
      expect(classifyFloatText(input).kind, input).toBe('invalid')
    }
  })

  it('classifies HALF literals decorated with trailing fragments as invalid (v2.5.9)', () => {
    // `NaN.` / `NaNe` / `Infinitye` must not be repairable into NaN/Infinity
    // — the blur path used to strip the fragment and commit the special value.
    for (const input of ['NaN.', 'NaNe', 'NaN_', 'Infinitye', 'Infinity.', '+Infinitye']) {
      expect(classifyFloatText(input).kind, input).toBe('invalid')
    }
  })

  it('classifies multi-dot drafts as invalid (v2.5.9 regression)', () => {
    for (const input of ['2..', '12..', '1..', '1.2.3', '.5.', '2.e.']) {
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

describe('fixFloatTextOnBlur guard (v2.5.9)', () => {
  it('never repairs invalid text into a different classification', () => {
    // The v2.5.9 defect: blur normalization stripped trailing dots / `e`
    // fragments BEFORE classification, turning `NaN.` into NaN, `NaNe` into
    // NaN, `Infinitye` into +Infinity and `2..` into 2. The normalizer must
    // leave invalid text alone — classification happens first.
    for (const input of ['NaN.', 'NaNe', 'Infinitye', '+Infinitye', '2..', '12..', '1ee', 'e']) {
      expect(fixFloatTextOnBlur(input), input).toBe(input.trim())
    }
  })

  it('still normalizes the strictly-legal transitional drafts', () => {
    expect(fixFloatTextOnBlur('.')).toBe('0')
    expect(fixFloatTextOnBlur('+.')).toBe('0')
    expect(fixFloatTextOnBlur('-.')).toBe('-0')
    expect(fixFloatTextOnBlur('-')).toBe('0')
    expect(fixFloatTextOnBlur('+')).toBe('0')
    expect(fixFloatTextOnBlur('1e')).toBe('1')
    expect(fixFloatTextOnBlur('1e+')).toBe('1')
    expect(fixFloatTextOnBlur('1e-')).toBe('1')
    expect(fixFloatTextOnBlur('12.5e-')).toBe('12.5')
    expect(fixFloatTextOnBlur('-0e+')).toBe('-0')
    expect(fixFloatTextOnBlur('1.e')).toBe('1.')
    expect(fixFloatTextOnBlur('.5e')).toBe('.5')
  })

  it('leaves complete values untouched', () => {
    expect(fixFloatTextOnBlur('1.')).toBe('1.')
    expect(fixFloatTextOnBlur('5')).toBe('5')
    expect(fixFloatTextOnBlur('NaN')).toBe('NaN')
    expect(fixFloatTextOnBlur('Infinity')).toBe('Infinity')
    expect(fixFloatTextOnBlur('1e400')).toBe('1e400')
  })
})

describe('resolveFloatTextOnBlur (v2.5.9 shared blur decision)', () => {
  it('surfaces empty drafts for the field to decide (0 vs null)', () => {
    expect(resolveFloatTextOnBlur('')).toEqual({ kind: 'empty' })
    expect(resolveFloatTextOnBlur('   ')).toEqual({ kind: 'empty' })
  })

  it('commits complete values unchanged (classification first, no lossy rewrite)', () => {
    expect(resolveFloatTextOnBlur('5')).toEqual({ kind: 'commit', text: '5', value: 5 })
    expect(resolveFloatTextOnBlur('1.')).toEqual({ kind: 'commit', text: '1.', value: 1 })
    expect(resolveFloatTextOnBlur('2.')).toEqual({ kind: 'commit', text: '2.', value: 2 })
    expect(resolveFloatTextOnBlur('NaN')).toEqual({ kind: 'commit', text: 'NaN', value: NaN })
    expect(resolveFloatTextOnBlur('Infinity')).toEqual({
      kind: 'commit',
      text: 'Infinity',
      value: Infinity,
    })
    const negativeZero = resolveFloatTextOnBlur('-0')
    expect(negativeZero.kind).toBe('commit')
    if (negativeZero.kind === 'commit') {
      expect(Object.is(negativeZero.value, -0)).toBe(true)
    }
  })

  it('normalizes legal transitional drafts to complete values', () => {
    expect(resolveFloatTextOnBlur('.')).toEqual({ kind: 'commit', text: '0', value: 0 })
    expect(resolveFloatTextOnBlur('+.')).toEqual({ kind: 'commit', text: '0', value: 0 })
    expect(resolveFloatTextOnBlur('-')).toEqual({ kind: 'commit', text: '0', value: 0 })
    const negDot = resolveFloatTextOnBlur('-.')
    expect(negDot.kind).toBe('commit')
    if (negDot.kind === 'commit') {
      expect(negDot.text).toBe('-0')
      expect(Object.is(negDot.value, -0)).toBe(true)
    }
    expect(resolveFloatTextOnBlur('1e')).toEqual({ kind: 'commit', text: '1', value: 1 })
    expect(resolveFloatTextOnBlur('1e+')).toEqual({ kind: 'commit', text: '1', value: 1 })
    expect(resolveFloatTextOnBlur('1e-')).toEqual({ kind: 'commit', text: '1', value: 1 })
    expect(resolveFloatTextOnBlur('12.5e-')).toEqual({ kind: 'commit', text: '12.5', value: 12.5 })
    const negZeroExp = resolveFloatTextOnBlur('-0e+')
    expect(negZeroExp.kind).toBe('commit')
    if (negZeroExp.kind === 'commit') {
      expect(negZeroExp.text).toBe('-0')
      expect(Object.is(negZeroExp.value, -0)).toBe(true)
    }
  })

  it('keeps invalid drafts as errors — never converts them into commits', () => {
    // Every v2.5.9 invalid-blur counterexample: the raw draft is invalid, so
    // the blur resolution must keep the error instead of committing a
    // repaired text.
    for (const input of ['NaN.', 'NaNe', 'Infinitye', '2..', '12..', '1ee', 'abc', '--1']) {
      const resolution = resolveFloatTextOnBlur(input)
      expect(resolution.kind, input).toBe('keep-error')
      if (resolution.kind === 'keep-error') {
        expect(resolution.raw.kind, input).toBe('invalid')
      }
    }
  })

  it('keeps out-of-range drafts as errors', () => {
    for (const input of ['1e400', '-1e400', '1e309']) {
      const resolution = resolveFloatTextOnBlur(input)
      expect(resolution.kind, input).toBe('keep-error')
      if (resolution.kind === 'keep-error') {
        expect(resolution.raw.kind, input).toBe('out-of-range')
      }
    }
  })

  it('fail-closes a transitional that fails normalization (defensive)', () => {
    // Unreachable through the strict transitional regex (every legal
    // transitional normalizes to a complete value), but the contract requires
    // fail-closed behavior instead of clearing the error.
    const resolution = resolveFloatTextOnBlur('1e')
    expect(resolution.kind).toBe('commit')
  })

  it('keeps input-underflow drafts as errors (v2.5.10)', () => {
    for (const input of ['1e-400', '-1e-400', '1e-324', '2e-324']) {
      const resolution = resolveFloatTextOnBlur(input)
      expect(resolution.kind, input).toBe('keep-error')
      if (resolution.kind === 'keep-error') {
        expect(resolution.raw.kind, input).toBe('underflow')
      }
    }
  })
})

describe('input underflow classification (v2.5.10)', () => {
  it('classifies non-zero decimals that binary64 rounds to ±0 as underflow', () => {
    for (const input of ['1e-400', '-1e-400', '1e-324', '2e-324', '-2e-324', '1e-4000']) {
      expect(classifyFloatText(input).kind, input).toBe('underflow')
    }
    // 1e-320 itself IS representable (a subnormal far above the rounding
    // threshold), so it stays a finite value; its negative too.
    expect(classifyFloatText('1e-320')).toEqual({ kind: 'value', value: Number('1e-320') })
    expect(classifyFloatText('-1e-320').kind).toBe('value')
  })

  it('accepts the smallest subnormal as a finite value', () => {
    const minSubnormal = 5e-324
    expect(classifyFloatText('5e-324')).toEqual({ kind: 'value', value: minSubnormal })
    expect(classifyFloatText('-5e-324')).toEqual({ kind: 'value', value: -minSubnormal })
    // 3e-324 rounds to the minimum subnormal (above half-ulp), not to zero.
    expect(classifyFloatText('3e-324')).toEqual({ kind: 'value', value: minSubnormal })
    expect(Number('3e-324')).toBe(minSubnormal)
  })

  it('keeps true zero texts as signed-zero values, never underflow', () => {
    const plusZeros = ['0', '0.0', '0e-400', '0e999999', '000.000e-999', '+0e-400']
    for (const input of plusZeros) {
      const parsed = classifyFloatText(input)
      expect(parsed.kind, input).toBe('value')
      if (parsed.kind === 'value') {
        expect(parsed.value === 0, input).toBe(true)
        expect(Object.is(parsed.value, -0), `${input} must be +0`).toBe(false)
      }
    }
    const minusZeros = ['-0', '-0.0', '-0e400', '-0e999999', '-0.0e-999', '-.0e-999']
    for (const input of minusZeros) {
      const parsed = classifyFloatText(input)
      expect(parsed.kind, input).toBe('value')
      if (parsed.kind === 'value') {
        expect(Object.is(parsed.value, -0), `${input} must be true -0`).toBe(true)
      }
    }
  })

  it('distinguishes underflow from overflow, literals and invalid fragments', () => {
    expect(classifyFloatText('1e400').kind).toBe('out-of-range')
    expect(classifyFloatText('-1e400').kind).toBe('out-of-range')
    expect(classifyFloatText('NaN').kind).toBe('value')
    expect(classifyFloatText('Infinity').kind).toBe('value')
    expect(classifyFloatText('-Infinity').kind).toBe('value')
    expect(classifyFloatText('1e').kind).toBe('transitional')
    expect(classifyFloatText('-.').kind).toBe('transitional')
    expect(classifyFloatText('NaN.').kind).toBe('invalid')
    expect(classifyFloatText('2..').kind).toBe('invalid')
  })

  it('never hard-codes an exponent threshold: mantissa digits decide', () => {
    // Same exponent, different mantissas: the all-zero mantissa is a true
    // zero while any 1-9 digit carries a non-zero magnitude.
    expect(classifyFloatText('0e-400').kind).toBe('value')
    expect(classifyFloatText('1e-400').kind).toBe('underflow')
    expect(classifyFloatText('00.00e-400').kind).toBe('value')
    expect(classifyFloatText('00.01e-400').kind).toBe('underflow')
  })
})
