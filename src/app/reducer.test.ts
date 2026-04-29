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
    it('sets commandKey', () => {
      const s = appReducer(base, { type: 'command/set', commandKey: 'VOUT_COMMAND' })
      expect(s.commandKey).toBe('VOUT_COMMAND')
    })

    it('clears commandKey with null', () => {
      const withCmd = appReducer(base, { type: 'command/set', commandKey: 'VOUT_COMMAND' })
      const s = appReducer(withCmd, { type: 'command/set', commandKey: null })
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

    it('masks to 16 bits', () => {
      const s = appReducer(base, { type: 'raw/set', raw: 0x1f0f0 })
      expect(s.raw).toBe(0xf0f0)
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

  describe('value/set', () => {
    it('returns unchanged state (Phase 2 placeholder)', () => {
      const s = appReducer(base, { type: 'value/set', value: '12.5' })
      expect(s).toEqual(base)
    })
  })

  describe('l11/set-n', () => {
    it('sets N', () => {
      const s = appReducer(base, { type: 'l11/set-n', n: '-4' })
      expect(s.l11.n).toBe(-4)
    })

    it('ignores invalid string', () => {
      const s = appReducer(base, { type: 'l11/set-n', n: 'abc' })
      expect(s.l11.n).toBe(base.l11.n)
    })
  })

  describe('l11/set-y', () => {
    it('sets Y', () => {
      const s = appReducer(base, { type: 'l11/set-y', y: '192' })
      expect(s.l11.y).toBe(192)
    })

    it('ignores invalid string', () => {
      const s = appReducer(base, { type: 'l11/set-y', y: 'xyz' })
      expect(s.l11.y).toBe(base.l11.y)
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

  describe('ui/set-focused-field', () => {
    it('sets focused field', () => {
      const s = appReducer(base, { type: 'ui/set-focused-field', field: 'raw-hex' })
      expect(s.ui.focusedField).toBe('raw-hex')
    })

    it('clears focused field', () => {
      const s = appReducer(base, { type: 'ui/set-focused-field', field: null })
      expect(s.ui.focusedField).toBeNull()
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
