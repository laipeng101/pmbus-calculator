/**
 * Format-encoding quantization outcome — domain layer shared by every mode
 * that accepts a physical-value encoding request (LINEAR11, LINEAR16,
 * DIRECT, IEEE Half).
 *
 * Semantics (docs/DOMAIN_MODEL.md §6):
 * - Error direction is `requested − represented` (legacy convention).
 * - The readout exists ONLY for an explicit, still-current encoding request
 *   (ValueInput commit). Without provenance the quantization error is
 *   unknown — this layer returns null and the UI must not fabricate a zero.
 * - Relative error requires a non-zero requested value and finite inputs;
 *   a zero denominator is undefined, not 0%.
 * - Severity follows the outcome class, never the sign and never a
 *   cross-format absolute threshold: PMBus device accuracy is a datasheet
 *   property (Part II §7.8/§7.9), so no universal 1e-5 cut exists.
 */
import type { AppState } from './state'
import { PMBusMath } from '../legacy/pmbus-math'
import { analyzeVoutMode } from '../legacy/vout-mode'
import { effectiveL16VoutMode } from './vout-mode-selector'

export type QuantizationStatus = 'exact' | 'quantized' | 'saturated' | 'overflow' | 'special'

/** Discriminated outcome of one explicit encoding request. */
export interface QuantizationOutcome {
  status: QuantizationStatus
  /** Committed physical-value request (never fabricated from represented). */
  requested: number
  /** Physical value the raw word decodes to. */
  represented: number
  /** requested − represented; null when either side is non-finite. */
  absoluteError: number | null
  /** Percent error; null for zero/−0 denominators or non-finite inputs. */
  relativeError: number | null
}

/**
 * Resolve the active encoding request for this page.
 *
 * L11 keeps its historical l11.valueInput channel; L16/DIRECT/HALF share the
 * mode-tagged state.valueRequest so switching pages can never cross-contaminate.
 * Returns null whenever no provenance exists — callers must treat the
 * quantization error as unknown, never as zero.
 */
function resolveRequested(state: AppState): number | null {
  switch (state.mode) {
    case 'L11':
      return Number.isFinite(state.l11.valueInput) ? state.l11.valueInput : null
    case 'L16':
    case 'DIRECT': {
      const r = state.valueRequest
      return r !== null && r.mode === state.mode && Number.isFinite(r.value) ? r.value : null
    }
    case 'HALF': {
      // HALF treats NaN and ±Infinity as first-class committed requests;
      // they classify as special outcomes instead of vanishing.
      const r2 = state.valueRequest
      return r2 !== null && r2.mode === 'HALF' ? r2.value : null
    }
    default:
      return null
  }
}

function rangeContains(value: number, min: number, max: number): boolean {
  return value >= min && value <= max
}

/**
 * Encodable range of the current page in physical units, or null when the
 * page has no bounded physical-value channel (HALF saturates via ±Infinity
 * instead, which the overflow status covers).
 */
function encodableRange(state: AppState): { min: number; max: number } | null {
  switch (state.mode) {
    case 'L11':
      // auto-N searches the full format (N=15 extremes); a locked N clamps
      // Y to -1024..1023 at that N (same contract as the saturation warning).
      return state.l11.autoN
        ? { min: PMBusMath.minLinear11(), max: PMBusMath.maxLinear11() }
        : PMBusMath.linear11RangeForN(state.l11.n)
    case 'L16': {
      // Fail closed on a non-LINEAR shared byte (v2.5.2, §8.4): no implicit
      // 0x18 channel, no bounded physical range to saturate against.
      const eff = effectiveL16VoutMode(state)
      if (eff.source === 'non-linear') return null
      // Payload semantics come first (Part II §13.3/§13.4): the signed
      // offset range applies to ANY LINEAR byte — bit7 does not participate.
      const a = analyzeVoutMode(eff.byte)
      if (a.format !== 0) return null
      const p = PMBusMath.pow2(a.linearExponent ?? 0)
      if (state.l16.payloadKind === 'slinear16-offset') {
        return { min: -32768 * p, max: 32767 * p }
      }
      // Relative ULINEAR16 is a ratio: no bounded physical-value channel.
      if (a.isRelative) return null
      return { min: 0, max: 65535 * p }
    }
    case 'DIRECT': {
      if (state.direct.m === 0) return null
      const lo = PMBusMath.decodeDirect(
        -32768,
        state.direct.m,
        state.direct.b,
        state.direct.r,
      ).value
      const hi = PMBusMath.decodeDirect(32767, state.direct.m, state.direct.b, state.direct.r).value
      if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null
      return { min: Math.min(lo, hi), max: Math.max(lo, hi) }
    }
    default:
      return null
  }
}

/**
 * Physical value currently represented by raw, or null when the page cannot
 * compute one (VOUT_MODE byte config, relative LINEAR16 ratio, DIRECT m=0).
 */
function computeRepresented(state: AppState): number | null {
  try {
    switch (state.mode) {
      case 'L11':
        return PMBusMath.decodeLinear11(state.raw).value
      case 'L16': {
        const eff = effectiveL16VoutMode(state)
        if (eff.source === 'non-linear') return null
        const a = analyzeVoutMode(eff.byte)
        if (a.format !== 0) return null
        const n = a.linearExponent ?? 0
        // SLINEAR16 offset is a command-payload semantic (Part II §13.3/
        // §13.4): bit7 does not participate in its math, so the payload kind
        // takes precedence over a relative VOUT_MODE bit — mirroring the
        // value-text and calculation-steps contracts.
        if (state.l16.payloadKind === 'slinear16-offset') {
          return PMBusMath.decodeSlinear16(state.raw, n).value
        }
        // Relative ULINEAR16 is a dimensionless ratio, not a decodable
        // physical voltage; no quantization error applies.
        if (a.isRelative) return null
        return PMBusMath.decodeUlinear16(state.raw, n).value
      }
      case 'DIRECT': {
        if (state.direct.m === 0) return null
        const y = PMBusMath.toSigned(state.raw, 16)
        return PMBusMath.decodeDirect(y, state.direct.m, state.direct.b, state.direct.r).value
      }
      case 'HALF':
        // Non-finite representations are first-class outcomes here: a finite
        // request that rounds to ±Infinity is an overflow the UI must show.
        return PMBusMath.decodeHalf(state.raw).value
      default:
        return null
    }
  } catch {
    return null
  }
}

/**
 * Quantization outcome for the visible page, or null when the panel and
 * steps must stay hidden:
 * - no explicit request provenance (error unknown, never fabricated zero);
 * - the page cannot decode a physical value at all.
 */
export function computeQuantizationOutcome(state: AppState): QuantizationOutcome | null {
  const represented = computeRepresented(state)
  if (represented === null) return null
  const requested = resolveRequested(state)
  if (requested === null) return null

  const requestedNonFinite = !Number.isFinite(requested)
  const representedNonFinite = !Number.isFinite(represented)

  // Special-value request (HALF-only): NaN or ±Infinity encodes to the same
  // class of special value; a numeric error is not applicable.
  if (requestedNonFinite) {
    return { status: 'special', requested, represented, absoluteError: null, relativeError: null }
  }

  // Finite request that rounds to ±Infinity is the most important encoding
  // failure to surface — never hide it.
  if (representedNonFinite) {
    return { status: 'overflow', requested, represented, absoluteError: null, relativeError: null }
  }

  const absoluteError = requested - represented
  // Zero (and −0) denominators make the relative error undefined.
  const relativeError = requested === 0 ? null : (absoluteError / Math.abs(requested)) * 100

  // Saturation: the encoder clamped the request to the encodable boundary.
  const range = encodableRange(state)
  if (range && !rangeContains(requested, range.min, range.max)) {
    return { status: 'saturated', requested, represented, absoluteError, relativeError }
  }

  return {
    status: absoluteError === 0 ? 'exact' : 'quantized',
    requested,
    represented,
    absoluteError,
    relativeError,
  }
}
