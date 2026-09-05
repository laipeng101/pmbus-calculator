import { analyzeVoutMode } from '../../legacy/vout-mode'
import { buildVoutModeExplanations } from '../vout-mode-explanation'
import { resolveVoutModeRequirement } from '../vout-mode-requirements'
import type { AppState } from '../state'
import type { VoutModeInfoVM, VoutModeBitVM, VoutModeNibbleVM, WarningVM } from './types'
import { byteDigits, formatByteHex } from './format'

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

export function buildVoutModeVM(byte: number, source?: 'linked' | 'non-linear'): VoutModeInfoVM {
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
 * Warnings describing the shared VOUT_MODE byte itself (relative-LINEAR
 * nominal note and the requirement-switch block), consumed by both the L16
 * page and the standalone VOUT_MODE page. The L16-only nonlinear /
 * offset-prohibition / ratio diagnostics live in the L16 projector.
 */
export function resolveVoutModeByteWarnings(state: AppState, byte: number): WarningVM[] {
  const a = analyzeVoutMode(byte)
  const hex = formatByteHex(byte)
  const signedOffset = state.mode === 'L16' && state.l16.payloadKind === 'slinear16-offset'

  if (a.format === 0 && a.isRelative) {
    // The nominal-reference note describes relative ULINEAR16 ratio
    // semantics only; the signed offset payload (§13.3/§13.4) ignores
    // bit7 and computes without a nominal.
    return [
      {
        id: 'vout-mode-relative',
        level: 'info',
        text: signedOffset
          ? `VOUT_MODE ${hex} 的 bit7 为相对值，但仅作用于 §8.5 相对阈值命令；当前 SLINEAR16 offset 是有符号命令 payload（§13.3/§13.4），bit7 不参与其数学，无需标称参考值。`
          : `VOUT_MODE ${hex} 为相对 LINEAR；需要 VOUT_COMMAND 标称参考值才能计算最终电压。`,
      },
    ]
  }

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
      return []
    case 'direct-absolute':
      // DIRECT genuinely needs device-specific m/b/R coefficients (§7.4/§8.4.3).
      return [
        {
          id: 'vout-mode-direct-profile',
          level: 'warning',
          text: `VOUT_MODE ${hex} 为 DIRECT 格式；需要器件 m/b/R 系数（来自 COEFFICIENTS 或器件资料）才能换算 word ↔ 物理值（Part II §7.4）。`,
        },
      ]
    case 'direct-relative':
      // Relative DIRECT needs BOTH the coefficients and the nominal
      // reference (§7.4 + §8.5.2) — stated in this one warning.
      return [
        {
          id: 'vout-mode-direct-profile',
          level: 'warning',
          text: `VOUT_MODE ${hex} 为相对 DIRECT 格式；需要器件 m/b/R 系数（来自 COEFFICIENTS 或器件资料）才能换算 word ↔ 物理值（Part II §7.4），相对阈值还需要 VOUT_COMMAND 标称参考值才能得到最终电压，且相对值必须为正（§8.5.2）。`,
        },
      ]
    case 'half-absolute':
      // IEEE Half is standard IEEE 754 binary16 (§7.6/§8.4.4): the word ↔
      // value conversion never depends on device numbers. Copy stays
      // positive — profile/系数 wording is banned for Half surfaces.
      return [
        {
          id: 'vout-mode-half-standard',
          level: 'warning',
          text: `VOUT_MODE ${hex} 为 IEEE Half 格式；payload 是标准 IEEE 754 binary16（Part II §7.6 / §8.4.4），word ↔ 数值换算不依赖器件数值，可在 HALF 模式页换算。`,
        },
      ]
    case 'half-relative':
      return [
        {
          id: 'vout-mode-half-standard',
          level: 'warning',
          text: `VOUT_MODE ${hex} 为相对 IEEE Half 格式；payload 是标准 IEEE 754 binary16（Part II §7.6 / §8.4.4），word ↔ 数值换算不依赖器件数值，但相对阈值需要 VOUT_COMMAND 标称参考值才能得到最终电压，且相对值必须为正（§8.5.2）。`,
        },
      ]
    case 'vid-relative-invalid':
      return [
        {
          id: 'vout-mode-invalid-combination',
          level: 'error',
          text: `VOUT_MODE ${hex} 为相对 + VID 非法组合（Part II §8.5.3：相对值不适用于 VID）。`,
        },
      ]
    case 'direct-or-half-param-invalid':
      return [
        {
          id: 'vout-mode-invalid-parameter',
          level: 'error',
          text: `VOUT_MODE ${hex} 的 ${a.formatName} 参数必须为 00000b（Part II §8.3 Table 2），当前参数 ${a.parameter} 非法。`,
        },
      ]
    case 'vid-not-used':
      return [
        {
          id: 'vout-mode-vid-not-used',
          level: 'warning',
          text: `VOUT_MODE ${hex} 的 VID code 00h 为未使用，不构成有效 VID profile。`,
        },
      ]
    case 'vid-reserved-listed': {
      // Table-3-listed reserved code (01h..04h / 10h..11h / 1Ch..1Dh):
      // provenance wording comes from the classifier single source and
      // must state the listing, never "unlisted" (v2.5.6).
      const codeHex = a.parameter.toString(16).toUpperCase().padStart(2, '0')
      const reason = a.vidCode?.reservedReason
      return [
        {
          id: 'vout-mode-vid-reserved',
          level: 'warning',
          text: reason
            ? `VOUT_MODE ${hex} 的 VID code ${codeHex}h 为保留值（Part II §8.4.2 Table 3 明列，${reason}）。`
            : `VOUT_MODE ${hex} 的 VID code ${codeHex}h 为保留值（Part II §8.4.2 Table 3 明列）。`,
        },
      ]
    }
    case 'vid-reserved-unlisted': {
      const codeHex = a.parameter.toString(16).toUpperCase().padStart(2, '0')
      return [
        {
          id: 'vout-mode-vid-reserved',
          level: 'warning',
          text: `VOUT_MODE ${hex} 的 VID code ${codeHex}h 为保留值（Part II §8.4.2 Table 3 未列出，保留供未来使用）。`,
        },
      ]
    }
    case 'vid-profile-required':
      return [
        {
          id: 'vout-mode-vid-profile',
          level: 'warning',
          text: `VOUT_MODE ${hex} 的 VID code 为制造商自定义（Part II §8.4.2 Table 3 明列，结构合法）；需要器件资料确定电压映射，当前计算器不可换算。`,
        },
      ]
  }
}
