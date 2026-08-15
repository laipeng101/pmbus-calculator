import { useMemo } from 'react'
import type { AppState, AppMode } from './state'
import { PMBusMath } from '../legacy/pmbus-math'
import { getCommandConfig } from '../legacy/command-metadata'

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
}

export interface CalculatorViewModel {
  mode: AppMode
  valueText: string
  rawHex: string
  rawBytesLE: string
  rawBytesBE: string
  formulaText: string
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

function computeFormula(state: AppState): string {
  switch (state.mode) {
    case 'L11': {
      const decoded = PMBusMath.decodeLinear11(state.raw)
      return `Y=${decoded.y} × 2^${decoded.n}`
    }
    case 'L16':
      return `V=${state.raw} × 2^${state.l16.n}`
    case 'DIRECT': {
      const y = PMBusMath.toSigned(state.raw, 16)
      return `X=(1/${state.direct.m})×(${y}×10^(-${state.direct.r})-${state.direct.b})`
    }
    case 'HALF':
      return 'IEEE 754 Half-Precision'
    default:
      return ''
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
  const special = PMBusMath.checkSpecial(state.raw, state.mode)
  if (special) {
    warnings.push({
      id: 'special-' + special.type,
      level: special.type === 'overflow' ? 'warning' : 'info',
      text: special.msg,
    })
  }
  if (state.mode === 'DIRECT' && state.direct.m === 0) {
    warnings.push({
      id: 'direct-m-zero',
      level: 'error',
      text: 'DIRECT 系数 m 不能为 0',
    })
  }
  if (state.direct.error) {
    warnings.push({
      id: 'direct-coeff-error',
      level: 'error',
      text: state.direct.error,
    })
  }
  if (state.mode === 'L16') {
    const parsed = PMBusMath.parseVoutMode(state.l16.voutMode)
    if (!parsed || parsed.modeName !== 'LINEAR') {
      warnings.push({
        id: 'l16-vout-mode-nonlinear',
        level: 'warning',
        text: `VOUT_MODE 0x${state.l16.voutMode.toString(16).toUpperCase().padStart(2, '0')} 为 ${parsed.modeName} 模式；当前按 LINEAR16 显示，N=${state.l16.n} 保持不变`,
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
    const p = PMBusMath.pow2(state.l16.n)
    nRangeText = `0 ~ ${formatNumber(65535 * p)}`
  }

  let voutModeInfo: VoutModeInfoVM | undefined
  if (state.mode === 'L16') {
    const parsed = PMBusMath.parseVoutMode(state.l16.voutMode)
    voutModeInfo = {
      hex: '0x' + state.l16.voutMode.toString(16).toUpperCase().padStart(2, '0'),
      modeName: parsed.modeName,
      linearExponent: parsed.linearExponent,
      isLinear: parsed.modeName === 'LINEAR',
    }
  }

  const displayedRaw =
    state.mode === 'L16' && state.byteOrder === 'be' ? PMBusMath.swapBytes(raw) : raw

  return {
    mode: state.mode,
    valueText: computeValueText(state),
    rawHex: formatRawHex(displayedRaw),
    rawBytesLE: formatBytes(le, {
      prefix0x: state.copy.prefix0x,
      space: state.copy.spaceBetweenBytes,
    }),
    rawBytesBE: formatBytes(be, {
      prefix0x: state.copy.prefix0x,
      space: state.copy.spaceBetweenBytes,
    }),
    formulaText: computeFormula(state),
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
