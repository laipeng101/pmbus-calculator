import { describe, expect, it } from 'vitest'
import { effectiveL16VoutMode } from './vout-mode-selector'
import { DEFAULT_LINEAR_VOUT_MODE } from '../legacy/vout-mode'
import type { AppState } from './state'
import { INITIAL_STATE } from './state'

function state(partial: Partial<AppState>): AppState {
  return { ...INITIAL_STATE, ...partial }
}

describe('effectiveL16VoutMode (M38 single source)', () => {
  it('returns the shared byte as linked when it is absolute/relative LINEAR', () => {
    for (const byte of [0x00, 0x0f, 0x10, 0x18, 0x80, 0x98]) {
      const eff = effectiveL16VoutMode(state({ voutMode: { byte } }))
      expect(eff.byte, `0x${byte.toString(16)}`).toBe(byte)
      expect(eff.source, `0x${byte.toString(16)}`).toBe('linked')
    }
  })

  it('returns fallback default 0x18 without mutating the shared byte', () => {
    for (const byte of [0x20, 0x40, 0x60, 0xe0, 0xa0, 0x41, 0xc1, 0xe1]) {
      const s = state({ voutMode: { byte } })
      const eff = effectiveL16VoutMode(s)
      expect(eff.byte, `0x${byte.toString(16)}`).toBe(DEFAULT_LINEAR_VOUT_MODE)
      expect(eff.source, `0x${byte.toString(16)}`).toBe('fallback-default')
      expect(s.voutMode.byte, `0x${byte.toString(16)}`).toBe(byte)
    }
  })

  it('DEFAULT_LINEAR_VOUT_MODE is defined once as 0x18', () => {
    expect(DEFAULT_LINEAR_VOUT_MODE).toBe(0x18)
  })
})
