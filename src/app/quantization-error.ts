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
import { deriveL16Semantics } from './l16-derivation'
import {
  compareExact,
  decodeDirectExact,
  directEncodableRangeExact,
  divideExact,
  exactPercentScale,
  multiplyExact,
  parseDecimalExactRational,
  subtractExact,
  absExact,
  type ExactRational,
} from './direct-exact'

export type QuantizationStatus = 'exact' | 'quantized' | 'saturated' | 'overflow' | 'special'

/**
 * Exact rational truth for one DIRECT encoding transaction (v2.5.12). The
 * status and these fields come from the same lexeme the reducer encoded —
 * requested is parsed from the committed text, represented from the live raw
 * word — so provenance and diagnostics can no longer disagree with raw the
 * way the binary64 Number path did (e.g. a `100000000000000001` request
 * whose Number delta folds to 0).
 */
export interface DirectExactQuantization {
  /** The committed decimal lexeme — the same string the exact encoder used. */
  requestedText: string
  requested: ExactRational
  represented: ExactRational
  /** requested − represented (error direction: legacy contract). */
  absoluteError: ExactRational
  /** (requested − represented) / |requested| × 100; null for an exactly-zero request. */
  relativePercent: ExactRational | null
}

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
  /**
   * DIRECT only (v2.5.12): the exact rational verdict for the same
   * transaction. `status` is decided from THIS structure, never from the
   * Number fields, which stay approximate display values for compatibility.
   */
  directExact?: DirectExactQuantization
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
      // Payload semantics come first (Part II §13.3/§13.4): the signed
      // offset range applies to ANY LINEAR byte — bit7 does not participate.
      // Relative ULINEAR16 is a ratio: no bounded physical-value channel.
      // All of it is read from the canonical interpretation facts (ADR 0006).
      const { interpretation } = deriveL16Semantics(state)
      switch (interpretation.kind) {
        case 'signed-offset': {
          const p = PMBusMath.pow2(interpretation.n)
          return { min: -32768 * p, max: 32767 * p }
        }
        case 'absolute-unsigned': {
          const p = PMBusMath.pow2(interpretation.n)
          return { min: 0, max: 65535 * p }
        }
        default:
          return null
      }
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
        // The canonical interpretation facts decide everything (ADR 0006):
        // non-LINEAR fails closed; the SLINEAR16 offset payload is a
        // command-payload semantic (Part II §13.3/§13.4) whose bit7 does not
        // participate, so it takes precedence over a relative VOUT_MODE bit;
        // relative ULINEAR16 is a dimensionless ratio, not a decodable
        // physical voltage — no quantization error applies.
        const { interpretation } = deriveL16Semantics(state)
        switch (interpretation.kind) {
          case 'signed-offset':
          case 'absolute-unsigned':
            return interpretation.value
          default:
            return null
        }
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
 * Exact DIRECT resolution (v2.5.12). Null — fail closed, no fabricated
 * error — whenever the state is not a DIRECT request that can be resolved
 * exactly: m=0, no provenance, a lexeme that no longer parses, or an
 * undecodable raw word.
 */
function resolveDirectExactQuantization(state: AppState): DirectExactQuantization | null {
  if (state.mode !== 'DIRECT' || state.direct.m === 0) return null
  const r = state.valueRequest
  if (!r || r.mode !== 'DIRECT') return null
  const requested = parseDecimalExactRational(r.text)
  if (!requested) return null
  const y = PMBusMath.toSigned(state.raw, 16)
  const represented = decodeDirectExact(y, state.direct.m, state.direct.b, state.direct.r)
  if (!represented) return null
  const absoluteError = subtractExact(requested, represented)
  // Normalized rationals are zero exactly when the numerator is zero.
  const relativePercent =
    requested.numerator === 0n
      ? null
      : divideExact(multiplyExact(absoluteError, exactPercentScale()), absExact(requested))
  return { requestedText: r.text, requested, represented, absoluteError, relativePercent }
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

  // v2.5.12: DIRECT decides its status from the exact rational pipeline over
  // the committed lexeme and the live raw word. The Number fields below stay
  // approximate display values — the classification never consults them, so
  // a delta folded to 0 in binary64 can no longer masquerade as exact.
  if (state.mode === 'DIRECT') {
    const exact = resolveDirectExactQuantization(state)
    const range = directEncodableRangeExact(state.direct.m, state.direct.b, state.direct.r)
    if (!exact || !range) return null
    const saturated =
      compareExact(exact.requested, range.min) < 0 || compareExact(exact.requested, range.max) > 0
    const status = saturated
      ? 'saturated'
      : compareExact(exact.requested, exact.represented) === 0
        ? 'exact'
        : 'quantized'
    const absoluteError = requested - represented
    return {
      status,
      requested,
      represented,
      absoluteError,
      relativeError: requested === 0 ? null : (absoluteError / Math.abs(requested)) * 100,
      directExact: exact,
    }
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
