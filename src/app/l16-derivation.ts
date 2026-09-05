/**
 * Canonical L16 / VOUT semantic derivation — one typed facts source for
 * every presentation-facing consumer (result value text, formula
 * presentation, calculation steps, warnings, physical-value copy and the
 * quantization outcome's L16 branches).
 *
 * Before this module the same decision tree — is the shared byte LINEAR,
 * which payload math applies to the raw word, is the byte relative, is the
 * nominal reference missing, did the relative product overflow / underflow —
 * was re-derived independently in formula-presentation.ts,
 * calculation-steps.ts, view-model/l16.ts and quantization-error.ts. The
 * facts below encode those domain decisions ONCE (Part II §8.3/§8.4/§8.5,
 * §13.3/§13.4); consumers render their own surface from them and must not
 * reclassify the same state. Rendering text, KaTeX, labels and copy wording
 * stay in the consumers — this layer holds domain facts only (no JSX, no
 * formatting, no component layout).
 *
 * Layering (one-way, mirroring ADR 0005/0006):
 *   legacy/vout-mode + legacy/pmbus-math
 *     → vout-mode-selector / l16-payload-contract / relative-voltage
 *       → l16-derivation (this module, pure state → facts)
 *         → formula-presentation / calculation-steps / quantization-error /
 *           view-model/*
 */
import type { AppState, Linear16PayloadKind } from './state'
import { PMBusMath } from '../legacy/pmbus-math'
import { analyzeVoutMode, type VoutModeAnalysis } from '../legacy/vout-mode'
import { effectiveL16VoutMode } from './vout-mode-selector'
import { resolveL16PayloadContext, type L16PayloadContext } from './l16-payload-contract'
import { resolveRelativeVoltage, type RelativeVoltageResult } from './relative-voltage'

/**
 * What math the current raw word is subject to on the L16 page — the payload
 * × shared-byte interpretation, or why none applies. `non-linear` is the
 * §8.4 fail-closed state: the reason lives on `payloadContext.semantics`
 * (VID profile question, §13.3/§13.4 offset prohibition, DIRECT coefficients,
 * Half scope, reserved/invalid byte) and no numeric channel exists at all.
 */
export type L16RawInterpretation =
  | { kind: 'non-linear' }
  /**
   * §13.3/§13.4 two's-complement offset payload on ANY LINEAR byte: bit7 is
   * not part of its math. `value = Y_s × 2^N` from the canonical raw.
   */
  | { kind: 'signed-offset'; n: number; y: number; value: number }
  /**
   * §8.5 relative ULINEAR16: dimensionless ratio `R = Y_u × 2^N`; the final
   * voltage `X = V_NOM × R` is classified by the shared relative-voltage
   * source (`missing-reference` / finite / overflow / underflow), so a
   * missing vs zero vs non-finite nominal can never be conflated.
   */
  | {
      kind: 'relative-ratio'
      n: number
      ratio: number
      /** The committed VOUT_COMMAND nominal reference (null = not provided). */
      nominal: number | null
      finalVoltage: RelativeVoltageResult
    }
  /** §8.4.1 absolute ULINEAR16: `value = V × 2^N` from the canonical raw. */
  | { kind: 'absolute-unsigned'; n: number; value: number }

/** One canonical derivation of the L16 page's presentation-facing domain facts. */
export interface L16Semantics {
  /** Shared VOUT_MODE byte analysis — the byte truth every surface displays. */
  analysis: VoutModeAnalysis
  /**
   * `linked` when the LINEAR shared byte drives the page math; `non-linear`
   * fails closed (v2.5.2) with no implicit 0x18 substitution.
   */
  source: 'linked' | 'non-linear'
  payloadKind: Linear16PayloadKind
  /** Byte × payload discriminated contract (§8.4 family; v2.5.3). */
  payloadContext: L16PayloadContext
  /** How the canonical raw word is interpreted on this state. */
  interpretation: L16RawInterpretation
}

/**
 * Derive the L16/VOUT semantic facts for the current state. Total and pure:
 * one `effectiveL16VoutMode`, one `analyzeVoutMode`, one payload-contract
 * resolution and at most one payload decode per call. The interpretation
 * order reproduces the historical contract exactly — non-LINEAR fail-closed
 * first, then the signed-offset payload (bit7 not part of its math), then
 * relative ratio, then absolute unsigned.
 */
export function deriveL16Semantics(state: AppState): L16Semantics {
  const eff = effectiveL16VoutMode(state)
  const analysis = analyzeVoutMode(eff.byte)
  const payloadKind = state.l16.payloadKind
  const payloadContext = resolveL16PayloadContext(state.voutMode.byte, payloadKind)

  let interpretation: L16RawInterpretation
  if (eff.source === 'non-linear') {
    interpretation = { kind: 'non-linear' }
  } else if (payloadKind === 'slinear16-offset') {
    const n = analysis.linearExponent ?? 0
    const decoded = PMBusMath.decodeSlinear16(state.raw, n)
    interpretation = { kind: 'signed-offset', n, y: decoded.y, value: decoded.value }
  } else if (analysis.isRelative) {
    const n = analysis.linearExponent ?? 0
    const ratio = PMBusMath.decodeUlinear16(state.raw, n).value
    const nominal = state.l16.nominalVout
    interpretation = {
      kind: 'relative-ratio',
      n,
      ratio,
      nominal,
      finalVoltage: resolveRelativeVoltage(nominal, ratio),
    }
  } else {
    const n = analysis.linearExponent ?? 0
    interpretation = {
      kind: 'absolute-unsigned',
      n,
      value: PMBusMath.decodeUlinear16(state.raw, n).value,
    }
  }

  return {
    analysis,
    source: eff.source,
    payloadKind,
    payloadContext,
    interpretation,
  }
}
