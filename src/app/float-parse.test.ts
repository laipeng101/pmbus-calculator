import { describe, expect, it } from 'vitest'
import {
  classifyFloatText,
  fixFloatTextOnBlur,
  isTransitionalFloatText,
  parseFloatSafe,
  resolveFloatTextOnBlur,
} from './float-parse'

describe('classifyFloatText', () => {
  it('accepts complete decimals and scientific notation without clipping', () => {
    for (const [text, value] of [
      ['12', 12],
      ['-5.5', -5.5],
      ['.5', 0.5],
      ['+1.', 1],
      ['1E-2', 0.01],
      [' 1e21 ', 1e21],
      ['-1e21', -1e21],
      ['1e128', 1e128],
      ['1e308', 1e308],
      ['-1e308', -1e308],
    ] as const) {
      expect(classifyFloatText(text), text).toEqual({ kind: 'value', value })
    }
  })

  it('keeps explicit HALF literals distinct from decimal overflow', () => {
    for (const [text, value] of [
      ['NaN', NaN],
      ['Infinity', Infinity],
      ['+Infinity', Infinity],
      ['-Infinity', -Infinity],
    ] as const) {
      expect(classifyFloatText(text), text).toEqual({ kind: 'value', value })
    }
    for (const text of ['1e309', '1e400', '-1e400']) {
      expect(classifyFloatText(text), text).toEqual({ kind: 'out-of-range' })
    }
  })

  it('accepts the minimum binary64 subnormal and rejects nonzero requests that round to zero', () => {
    for (const text of [
      '1e-400',
      '-1e-400',
      '1e-324',
      '2e-324',
      '-2e-324',
      '1e-4000',
      '00.01e-400',
    ]) {
      expect(classifyFloatText(text), text).toEqual({ kind: 'underflow' })
    }
    for (const [text, value] of [
      ['3e-324', Number.MIN_VALUE],
      ['5e-324', Number.MIN_VALUE],
      ['-5e-324', -Number.MIN_VALUE],
      ['1e-320', 1e-320],
      ['-1e-320', -1e-320],
    ] as const) {
      expect(classifyFloatText(text), text).toEqual({ kind: 'value', value })
    }
  })

  it('retains the sign of an all-zero mantissa regardless of exponent', () => {
    for (const text of ['0', '0.0', '+.0', '+0e-400', '0e999999', '000.000e-999']) {
      expect(classifyFloatText(text), text).toEqual({ kind: 'value', value: 0 })
    }
    for (const text of ['-0', '-0.0', '-.0', '-.00', '-0e3', '-0e400', '-0e999999', '-.0e-999']) {
      expect(classifyFloatText(text), text).toEqual({ kind: 'value', value: -0 })
    }
  })

  it('distinguishes unfinished input with a valid mantissa from invalid syntax', () => {
    expect(classifyFloatText('')).toEqual({ kind: 'empty' })
    for (const text of ['-', '+', '.', '+.', '-.', '1e', '1e+', '12.5e-', '1E-']) {
      expect(classifyFloatText(text), text).toEqual({ kind: 'transitional' })
    }
    for (const text of [
      'e',
      'e+',
      'e-',
      'E',
      'E+',
      '+e',
      '-e+',
      '-e-',
      '.e',
      '-.e',
      '+.e',
      '1ee',
      '1Ee',
      '1e++',
      '1e+-',
      '12.5e-e',
      '1.5e2.5',
      'NaN.',
      'NaNe',
      'NaN_',
      'Infinitye',
      'Infinity.',
      '+Infinitye',
      'infinity2',
      '2..',
      '12..',
      '1..',
      '1.2.3',
      '.5.',
      '2.e.',
      'abc',
      '12a',
      '--1',
    ]) {
      expect(classifyFloatText(text), text).toEqual({ kind: 'invalid' })
    }
  })
})

describe('resolveFloatTextOnBlur', () => {
  it('returns empty for the field to apply its own clear behavior', () => {
    expect(resolveFloatTextOnBlur('')).toEqual({ kind: 'empty' })
    expect(resolveFloatTextOnBlur('   ')).toEqual({ kind: 'empty' })
  })

  it('preserves the committed decimal spelling and the numeric sign', () => {
    for (const [draft, text, value] of [
      ['5', '5', 5],
      [' 1. ', '1.', 1],
      ['NaN', 'NaN', NaN],
      ['Infinity', 'Infinity', Infinity],
      ['-0', '-0', -0],
    ] as const) {
      expect(resolveFloatTextOnBlur(draft), draft).toEqual({ kind: 'commit', text, value })
    }
  })

  it('commits a valid transitional draft after normalization', () => {
    for (const [draft, text, value] of [
      ['.', '0', 0],
      ['+.', '0', 0],
      ['-.', '-0', -0],
      ['-', '0', 0],
      ['+', '0', 0],
      ['1e', '1', 1],
      ['1e+', '1', 1],
      ['1e-', '1', 1],
      ['12.5e-', '12.5', 12.5],
      ['-0e+', '-0', -0],
      ['1.e', '1.', 1],
      ['.5e', '.5', 0.5],
    ] as const) {
      expect(resolveFloatTextOnBlur(draft), draft).toEqual({ kind: 'commit', text, value })
    }
  })

  it('keeps drafts that cannot be committed', () => {
    for (const [kind, drafts] of [
      [
        'invalid',
        ['NaN.', 'NaNe', 'Infinitye', '+Infinitye', '2..', '12..', '1ee', 'e', 'abc', '--1'],
      ],
      ['out-of-range', ['1e400', '-1e400', '1e309']],
      ['underflow', ['1e-400', '-1e-400', '1e-324', '2e-324']],
    ] as const) {
      for (const draft of drafts) {
        expect(resolveFloatTextOnBlur(draft), draft).toEqual({ kind: 'keep-error', raw: { kind } })
      }
    }
  })

  it.each([
    { boundary: 'overflow', text: `${'9'.repeat(309)}e` },
    { boundary: 'underflow', text: `0.${'0'.repeat(399)}1e` },
  ])('keeps a transitional draft when normalization would $boundary', ({ text }) => {
    expect(resolveFloatTextOnBlur(text)).toEqual({
      kind: 'keep-error',
      raw: { kind: 'transitional' },
    })
  })
})

it('keeps the compatibility helpers’ parse, draft and normalization results', () => {
  expect(parseFloatSafe('-.0')).toBe(-0)
  expect(parseFloatSafe('1e-400')).toBeNull()
  expect(isTransitionalFloatText('')).toBe(true)
  expect(isTransitionalFloatText('1e')).toBe(true)
  expect(isTransitionalFloatText('1e400')).toBe(false)
  expect(fixFloatTextOnBlur('NaN.')).toBe('NaN.')
  expect(fixFloatTextOnBlur('-.')).toBe('-0')
})
