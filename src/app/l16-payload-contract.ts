import { analyzeVoutMode } from '../legacy/vout-mode'
import type { VidCodeKind } from '../legacy/vout-mode'
import type { Linear16PayloadKind } from './state'

/**
 * Exhaustive resolution of the "shared VOUT_MODE byte × LINEAR16 payload
 * kind" combination (PMBus Part II §8.4, §8.4.2, §8.5.3, §13.3 and §13.4).
 *
 * This is the single semantic source for the L16 page: view-model text,
 * input availability, result/formula/steps gating, warnings and the bit-grid
 * legend all consume the same resolution instead of re-deriving it.
 *
 * Key distinction (v2.5.3): a non-LINEAR VOUT_MODE byte is never computed
 * with LINEAR16 semantics (v2.5.2 fail-closed), but WHY differs per format
 * and payload:
 *
 * - VID is a SUPPORTED output-voltage data format (§8.4.2). It is not a
 *   globally prohibited format. Only without a selected VID code map or
 *   product profile can the page not map code ↔ voltage:
 *   `vid-profile-required`.
 * - The two's-complement offset commands VOUT_TRIM / VOUT_CAL_OFFSET are
 *   explicitly prohibited under VID by the spec itself: `vid-offset-prohibited`
 *   (§13.3 / §13.4 — devices must reject them).
 * - A relative byte combined with VID is an invalid combination byte-wide:
 *   `vid-relative-invalid` (§8.5.3 — the Relative option is not available
 *   when a VID format is used).
 * - DIRECT needs m/b/R coefficients (§7.4 / §8.4.3) that this page does not
 *   implement for output voltage: `direct-profile-required`.
 * - IEEE Half is legal for output voltage (§8.4.4) but this page only
 *   implements LINEAR16 interpretation: `half-unsupported-in-l16`.
 * - Everything else on a non-LINEAR byte (e.g. DIRECT/Half parameter ≠ 0)
 *   has no interpretation contract at all: `reserved-or-invalid`.
 */
export type L16FormatSemantics =
  | { status: 'linear-supported' }
  | {
      status: 'vid-profile-required'
      vidCodeKind: VidCodeKind
      /** Human label such as "1Eh — 制造商自定义（需器件资料）". */
      vidCodeLabel: string
    }
  | { status: 'vid-offset-prohibited' }
  | { status: 'vid-relative-invalid' }
  | { status: 'direct-profile-required' }
  | { status: 'half-unsupported-in-l16' }
  | { status: 'reserved-or-invalid'; reason: string }

export interface L16PayloadContext {
  byte: number
  source: 'linked' | 'non-linear'
  /** SLINEAR16 two's-complement offset payload (§13.3/§13.4 semantics). */
  signedOffset: boolean
  /** ULINEAR16 + relative LINEAR byte: dimensionless ratio semantics. */
  relativeRatio: boolean
  /** Physical-value entry and reverse encoding are available on this state. */
  physicalInputAvailable: boolean
  /** Nominal VOUT_COMMAND reference input applies to this state. */
  requiresNominalReference: boolean
  semantics: L16FormatSemantics
}

/**
 * Total, pure resolver over every VOUT_MODE byte × payload kind pair. For a
 * LINEAR shared byte it reproduces the historical payload-context behavior;
 * for any other format it fails closed and reports WHY, so UI copy can stay
 * spec-accurate without re-analyzing the byte in components or tests.
 */
export function resolveL16PayloadContext(
  byte: number,
  payloadKind: Linear16PayloadKind,
): L16PayloadContext {
  const analysis = analyzeVoutMode(byte)
  const signedOffset = payloadKind === 'slinear16-offset'

  if (analysis.format === 0) {
    return {
      byte,
      source: 'linked',
      signedOffset,
      relativeRatio: !signedOffset && analysis.isRelative,
      physicalInputAvailable: signedOffset || !analysis.isRelative,
      requiresNominalReference: !signedOffset && analysis.isRelative,
      semantics: { status: 'linear-supported' },
    }
  }

  // Non-LINEAR shared byte: fail closed on every numeric channel and name
  // the reason. Order matters — the byte-level verdict (§8.5.3 invalid
  // combination) precedes the payload-level one (§13.3/§13.4 prohibition),
  // which precedes the profile question raised by the VID code class.
  let semantics: L16FormatSemantics
  if (analysis.status === 'invalid-combination') {
    semantics = { status: 'vid-relative-invalid' }
  } else if (analysis.format === 1 && signedOffset) {
    semantics = { status: 'vid-offset-prohibited' }
  } else if (analysis.format === 1 && analysis.vidCode) {
    semantics = {
      status: 'vid-profile-required',
      vidCodeKind: analysis.vidCode.kind,
      vidCodeLabel: analysis.vidCode.label,
    }
  } else if (analysis.format === 2 && analysis.status === 'valid') {
    semantics = { status: 'direct-profile-required' }
  } else if (analysis.format === 3 && analysis.status === 'valid') {
    semantics = { status: 'half-unsupported-in-l16' }
  } else {
    semantics = { status: 'reserved-or-invalid', reason: analysis.reason }
  }

  return {
    byte,
    source: 'non-linear',
    signedOffset,
    relativeRatio: false,
    physicalInputAvailable: false,
    requiresNominalReference: false,
    semantics,
  }
}
