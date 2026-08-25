import { describe, it, expect } from 'vitest'
import { appReducer } from './reducer'
import { INITIAL_STATE, type AppState } from './state'

describe('appReducer — state transitions', () => {
  const base: AppState = { ...INITIAL_STATE }

  describe('mode/set', () => {
    it('changes the mode', () => {
      const s = appReducer(base, { type: 'mode/set', mode: 'L16' })
      expect(s.mode).toBe('L16')
    })
  })

  describe('command/set', () => {
    it('sets commandKey only, without switching mode or rewriting raw', () => {
      const l16 = appReducer(base, { type: 'mode/set', mode: 'L16' })
      const withRaw = appReducer(l16, { type: 'raw/set', raw: '4660' })
      const s = appReducer(withRaw, { type: 'command/set', commandKey: 'VOUT_COMMAND' })
      expect(s.commandKey).toBe('VOUT_COMMAND')
      expect(s.mode).toBe('L16')
      expect(s.raw).toBe(0x1234)
      expect(s.l16.voutMode).toBe(withRaw.l16.voutMode)
    })

    it('does not auto-apply device_defined presets', () => {
      const l16 = appReducer(base, { type: 'mode/set', mode: 'L16' })
      const s = appReducer(l16, { type: 'command/set', commandKey: 'READ_VIN' })
      expect(s.commandKey).toBe('READ_VIN')
      expect(s.mode).toBe('L16')
      expect(s.raw).toBe(l16.raw)
    })

    it('clears commandKey with null', () => {
      const withCmd = appReducer(base, { type: 'command/set', commandKey: 'VOUT_COMMAND' })
      const s = appReducer(withCmd, { type: 'command/set', commandKey: null })
      expect(s.commandKey).toBeNull()
    })

    it('ignores an unknown command key', () => {
      const s = appReducer(base, { type: 'command/set', commandKey: 'NOT_A_COMMAND' })
      expect(s.commandKey).toBeNull()
    })

    it('does not force a numeric mode for STATUS_WORD', () => {
      const l16 = appReducer(base, { type: 'mode/set', mode: 'L16' })
      const s = appReducer(l16, { type: 'command/set', commandKey: 'STATUS_WORD' })
      expect(s.commandKey).toBe('STATUS_WORD')
      expect(s.mode).toBe('L16')
    })

    it('does not force a numeric mode for READ_EIN', () => {
      const s = appReducer(base, { type: 'command/set', commandKey: 'READ_EIN' })
      expect(s.commandKey).toBe('READ_EIN')
      expect(s.mode).toBe('L11')
    })
  })

  describe('raw/set-from-hex', () => {
    it('parses plain hex', () => {
      const s = appReducer(base, { type: 'raw/set-from-hex', hex: 'e0c0' })
      expect(s.raw).toBe(0xe0c0)
    })

    it('parses 0x-prefixed hex', () => {
      const s = appReducer(base, { type: 'raw/set-from-hex', hex: '0x1A2B' })
      expect(s.raw).toBe(0x1a2b)
    })

    it('allows leading and trailing whitespace only', () => {
      const s = appReducer(base, { type: 'raw/set-from-hex', hex: '  1A2B  ' })
      expect(s.raw).toBe(0x1a2b)
    })

    it('rejects internal whitespace (full string must match)', () => {
      const s = appReducer(base, { type: 'raw/set-from-hex', hex: 'E0 C0' })
      expect(s.raw).toBe(base.raw)
    })

    it('falls back on empty string (explicit reset-to-zero)', () => {
      const s = appReducer(base, { type: 'raw/set-from-hex', hex: '' })
      expect(s.raw).toBe(0)
    })

    it('rejects over-long hex instead of silently truncating', () => {
      const s = appReducer(base, { type: 'raw/set-from-hex', hex: '0x12345' })
      expect(s.raw).toBe(base.raw)
    })

    it('rejects partial parses such as 1G and 0x12ZZ', () => {
      for (const hex of ['1G', '0x12ZZ']) {
        const s = appReducer(base, { type: 'raw/set-from-hex', hex })
        expect(s.raw, hex).toBe(base.raw)
      }
    })

    it('rejects a bare 0x prefix', () => {
      const s = appReducer(base, { type: 'raw/set-from-hex', hex: '0x' })
      expect(s.raw).toBe(base.raw)
    })

    it('rejects invalid hex without modifying global state', () => {
      const s = appReducer(base, { type: 'raw/set-from-hex', hex: 'zzzz' })
      expect(s.raw).toBe(base.raw)
    })
  })

  describe('raw/set', () => {
    it('sets raw value', () => {
      const s = appReducer(base, { type: 'raw/set', raw: '43981' })
      expect(s.raw).toBe(0xabcd)
    })

    it('clamps to 0..65535 instead of wrapping', () => {
      const hi = appReducer(base, { type: 'raw/set', raw: '127216' })
      expect(hi.raw).toBe(65535)
      const lo = appReducer(base, { type: 'raw/set', raw: '-1' })
      expect(lo.raw).toBe(0)
    })

    it('clamps L16 manual V input to 0..65535', () => {
      const l16 = appReducer(base, { type: 'mode/set', mode: 'L16' })
      const hi = appReducer(l16, { type: 'raw/set', raw: '70000' })
      expect(hi.raw).toBe(65535)
      const lo = appReducer(l16, { type: 'raw/set', raw: '-1' })
      expect(lo.raw).toBe(0)
    })

    it('rejects decimal partial parses, scientific notation, and floats', () => {
      const l16 = appReducer(base, { type: 'mode/set', mode: 'L16' })
      for (const raw of ['12abc', '1e2', '1.5', '+', '-']) {
        const s = appReducer(l16, { type: 'raw/set', raw })
        expect(s.raw, raw).toBe(l16.raw)
      }
    })

    it('accepts decimal strings with surrounding whitespace and explicit sign', () => {
      const l16 = appReducer(base, { type: 'mode/set', mode: 'L16' })
      expect(appReducer(l16, { type: 'raw/set', raw: '  12  ' }).raw).toBe(12)
      expect(appReducer(l16, { type: 'raw/set', raw: '+12' }).raw).toBe(12)
    })
  })

  describe('bit/toggle', () => {
    it('toggles MSB (bit 0)', () => {
      const s = appReducer(base, { type: 'bit/toggle', bit: 0 })
      expect(s.raw).toBe(0x8000)
    })

    it('toggles LSB (bit 15)', () => {
      const s = appReducer(base, { type: 'bit/toggle', bit: 15 })
      expect(s.raw).toBe(0x0001)
    })

    it('toggles twice restores original', () => {
      const s1 = appReducer(base, { type: 'bit/toggle', bit: 5 })
      const s2 = appReducer(s1, { type: 'bit/toggle', bit: 5 })
      expect(s2.raw).toBe(base.raw)
    })
  })

  describe('L11 raw -> N/Y sync', () => {
    it('raw/set-from-hex decodes N and Y in L11 mode', () => {
      const s = appReducer(base, { type: 'raw/set-from-hex', hex: 'F819' })
      expect(s.l11.n).toBe(-1)
      expect(s.l11.y).toBe(25)
      expect(s.l11.valueInput).toBeNull()
    })

    it('bit/toggle decodes N and Y in L11 mode', () => {
      const s1 = appReducer(base, { type: 'raw/set-from-hex', hex: '0801' })
      expect(s1.l11.n).toBe(1)
      expect(s1.l11.y).toBe(1)
    })

    it('mode/set entering L11 syncs N and Y from current raw', () => {
      const l16 = appReducer(base, { type: 'mode/set', mode: 'L16' })
      const withRaw = appReducer(l16, { type: 'raw/set', raw: '2049' })
      expect(withRaw.l11.n).toBe(0) // not yet synced in L16
      const s = appReducer(withRaw, { type: 'mode/set', mode: 'L11' })
      expect(s.l11.n).toBe(1)
      expect(s.l11.y).toBe(1)
      expect(s.l11.valueInput).toBeNull()
    })
  })

  describe('value/set', () => {
    it('encodes an integer with auto-N (best N/Y)', () => {
      const s = appReducer(base, { type: 'value/set', value: '12' })
      // 12 = 12 × 2^0
      expect(s.raw).toBe(0x000c)
      expect(s.l11.n).toBe(0)
      expect(s.l11.y).toBe(12)
      expect(s.l11.valueInput).toBe(12)
    })

    it('encodes a fraction with auto-N', () => {
      const s = appReducer(base, { type: 'value/set', value: '12.5' })
      // 12.5 = 25 × 2^-1
      expect(s.raw).toBe(0xf819)
      expect(s.l11.n).toBe(-1)
      expect(s.l11.y).toBe(25)
    })

    it('encodes with manual N when autoN is off', () => {
      const manual: AppState = {
        ...base,
        l11: { ...base.l11, autoN: false, n: -1 },
      }
      const s = appReducer(manual, { type: 'value/set', value: '12.5' })
      expect(s.l11.autoN).toBe(false)
      expect(s.raw).toBe(0xf819)
      expect(s.l11.n).toBe(-1)
      expect(s.l11.y).toBe(25)
    })

    it('ignores invalid strings', () => {
      const s = appReducer(base, { type: 'value/set', value: 'abc' })
      expect(s.raw).toBe(base.raw)
      expect(s.l11.valueInput).toBeNull()
    })

    it('ignores non-finite values', () => {
      const s = appReducer(base, { type: 'value/set', value: 'Infinity' })
      expect(s.raw).toBe(base.raw)
    })

    it('encodes in HALF mode', () => {
      const half = appReducer(base, { type: 'mode/set', mode: 'HALF' })
      const s = appReducer(half, { type: 'value/set', value: '12' })
      expect(s.raw).toBe(0x4a00)
    })
  })

  describe('L16 value -> raw encode', () => {
    it('encodes with VOUT_MODE-derived N=-8', () => {
      const l16 = appReducer(base, { type: 'mode/set', mode: 'L16' })
      expect(l16.l16.n).toBe(-8)
      const s = appReducer(l16, { type: 'value/set', value: '12' })
      // 12 / 2^-8 = 3072 = 0x0C00
      expect(s.raw).toBe(0x0c00)
    })

    it('encodes a fractional value with N=-8', () => {
      const l16 = appReducer(base, { type: 'mode/set', mode: 'L16' })
      const s = appReducer(l16, { type: 'value/set', value: '12.5' })
      // 12.5 / 2^-8 = 3200 = 0x0C80
      expect(s.raw).toBe(0x0c80)
    })

    it('clamps to 0..65535', () => {
      const l16 = appReducer(base, { type: 'mode/set', mode: 'L16' })
      const hi = appReducer(l16, { type: 'value/set', value: '999999' })
      expect(hi.raw).toBe(0xffff)
      const lo = appReducer(l16, { type: 'value/set', value: '-1' })
      expect(lo.raw).toBe(0)
    })
  })

  describe('l11/set-n', () => {
    it('sets N', () => {
      const s = appReducer(base, { type: 'l11/set-n', n: '-4' })
      expect(s.l11.n).toBe(-4)
    })

    it('writes raw back from N and current Y', () => {
      const s = appReducer(base, { type: 'l11/set-n', n: '-4' })
      // Y=0, N=-4 => raw = N-bits(28)<<11 = 0xE000
      expect(s.raw).toBe(0xe000)
    })

    it('ignores invalid string', () => {
      const s = appReducer(base, { type: 'l11/set-n', n: 'abc' })
      expect(s.l11.n).toBe(base.l11.n)
      expect(s.raw).toBe(base.raw)
    })
  })

  describe('l11/set-y', () => {
    it('sets Y', () => {
      const s = appReducer(base, { type: 'l11/set-y', y: '192' })
      expect(s.l11.y).toBe(192)
    })

    it('writes raw back from Y and current N', () => {
      const s = appReducer(base, { type: 'l11/set-y', y: '192' })
      expect(s.raw).toBe(0x00c0)
    })

    it('ignores invalid string', () => {
      const s = appReducer(base, { type: 'l11/set-y', y: 'xyz' })
      expect(s.l11.y).toBe(base.l11.y)
      expect(s.raw).toBe(base.raw)
    })
  })

  describe('l11/toggle-auto-n', () => {
    it('toggles autoN', () => {
      const s = appReducer(base, { type: 'l11/toggle-auto-n' })
      expect(s.l11.autoN).toBe(!base.l11.autoN)
    })
  })

  describe('l16/set-vout-mode', () => {
    it('parses hex vout mode', () => {
      const s = appReducer(base, { type: 'l16/set-vout-mode', hex: '0x18' })
      expect(s.l16.voutMode).toBe(0x18)
    })

    it('derives N for LINEAR VOUT_MODE (0x18 -> N=-8)', () => {
      const s = appReducer(base, { type: 'l16/set-vout-mode', hex: '0x18' })
      expect(s.l16.n).toBe(-8)
    })

    it('derives N for LINEAR VOUT_MODE (0x17 -> N=-9)', () => {
      const s = appReducer(base, { type: 'l16/set-vout-mode', hex: '0x17' })
      expect(s.l16.n).toBe(-9)
    })

    it('keeps previous N for non-LINEAR VOUT_MODE', () => {
      const s = appReducer(base, { type: 'l16/set-vout-mode', hex: '0x20' })
      expect(s.l16.voutMode).toBe(0x20)
      expect(s.l16.n).toBe(base.l16.n)
    })

    it('rejects over-long VOUT_MODE instead of masking', () => {
      const s = appReducer(base, { type: 'l16/set-vout-mode', hex: '0x1ff' })
      expect(s.l16.voutMode).toBe(base.l16.voutMode)
    })

    it('falls back on empty string (explicit reset-to-zero)', () => {
      const s = appReducer(base, { type: 'l16/set-vout-mode', hex: '' })
      expect(s.l16.voutMode).toBe(0)
    })

    it('ignores invalid hex', () => {
      const s = appReducer(base, { type: 'l16/set-vout-mode', hex: 'gg' })
      expect(s.l16.voutMode).toBe(base.l16.voutMode)
    })
  })

  describe('byte-order/set', () => {
    it('sets byteOrder', () => {
      const s = appReducer(base, { type: 'byte-order/set', endian: 'be' })
      expect(s.byteOrder).toBe('be')
    })
  })

  describe('raw/set-from-hex with L16 byte order', () => {
    it('swaps bytes in BE mode', () => {
      const be: AppState = {
        ...base,
        mode: 'L16',
        byteOrder: 'be',
      }
      const s = appReducer(be, { type: 'raw/set-from-hex', hex: '1234' })
      expect(s.raw).toBe(0x3412)
    })

    it('does not swap in LE mode', () => {
      const le: AppState = {
        ...base,
        mode: 'L16',
        byteOrder: 'le',
      }
      const s = appReducer(le, { type: 'raw/set-from-hex', hex: '1234' })
      expect(s.raw).toBe(0x1234)
    })
  })

  describe('direct/set-y', () => {
    const directMode = appReducer(base, { type: 'mode/set', mode: 'DIRECT' })

    it('encodes signed Y into raw (single source of truth)', () => {
      const s = appReducer(directMode, { type: 'direct/set-y', y: '100' })
      expect(s.raw).toBe(100)
      expect(s.direct).toEqual(directMode.direct)
    })

    it('clamps Y to -32768..32767', () => {
      const hi = appReducer(directMode, { type: 'direct/set-y', y: '40000' })
      expect(hi.raw).toBe(0x7fff)
      const lo = appReducer(directMode, { type: 'direct/set-y', y: '-40000' })
      expect(lo.raw).toBe(0x8000)
    })

    it('ignores invalid string', () => {
      const s = appReducer(directMode, { type: 'direct/set-y', y: 'abc' })
      expect(s.raw).toBe(directMode.raw)
    })

    it('is a no-op outside DIRECT mode', () => {
      const s = appReducer(base, { type: 'direct/set-y', y: '100' })
      expect(s.raw).toBe(base.raw)
    })
  })

  describe('direct/set-coeff', () => {
    it('sets m as a signed 16-bit integer', () => {
      const s = appReducer(base, { type: 'direct/set-coeff', name: 'm', value: '-10' })
      expect(s.direct.m).toBe(-10)
      expect(s.direct.errors.m).toBeNull()
    })

    it('sets b as a signed 16-bit integer', () => {
      const s = appReducer(base, { type: 'direct/set-coeff', name: 'b', value: '-32768' })
      expect(s.direct.b).toBe(-32768)
    })

    it('sets r as a signed 8-bit integer', () => {
      const s = appReducer(base, { type: 'direct/set-coeff', name: 'r', value: '3' })
      expect(s.direct.r).toBe(3)
    })

    it('rejects float coefficients with an explicit error', () => {
      const s = appReducer(base, { type: 'direct/set-coeff', name: 'm', value: '2.5' })
      expect(s.direct.m).toBe(base.direct.m)
      expect(s.direct.errors.m).toContain('M 必须是')
    })

    it('rejects out-of-range m', () => {
      const s = appReducer(base, { type: 'direct/set-coeff', name: 'm', value: '40000' })
      expect(s.direct.m).toBe(base.direct.m)
      expect(s.direct.errors.m).toContain('M 必须是')
    })

    it('accepts m/b boundaries', () => {
      const hi = appReducer(base, { type: 'direct/set-coeff', name: 'm', value: '32767' })
      expect(hi.direct.m).toBe(32767)
      const lo = appReducer(base, { type: 'direct/set-coeff', name: 'm', value: '-32768' })
      expect(lo.direct.m).toBe(-32768)
    })

    it('accepts r boundaries and rejects out-of-range r', () => {
      const hi = appReducer(base, { type: 'direct/set-coeff', name: 'r', value: '127' })
      expect(hi.direct.r).toBe(127)
      const lo = appReducer(base, { type: 'direct/set-coeff', name: 'r', value: '-128' })
      expect(lo.direct.r).toBe(-128)
      const bad = appReducer(base, { type: 'direct/set-coeff', name: 'r', value: '128' })
      expect(bad.direct.r).toBe(base.direct.r)
      expect(bad.direct.errors.r).toContain('R 必须是')
    })

    it('stores m=0 with an explicit error (never silent)', () => {
      const s = appReducer(base, { type: 'direct/set-coeff', name: 'm', value: '0' })
      expect(s.direct.m).toBe(0)
      expect(s.direct.errors.m).toContain('m 不能为 0')
    })

    it('clears error after a valid coefficient is entered', () => {
      const bad = appReducer(base, { type: 'direct/set-coeff', name: 'm', value: '2.5' })
      expect(bad.direct.errors.m).toBeTruthy()
      const good = appReducer(bad, { type: 'direct/set-coeff', name: 'm', value: '2' })
      expect(good.direct.m).toBe(2)
      expect(good.direct.errors.m).toBeNull()
    })

    it('ignores invalid string', () => {
      const s = appReducer(base, { type: 'direct/set-coeff', name: 'm', value: 'x' })
      expect(s.direct.m).toBe(base.direct.m)
      expect(s.direct.errors.m).toContain('M 必须是')
    })
  })

  describe('DIRECT value -> raw encode', () => {
    const directMode = appReducer(base, { type: 'mode/set', mode: 'DIRECT' })

    it('Value 12 with m=1,b=0,R=0 -> raw 12 -> Value 12', () => {
      const s = appReducer(directMode, { type: 'value/set', value: '12' })
      expect(s.raw).toBe(12)
    })

    it('Value -> raw -> Value round-trips with legacy rounding', () => {
      const s = appReducer(directMode, { type: 'value/set', value: '12.5' })
      expect(s.raw).toBe(13) // legacy round(12.5) = 13
      const s2 = appReducer(s, { type: 'value/set', value: '13' })
      expect(s2.raw).toBe(13)
    })

    it('encodes negative physical values to signed Y raw', () => {
      const s = appReducer(directMode, { type: 'value/set', value: '-5' })
      // y = round(-5) = -5 -> fromSigned(-5,16) = 0xFFFB
      expect(s.raw).toBe(0xfffb)
    })

    it('is a no-op when m=0', () => {
      const zeroM = appReducer(base, { type: 'direct/set-coeff', name: 'm', value: '0' })
      const directZero = appReducer(zeroM, { type: 'mode/set', mode: 'DIRECT' })
      const s = appReducer(directZero, { type: 'value/set', value: '12' })
      expect(s.raw).toBe(directZero.raw)
    })
  })

  describe('HALF value -> raw encode', () => {
    const halfMode = appReducer(base, { type: 'mode/set', mode: 'HALF' })

    it('Value 1 -> raw 0x3C00', () => {
      const s = appReducer(halfMode, { type: 'value/set', value: '1' })
      expect(s.raw).toBe(0x3c00)
    })

    it('Value NaN -> raw 0x7E00', () => {
      const s = appReducer(halfMode, { type: 'value/set', value: 'NaN' })
      expect(s.raw).toBe(0x7e00)
    })

    it('Value +Infinity -> raw 0x7C00 and -Infinity -> 0xFC00', () => {
      expect(appReducer(halfMode, { type: 'value/set', value: 'Infinity' }).raw).toBe(0x7c00)
      expect(appReducer(halfMode, { type: 'value/set', value: '-Infinity' }).raw).toBe(0xfc00)
    })

    it('Value -0 -> raw 0x8000 (preserves negative zero)', () => {
      const s = appReducer(halfMode, { type: 'value/set', value: '-0' })
      expect(s.raw).toBe(0x8000)
    })
  })

  describe('DIRECT raw -> signed Y / Value sync', () => {
    const directMode = appReducer(base, { type: 'mode/set', mode: 'DIRECT' })

    it('raw/set-from-hex updates raw for DIRECT (Y derived by view-model)', () => {
      const s = appReducer(directMode, { type: 'raw/set-from-hex', hex: '8000' })
      expect(s.raw).toBe(0x8000)
    })

    it('raw/set clamps and stores 16-bit raw in DIRECT', () => {
      const hi = appReducer(directMode, { type: 'raw/set', raw: '131071' })
      expect(hi.raw).toBe(65535)
      const lo = appReducer(directMode, { type: 'raw/set', raw: '-1' })
      expect(lo.raw).toBe(0)
    })

    it('bit/toggle toggles raw in DIRECT', () => {
      const s = appReducer(directMode, { type: 'bit/toggle', bit: 0 })
      expect(s.raw).toBe(0x8000)
    })
  })

  describe('DIRECT error isolation', () => {
    it('keeps invalid coefficient error in state.direct.errors for DIRECT display', () => {
      const bad = appReducer(base, { type: 'direct/set-coeff', name: 'm', value: '2.5' })
      expect(bad.direct.errors.m).toBeTruthy()
      expect(bad.raw).toBe(base.raw)
    })

    it('does not corrupt an existing valid raw value on invalid coefficient input', () => {
      const directMode = appReducer(base, { type: 'mode/set', mode: 'DIRECT' })
      const withRaw = appReducer(directMode, { type: 'raw/set-from-hex', hex: '1234' })
      const bad = appReducer(withRaw, { type: 'direct/set-coeff', name: 'm', value: '2.5' })
      expect(bad.raw).toBe(0x1234)
      expect(bad.direct.m).toBe(withRaw.direct.m)
      expect(bad.direct.errors.m).toBeTruthy()
    })

    it('keeps the error stored after switching away and back (mode-scoped display, not state reset)', () => {
      const bad = appReducer(base, { type: 'direct/set-coeff', name: 'm', value: '2.5' })
      const away = appReducer(bad, { type: 'mode/set', mode: 'L11' })
      expect(away.direct.errors.m).toBeTruthy()
      const back = appReducer(away, { type: 'mode/set', mode: 'DIRECT' })
      expect(back.direct.errors.m).toBeTruthy()
    })
  })

  describe('M21 统一整数语法（可选正负号 + 十进制数字）', () => {
    it('l11/set-n rejects 1e2 instead of clamping 100 to 15', () => {
      const s = appReducer(base, { type: 'l11/set-n', n: '1e2' })
      expect(s.l11.n).toBe(base.l11.n)
      expect(s.raw).toBe(base.raw)
    })

    it('l11/set-n rejects 0x10 instead of accepting hex 16', () => {
      const s = appReducer(base, { type: 'l11/set-n', n: '0x10' })
      expect(s.l11.n).toBe(base.l11.n)
      expect(s.raw).toBe(base.raw)
    })

    it('l11/set-y rejects 1e2 and 0x10', () => {
      for (const y of ['1e2', '0x10']) {
        const s = appReducer(base, { type: 'l11/set-y', y })
        expect(s.l11.y, y).toBe(base.l11.y)
        expect(s.raw, y).toBe(base.raw)
      }
    })

    it('direct/set-y rejects 1e2 and 0x10', () => {
      const directMode = appReducer(base, { type: 'mode/set', mode: 'DIRECT' })
      for (const y of ['1e2', '0x10']) {
        const s = appReducer(directMode, { type: 'direct/set-y', y })
        expect(s.raw, y).toBe(directMode.raw)
      }
    })

    it('direct/set-coeff rejects 1e2 and 0x10 with a per-field error', () => {
      for (const value of ['1e2', '0x10']) {
        const s = appReducer(base, { type: 'direct/set-coeff', name: 'm', value })
        expect(s.direct.m, value).toBe(base.direct.m)
        expect(s.direct.errors.m, value).toContain('M 必须是')
      }
    })

    it('keeps clamping semantics for safe out-of-range integers in clamp fields', () => {
      const n = appReducer(base, { type: 'l11/set-n', n: '500' })
      expect(n.l11.n).toBe(15)
      const y = appReducer(base, { type: 'l11/set-y', y: '5000' })
      expect(y.l11.y).toBe(1023)
    })
  })

  describe('DIRECT per-field coefficient errors', () => {
    it('keeps the m error when b is edited invalid (no overwrite, no clear)', () => {
      const badM = appReducer(base, { type: 'direct/set-coeff', name: 'm', value: '2.5' })
      const badB = appReducer(badM, { type: 'direct/set-coeff', name: 'b', value: '1.5' })
      expect(badB.direct.errors.m).toContain('M 必须是')
      expect(badB.direct.errors.b).toContain('B 必须是')
    })

    it('clears only the edited field error on valid input', () => {
      const badM = appReducer(base, { type: 'direct/set-coeff', name: 'm', value: '2.5' })
      const badB = appReducer(badM, { type: 'direct/set-coeff', name: 'b', value: '1.5' })
      const fixedB = appReducer(badB, { type: 'direct/set-coeff', name: 'b', value: '3' })
      expect(fixedB.direct.b).toBe(3)
      expect(fixedB.direct.errors.b).toBeNull()
      expect(fixedB.direct.errors.m).toContain('M 必须是')
    })

    it('stores m=0 error on the m field only and clears it when m becomes non-zero', () => {
      const zeroM = appReducer(base, { type: 'direct/set-coeff', name: 'm', value: '0' })
      expect(zeroM.direct.m).toBe(0)
      expect(zeroM.direct.errors.m).toContain('m 不能为 0')
      expect(zeroM.direct.errors.b).toBeNull()
      const fixed = appReducer(zeroM, { type: 'direct/set-coeff', name: 'm', value: '2' })
      expect(fixed.direct.m).toBe(2)
      expect(fixed.direct.errors.m).toBeNull()
    })

    it('preserves per-field errors across mode switches', () => {
      const badM = appReducer(base, { type: 'direct/set-coeff', name: 'm', value: '2.5' })
      const away = appReducer(badM, { type: 'mode/set', mode: 'L11' })
      expect(away.direct.errors.m).toContain('M 必须是')
      const back = appReducer(away, { type: 'mode/set', mode: 'DIRECT' })
      expect(back.direct.errors.m).toContain('M 必须是')
    })
  })

  describe('copy/toggle-prefix', () => {
    it('toggles prefix0x', () => {
      const s = appReducer(base, { type: 'copy/toggle-prefix' })
      expect(s.copy.prefix0x).toBe(!base.copy.prefix0x)
    })
  })

  describe('copy/toggle-space', () => {
    it('toggles spaceBetweenBytes', () => {
      const s = appReducer(base, { type: 'copy/toggle-space' })
      expect(s.copy.spaceBetweenBytes).toBe(!base.copy.spaceBetweenBytes)
    })
  })

  describe('copy/set-endian', () => {
    it('sets endian', () => {
      const s = appReducer(base, { type: 'copy/set-endian', endian: 'be' })
      expect(s.copy.endian).toBe('be')
    })
  })

  describe('ui/set-theme', () => {
    it('sets theme', () => {
      const s = appReducer(base, { type: 'ui/set-theme', theme: 'dark' })
      expect(s.ui.theme).toBe('dark')
    })
  })

  describe('ui/toggle-debug', () => {
    it('toggles debugOpen', () => {
      const s = appReducer(base, { type: 'ui/toggle-debug' })
      expect(s.ui.debugOpen).toBe(!base.ui.debugOpen)
    })
  })

  describe('immutability', () => {
    it('never mutates original state', () => {
      const original = {
        ...base,
        l11: { ...base.l11 },
        l16: { ...base.l16 },
        direct: { ...base.direct },
        copy: { ...base.copy },
        ui: { ...base.ui },
      }
      const s = appReducer(original, { type: 'mode/set', mode: 'L16' })
      expect(original.mode).toBe(base.mode)
      expect(s).not.toBe(original)
    })
  })
})
