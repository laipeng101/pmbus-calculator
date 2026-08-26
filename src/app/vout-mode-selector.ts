import type { AppState } from './state'
import { analyzeVoutMode, DEFAULT_LINEAR_VOUT_MODE } from '../legacy/vout-mode'

export interface EffectiveL16VoutMode {
  /** Byte the LINEAR16 page must use for its V×2^N / offset semantics. */
  byte: number
  source: 'linked' | 'fallback-default'
}

/**
 * Single pure selector for the VOUT_MODE byte that actually drives the L16
 * page.
 *
 * - When the shared `state.voutMode.byte` is LINEAR (bits[6:5] = 00b), L16 uses
 *   it directly, including its bit7 and N (linked).
 * - Otherwise L16 uses `DEFAULT_LINEAR_VOUT_MODE` (0x18) as an explicit
 *   fallback, without silently rewriting the shared byte (fallback-default).
 */
export function effectiveL16VoutMode(state: AppState): EffectiveL16VoutMode {
  const byte = state.voutMode.byte
  if (analyzeVoutMode(byte).format === 0) {
    return { byte, source: 'linked' }
  }
  return { byte: DEFAULT_LINEAR_VOUT_MODE, source: 'fallback-default' }
}
