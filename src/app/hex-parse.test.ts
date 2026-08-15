import { describe, it, expect } from 'vitest'
import { parseHexByte, parseHexStrict, parseHexWord } from './hex-parse'

describe('parseHexStrict', () => {
  it('parses plain hex digits', () => {
    expect(parseHexStrict('F819', 4)).toEqual({ ok: true, value: 0xf819, empty: false })
    expect(parseHexStrict('ffff', 4)).toEqual({ ok: true, value: 0xffff, empty: false })
  })

  it('accepts optional 0x/0X prefix', () => {
    expect(parseHexStrict('0xF819', 4)).toEqual({ ok: true, value: 0xf819, empty: false })
    expect(parseHexStrict('0Xf819', 4)).toEqual({ ok: true, value: 0xf819, empty: false })
  })

  it('allows leading and trailing whitespace', () => {
    expect(parseHexStrict('  F819  ', 4)).toEqual({ ok: true, value: 0xf819, empty: false })
  })

  it('treats empty input as explicit zero', () => {
    expect(parseHexStrict('', 4)).toEqual({ ok: true, value: 0, empty: true })
    expect(parseHexStrict('   ', 4)).toEqual({ ok: true, value: 0, empty: true })
  })

  it('rejects a bare 0x prefix', () => {
    const r = parseHexStrict('0x', 4)
    expect(r.ok).toBe(false)
    if (r.ok === false) expect(r.error).toContain('0x/0X 后')
  })

  it('rejects non-hex characters anywhere in the string', () => {
    for (const input of ['1G', '0x12ZZ', '12 34', '12-4', '0x12345']) {
      const r = parseHexStrict(input, 4)
      expect(r.ok, input).toBe(false)
    }
  })

  it('rejects over-long raw word input', () => {
    const r = parseHexWord('12345')
    expect(r.ok).toBe(false)
    if (r.ok === false) expect(r.error).toContain('最多 4 位')
  })

  it('rejects over-long byte input for VOUT_MODE', () => {
    const r = parseHexByte('0x1ff')
    expect(r.ok).toBe(false)
    if (r.ok === false) expect(r.error).toContain('最多 2 位')
  })

  it('requires the whole string to match (no partial parse)', () => {
    expect(parseHexWord('F819ZZ').ok).toBe(false)
    expect(parseHexWord('0xF8190').ok).toBe(false)
  })
})
