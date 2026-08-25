import { useMemo } from 'react'
import type { AppState, AppMode } from './state'
import { PMBusMath } from '../legacy/pmbus-math'
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
  linearExponent: number | 'IEEE Half' | null
  isLinear: boolean
  isRelative: boolean
  /** Mode bits [6:5] per Part II §8.3. */
  mode: number
  /** Parameter bits [4:0]. */
  param: number
  /** Whether the LINEAR16 page may compute an absolute voltage. */
  status: 'ok' | 'reference-required' | 'unsupported'
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

function computeValueText(state: AppState): string {
  try {
    switch (state.mode) {
      case 'L11': {
        const r = PMBusMath.decodeLinear11(state.raw)
        return formatNumber(r.value)
      }
      case 'L16': {
        const parsed = PMBusMath.parseVoutMode(state.l16.voutMode)
        const canCompute = parsed.mode === 0 && parsed.isRelative === false
        if (canCompute === false) return '—'
        const r = PMBusMath.decodeLinear16(state.raw, state.l16.n)
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
    const parsed = PMBusMath.parseVoutMode(state.l16.voutMode)
    const hex = `0x${state.l16.voutMode.toString(16).toUpperCase().padStart(2, '0')}`
    if (parsed.mode !== 0) {
      warnings.push({
        id: 'l16-vout-mode-nonlinear',
        level: 'warning',
        text: `VOUT_MODE ${hex} 为 ${parsed.modeName} 模式；LINEAR16 页面不能给出有效电压结果，需要器件 Profile 或切换到对应格式。`,
      })
    } else if (parsed.isRelative) {
      warnings.push({
        id: 'l16-vout-mode-relative',
        level: 'info',
        text: `VOUT_MODE ${hex} 为相对 LINEAR；需要参考值，当前不计算绝对电压。`,
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
    const parsed = PMBusMath.parseVoutMode(state.l16.voutMode)
    if (parsed.mode === 0 && parsed.isRelative === false) {
      const p = PMBusMath.pow2(state.l16.n)
      nRangeText = '0 ~ ' + formatNumber(65535 * p)
    }
  }

  let voutModeInfo: VoutModeInfoVM | undefined
  if (state.mode === 'L16') {
    const parsed = PMBusMath.parseVoutMode(state.l16.voutMode)
    const status =
      parsed.mode === 0 && parsed.isRelative === false
        ? 'ok'
        : parsed.mode === 0
          ? 'reference-required'
          : 'unsupported'
    voutModeInfo = {
      hex: '0x' + state.l16.voutMode.toString(16).toUpperCase().padStart(2, '0'),
      modeName: parsed.modeName,
      linearExponent: parsed.linearExponent,
      isLinear: parsed.mode === 0,
      isRelative: parsed.isRelative,
      mode: parsed.mode,
      param: parsed.param,
      status,
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
