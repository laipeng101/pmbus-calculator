import { useMemo } from 'react'
import type { AppState, AppMode } from './state'
import { PMBusMath } from '../legacy/pmbus-math'
import { analyzeVoutMode } from '../legacy/vout-mode'
import type { VoutModeFormat, VoutModeStatus, VidCodeKind } from '../legacy/vout-mode'
import { getCommandConfig } from '../legacy/command-metadata'
import { buildCMacro } from './copy-utils'
import { getFormulaPresentation } from './formula-presentation'
import type { FormulaDetailLine } from './formula-presentation'
import { buildCalculationSteps } from './calculation-steps'
import type { CalculationStepVM } from './calculation-steps'
import { computeQuantizationOutcome } from './quantization-error'
import type { QuantizationOutcome } from './quantization-error'
import { buildVoutModeExplanations } from './vout-mode-explanation'
import type { VoutModeExplanation } from './vout-mode-explanation'
import { resolveVoutModeRequirement } from './vout-mode-requirements'
import { resolveHalfSpecialSemantics } from './half-special-semantics'
import type { HalfSpecialSemantics } from './half-special-semantics'
import { effectiveL16VoutMode } from './vout-mode-selector'
import { resolveL16PayloadContext } from './l16-payload-contract'
import type { L16FormatSemantics } from './l16-payload-contract'
import {
  resolveRelativeVoltage,
  RELATIVE_VOLTAGE_OVERFLOW_NOTE,
  RELATIVE_VOLTAGE_UNDERFLOW_NOTE,
} from './relative-voltage'
import type { RelativeVoltageResult } from './relative-voltage'
import {
  analyzeDirectRoundTrip,
  formatExactDecimal,
  formatExactDelta,
  formatExactPercent,
  formatExactRational,
  generateSafeDirectReentryText,
} from './direct-exact'

export interface BitGroupVM {
  nibbleIndex: number
  hex: string
  bits: Array<{ index: number; value: number; label?: string }>
}

type L16BlockedStatus = Exclude<L16FormatSemantics['status'], 'linear-supported'>

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
  rawHex: string
  /** Digit-only raw hex (no 0x prefix) for fixed-prefix inputs. */
  rawHexDigits: string
  /** Internal 16-bit raw word, never byte-swapped for display. */
  rawWordHex: string
  rawBytesLE: string
  rawBytesBE: string
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
   * raw Hex / LE / BE copies are never affected.
   */
  physicalValueCopy?: { available: false; reason: string }
  /**
   * DIRECT only, present ONLY when the displayed physical value is a
   * precision-folded approximation (v2.5.11): the 物理值 copy must hand out
   * the verified safe re-entry text instead of the approximation, with an
   * explanatory note. The raw Hex / LE / BE / C-macro copies are unaffected.
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

function formatRawHex(raw: number): string {
  return '0x' + (raw & 0xffff).toString(16).toUpperCase().padStart(4, '0')
}

function formatByteHex(byte: number): string {
  return '0x' + (byte & 0xff).toString(16).toUpperCase().padStart(2, '0')
}

function byteDigits(byte: number): string {
  return (byte & 0xff).toString(16).toUpperCase().padStart(2, '0')
}

/** Number formatting mirroring legacy formatNumber (12 significant digits). */
function formatNumber(v: number): string {
  if (Object.is(v, -0)) return '-0'
  if (Number.isInteger(v)) return v.toString()
  return parseFloat(v.toPrecision(12)).toString()
}

function toBytesLE(raw: number): [number, number] {
  return [raw & 0xff, (raw >> 8) & 0xff]
}

function toBytesBE(raw: number): [number, number] {
  return [(raw >> 8) & 0xff, raw & 0xff]
}

function formatBytes(bytes: number[], opts: { prefix0x?: boolean; space?: boolean } = {}): string {
  const { prefix0x = true, space = true } = opts
  const parts = bytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0'))
  let result = space ? parts.join(' ') : parts.join('')
  if (prefix0x) result = '0x ' + result
  return result
}

function buildBitGroups(raw: number): BitGroupVM[] {
  const groups: BitGroupVM[] = []
  for (let nib = 0; nib < 4; nib++) {
    const nibbleValue = (raw >> (12 - nib * 4)) & 0xf
    const bits = []
    for (let b = 0; b < 4; b++) {
      const bitIndex = 15 - (nib * 4 + b)
      bits.push({ index: bitIndex, value: (raw >> bitIndex) & 1 })
    }
    groups.push({
      nibbleIndex: nib,
      hex: nibbleValue.toString(16).toUpperCase(),
      bits,
    })
  }
  return groups
}

/**
 * Short status line per VOUT_MODE verdict, derived from the shared
 * requirement source (v2.5.4). DIRECT keeps the device m/b/R wording
 * (Part II §7.4); IEEE Half is standard binary16 — its status never claims
 * a device profile (§7.6 / §8.4.4); a relative byte keeps the nominal
 * reference wording (§8.5.2).
 */
function voutModeStatusText(byte: number): string {
  const a = analyzeVoutMode(byte)
  const req = resolveVoutModeRequirement(a)
  switch (req.id) {
    case 'linear-absolute':
      return '绝对 LINEAR'
    case 'linear-relative':
      return '相对 LINEAR（需参考值）'
    case 'direct-absolute':
      return '绝对 DIRECT（需 m/b/R 系数）'
    case 'direct-relative':
      return '相对 DIRECT（需系数与参考值）'
    case 'half-absolute':
      return 'IEEE Half（标准 binary16）'
    case 'half-relative':
      return '相对 IEEE Half（需参考值）'
    case 'vid-relative-invalid':
      return '相对 VID — 非法组合（§8.5.3）'
    case 'direct-or-half-param-invalid':
      return a.formatName + ' 参数必须为 0（§8.3 Table 2）'
    case 'vid-not-used':
      return 'VID code 00h — 未使用'
    case 'vid-reserved-listed': {
      // Table 3 provenance text comes from the classifier single source; a
      // listed-reserved code must never be described as unlisted (v2.5.6).
      const a = analyzeVoutMode(byte)
      const reason = a.vidCode?.reservedReason
      return reason ? `VID code 保留（Table 3 明列，${reason}）` : 'VID code 保留（Table 3 明列）'
    }
    case 'vid-reserved-unlisted':
      return 'VID code 保留（Table 3 未列出，保留供未来使用）'
    case 'vid-profile-required':
      return 'VID code 制造商自定义（需器件资料）'
    case 'invalid-input':
      return '无效 VOUT_MODE'
  }
}

function buildVoutModeNibbles(byte: number): VoutModeNibbleVM[] {
  const semantic = (index: number): string => {
    if (index === 7) return '绝对值/相对值'
    if (index === 5 || index === 6) return '格式'
    return '参数'
  }

  const highBits: VoutModeBitVM[] = []
  for (const index of [7, 6, 5, 4]) {
    highBits.push({
      index,
      value: (byte >> index) & 1,
      semantic: semantic(index),
    })
  }
  const lowBits: VoutModeBitVM[] = []
  for (const index of [3, 2, 1, 0]) {
    lowBits.push({
      index,
      value: (byte >> index) & 1,
      semantic: semantic(index),
    })
  }
  return [
    { nibbleIndex: 0, hex: ((byte >> 4) & 0xf).toString(16).toUpperCase(), bits: highBits },
    { nibbleIndex: 1, hex: (byte & 0xf).toString(16).toUpperCase(), bits: lowBits },
  ]
}

function buildVoutModeVM(byte: number, source?: 'linked' | 'non-linear'): VoutModeInfoVM {
  const a = analyzeVoutMode(byte)
  // Single spec source (v2.5.5): structural legality and the external-data
  // question come from the shared requirement discriminator, never from
  // raw `format`/`status` switches. 1Eh/1Fh are Table-3-listed
  // manufacturer-specific codes: structurally legal, not calculable here.
  const req = resolveVoutModeRequirement(a)
  const isLinear = a.format === 0
  const status: VoutModeInfoVM['status'] = !isLinear
    ? 'unsupported'
    : a.isRelative
      ? 'reference-required'
      : 'ok'

  const explanations = buildVoutModeExplanations(a)
  if (source === 'non-linear') {
    explanations.unshift({
      id: 'l16-nonlinear',
      severity: 'warning',
      title: '共享 VOUT_MODE 非 LINEAR，本页不可计算',
      detail:
        '输出电压相关命令的数据格式由当前 VOUT_MODE 决定（Part II §8.4）；' +
        'LINEAR16 页不隐式替换字节。显式应用计算器 LINEAR 示例 0x18（absolute、N=-8）后才恢复计算。',
      specRef: 'Part II §8.3 / §8.4',
    })
  }

  return {
    byte,
    hex: formatByteHex(byte),
    hexDigits: byteDigits(byte),
    modeName: a.formatName,
    formatName: a.formatName,
    linearExponent: a.linearExponent,
    isLinear,
    isRelative: a.isRelative,
    mode: a.format,
    format: a.format,
    param: a.parameter,
    parameter: a.parameter,
    status,
    domainStatus: a.status,
    reason: a.reason,
    ...(a.vidCode ? { vidCodeKind: a.vidCode.kind } : {}),
    statusText: voutModeStatusText(byte),
    binary: (byte & 0xff).toString(2).padStart(8, '0'),
    structureLegal: req.structureLegal,
    requiresExternalData: req.requiresDeviceCoefficients || req.requiresVidProfile,
    calculable: isLinear && a.isRelative === false,
    ...(source ? { source } : {}),
    explanations,
    nibbles: buildVoutModeNibbles(byte),
  }
}

/**
 * Spec-accurate reason text per payload-contract status (v2.5.3). VID is
 * never described as a globally prohibited format: §8.4.2 supports it, only
 * VOUT_TRIM / VOUT_CAL_OFFSET are prohibited under VID (§13.3/§13.4) and a
 * relative byte × VID is invalid outright (§8.5.3).
 */
function buildL16BlockVM(
  semantics: L16FormatSemantics,
  byteHex: string,
  formatName: string,
): L16BlockVM {
  switch (semantics.status) {
    case 'linear-supported':
      throw new Error('linear-supported states have no blocked card')
    case 'vid-profile-required': {
      const detailLines = [
        'VID 是规范支持的输出电压数据格式（Part II §8.4.2），不是被禁止的数据格式。当前页面未选定任何 VID 表或产品 profile，无法在 VID 码与物理电压之间换算，也不允许借用 LINEAR16 指数 N 计算。',
      ]
      if (semantics.vidCodeKind === 'profile-required') {
        detailLines.push(
          `${byteHex} 的 VID code 为制造商自定义；码表与电压映射必须来自器件资料，本页不提供。`,
        )
      }
      return {
        status: semantics.status,
        title: `VOUT_MODE ${byteHex} 为 VID 格式（${semantics.vidCodeLabel}）`,
        detailLines,
      }
    }
    case 'vid-offset-prohibited':
      return {
        status: semantics.status,
        title: `VOUT_MODE ${byteHex} 为 VID 格式：二补码偏移命令被禁止`,
        detailLines: [
          '当前解释类型 SLINEAR16（二补码偏移）对应 VOUT_TRIM / VOUT_CAL_OFFSET 的命令语义；这两类命令在 VID 输出电压格式下被规范明确禁止（Part II §13.3 / §13.4），器件必须拒绝。该命令组合被禁止，本页不生成 word。',
          '禁止范围仅限这两条二补码偏移命令：VID 本身对其他输出电压相关命令（如 VOUT_COMMAND）是合法数据格式（Part II §8.4.2）。',
        ],
      }
    case 'vid-relative-invalid':
      return {
        status: semantics.status,
        title: `VOUT_MODE ${byteHex} 为相对 + VID 非法组合`,
        detailLines: [
          '相对数据格式不适用于 VID（Part II §8.5.3），该 VOUT_MODE 字节组合本身无效。本页不生成 word，也不显示相对比值结果。',
        ],
      }
    case 'direct-profile-required':
      return {
        status: semantics.status,
        title: `VOUT_MODE ${byteHex} 为 DIRECT 格式`,
        detailLines: [
          'DIRECT 需要 m / b / R 系数（来自 COEFFICIENTS 或器件资料）才能建立 word 与物理量的映射（Part II §7.4 / §8.4.3）。LINEAR16 页未实现 DIRECT 输出电压解释：不猜测系数，也不借用 LINEAR16 指数 N。本页不生成 word。',
        ],
      }
    case 'half-unsupported-in-l16':
      return {
        status: semantics.status,
        title: `VOUT_MODE ${byteHex} 为 ${formatName} 格式`,
        detailLines: [
          'IEEE Half 是合法的输出电压数据格式（Part II §8.4.4），但本页只实现 LINEAR16 解释：不做 Half 解码/编码，也不借用 LINEAR16 指数 N（HALF 模式页可做该格式的数学换算）。本页不生成 word。',
        ],
      }
    case 'reserved-or-invalid':
      return {
        status: semantics.status,
        title: `VOUT_MODE ${byteHex} 无有效解释合同`,
        detailLines: [
          `按 Part II §8.3 Table 2，${formatName} 模式的参数位必须为 00000b；当前字节为保留/非法配置（原因：${semantics.reason}），无任何输出电压解释合同。本页不生成 word。`,
        ],
      }
  }
}

/**
 * Shared relative-ULINEAR16 resolution (v2.5.9, extended v2.6.4): null for
 * every state that is not "relative ULINEAR16 with a LINEAR shared byte".
 * The result card, warnings and the physical-value copy answer the
 * overflow/underflow question from `result`, and the §8.5.2 relative-value
 * compliance question from the same single decoded `ratio` (the spec requires
 * the relative value to be positive, so a committed R=0 is non-compliant
 * data — the math itself stays an exact zero).
 */
function resolveL16Relative(
  state: AppState,
): { result: RelativeVoltageResult; ratio: number } | null {
  if (state.mode !== 'L16') return null
  const eff = effectiveL16VoutMode(state)
  if (eff.source === 'non-linear') return null
  const a = analyzeVoutMode(eff.byte)
  if (a.format !== 0 || !a.isRelative) return null
  if (state.l16.payloadKind !== 'ulinear16') return null
  const ratio = PMBusMath.decodeUlinear16(state.raw, a.linearExponent ?? 0).value
  return { result: resolveRelativeVoltage(state.l16.nominalVout, ratio), ratio }
}

function resolveL16RelativeResult(state: AppState): RelativeVoltageResult | null {
  return resolveL16Relative(state)?.result ?? null
}

/**
 * Shared note for the quantization readout in a precision-folded DIRECT
 * state (v2.5.11): the binary64 delta can honestly be zero while the
 * displayed value still cannot be re-entered safely.
 */
const DIRECT_PRECISION_FOLD_DELTA_NOTE =
  '当前 raw 的显示值为 binary64 近似（精度折叠），直接回输会编码为不同的 raw；「物理值」复制使用经验证的精确回录文本'

/**
 * DIRECT precision-fidelity resolution (v2.5.11): null for every state that
 * is not "DIRECT with m ≠ 0 whose exact decode precision-folds in binary64".
 * Single source for the warning, the quantization note, the exact-value
 * steps and the copy override — every surface answers the same fidelity
 * question from this resolution, derived from the live raw word and
 * coefficients so it can never go stale.
 */
function resolveDirectFidelity(state: AppState): DirectFidelityVM | null {
  if (state.mode !== 'DIRECT' || state.direct.m === 0) return null
  const y = PMBusMath.toSigned(state.raw, 16)
  const analysis = analyzeDirectRoundTrip(y, state.direct.m, state.direct.b, state.direct.r)
  if (!analysis || analysis.roundTripSafe) return null
  const safeReentryText = generateSafeDirectReentryText(
    analysis.exact,
    y,
    state.direct.m,
    state.direct.b,
    state.direct.r,
  )
  return {
    exactFractionText: formatExactRational(analysis.exact),
    exactDecimalText: formatExactDecimal(analysis.exact),
    approxValueText: formatNumber(analysis.approxValue),
    reencodedY: analysis.reencodedY,
    safeReentryText,
  }
}

function computeValueText(state: AppState): string {
  try {
    switch (state.mode) {
      case 'L11': {
        const r = PMBusMath.decodeLinear11(state.raw)
        return formatNumber(r.value)
      }
      case 'L16': {
        const eff = effectiveL16VoutMode(state)
        // Fail closed on a non-LINEAR shared byte (v2.5.2, §8.4): no value is
        // derived from an implicit 0x18 substitution.
        if (eff.source === 'non-linear') return '—'
        const a = analyzeVoutMode(eff.byte)
        const n = a.linearExponent ?? 0
        if (state.l16.payloadKind === 'slinear16-offset') {
          return formatNumber(PMBusMath.decodeSlinear16(state.raw, n).value)
        }
        if (a.isRelative) {
          // v2.5.9: the derivation is classified — overflow / nonzero-factor
          // underflow show '—' instead of a fabricated Infinity / 0 result.
          const result = resolveRelativeVoltage(
            state.l16.nominalVout,
            PMBusMath.decodeUlinear16(state.raw, n).value,
          )
          if (result.kind !== 'finite') return '—'
          return formatNumber(result.value)
        }
        return formatNumber(PMBusMath.decodeUlinear16(state.raw, n).value)
      }
      case 'VOUT_MODE':
        return formatByteHex(state.voutMode.byte)
      case 'DIRECT': {
        const y = PMBusMath.toSigned(state.raw, 16)
        const r = PMBusMath.decodeDirect(y, state.direct.m, state.direct.b, state.direct.r)
        return Number.isNaN(r.value) ? '—' : formatNumber(r.value)
      }
      case 'HALF': {
        const r = PMBusMath.decodeHalf(state.raw)
        if (Number.isNaN(r.value)) return 'NaN'
        if (!Number.isFinite(r.value)) return r.value > 0 ? '+Infinity' : '-Infinity'
        return formatNumber(r.value)
      }
      default:
        return '—'
    }
  } catch {
    return '—'
  }
}

function buildWarnings(state: AppState): WarningVM[] {
  const warnings: WarningVM[] = []
  // DIRECT coefficient errors (including m=0) live in state.direct.errors and
  // are rendered inline next to the corresponding input; the InfoPanel must
  // not announce the same error a second time.
  if (
    state.mode === 'L11' &&
    state.l11.valueInput != null &&
    Number.isFinite(state.l11.valueInput)
  ) {
    const requested = state.l11.valueInput
    // Saturation range depends on the encoding mode: auto-N searches the full
    // format (N=15 extremes); a locked N clamps Y to -1024..1023 at that N.
    const { min, max } = state.l11.autoN
      ? { min: PMBusMath.minLinear11(), max: PMBusMath.maxLinear11() }
      : PMBusMath.linear11RangeForN(state.l11.n)
    if (requested > max || requested < min) {
      warnings.push({
        id: 'l11-saturation',
        level: 'warning',
        text: `输入值超出 LINEAR11 可表示范围（${formatNumber(min)} ~ ${formatNumber(max)}），编码器已饱和到极值；量化误差见误差面板。`,
      })
    }
  }

  if (state.mode === 'DIRECT' && state.direct.m !== 0) {
    // v2.5.11: a precision-folded decode must be marked before any re-entry
    // — the displayed value is an approximation and directly re-entering it
    // encodes a different payload (a different request, not a same-value
    // no-op). The field-level m/b/R errors stay in state.direct.errors.
    const fidelity = resolveDirectFidelity(state)
    if (fidelity) {
      const exactText = fidelity.exactDecimalText ?? fidelity.exactFractionText
      warnings.push({
        id: 'direct-precision-fold',
        level: 'warning',
        text: `当前 raw 的精确物理值是 ${exactText}，超出 binary64 物理值的表示精度；显示值 ${fidelity.approxValueText} 是近似值，直接回输会按仓库舍入合同编码为 Y=${fidelity.reencodedY}——这是一个不同的请求，raw 会随之改变。「物理值」复制提供经精确编码验证、可安全回录的文本；直接编辑 raw 或 Y 始终是保留位级真值的权威路径。`,
      })
    }
  }

  if (state.mode === 'L16' || state.mode === 'VOUT_MODE') {
    const eff =
      state.mode === 'L16'
        ? effectiveL16VoutMode(state)
        : { byte: state.voutMode.byte, source: undefined }
    const byte = eff.byte
    const a = analyzeVoutMode(byte)
    const hex = formatByteHex(byte)

    // §8.4 fail-closed notice applies to EVERY non-LINEAR shared byte; the
    // format-specific warnings below (invalid-parameter / invalid-combination
    // stay at error level, VID code notes stay warnings) coexist with it.
    if (state.mode === 'L16' && eff.source === 'non-linear') {
      warnings.push({
        id: 'l16-vout-mode-nonlinear',
        level: 'warning',
        text: `当前共享 VOUT_MODE ${formatByteHex(state.voutMode.byte)} 为 ${a.formatName}；输出电压相关命令的数据格式由当前 VOUT_MODE 决定（Part II §8.4），LINEAR16 页不隐式替换字节。显式应用计算器 LINEAR 示例 0x18（absolute、N=-8）后才恢复计算。0x18 是本计算器的示例值，不是 PMBus 规范默认值，也不代表真实器件一定接受 VOUT_MODE 写入。`,
      })
      // The offset-command prohibition is a spec-level error (§13.3/§13.4:
      // devices must reject VOUT_TRIM / VOUT_CAL_OFFSET under VID), so it is
      // announced at error level — distinct from the profile questions above.
      if (
        resolveL16PayloadContext(state.voutMode.byte, state.l16.payloadKind).semantics.status ===
        'vid-offset-prohibited'
      ) {
        warnings.push({
          id: 'vout-mode-vid-offset-prohibited',
          level: 'error',
          text: `SLINEAR16 偏移 payload 对应 VOUT_TRIM / VOUT_CAL_OFFSET，这两类命令在 VID 输出电压格式下被规范禁止（Part II §13.3 / §13.4）；本页不生成 word。`,
        })
      }
    }

    if (a.format === 0 && a.isRelative) {
      // The nominal-reference note describes relative ULINEAR16 ratio
      // semantics only; the signed offset payload (§13.3/§13.4) ignores
      // bit7 and computes without a nominal.
      const signedOffset = state.mode === 'L16' && state.l16.payloadKind === 'slinear16-offset'
      warnings.push({
        id: 'vout-mode-relative',
        level: 'info',
        text: signedOffset
          ? `VOUT_MODE ${hex} 的 bit7 为相对值，但仅作用于 §8.5 相对阈值命令；当前 SLINEAR16 offset 是有符号命令 payload（§13.3/§13.4），bit7 不参与其数学，无需标称参考值。`
          : `VOUT_MODE ${hex} 为相对 LINEAR；需要 VOUT_COMMAND 标称参考值才能计算最终电压。`,
      })
      // v2.5.9: derivation-range diagnostics come from the shared relative
      // classifier — same source as the result card, formula and steps.
      // v2.6.4: the §8.5.2 compliance answer also comes from that one
      // resolution — the committed ratio must be positive; R=0 stays an exact
      // mathematical zero but is flagged as non-compliant data. The signed
      // offset payload has no ratio semantics (checked above), and the
      // overflow/underflow branches already exclude a zero ratio by
      // construction (a zero factor can only produce a finite product).
      const relative = resolveL16Relative(state)
      if (relative?.result.kind === 'overflow') {
        warnings.push({
          id: 'l16-relative-overflow',
          level: 'warning',
          text: `${RELATIVE_VOLTAGE_OVERFLOW_NOTE}；最终电压显示为 —，标称值与比值仍按输入显示，原始 Hex/LE/BE 复制不受影响。`,
        })
      } else if (relative?.result.kind === 'underflow') {
        warnings.push({
          id: 'l16-relative-underflow',
          level: 'warning',
          text: `${RELATIVE_VOLTAGE_UNDERFLOW_NOTE}；最终电压显示为 —，标称值与比值仍按输入显示，原始 Hex/LE/BE 复制不受影响。`,
        })
      } else if (relative?.ratio === 0) {
        warnings.push({
          id: 'l16-relative-zero-ratio',
          level: 'warning',
          text: `当前 relative ULINEAR16 解码比值 R = 0（raw ${formatByteHex(state.raw)}，Y_u = 0）；Part II §8.5.2 要求相对值恒为正，该提交标记为非符合性。R = 0 是数学精确结果，不是派生下溢或饱和。`,
        })
      }
    } else {
      // v2.5.5: every remaining branch is selected by the shared requirement
      // discriminator — no surface re-derives spec conclusions from format
      // numbers or status strings. Field details (hex, code) still come from
      // the analysis.
      const req = resolveVoutModeRequirement(a)
      switch (req.id) {
        // Relative LINEAR (incl. the SLINEAR16-offset nuance) is handled
        // above; absolute LINEAR and non-byte inputs carry no warning.
        case 'linear-absolute':
        case 'linear-relative':
        case 'invalid-input':
          break
        case 'direct-absolute':
          // DIRECT genuinely needs device-specific m/b/R coefficients (§7.4/§8.4.3).
          warnings.push({
            id: 'vout-mode-direct-profile',
            level: 'warning',
            text: `VOUT_MODE ${hex} 为 DIRECT 格式；需要器件 m/b/R 系数（来自 COEFFICIENTS 或器件资料）才能换算 word ↔ 物理值（Part II §7.4）。`,
          })
          break
        case 'direct-relative':
          // Relative DIRECT needs BOTH the coefficients and the nominal
          // reference (§7.4 + §8.5.2) — stated in this one warning.
          warnings.push({
            id: 'vout-mode-direct-profile',
            level: 'warning',
            text: `VOUT_MODE ${hex} 为相对 DIRECT 格式；需要器件 m/b/R 系数（来自 COEFFICIENTS 或器件资料）才能换算 word ↔ 物理值（Part II §7.4），相对阈值还需要 VOUT_COMMAND 标称参考值才能得到最终电压（§8.5.2）。`,
          })
          break
        case 'half-absolute':
          // IEEE Half is standard IEEE 754 binary16 (§7.6/§8.4.4): the word ↔
          // value conversion never depends on device numbers. Copy stays
          // positive — profile/系数 wording is banned for Half surfaces.
          warnings.push({
            id: 'vout-mode-half-standard',
            level: 'warning',
            text: `VOUT_MODE ${hex} 为 IEEE Half 格式；payload 是标准 IEEE 754 binary16（Part II §7.6 / §8.4.4），word ↔ 数值换算不依赖器件数值，可在 HALF 模式页换算。`,
          })
          break
        case 'half-relative':
          warnings.push({
            id: 'vout-mode-half-standard',
            level: 'warning',
            text: `VOUT_MODE ${hex} 为相对 IEEE Half 格式；payload 是标准 IEEE 754 binary16（Part II §7.6 / §8.4.4），word ↔ 数值换算不依赖器件数值，但相对阈值需要 VOUT_COMMAND 标称参考值才能得到最终电压（§8.5.2）。`,
          })
          break
        case 'vid-relative-invalid':
          warnings.push({
            id: 'vout-mode-invalid-combination',
            level: 'error',
            text: `VOUT_MODE ${hex} 为相对 + VID 非法组合（Part II §8.5.3：相对值不适用于 VID）。`,
          })
          break
        case 'direct-or-half-param-invalid':
          warnings.push({
            id: 'vout-mode-invalid-parameter',
            level: 'error',
            text: `VOUT_MODE ${hex} 的 ${a.formatName} 参数必须为 00000b（Part II §8.3 Table 2），当前参数 ${a.parameter} 非法。`,
          })
          break
        case 'vid-not-used':
          warnings.push({
            id: 'vout-mode-vid-not-used',
            level: 'warning',
            text: `VOUT_MODE ${hex} 的 VID code 00h 为未使用，不构成有效 VID profile。`,
          })
          break
        case 'vid-reserved-listed': {
          // Table-3-listed reserved code (01h..04h / 10h..11h / 1Ch..1Dh):
          // provenance wording comes from the classifier single source and
          // must state the listing, never "unlisted" (v2.5.6).
          const codeHex = a.parameter.toString(16).toUpperCase().padStart(2, '0')
          const reason = a.vidCode?.reservedReason
          warnings.push({
            id: 'vout-mode-vid-reserved',
            level: 'warning',
            text: reason
              ? `VOUT_MODE ${hex} 的 VID code ${codeHex}h 为保留值（Part II §8.4.2 Table 3 明列，${reason}）。`
              : `VOUT_MODE ${hex} 的 VID code ${codeHex}h 为保留值（Part II §8.4.2 Table 3 明列）。`,
          })
          break
        }
        case 'vid-reserved-unlisted': {
          const codeHex = a.parameter.toString(16).toUpperCase().padStart(2, '0')
          warnings.push({
            id: 'vout-mode-vid-reserved',
            level: 'warning',
            text: `VOUT_MODE ${hex} 的 VID code ${codeHex}h 为保留值（Part II §8.4.2 Table 3 未列出，保留供未来使用）。`,
          })
          break
        }
        case 'vid-profile-required':
          warnings.push({
            id: 'vout-mode-vid-profile',
            level: 'warning',
            text: `VOUT_MODE ${hex} 的 VID code 为制造商自定义（Part II §8.4.2 Table 3 明列，结构合法）；需要器件资料确定电压映射，当前计算器不可换算。`,
          })
          break
      }
    }
  }

  if (state.commandKey) {
    const cmd = getCommandConfig(state.commandKey)
    if (cmd?.note) {
      warnings.push({ id: 'cmd-note', level: 'info', text: cmd.note })
    }
    if (cmd?.encodingRule === 'device_defined') {
      warnings.push({
        id: 'cmd-device-defined',
        level: 'info',
        text: `${cmd.label} 需要器件数据手册确定数据格式；选择命令不会自动应用参数。`,
      })
    }
    if (cmd?.encodingRule === 'follows_vout_mode') {
      warnings.push({
        id: 'cmd-follows-vout-mode',
        level: 'info',
        text: `${cmd.label} 的数据格式跟随 VOUT_MODE；选择命令不会自动应用参数。`,
      })
    }
  }
  return warnings
}

function getValueLabel(mode: AppMode): string {
  return mode === 'VOUT_MODE' ? 'VOUT_MODE 字节' : '物理值'
}

/**
 * Signed error rendering. Readable fixed 6-decimals for |x| >= 1e-6 (legacy
 * look), adaptive significant digits below it — any non-zero error must
 * never render as textual zero.
 */
function formatSignedError(value: number): string {
  if (value === 0) return '+0.000000'
  const body = Math.abs(value) >= 1e-6 ? value.toFixed(6) : formatNumber(value)
  return `${value > 0 ? '+' : ''}${body}`
}

function formatSpecial(value: number): string {
  if (Number.isNaN(value)) return 'NaN'
  if (value > 0) return '+Infinity'
  if (value < 0) return '-Infinity'
  return Object.is(value, -0) ? '-0' : '+0'
}

/**
 * Present one quantization outcome for the shared readout panel.
 *
 * Severity follows the outcome class only — exact/neutral, quantized/
 * informational, saturated or overflowing/error — with no cross-format
 * absolute threshold: PMBus device accuracy is a datasheet property
 * (Part II §7.8/§7.9), so no universal cut-off is implied.
 *
 * v2.5.12: DIRECT renders the exact rational verdict when one exists — the
 * binary64 Number fields cannot distinguish a folded delta from a real
 * zero, and a non-zero exact error must never display as 0.
 */
function presentQuantizationOutcome(outcome: QuantizationOutcome): {
  kind: 'ok' | 'warn' | 'error'
  text: string
  note?: string
} {
  if (outcome.directExact) {
    const exact = outcome.directExact
    const delta = formatExactDelta(exact.absoluteError)
    switch (outcome.status) {
      case 'exact':
        return { kind: 'ok', text: `+0.000000 (${formatExactPercent(exact.relativePercent)})` }
      case 'quantized':
        return {
          kind: 'warn',
          text: `${delta}（约 ${formatExactPercent(exact.relativePercent)}）`,
        }
      case 'saturated':
        return {
          kind: 'error',
          text: `${delta}（已编码到边界值）`,
          note: '请求值超出当前系数下的精确可表示范围，编码器已饱和',
        }
      // overflow / special are unreachable for a DIRECT exact transaction;
      // they fall through to the generic presentation below.
      default:
        break
    }
  }
  switch (outcome.status) {
    case 'exact': {
      const percent = outcome.relativeError === null ? '—' : `${outcome.relativeError.toFixed(4)}%`
      return { kind: 'ok', text: `+0.000000 (${percent})` }
    }
    case 'quantized': {
      const percent = outcome.relativeError === null ? '—' : `${outcome.relativeError.toFixed(4)}%`
      return {
        kind: 'warn',
        text: `${formatSignedError(outcome.absoluteError ?? 0)} (${percent})`,
      }
    }
    case 'saturated':
      return {
        kind: 'error',
        text: `${formatSignedError(outcome.absoluteError ?? 0)}（已编码到边界值）`,
        note: '请求值超出当前指数下的可表示范围，编码器已饱和',
      }
    case 'overflow':
      return {
        kind: 'error',
        text: `${formatNumber(outcome.requested)} → ${formatSpecial(outcome.represented)}`,
        note: '有限值编码溢出（IEEE 754 binary16 范围 ±65504）',
      }
    case 'special':
      return {
        kind: 'warn',
        text: `${formatSpecial(outcome.requested)} → ${formatSpecial(outcome.represented)}`,
        note: '特殊值（NaN / ±Infinity）：量化误差不适用',
      }
  }
}

export function toCalculatorViewModel(state: AppState): CalculatorViewModel {
  const raw = state.raw & 0xffff
  const le = toBytesLE(raw)
  const be = toBytesBE(raw)

  const decodedL11 = state.mode === 'L11' ? PMBusMath.decodeLinear11(raw) : null

  // Format-encoding quantization readout — shared by L11/L16/DIRECT/HALF via
  // the domain layer. Hidden entirely without an explicit request provenance
  // (error unknown, never fabricated zero); hidden for pages that cannot
  // decode a physical value (VOUT_MODE, relative LINEAR16, DIRECT m=0).
  let deltaText: string | undefined
  let deltaKind: 'ok' | 'warn' | 'error' | undefined
  let deltaNote: string | undefined
  // v2.5.11: DIRECT precision fidelity is resolved once and consumed by the
  // quantization readout, the copy override and the VM field alike.
  const directFidelity = resolveDirectFidelity(state)
  // Displayed physical value — also the reference for whether the committed
  // request lexeme is already fully visible to the user.
  const valueText = computeValueText(state)
  {
    const outcome = computeQuantizationOutcome(state)
    if (outcome) {
      const presented = presentQuantizationOutcome(outcome)
      deltaKind = presented.kind
      deltaText = presented.text
      const notes: string[] = []
      if (presented.note) notes.push(presented.note)
      // v2.5.12: the panel keeps the committed exact request and the exact
      // represented value side by side whenever the displayed value cannot
      // show the request as-is (folded approximation, normalized display…).
      // A request that already IS the displayed value stays noise-free.
      if (outcome.directExact && valueText !== outcome.directExact.requestedText) {
        const e = outcome.directExact
        const representedText =
          formatExactDecimal(e.represented) ?? formatExactRational(e.represented)
        notes.push(`用户请求 ${e.requestedText}；raw 精确表示 ${representedText}`)
      }
      if (directFidelity) {
        // The binary64 delta may honestly be zero, but a folded display must
        // never read as a clean exact result: flag it as a warning and name
        // the re-entry consequence.
        deltaKind = 'warn'
        notes.push(DIRECT_PRECISION_FOLD_DELTA_NOTE)
      }
      if (notes.length > 0) deltaNote = notes.join('；')
    }
  }

  let nRangeText: string | undefined
  if (decodedL11) {
    const p = PMBusMath.pow2(decodedL11.n)
    nRangeText = `${formatNumber(-1024 * p)} ~ ${formatNumber(1023 * p)}`
  } else if (state.mode === 'L16') {
    // Payload semantics first: the signed offset range applies to ANY
    // LINEAR byte (bit7 not part of its math); absolute ULINEAR16 keeps the
    // unsigned range; relative ULINEAR16 is a ratio with no voltage range.
    const eff = effectiveL16VoutMode(state)
    const a = analyzeVoutMode(eff.byte)
    if (a.format === 0 && state.l16.payloadKind === 'slinear16-offset') {
      const p = PMBusMath.pow2(a.linearExponent ?? 0)
      nRangeText = `${formatNumber(-32768 * p)} ~ ${formatNumber(32767 * p)}`
    } else if (a.format === 0 && a.isRelative === false) {
      const p = PMBusMath.pow2(a.linearExponent ?? 0)
      nRangeText = '0 ~ ' + formatNumber(65535 * p)
    }
  }

  let l16Payload: L16PayloadContextVM | undefined
  if (state.mode === 'L16') {
    // Single semantic resolution of byte × payload (v2.5.3): the shared
    // byte is analyzed as-is — never a substituted 0x18 (v2.5.2) — and the
    // discriminated contract decides input availability, blocked copy and
    // profile questions for every non-LINEAR format.
    const ctx = resolveL16PayloadContext(state.voutMode.byte, state.l16.payloadKind)
    const nonLinear = ctx.source === 'non-linear'
    const a = analyzeVoutMode(ctx.byte)
    l16Payload = {
      kind: state.l16.payloadKind,
      signedOffset: ctx.signedOffset,
      relativeRatio: ctx.relativeRatio,
      nonLinear,
      ...(nonLinear ? { nonLinearFormat: a.formatName } : {}),
      ...(ctx.semantics.status !== 'linear-supported'
        ? { blocked: buildL16BlockVM(ctx.semantics, formatByteHex(ctx.byte), a.formatName) }
        : {}),
      physicalInputAvailable: ctx.physicalInputAvailable,
      requiresNominalReference: ctx.requiresNominalReference,
    }
  }

  let voutModeInfo: VoutModeInfoVM | undefined
  let voutModePage: VoutModeInfoVM | undefined
  if (state.mode === 'L16') {
    const eff = effectiveL16VoutMode(state)
    voutModeInfo = buildVoutModeVM(eff.byte, eff.source)
    if (state.l16.payloadKind === 'slinear16-offset') {
      voutModeInfo.explanations.unshift({
        id: 'slinear16-bit7-na',
        severity: 'info',
        title: 'bit7 对本 payload 不适用',
        detail:
          'SLINEAR16 offset 使用 16 位二补码 payload，bit7 只作用于 §8.5 的 8 个输出电压相关命令，不参与 X_offset = Y_s × 2^N；选择 offset 语义不会把公式切成“有符号比例”。',
        specRef: 'Part II §13.3 / §13.4 / §8.5',
      })
    }
  } else if (state.mode === 'VOUT_MODE') {
    voutModePage = buildVoutModeVM(state.voutMode.byte)
    voutModeInfo = voutModePage
  }

  const displayedRaw =
    state.mode === 'L16' && state.byteOrder === 'be' ? PMBusMath.swapBytes(raw) : raw
  const formula = getFormulaPresentation(state)
  const formulaText = formula.plainText

  const rawHex =
    state.mode === 'VOUT_MODE' ? formatByteHex(state.voutMode.byte) : formatRawHex(displayedRaw)
  const rawHexDigits =
    state.mode === 'VOUT_MODE'
      ? byteDigits(state.voutMode.byte)
      : (displayedRaw & 0xffff).toString(16).toUpperCase().padStart(4, '0')

  // HALF §7.6.2 special-value semantics: derived from the current raw word so
  // BOTH user paths (raw Hex edit and physical-value encode) surface the same
  // notice; it can never go stale because it is never stored in state.
  let halfSpecial: HalfSpecialSemantics | undefined
  if (state.mode === 'HALF') {
    const semantics = resolveHalfSpecialSemantics(PMBusMath.decodeHalf(raw).value)
    if (semantics.presentable) halfSpecial = semantics
  }

  // v2.5.9: a relative-derivation range error disables the 物理值 copy with
  // an accessible reason; every other state keeps the copy enabled.
  let physicalValueCopyUnavailability: { available: false; reason: string } | undefined
  const relativeResult = resolveL16RelativeResult(state)
  if (relativeResult?.kind === 'overflow') {
    physicalValueCopyUnavailability = {
      available: false,
      reason: `物理值复制不可用：${RELATIVE_VOLTAGE_OVERFLOW_NOTE}。原始 Hex/LE/BE 复制仍可用。`,
    }
  } else if (relativeResult?.kind === 'underflow') {
    physicalValueCopyUnavailability = {
      available: false,
      reason: `物理值复制不可用：${RELATIVE_VOLTAGE_UNDERFLOW_NOTE}。原始 Hex/LE/BE 复制仍可用。`,
    }
  }

  // v2.5.11: a precision-folded DIRECT decode swaps the 物理值 copy payload
  // for the verified safe re-entry text; when no verified text exists the
  // copy degrades to disabled instead of handing out the approximation.
  let physicalValueCopyOverride: { text: string; note: string } | undefined
  if (directFidelity) {
    if (directFidelity.safeReentryText !== null) {
      physicalValueCopyOverride = {
        text: directFidelity.safeReentryText,
        note: `物理值复制返回经验证可安全回录的精确文本 ${directFidelity.safeReentryText}（回输后回到当前 raw）；显示值 ${directFidelity.approxValueText} 是精度折叠的近似。`,
      }
    } else {
      physicalValueCopyUnavailability = {
        available: false,
        reason: `物理值复制不可用：显示值 ${directFidelity.approxValueText} 是精度折叠的近似，且当前无法生成经验证的精确回录文本。请使用 raw/LE/BE 复制，或直接编辑 raw / Y 保留位级真值。`,
      }
    }
  }

  return {
    mode: state.mode,
    steps: buildCalculationSteps(state),
    valueText,
    valueLabel: getValueLabel(state.mode),
    rawHex,
    rawHexDigits,
    rawWordHex: state.mode === 'VOUT_MODE' ? formatByteHex(state.voutMode.byte) : formatRawHex(raw),
    rawBytesLE: formatBytes(le, {
      prefix0x: state.copy.prefix0x,
      space: state.copy.spaceBetweenBytes,
    }),
    rawBytesBE: formatBytes(be, {
      prefix0x: state.copy.prefix0x,
      space: state.copy.spaceBetweenBytes,
    }),
    cMacroText: buildCMacro(state.commandKey, formatRawHex(raw), formulaText),
    formulaText,
    formulaLatex: formula.latex,
    formulaGenericLatex: formula.genericLatex,
    formulaDetailLines: formula.detailLines,
    deltaText,
    deltaKind,
    deltaNote,
    warnings: buildWarnings(state),
    bitGroups: buildBitGroups(raw),
    directY: state.mode === 'DIRECT' ? PMBusMath.toSigned(raw, 16) : undefined,
    commandNote: getCommandConfig(state.commandKey)?.note,
    nRangeText,
    l16Payload,
    physicalValueCopy: physicalValueCopyUnavailability,
    physicalValueCopyOverride,
    directFidelity: directFidelity ?? undefined,
    voutModeInfo,
    voutModePage,
    halfSpecial,
    visible: {
      voutMode: state.mode === 'L16',
      directCoefficients: state.mode === 'DIRECT',
      halfNote: state.mode === 'HALF',
      nRange: state.mode === 'L11' || state.mode === 'L16',
      byteCalculator: state.mode === 'VOUT_MODE',
    },
  }
}

/** React hook wrapper for useMemo */
export function useCalculatorViewModel(state: AppState): CalculatorViewModel {
  return useMemo(() => toCalculatorViewModel(state), [state])
}
