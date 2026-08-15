import { describe, it, expect } from 'vitest'
import { parseDecimalIntStrict } from './decimal-parse'

describe('parseDecimalIntStrict', () => {
  it('parses plain decimal integers', () => {
    expect(parseDecimalIntStrict('0')).toEqual({ ok: true, value: 0, empty: false })
    expect(parseDecimalIntStrict('65535')).toEqual({ ok: true, value: 65535, empty: false })
  })

  it('allows leading/trailing whitespace and an explicit sign', () => {
    expect(parseDecimalIntStrict('  12  ')).toEqual({ ok: true, value: 12, empty: false })
    expect(parseDecimalIntStrict('+12')).toEqual({ ok: true, value: 12, empty: false })
    expect(parseDecimalIntStrict('-12')).toEqual({ ok: true, value: -12, empty: false })
  })

  it('treats empty input as explicit zero', () => {
    expect(parseDecimalIntStrict('')).toEqual({ ok: true, value: 0, empty: true })
    expect(parseDecimalIntStrict('   ')).toEqual({ ok: true, value: 0, empty: true })
  })

  it('rejects partial parses, scientific notation, floats, and sign-only input', () => {
    for (const input of ['12abc', '1e2', '1.5', '+', '-', '0x10', '12 34']) {
      expect(parseDecimalIntStrict(input).ok, input).toBe(false)
    }
  })

  it('rejects unsafe oversized integers', () => {
    const r = parseDecimalIntStrict('999999999999999999999999999999999999')
    expect(r.ok).toBe(false)
    if (r.ok === false) expect(r.error).toContain('过大')
  })
})
