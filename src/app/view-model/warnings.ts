import type { AppState } from '../state'
import type { DirectFidelityVM, WarningVM } from './types'
import { resolveL11SaturationWarning } from './l11'
import { resolveDirectFoldWarning } from './direct'
import { resolveL16NonlinearWarnings, resolveL16RelativeDiagnostics } from './l16'
import { resolveVoutModeByteWarnings } from './vout-mode'

/**
 * Warning/info/error aggregation for the InfoPanel. Mode-scoped policies
 * live in the mode projectors (L11 saturation, DIRECT fold, L16 nonlinear
 * and relative-ratio diagnostics, shared VOUT_MODE byte wording). This
 * function assembles the warnings in their display order.
 */
export function buildWarnings(
  state: AppState,
  directFidelity: DirectFidelityVM | null,
): WarningVM[] {
  const warnings: WarningVM[] = []
  // DIRECT coefficient errors (including m=0) live in state.direct.errors and
  // are rendered inline next to the corresponding input; the InfoPanel must
  // not announce the same error a second time.
  const l11Saturation = resolveL11SaturationWarning(state)
  if (l11Saturation) warnings.push(l11Saturation)

  if (directFidelity) warnings.push(resolveDirectFoldWarning(directFidelity))

  if (state.mode === 'L16' || state.mode === 'VOUT_MODE') {
    // Both modes show the shared VOUT_MODE byte card warnings; the byte is
    // the state truth itself (the L16 derivation layer consumes it unchanged).
    const byte = state.voutMode.byte
    // §8.4 fail-closed notice applies to EVERY non-LINEAR shared byte; the
    // format-specific warnings below (invalid-parameter / invalid-combination
    // stay at error level, VID code notes stay warnings) coexist with it.
    warnings.push(...resolveL16NonlinearWarnings(state))
    warnings.push(...resolveVoutModeByteWarnings(state, byte))
    // v2.5.9: derivation-range diagnostics come from the shared relative
    // classifier — same source as the result card, formula and steps.
    // v2.6.4: the §8.5.2 compliance answer also comes from that one
    // resolution — the committed ratio must be positive; R=0 stays an exact
    // mathematical zero but is flagged as non-compliant data. The signed
    // offset payload has no ratio semantics, and the overflow/underflow
    // branches already exclude a zero ratio by construction (a zero factor
    // can only produce a finite product).
    warnings.push(...resolveL16RelativeDiagnostics(state))
  }

  return warnings
}
