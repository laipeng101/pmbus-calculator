import { useMemo } from 'react'
import type { AppState, AppMode } from './state'
import { PMBusMath } from '../legacy/pmbus-math'
import { analyzeVoutMode } from '../legacy/vout-mode'
import type { VoutModeStatus } from '../legacy/vout-mode'
import { getCommandConfig } from '../legacy/command-metadata'
import { buildCMacro } from './copy-utils'
import { getFormulaPresentation } from './formula-presentation'
import type { FormulaDetailLine } from './formula-presentation'
import { buildCalculationSteps } from './calculation-steps'
import type { CalculationStepVM } from './calculation-steps'

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

export interface VoutModeInfoVM {
  hex: string
  modeName: string
  linearExponent: number | null
  isLinear: boolean
  isRelative: boolean
  /** Mode bits [6:5] per Part II §8.3. */
  mode: number
  /** Parameter bits [4:0]. */
  param: number
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
  /** 8-bit binary rendering of the canonical byte. */
  binary: string
}

export interface CalculatorViewModel {
  mode: AppMode
  valueText: string
  rawHex: string
  /** Internal 16-bit raw word, never byte-swapped for display. */
  rawWordHex: string
  rawBytesLE: string
  rawBytesBE: string
  cMacroText: string
  formulaText: string
  formulaLatex: string
  formulaGenericLatex: string
  formulaDetailLines: FormulaDetailLine[]
  /** Unified four-mode calculation steps (fields -> formula -> intermediates -> result). */
  steps: CalculationStepVM[]
  deltaText?: string
  deltaKind?: 'ok' | 'warn' | 'error'
  warnings: WarningVM[]
  bitGroups: BitGroupVM[]
  commandNote?: string
  nRangeText?: string
  voutModeInfo?: VoutModeInfoVM
  /** DIRECT mode: signed Y derived from raw via toSigned(raw, 16). */
  directY?: number
  visible: {
    voutMode: boolean
    directCoefficients: boolean
    halfNote: boolean
    nRange: boolean
  }
}

function formatRawHex(raw: number): string {
  return '0x' + (raw & 0xffff).toString(16).toUpperCase().padStart(4, '0')
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

function voutModeStatusText(state: AppState): string {
  const a = analyzeVoutMode(state.l16.voutMode)
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

function computeValueText(state: AppState): string {
  try {
    switch (state.mode) {
      case 'L11': {
        const r = PMBusMath.decodeLinear11(state.raw)
        return formatNumber(r.value)
      }
      case 'L16': {
        const a = analyzeVoutMode(state.l16.voutMode)
        const canCompute = a.format === 0 && a.isRelative === false
        if (canCompute === false) return '—'
        const r = PMBusMath.decodeLinear16(state.raw, a.linearExponent ?? 0)
        return formatNumber(r.value)
      }
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
  if (state.mode === 'L16') {
    const a = analyzeVoutMode(state.l16.voutMode)
    const hex = `0x${state.l16.voutMode.toString(16).toUpperCase().padStart(2, '0')}`
    if (a.format === 0 && a.isRelative) {
      warnings.push({
        id: 'l16-vout-mode-relative',
        level: 'info',
        text: `VOUT_MODE ${hex} 为相对 LINEAR；需要参考值（VOUT_COMMAND nominal reference），当前不计算绝对电压。`,
      })
    } else if (a.status === 'invalid-combination') {
      warnings.push({
        id: 'l16-vout-mode-invalid-combination',
        level: 'error',
        text: `VOUT_MODE ${hex} 为相对 + VID 非法组合（Part II §8.5.3：Relative 不适用于 VID）。`,
      })
    } else if (a.status === 'invalid-parameter') {
      warnings.push({
        id: 'l16-vout-mode-invalid-parameter',
        level: 'error',
        text: `VOUT_MODE ${hex} 的 ${a.formatName} 参数必须为 00000b（Part II §8.3 Table 2），当前参数 ${a.parameter} 非法。`,
      })
    } else if (a.status === 'not-used') {
      warnings.push({
        id: 'l16-vout-mode-vid-not-used',
        level: 'warning',
        text: `VOUT_MODE ${hex} 为 VID code 00h（Not Used），不构成有效 VID profile；LINEAR16 页面不给出电压结果。`,
      })
    } else if (a.status === 'reserved') {
      warnings.push({
        id: 'l16-vout-mode-vid-reserved',
        level: 'warning',
        text: `VOUT_MODE ${hex} 的 VID code ${a.parameter.toString(16).toUpperCase().padStart(2, '0')}h 为保留值（Part II §8.4.2 Table 3 未列出）；不构成有效 VID profile。`,
      })
    } else if (a.status === 'profile-required') {
      warnings.push({
        id: 'l16-vout-mode-vid-profile',
        level: 'warning',
        text: `VOUT_MODE ${hex} 的 VID code 为制造商自定义；需要器件资料确定电压映射，本页不猜测。`,
      })
    } else if (a.format === 2 || a.format === 3) {
      warnings.push({
        id: 'l16-vout-mode-nonlinear',
        level: 'warning',
        text: `VOUT_MODE ${hex} 为 ${a.formatName} 格式；LINEAR16 页面不给出 V×2^N 电压结果，需要器件 Profile（DIRECT 系数/设备数据）或切换到对应格式。`,
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
    const a = analyzeVoutMode(state.l16.voutMode)
    if (a.format === 0 && a.isRelative === false) {
      const p = PMBusMath.pow2(a.linearExponent ?? 0)
      nRangeText = '0 ~ ' + formatNumber(65535 * p)
    }
  }

  let voutModeInfo: VoutModeInfoVM | undefined
  if (state.mode === 'L16') {
    const a = analyzeVoutMode(state.l16.voutMode)
    const status =
      a.format === 0 && a.isRelative === false
        ? 'ok'
        : a.format === 0
          ? 'reference-required'
          : 'unsupported'
    voutModeInfo = {
      hex: '0x' + state.l16.voutMode.toString(16).toUpperCase().padStart(2, '0'),
      modeName: a.formatName,
      linearExponent: a.linearExponent,
      isLinear: a.format === 0,
      isRelative: a.isRelative,
      mode: a.format,
      param: a.parameter,
      status,
      domainStatus: a.status,
      reason: a.reason,
      ...(a.vidCode ? { vidCodeKind: a.vidCode.kind } : {}),
      statusText: voutModeStatusText(state),
      binary: state.l16.voutMode.toString(2).padStart(8, '0'),
    }
  }

  const displayedRaw =
    state.mode === 'L16' && state.byteOrder === 'be' ? PMBusMath.swapBytes(raw) : raw
  const formula = getFormulaPresentation(state)
  const formulaText = formula.plainText

  return {
    mode: state.mode,
    steps: buildCalculationSteps(state),
    valueText: computeValueText(state),
    rawHex: formatRawHex(displayedRaw),
    rawWordHex: formatRawHex(raw),
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
    visible: {
      voutMode: state.mode === 'L16',
      directCoefficients: state.mode === 'DIRECT',
      halfNote: state.mode === 'HALF',
      nRange: state.mode === 'L11' || state.mode === 'L16',
    },
  }
}

/** React hook wrapper for useMemo */
export function useCalculatorViewModel(state: AppState): CalculatorViewModel {
  return useMemo(() => toCalculatorViewModel(state), [state])
}
