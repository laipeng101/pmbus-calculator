import { describe, it, expect } from 'vitest'
import { parseIntegerStrict, isTransitionalIntegerText } from './int-parse'

describe('parseIntegerStrict', () => {
  it('parses plain decimal integers', () => {
    expect(parseIntegerStrict('0')).toEqual({ ok: true, value: 0, empty: false })
    expect(parseIntegerStrict('65535')).toEqual({ ok: true, value: 65535, empty: false })
    expect(parseIntegerStrict('-32768')).toEqual({ ok: true, value: -32768, empty: false })
  })

  it('allows leading/trailing whitespace and an explicit sign', () => {
    expect(parseIntegerStrict('  12  ')).toEqual({ ok: true, value: 12, empty: false })
    expect(parseIntegerStrict('+12')).toEqual({ ok: true, value: 12, empty: false })
    expect(parseIntegerStrict('-12')).toEqual({ ok: true, value: -12, empty: false })
  })

  it('treats empty input as explicit zero', () => {
    expect(parseIntegerStrict('')).toEqual({ ok: true, value: 0, empty: true })
    expect(parseIntegerStrict('   ')).toEqual({ ok: true, value: 0, empty: true })
  })

  it('rejects partial parses, scientific notation, floats, hex, and sign-only input', () => {
    for (const input of ['12abc', '1e2', '1.5', '+', '-', '0x10', '12 34', '1E2', '0b101']) {
      expect(parseIntegerStrict(input).ok, input).toBe(false)
    }
  })

  it('rejects unsafe oversized integers with a generic message', () => {
    const r = parseIntegerStrict('999999999999999999999999999999999999')
    expect(r.ok).toBe(false)
    if (r.ok === false) expect(r.error).toContain('过大')
  })
})

describe('isTransitionalIntegerText', () => {
  it('treats empty and lone-sign drafts as unfinished, not invalid', () => {
    for (const input of ['', '  ', '+', '-', ' + ', ' - ']) {
      expect(isTransitionalIntegerText(input), input).toBe(true)
    }
  })

  it('treats anything else as either complete or definitively invalid', () => {
    for (const input of ['0', '12', '-5', '1.5', 'abc', '1e2']) {
      expect(isTransitionalIntegerText(input), input).toBe(false)
    }
  })
})
