import { useMemo } from 'react'
import type { AppState, AppMode } from './state'
import { PMBusMath } from '../legacy/pmbus-math'
import { analyzeVoutMode } from '../legacy/vout-mode'
import type { VoutModeFormat, VoutModeStatus } from '../legacy/vout-mode'
import { getCommandConfig } from '../legacy/command-metadata'
import { buildCMacro } from './copy-utils'
import { getFormulaPresentation } from './formula-presentation'
import type { FormulaDetailLine } from './formula-presentation'
import { buildCalculationSteps } from './calculation-steps'
import type { CalculationStepVM } from './calculation-steps'
import { buildVoutModeExplanations } from './vout-mode-explanation'
import type { VoutModeExplanation } from './vout-mode-explanation'
import { effectiveL16VoutMode } from './vout-mode-selector'

export interface BitGroupVM {
  nibbleIndex: number
  hex: string
  bits: Array<{ index: number; value: number; label?: string }>
}

export interface WarningVM {
  id: string
  level: 'info' | 'warning' | 'error'
  text: string
}

export interface VoutModeBitVM {
  index: number
  value: number
  region: 'ar' | 'format' | 'parameter'
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
  vidCodeKind?: 'not-used' | 'reserved' | 'profile-required'
  /** Short UI classification text derived from the domain analysis. */
  statusText: string
  /** 8-bit binary rendering of the byte. */
  binary: string
  /** True only when the byte is a legal PMBus VOUT_MODE configuration. */
  structureLegal: boolean
  /** True only when the current calculator can produce a value for the byte. */
  calculable: boolean
  source?: 'linked' | 'fallback-default'
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
  warnings: WarningVM[]
  bitGroups: BitGroupVM[]
  commandNote?: string
  nRangeText?: string
  voutModeInfo?: VoutModeInfoVM
  voutModePage?: VoutModeInfoVM
  /** DIRECT mode: signed Y derived from raw via toSigned(raw, 16). */
  directY?: number
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

function voutModeStatusText(byte: number): string {
  const a = analyzeVoutMode(byte)
  switch (a.status) {
    case 'valid':
      if (a.format === 0) return a.isRelative ? '相对 LINEAR（需参考值）' : '绝对 LINEAR'
      if (a.format === 2)
        return a.isRelative ? '相对 DIRECT（需系数与参考值）' : '绝对 DIRECT（需系数）'
      return a.isRelative ? '相对 IEEE Half（需参考值）' : 'IEEE Half（需器件资料）'
    case 'invalid-combination':
      return '相对 VID — 非法组合（§8.5.3）'
    case 'invalid-parameter':
      return a.formatName + ' 参数必须为 0（§8.3 Table 2）'
    case 'not-used':
      return 'VID code 00h — Not Used（未使用）'
    case 'reserved':
      return 'VID code 保留（规范未列出）'
    case 'profile-required':
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
      region: index === 7 ? 'ar' : index === 5 || index === 6 ? 'format' : 'parameter',
      semantic: semantic(index),
    })
  }
  const lowBits: VoutModeBitVM[] = []
  for (const index of [3, 2, 1, 0]) {
    lowBits.push({
      index,
      value: (byte >> index) & 1,
      region: 'parameter',
      semantic: semantic(index),
    })
  }
  return [
    { nibbleIndex: 0, hex: ((byte >> 4) & 0xf).toString(16).toUpperCase(), bits: highBits },
    { nibbleIndex: 1, hex: (byte & 0xf).toString(16).toUpperCase(), bits: lowBits },
  ]
}

function buildVoutModeVM(byte: number, source?: 'linked' | 'fallback-default'): VoutModeInfoVM {
  const a = analyzeVoutMode(byte)
  const isLinear = a.format === 0
  const status: VoutModeInfoVM['status'] = !isLinear
    ? 'unsupported'
    : a.isRelative
      ? 'reference-required'
      : 'ok'

  const explanations = buildVoutModeExplanations(a)
  if (source === 'fallback-default') {
    explanations.unshift({
      id: 'l16-fallback',
      severity: 'warning',
      title: 'L16 使用默认 LINEAR 0x18',
      detail:
        '当前共享 VOUT_MODE ' +
        formatByteHex(byte) +
        ' 非 LINEAR；本页暂用默认 0x18 计算，未改写共享字节。',
      specRef: 'Part II §8.3',
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
    structureLegal: a.isLegal,
    calculable: isLinear && a.isRelative === false,
    ...(source ? { source } : {}),
    explanations,
    nibbles: buildVoutModeNibbles(byte),
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
        const a = analyzeVoutMode(eff.byte)
        const n = a.linearExponent ?? 0
        if (state.l16.payloadKind === 'slinear16-offset') {
          return formatNumber(PMBusMath.decodeSlinear16(state.raw, n).value)
        }
        if (a.isRelative) {
          if (state.l16.nominalVout == null) return '—'
          const ratio = PMBusMath.decodeUlinear16(state.raw, n).value
          return formatNumber(state.l16.nominalVout * ratio)
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

  if (state.mode === 'L16' || state.mode === 'VOUT_MODE') {
    const eff =
      state.mode === 'L16'
        ? effectiveL16VoutMode(state)
        : { byte: state.voutMode.byte, source: undefined }
    const byte = eff.byte
    const a = analyzeVoutMode(byte)
    const hex = formatByteHex(byte)

    if (state.mode === 'L16' && eff.source === 'fallback-default') {
      warnings.push({
        id: 'l16-vout-mode-fallback',
        level: 'warning',
        text: `当前共享 VOUT_MODE ${formatByteHex(state.voutMode.byte)} 非 LINEAR；本页暂用默认 0x18（Part II §8.3）。`,
      })
    }

    if (a.format === 0 && a.isRelative) {
      warnings.push({
        id: 'vout-mode-relative',
        level: 'info',
        text: `VOUT_MODE ${hex} 为相对 LINEAR；需要参考值（VOUT_COMMAND nominal reference）才能计算最终电压。`,
      })
    } else if (a.status === 'invalid-combination') {
      warnings.push({
        id: 'vout-mode-invalid-combination',
        level: 'error',
        text: `VOUT_MODE ${hex} 为相对 + VID 非法组合（Part II §8.5.3：Relative 不适用于 VID）。`,
      })
    } else if (a.status === 'invalid-parameter') {
      warnings.push({
        id: 'vout-mode-invalid-parameter',
        level: 'error',
        text: `VOUT_MODE ${hex} 的 ${a.formatName} 参数必须为 00000b（Part II §8.3 Table 2），当前参数 ${a.parameter} 非法。`,
      })
    } else if (a.status === 'not-used') {
      warnings.push({
        id: 'vout-mode-vid-not-used',
        level: 'warning',
        text: `VOUT_MODE ${hex} 为 VID code 00h（Not Used），不构成有效 VID profile。`,
      })
    } else if (a.status === 'reserved') {
      warnings.push({
        id: 'vout-mode-vid-reserved',
        level: 'warning',
        text: `VOUT_MODE ${hex} 的 VID code ${a.parameter.toString(16).toUpperCase().padStart(2, '0')}h 为保留值（Part II §8.4.2 Table 3 未列出）。`,
      })
    } else if (a.status === 'profile-required') {
      warnings.push({
        id: 'vout-mode-vid-profile',
        level: 'warning',
        text: `VOUT_MODE ${hex} 的 VID code 为制造商自定义；需要器件资料确定电压映射。`,
      })
    } else if (a.format === 2 || a.format === 3) {
      warnings.push({
        id: 'vout-mode-nonlinear',
        level: 'warning',
        text: `VOUT_MODE ${hex} 为 ${a.formatName} 格式；需要器件 Profile（DIRECT 系数/设备数据）。`,
      })
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

export function toCalculatorViewModel(state: AppState): CalculatorViewModel {
  const raw = state.raw & 0xffff
  const le = toBytesLE(raw)
  const be = toBytesBE(raw)

  const decodedL11 = state.mode === 'L11' ? PMBusMath.decodeLinear11(raw) : null

  let deltaText: string | undefined
  let deltaKind: 'ok' | 'warn' | 'error' | undefined
  if (decodedL11) {
    const represented = decodedL11.value
    const requested = state.l11.valueInput ?? represented
    const delta = requested - represented
    if (Number.isFinite(requested) && Number.isFinite(delta)) {
      const percent = Math.abs(requested) > 1e-12 ? (delta / Math.abs(requested)) * 100 : 0
      deltaKind = Math.abs(delta) > 1e-5 ? 'warn' : 'ok'
      deltaText = `${delta >= 0 ? '+' : ''}${delta.toFixed(6)} (${percent.toFixed(4)}%)`
    }
  }

  let nRangeText: string | undefined
  if (decodedL11) {
    const p = PMBusMath.pow2(decodedL11.n)
    nRangeText = `${formatNumber(-1024 * p)} ~ ${formatNumber(1023 * p)}`
  } else if (state.mode === 'L16') {
    // Only absolute LINEAR VOUT_MODE has a LINEAR16 V×2^N range; relative
    // LINEAR is a ratio and VID/DIRECT/IEEE Half are not LINEAR16 at all.
    const eff = effectiveL16VoutMode(state)
    const a = analyzeVoutMode(eff.byte)
    if (a.format === 0 && a.isRelative === false && state.l16.payloadKind === 'ulinear16') {
      const p = PMBusMath.pow2(a.linearExponent ?? 0)
      nRangeText = '0 ~ ' + formatNumber(65535 * p)
    } else if (
      a.format === 0 &&
      a.isRelative === false &&
      state.l16.payloadKind === 'slinear16-offset'
    ) {
      const p = PMBusMath.pow2(a.linearExponent ?? 0)
      nRangeText = `${formatNumber(-32768 * p)} ~ ${formatNumber(32767 * p)}`
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

  return {
    mode: state.mode,
    steps: buildCalculationSteps(state),
    valueText: computeValueText(state),
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
    warnings: buildWarnings(state),
    bitGroups: buildBitGroups(raw),
    directY: state.mode === 'DIRECT' ? PMBusMath.toSigned(raw, 16) : undefined,
    commandNote: getCommandConfig(state.commandKey)?.note,
    nRangeText,
    voutModeInfo,
    voutModePage,
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
