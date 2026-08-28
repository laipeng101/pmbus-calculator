/**
 * VOUT_MODE analyzer / composer — single domain source of truth for the
 * VOUT_MODE data byte (PMBus Part II §8.3, §8.4.2 and §8.5).
 *
 * Byte layout (Part II §8.3, Figure 6 / Table 2):
 *   bit7        = Absolute (0) / Relative (1)
 *   bits[6:5]   = format: 00b LINEAR, 01b VID, 10b DIRECT, 11b IEEE Half
 *   bits[4:0]   = parameter:
 *       LINEAR      -> 5-bit two's complement exponent N (-16..15)
 *       VID         -> 5-bit unsigned VID Code Type (Table 3)
 *       DIRECT      -> must be 00000b (Table 2)
 *       IEEE Half   -> must be 00000b (Table 2)
 *
 * Part II §8.5.3: the Relative option is not available when a VID format is
 * used. Relative + VID is therefore an invalid combination.
 *
 * The analyzer is total over every byte 0..255 and never throws; a non-byte
 * input (non-integer, NaN, ±Infinity, negative or >255) is reported as an
 * explicit `invalid-input` instead of being silently masked. The composer only
 * emits canonical bytes for the requested strategy and returns null for an
 * un-encodable request (for example relative + VID).
 */

export type VoutModeFormat = 0 | 1 | 2 | 3
export type VoutModeFormatName = 'LINEAR' | 'VID' | 'DIRECT' | 'IEEE Half'
/**
 * Machine distinction of the five §8.4.2 Table 3 provenance classes (v2.5.6):
 * `listed-reserved` codes ARE printed in Table 3 (Intel / AMD / future-use
 * rows) while `unlisted-reserved` codes are absent from it — both are
 * reserved and unusable as a generic voltage profile, but the reason text
 * shown to users must never conflate the two.
 */
export type VidCodeKind = 'not-used' | 'listed-reserved' | 'unlisted-reserved' | 'profile-required'
/** Which Table 3 row lists a listed-reserved code. */
export type VidReservedFamily = 'intel-future' | 'amd-future' | 'future-use'
export type VoutModeStatus =
  | 'valid'
  | 'invalid-combination'
  | 'invalid-parameter'
  | 'not-used'
  | 'reserved'
  | 'profile-required'
  | 'invalid-input'

export interface VidCodeInfo {
  /** Unsigned VID Code Type, 0..31. */
  code: number
  kind: VidCodeKind
  /** Present only for listed-reserved codes: which Table 3 row lists them. */
  reservedFamily?: VidReservedFamily
  /** Table 3 provenance sentence fragment, e.g. 留给未来 Intel 处理器. */
  reservedReason?: string
  /** Short, stable Chinese label (UI data; never a component judgement). */
  label: string
}

export interface VoutModeAnalysis {
  /** The decoded byte; NaN only for an `invalid-input` result. */
  byte: number
  /** bit7: true = relative, false = absolute. */
  isRelative: boolean
  /** bits[6:5] format code. */
  format: VoutModeFormat
  formatName: VoutModeFormatName
  /** Raw bits[4:0], 0..31. */
  parameter: number
  /** Signed 5-bit exponent; only meaningful for LINEAR, otherwise null. */
  linearExponent: number | null
  /** VID Code Type classification; present only for the VID format. */
  vidCode?: VidCodeInfo
  status: VoutModeStatus
  /** Machine-testable reason code. */
  reason: string
}

export const VOUT_MODE_FORMAT_NAMES: Record<VoutModeFormat, VoutModeFormatName> = {
  0: 'LINEAR',
  1: 'VID',
  2: 'DIRECT',
  3: 'IEEE Half',
}

/**
 * Fallback LINEAR VOUT_MODE used by the LINEAR16 page when the shared byte is
 * not LINEAR (Part II §8.3: bits[6:5] must be 00b for LINEAR16 semantics).
 *
 * 0x18 = absolute LINEAR, N = -8 (5-bit two's complement 0b11000).
 * This is the single definition; state initialization and the fallback selector
 * both consume it and no other copy exists.
 */
export const DEFAULT_LINEAR_VOUT_MODE = 0x18

function toSigned5(bits: number): number {
  return bits >= 16 ? bits - 32 : bits
}

function vidCodeKindLabel(code: number, info: Omit<VidCodeInfo, 'label'>): string {
  const hex = code.toString(16).toUpperCase().padStart(2, '0')
  if (info.kind === 'not-used') return hex + 'h — 未使用'
  if (info.kind === 'profile-required') return hex + 'h — 制造商自定义（需器件资料）'
  if (info.kind === 'listed-reserved')
    return hex + 'h — 保留（Table 3 明列，' + info.reservedReason + '）'
  return hex + 'h — 保留（Table 3 未列出，保留供未来使用）'
}

/**
 * Classify an unsigned VID Code Type per Part II §8.4.2 Table 3 (v2.5.6
 * provenance split): 00h Not Used; 01h..04h reserved for a future Intel
 * processor generation; 10h..11h reserved for a future AMD processor
 * generation; 1Ch..1Dh reserved for future use; 1Eh/1Fh PMBus device
 * manufacturer specific. Every other code is NOT listed in Table 3 and
 * reserved for future use.
 */
export function classifyVidCode(code: number): VidCodeInfo {
  if (code === 0x00) {
    return { code, kind: 'not-used', label: vidCodeKindLabel(code, { code, kind: 'not-used' }) }
  }
  if (code === 0x1e || code === 0x1f) {
    return {
      code,
      kind: 'profile-required',
      label: vidCodeKindLabel(code, { code, kind: 'profile-required' }),
    }
  }
  if (code >= 0x01 && code <= 0x04) {
    const info = {
      code,
      kind: 'listed-reserved',
      reservedFamily: 'intel-future',
      reservedReason: '留给未来 Intel 处理器',
    } as const
    return { ...info, label: vidCodeKindLabel(code, info) }
  }
  if (code >= 0x10 && code <= 0x11) {
    const info = {
      code,
      kind: 'listed-reserved',
      reservedFamily: 'amd-future',
      reservedReason: '留给未来 AMD 处理器',
    } as const
    return { ...info, label: vidCodeKindLabel(code, info) }
  }
  if (code >= 0x1c && code <= 0x1d) {
    const info = {
      code,
      kind: 'listed-reserved',
      reservedFamily: 'future-use',
      reservedReason: '留作未来使用',
    } as const
    return { ...info, label: vidCodeKindLabel(code, info) }
  }
  return {
    code,
    kind: 'unlisted-reserved',
    label: vidCodeKindLabel(code, { code, kind: 'unlisted-reserved' }),
  }
}

/** Full 5-bit VID code lookup (0..31) for structured UI options. */
export const VID_CODE_TABLE: readonly VidCodeInfo[] = Array.from({ length: 32 }, (_, code) =>
  classifyVidCode(code),
)

/**
 * Total VOUT_MODE decoder over the full byte space.
 *
 * - LINEAR: any parameter is a valid two's complement exponent; absolute or
 *   relative both legal.
 * - VID: parameter is an unsigned code; absolute codes are classified as
 *   not-used / reserved / profile-required. Relative VID is invalid per §8.5.3.
 * - DIRECT / IEEE Half: parameter must be 00000b; non-zero is invalid-parameter.
 */
export function analyzeVoutMode(byte: number): VoutModeAnalysis {
  if (!Number.isInteger(byte) || !Number.isFinite(byte) || byte < 0 || byte > 255) {
    return {
      byte: Number.isFinite(byte) ? byte : Number.NaN,
      isRelative: false,
      format: 0,
      formatName: 'LINEAR',
      parameter: 0,
      linearExponent: null,
      status: 'invalid-input',
      reason: 'input-not-a-byte',
    }
  }

  const isRelative = (byte & 0x80) !== 0
  const format = ((byte >> 5) & 0x03) as VoutModeFormat
  const parameter = byte & 0x1f
  const formatName = VOUT_MODE_FORMAT_NAMES[format]
  const linearExponent = format === 0 ? toSigned5(parameter) : null

  let status: VoutModeStatus
  let reason: string
  let vidCode: VidCodeInfo | undefined

  if (format === 1) {
    if (isRelative) {
      status = 'invalid-combination'
      reason = 'relative-vid'
    } else {
      vidCode = classifyVidCode(parameter)
      // Coarse status keeps the historical verdict vocabulary; the listed vs
      // unlisted provenance lives on vidCode.kind and the requirement
      // discriminator (v2.5.6).
      status =
        vidCode.kind === 'profile-required'
          ? 'profile-required'
          : vidCode.kind === 'not-used'
            ? 'not-used'
            : 'reserved'
      reason = 'absolute-vid-' + vidCode.kind
    }
  } else if ((format === 2 || format === 3) && parameter !== 0) {
    status = 'invalid-parameter'
    reason = format === 2 ? 'direct-param-nonzero' : 'half-param-nonzero'
  } else {
    status = 'valid'
    reason = isRelative
      ? format === 0
        ? 'relative-linear'
        : format === 2
          ? 'relative-direct'
          : 'relative-half'
      : format === 0
        ? 'absolute-linear'
        : format === 2
          ? 'absolute-direct'
          : 'absolute-half'
  }

  return {
    byte,
    isRelative,
    format,
    formatName,
    parameter,
    linearExponent,
    ...(vidCode ? { vidCode } : {}),
    status,
    reason,
  }
}

export interface VoutModeComposeInput {
  relative: boolean
  format: VoutModeFormat
  /**
   * Raw bits[4:0] (0..31). LINEAR interprets it as the two's complement
   * exponent; VID as the unsigned code; DIRECT / IEEE Half ignore it (forced 0).
   */
  parameter: number
}

/**
 * Canonical structured encoder. Returns null for an un-encodable request
 * (invalid format/parameter or the relative + VID combination). It never
 * silently truncates a non-byte parameter.
 */
export function composeVoutMode(input: VoutModeComposeInput): number | null {
  const { relative, format, parameter } = input
  if (!Number.isInteger(format) || format < 0 || format > 3) return null
  if (!Number.isInteger(parameter) || parameter < 0 || parameter > 31) return null
  if (format === 1 && relative) return null

  const bit7 = relative ? 0x80 : 0
  const mode = (format & 0x03) << 5
  const param = format === 2 || format === 3 ? 0 : parameter & 0x1f
  return bit7 | mode | param
}
