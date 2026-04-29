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
    case 'L11':
      return `Y=${state.l11.y} × 2^${state.l11.n}`
    case 'L16':
      return `V=${state.raw} × 2^${state.l16.n}`
    case 'DIRECT':
      return `X=(1/${state.direct.m})×(Y×10^(-${state.direct.r})-${state.direct.b})`
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
        return r.value.toString()
      }
      case 'L16': {
        const r = PMBusMath.decodeLinear16(state.raw, state.l16.n)
        return r.value.toString()
      }
      case 'DIRECT': {
        const r = PMBusMath.decodeDirect(
          state.direct.y,
          state.direct.m,
          state.direct.b,
          state.direct.r,
        )
        return Number.isNaN(r.value) ? '—' : r.value.toString()
      }
      case 'HALF': {
        const r = PMBusMath.decodeHalf(state.raw)
        if (Number.isNaN(r.value)) return 'NaN'
        if (!Number.isFinite(r.value)) return r.value > 0 ? '+Infinity' : '-Infinity'
        return r.value.toString()
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
  if (state.commandKey) {
    const cmd = getCommandConfig(state.commandKey)
    if (cmd?.note) {
      warnings.push({ id: 'cmd-note', level: 'info', text: cmd.note })
    }
  }
  return warnings
}

export function toCalculatorViewModel(state: AppState): CalculatorViewModel {
  const raw = state.raw & 0xffff
  const le = toBytesLE(raw)
  const be = toBytesBE(raw)

  return {
    mode: state.mode,
    valueText: computeValueText(state),
    rawHex: formatRawHex(raw),
    rawBytesLE: formatBytes(le, {
      prefix0x: state.copy.prefix0x,
      space: state.copy.spaceBetweenBytes,
    }),
    rawBytesBE: formatBytes(be, {
      prefix0x: state.copy.prefix0x,
      space: state.copy.spaceBetweenBytes,
    }),
    formulaText: computeFormula(state),
    warnings: buildWarnings(state),
    bitGroups: buildBitGroups(raw),
    commandNote: getCommandConfig(state.commandKey)?.note,
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
