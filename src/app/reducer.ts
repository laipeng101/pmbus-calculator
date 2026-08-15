import { INITIAL_STATE } from './state'
import type { AppState } from './state'
import type { AppAction } from './actions'
import { PMBusMath } from '../legacy/pmbus-math'

/** Integer parser for reducer-managed numeric fields (L11 Y/N, etc.) */
function parseIntegerSafe(s: string): number | null {
  s = String(s).trim()
  if (!s || s === '-' || s === '+') return null
  const n = Number(s)
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null
  return n
}

/** Float parser mirroring legacy parseFloatSafe behavior. */
function parseFloatSafe(s: string): number | null {
  s = String(s).trim()
  if (!s) return null
  const lower = s.toLowerCase()
  if (lower === 'nan') return NaN
  if (lower === 'infinity' || lower === '+infinity') return Infinity
  if (lower === '-infinity') return -Infinity
  // Allow transitional inputs like ".", ".0", "+.", "-."
  if (/^[+-]?\.0*$/.test(s)) return 0
  if (!/^[+-]?(?:(?:\d+\.?\d*)|(?:\.\d+))(?:[eE][+-]?\d+)?$/.test(s)) return null
  let n = Number(s)
  if (Number.isNaN(n)) return null
  if (n > 1e20) n = 1e20
  if (n < -1e20) n = -1e20
  return n
}

/**
 * Encode a physical value into LINEAR11 raw and canonical N/Y.
 * Mirrors legacy updateAll('val') for L11.
 */
function encodeL11FromValue(state: AppState, value: number): AppState {
  let n: number
  let y: number
  if (state.l11.autoN) {
    const best = PMBusMath.findBestLinear11(value)
    n = best.n
    y = best.y
  } else {
    n = PMBusMath.clamp(state.l11.n, -16, 15)
    const p = PMBusMath.pow2(n)
    y = PMBusMath.clamp(Math.round(value / p), -1024, 1023)
  }
  const raw = PMBusMath.encodeLinear11(n, y)
  const decoded = PMBusMath.decodeLinear11(raw)
  return {
    ...state,
    raw,
    l11: { ...state.l11, n: decoded.n, y: decoded.y, valueInput: value },
  }
}

/** Set raw and, when in L11 mode, re-sync N/Y from the raw bits. */
function withRaw(state: AppState, raw: number): AppState {
  const nextRaw = raw & 0xffff
  if (state.mode !== 'L11') return { ...state, raw: nextRaw }
  const decoded = PMBusMath.decodeLinear11(nextRaw)
  return {
    ...state,
    raw: nextRaw,
    l11: { ...state.l11, n: decoded.n, y: decoded.y, valueInput: null },
  }
}

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'mode/set': {
      if (action.mode === 'L11' && state.mode !== 'L11') {
        const decoded = PMBusMath.decodeLinear11(state.raw)
        return {
          ...state,
          mode: 'L11',
          l11: { ...state.l11, n: decoded.n, y: decoded.y, valueInput: null },
        }
      }
      return { ...state, mode: action.mode }
    }

    case 'command/set':
      return { ...state, commandKey: action.commandKey }

    case 'raw/set-from-hex': {
      const cleaned = action.hex.replace(/^0x/i, '').replace(/\s/g, '')
      const raw = cleaned === '' ? 0 : parseInt(cleaned, 16)
      return Number.isNaN(raw) ? state : withRaw(state, raw)
    }

    case 'raw/set':
      return withRaw(state, action.raw)

    case 'bit/toggle': {
      const mask = 1 << (15 - action.bit)
      return withRaw(state, state.raw ^ mask)
    }

    case 'value/set': {
      // Phase 3 (M3): L11 encode loop. Other modes are wired in their own milestones.
      if (state.mode !== 'L11') return state
      const value = parseFloatSafe(action.value)
      if (value === null || Number.isNaN(value) || !Number.isFinite(value)) return state
      return encodeL11FromValue(state, value)
    }

    case 'l11/set-n': {
      const n = parseIntegerSafe(action.n)
      if (n === null) return state
      const clamped = PMBusMath.clamp(n, -16, 15)
      if (state.mode !== 'L11') return { ...state, l11: { ...state.l11, n: clamped } }
      const raw = PMBusMath.encodeLinear11(clamped, state.l11.y)
      const decoded = PMBusMath.decodeLinear11(raw)
      return {
        ...state,
        raw,
        l11: { ...state.l11, n: decoded.n, y: decoded.y, valueInput: null },
      }
    }

    case 'l11/set-y': {
      const y = parseIntegerSafe(action.y)
      if (y === null) return state
      const clamped = PMBusMath.clamp(y, -1024, 1023)
      if (state.mode !== 'L11') return { ...state, l11: { ...state.l11, y: clamped } }
      const raw = PMBusMath.encodeLinear11(state.l11.n, clamped)
      const decoded = PMBusMath.decodeLinear11(raw)
      return {
        ...state,
        raw,
        l11: { ...state.l11, n: decoded.n, y: decoded.y, valueInput: null },
      }
    }

    case 'l11/toggle-auto-n': {
      const autoN = !state.l11.autoN
      if (state.mode !== 'L11') return { ...state, l11: { ...state.l11, autoN } }
      const value = state.l11.valueInput ?? PMBusMath.decodeLinear11(state.raw).value
      return encodeL11FromValue({ ...state, l11: { ...state.l11, autoN } }, value)
    }

    case 'l16/set-vout-mode': {
      const hex = action.hex.replace(/^0x/i, '')
      const voutMode = hex === '' ? 0 : parseInt(hex, 16)
      return Number.isNaN(voutMode)
        ? state
        : { ...state, l16: { ...state.l16, voutMode: voutMode & 0xff } }
    }

    case 'direct/set-y': {
      const y = parseInt(action.y, 10)
      return Number.isNaN(y) ? state : { ...state, direct: { ...state.direct, y } }
    }

    case 'direct/set-coeff': {
      const val = parseFloat(action.value)
      if (Number.isNaN(val)) return state
      return {
        ...state,
        direct: { ...state.direct, [action.name]: val },
      }
    }

    case 'copy/toggle-prefix':
      return {
        ...state,
        copy: { ...state.copy, prefix0x: !state.copy.prefix0x },
      }

    case 'copy/toggle-space':
      return {
        ...state,
        copy: {
          ...state.copy,
          spaceBetweenBytes: !state.copy.spaceBetweenBytes,
        },
      }

    case 'copy/set-endian':
      return { ...state, copy: { ...state.copy, endian: action.endian } }

    case 'ui/set-theme':
      return { ...state, ui: { ...state.ui, theme: action.theme } }

    case 'ui/set-focused-field':
      return { ...state, ui: { ...state.ui, focusedField: action.field } }

    case 'ui/toggle-debug':
      return { ...state, ui: { ...state.ui, debugOpen: !state.ui.debugOpen } }

    default:
      return state
  }
}

export { INITIAL_STATE }
