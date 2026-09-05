import type { AppMode } from '../state'
import type { VoutModeFormat, VoutModeStatus, VidCodeKind } from '../../legacy/vout-mode'
import type { FormulaDetailLine } from '../formula-presentation'
import type { CalculationStepVM } from '../calculation-steps'
import type { HalfSpecialSemantics } from '../half-special-semantics'
import type { L16FormatSemantics } from '../l16-payload-contract'
import type { VoutModeExplanation } from '../vout-mode-explanation'

export interface BitGroupVM {
  nibbleIndex: number
  hex: string
  bits: Array<{ index: number; value: number; label?: string }>
}

export type L16BlockedStatus = Exclude<L16FormatSemantics['status'], 'linear-supported'>

/**
 * Fail-closed card content for a shared VOUT_MODE byte the L16 page cannot
 * interpret with LINEAR16 semantics. `status` is machine-checkable and
 * exhaustively switches over the payload contract (§8.4 / §8.4.2 / §8.5.3 /
 * §13.3 / §13.4); title/detailLines carry the spec-accurate reason.
 */
export interface L16BlockVM {
  status: L16BlockedStatus
  title: string
  detailLines: readonly string[]
}

/** L16 payload-context contract: UI entry decided by payload, not byte status. */
export interface L16PayloadContextVM {
  kind: 'ulinear16' | 'slinear16-offset'
  /** Signed command payload (§13.3/§13.4) — bit7 not part of its math. */
  signedOffset: boolean
  /** ULINEAR16 + relative byte: dimensionless ratio semantics. */
  relativeRatio: boolean
  /** Shared VOUT_MODE is not LINEAR: the page fails closed (§8.4, v2.5.2). */
  nonLinear: boolean
  /** Format name of the non-LINEAR shared byte (VID / DIRECT / IEEE Half). */
  nonLinearFormat?: string
  /**
   * Present ONLY when the word cannot be interpreted with LINEAR16
   * semantics on this page state; absent for every active LINEAR state.
   * VID legality vs prohibition is encoded by the machine status
   * (`vid-profile-required` is legal-but-profile-missing, NOT prohibited),
   * so no component re-derives spec claims from booleans.
   */
  blocked?: L16BlockVM
  /** Physical-value input and reverse encoding are available on this page. */
  physicalInputAvailable: boolean
  /** Nominal VOUT_COMMAND reference input applies to this page state. */
  requiresNominalReference: boolean
}

/**
 * DIRECT precision-fidelity contract (v2.5.11). Present ONLY when the
 * current raw's exact §7.4 decode needs more precision than binary64
 * carries, so the displayed physical value is an approximation whose direct
 * re-entry would encode a different payload. Derived from the live raw word
 * and coefficients on every render — never stored, never stale. Safe states
 * leave it undefined (no noise for ordinary DIRECT vectors).
 */
export interface DirectFidelityVM {
  /** Exact decoded value: "n/d" fraction, or a plain integer for d=1. */
  exactFractionText: string
  /** Exact terminating decimal text, or null for a repeating rational. */
  exactDecimalText: string | null
  /** The binary64 approximation the result card displays. */
  approxValueText: string
  /** Y the repository's Math.round contract assigns to the approximation. */
  reencodedY: number
  /**
   * Decimal string whose re-entry provably returns to the original Y
   * (verified through the independent exact encoder), or null when no
   * verified string exists within the deterministic bound — the copy must
   * then degrade instead of handing out an unverified string.
   */
  safeReentryText: string | null
}

export interface WarningVM {
  id: string
  level: 'info' | 'warning' | 'error'
  text: string
}

export interface VoutModeBitVM {
  index: number
  value: number
  /** Chinese-primary semantic label (bit7 = 绝对值/相对值, [6:5] = 格式, [4:0] = 参数). */
  semantic: string
}

export interface VoutModeNibbleVM {
  nibbleIndex: number
  hex: string
  bits: VoutModeBitVM[]
}

export interface VoutModeInfoVM {
  byte: number
  hex: string
  hexDigits: string
  modeName: string
  formatName: string
  linearExponent: number | null
  isLinear: boolean
  isRelative: boolean
  /** Format bits [6:5] per Part II §8.3. */
  mode: number
  format: VoutModeFormat
  /** Parameter bits [4:0]. */
  param: number
  parameter: number
  /** Whether the LINEAR16 page may compute an absolute voltage. */
  status: 'ok' | 'reference-required' | 'unsupported'
  /** Domain validity classification (M37). */
  domainStatus: VoutModeStatus
  /** Machine-testable reason code. */
  reason: string
  /** VID code classification, present only for the VID format. */
  vidCodeKind?: VidCodeKind
  /** Short UI classification text derived from the domain analysis. */
  statusText: string
  /** 8-bit binary rendering of the byte. */
  binary: string
  /** True only when the byte is a structurally legal PMBus VOUT_MODE
   *  configuration (v2.5.5: 1Eh/1Fh manufacturer-specific VID included —
   *  legal but not calculable here); sourced from the shared requirement. */
  structureLegal: boolean
  /** True when word ↔ value needs external device data (m/b/R or VID table). */
  requiresExternalData: boolean
  /** True only when the current calculator can produce a value for the byte. */
  calculable: boolean
  source?: 'linked' | 'non-linear'
  explanations: VoutModeExplanation[]
  nibbles: VoutModeNibbleVM[]
}

export interface CalculatorViewModel {
  mode: AppMode
  valueText: string
  valueLabel: string
  /**
   * The main Raw Word hex ('0x' + 4 digits) — always the canonical numeric
   * raw word in every mode (v3.0.0). Identical to rawWordHex.
   */
  rawHex: string
  /** Digit-only raw hex (no 0x prefix) for fixed-prefix inputs. */
  rawHexDigits: string
  /** Canonical unsigned 16-bit raw word, never byte-swapped for display. */
  rawWordHex: string
  /**
   * SMBus / PMBus wire bytes, low byte first (SMBus 3.0 §6.5.4/§6.5.5:
   * word data moves low byte first). Serialization only — derived from the
   * canonical raw word and never re-entering raw identity.
   */
  wireBytes: string
  /**
   * MSB-first (high byte first) byte representation of the same raw word —
   * a display/export alternative, NOT another wire order.
   */
  msbFirstBytes: string
  cMacroText: string
  formulaText: string
  formulaLatex: string
  formulaGenericLatex: string
  formulaDetailLines: FormulaDetailLine[]
  /** Unified calculation steps (fields -> formula -> intermediates -> result). */
  steps: CalculationStepVM[]
  deltaText?: string
  deltaKind?: 'ok' | 'warn' | 'error'
  /** Provenance/severity context for the readout (saturation, rounding…). */
  deltaNote?: string
  warnings: WarningVM[]
  bitGroups: BitGroupVM[]
  commandNote?: string
  nRangeText?: string
  /**
   * Present ONLY when the 物理值 copy must be disabled (v2.5.9): a relative
   * ULINEAR16 derivation range error (overflow / nonzero-factor underflow)
   * has no copyable physical value. Undefined means the copy stays enabled;
   * Raw Word / wire-byte copies are never affected.
   */
  physicalValueCopy?: { available: false; reason: string }
  /**
   * DIRECT only, present ONLY when the displayed physical value is a
   * precision-folded approximation (v2.5.11): the 物理值 copy must hand out
   * the verified safe re-entry text instead of the approximation, with an
   * explanatory note. The Raw Word / wire-byte / C-macro copies are unaffected.
   */
  physicalValueCopyOverride?: { text: string; note: string }
  /**
   * DIRECT fidelity contract (v2.5.11): present only when the displayed
   * value cannot be safely re-entered because the exact decode exceeds
   * binary64 precision. Undefined for every safe state.
   */
  directFidelity?: DirectFidelityVM
  /**
   * L16 only: payload-context contract (v2.5.1). Byte-level VOUT_MODE
   * status alone cannot decide UI entry — the signed offset payload
   * (Part II §13.3/§13.4) ignores bit7, while relative ULINEAR16 is a
   * ratio that needs a nominal reference and has no reverse encode.
   */
  l16Payload?: L16PayloadContextVM
  voutModeInfo?: VoutModeInfoVM
  voutModePage?: VoutModeInfoVM
  /** DIRECT mode: signed Y derived from raw via toSigned(raw, 16). */
  directY?: number
  /**
   * HALF only, and only for NaN / ±Infinity raw words: the PMBus §7.6.2
   * send/read operational semantics card content. Finite values never
   * expose it (v2.5.5).
   */
  halfSpecial?: HalfSpecialSemantics
  visible: {
    voutMode: boolean
    directCoefficients: boolean
    halfNote: boolean
    nRange: boolean
    byteCalculator: boolean
  }
}
