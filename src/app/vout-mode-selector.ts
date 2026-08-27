import type { AppState } from './state'
import { analyzeVoutMode } from '../legacy/vout-mode'

export interface EffectiveL16VoutMode {
  /**
   * The shared VOUT_MODE byte. When `source` is 'linked' this byte drives the
   * L16 page math; when 'non-linear' the byte is displayed as-is and every
   * compute/encode path must fail closed (Part II §8.4).
   */
  byte: number
  source: 'linked' | 'non-linear'
}

/**
 * Single pure selector for the VOUT_MODE byte that actually drives the L16
 * page.
 *
 * - Shared byte LINEAR (bits[6:5] = 00b): used directly, including its bit7
 *   and N (linked).
 * - Anything else: `source: 'non-linear'`. The page must NOT substitute
 *   `DEFAULT_LINEAR_VOUT_MODE` behind the user's back — output-voltage-related
 *   commands take their data format from the current VOUT_MODE (Part II
 *   §8.4), so computing against 0x18 would fabricate values for VID / DIRECT
 *   / IEEE Half configurations. Recovering the LINEAR16 editor requires the
 *   explicit `l16/apply-default-vout-mode` action, which really writes 0x18
 *   into the shared byte (and invalidates stale provenance).
 */
export function effectiveL16VoutMode(state: AppState): EffectiveL16VoutMode {
  const byte = state.voutMode.byte
  if (analyzeVoutMode(byte).format === 0) {
    return { byte, source: 'linked' }
  }
  return { byte, source: 'non-linear' }
}
