import type { AppState } from '../state'
import { formatByteHex } from './format'
import { resolveL11ValueText } from './l11'
import { resolveL16ValueText } from './l16'
import { resolveDirectValueText } from './direct'
import { resolveHalfValueText } from './half'

/**
 * Per-mode dispatch for the result card value text. Every mode projector
 * owns its own derivation; this wrapper only routes and keeps the shared
 * fail-closed catch (an unexpected throw renders '—', never a crash).
 */
export function computeValueText(state: AppState): string {
  try {
    switch (state.mode) {
      case 'L11':
        return resolveL11ValueText(state.raw)
      case 'L16':
        return resolveL16ValueText(state)
      case 'VOUT_MODE':
        return formatByteHex(state.voutMode.byte)
      case 'DIRECT':
        return resolveDirectValueText(state)
      case 'HALF':
        return resolveHalfValueText(state.raw)
      default:
        return '—'
    }
  } catch {
    return '—'
  }
}
