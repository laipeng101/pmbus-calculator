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
      const withRaw = appReducer(l16, { type: 'raw/set', raw: 0x1234 })
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

  describe('command/apply-preset', () => {
    it('applies VOUT_COMMAND project-demo preset: mode, VOUT_MODE, N, and raw', () => {
      const s = appReducer(base, { type: 'command/apply-preset', commandKey: 'VOUT_COMMAND' })
      expect(s.commandKey).toBe('VOUT_COMMAND')
      expect(s.mode).toBe('L16')
      expect(s.l16.voutMode).toBe(0x18)
      expect(s.l16.n).toBe(-8)
      // 12 / 2^-8 = 3072 = 0x0C00
      expect(s.raw).toBe(0x0c00)
    })

    it('applies FAN_COMMAND_1 project-demo preset and re-encodes raw', () => {
      const s = appReducer(base, { type: 'command/apply-preset', commandKey: 'FAN_COMMAND_1' })
      expect(s.commandKey).toBe('FAN_COMMAND_1')
      expect(s.mode).toBe('L11')
      expect(s.l11.valueInput).toBe(5000)
      expect(s.raw).toBe(0x1a71) // 5000 = 625 × 2^3 (N=3, Y=625)
    })

    it('does not apply anything for STATUS_WORD (no preset)', () => {
      const l16 = appReducer(base, { type: 'mode/set', mode: 'L16' })
      const s = appReducer(l16, { type: 'command/apply-preset', commandKey: 'STATUS_WORD' })
      expect(s.commandKey).toBe('STATUS_WORD')
      expect(s.mode).toBe('L16')
      expect(s.raw).toBe(l16.raw)
    })

    it('does not apply anything for READ_EIN (no preset)', () => {
      const s = appReducer(base, { type: 'command/apply-preset', commandKey: 'READ_EIN' })
      expect(s.commandKey).toBe('READ_EIN')
      expect(s.mode).toBe('L11')
      expect(s.raw).toBe(base.raw)
    })

    it('clears commandKey with null', () => {
      const withCmd = appReducer(base, { type: 'command/apply-preset', commandKey: 'VOUT_COMMAND' })
      const s = appReducer(withCmd, { type: 'command/apply-preset', commandKey: null })
      expect(s.commandKey).toBeNull()
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

    it('handles spaces', () => {
      const s = appReducer(base, { type: 'raw/set-from-hex', hex: 'E0 C0' })
      expect(s.raw).toBe(0xe0c0)
    })

    it('clamps to 16 bits', () => {
      const s = appReducer(base, { type: 'raw/set-from-hex', hex: '0x12345' })
      expect(s.raw).toBe(0x2345)
    })

    it('falls back on empty string', () => {
      const s = appReducer(base, { type: 'raw/set-from-hex', hex: '' })
      expect(s.raw).toBe(0)
    })

    it('ignores invalid hex', () => {
      const s = appReducer(base, { type: 'raw/set-from-hex', hex: 'zzzz' })
      expect(s.raw).toBe(base.raw)
    })
  })

  describe('raw/set', () => {
    it('sets raw value', () => {
      const s = appReducer(base, { type: 'raw/set', raw: 0xabcd })
      expect(s.raw).toBe(0xabcd)
    })

    it('clamps to 0..65535 instead of wrapping', () => {
      const hi = appReducer(base, { type: 'raw/set', raw: 0x1f0f0 })
      expect(hi.raw).toBe(65535)
      const lo = appReducer(base, { type: 'raw/set', raw: -1 })
      expect(lo.raw).toBe(0)
    })

    it('clamps L16 manual V input to 0..65535', () => {
      const l16 = appReducer(base, { type: 'mode/set', mode: 'L16' })
      const hi = appReducer(l16, { type: 'raw/set', raw: 70000 })
      expect(hi.raw).toBe(65535)
      const lo = appReducer(l16, { type: 'raw/set', raw: -1 })
      expect(lo.raw).toBe(0)
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
      const withRaw = appReducer(l16, { type: 'raw/set', raw: 0x0801 })
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

    it('is a no-op outside L11/L16 mode', () => {
      const direct = appReducer(base, { type: 'mode/set', mode: 'DIRECT' })
      const s = appReducer(direct, { type: 'value/set', value: '12' })
      expect(s.raw).toBe(direct.raw)
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

    it('masks to 8 bits', () => {
      const s = appReducer(base, { type: 'l16/set-vout-mode', hex: '0x1ff' })
      expect(s.l16.voutMode).toBe(0xff)
    })

    it('falls back on empty string', () => {
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
    it('sets direct Y', () => {
      const s = appReducer(base, { type: 'direct/set-y', y: '100' })
      expect(s.direct.y).toBe(100)
    })

    it('ignores invalid string', () => {
      const s = appReducer(base, { type: 'direct/set-y', y: 'abc' })
      expect(s.direct.y).toBe(base.direct.y)
    })
  })

  describe('direct/set-coeff', () => {
    it('sets m', () => {
      const s = appReducer(base, { type: 'direct/set-coeff', name: 'm', value: '2.5' })
      expect(s.direct.m).toBe(2.5)
    })

    it('sets b', () => {
      const s = appReducer(base, { type: 'direct/set-coeff', name: 'b', value: '-10' })
      expect(s.direct.b).toBe(-10)
    })

    it('sets r', () => {
      const s = appReducer(base, { type: 'direct/set-coeff', name: 'r', value: '3' })
      expect(s.direct.r).toBe(3)
    })

    it('ignores invalid string', () => {
      const s = appReducer(base, { type: 'direct/set-coeff', name: 'm', value: 'x' })
      expect(s.direct.m).toBe(base.direct.m)
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
