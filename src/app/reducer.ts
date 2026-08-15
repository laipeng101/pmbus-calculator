import { INITIAL_STATE } from './state'
import type { AppState } from './state'
import type { AppAction } from './actions'
import { PMBusMath } from '../legacy/pmbus-math'
import { getCommandConfig } from '../legacy/command-metadata'

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

/**
 * Encode a physical value into LINEAR16 raw (V), mirroring legacy
 * updateAll('val') for L16: V = clamp(round(value / 2^N), 0, 65535).
 */
function encodeL16FromValue(state: AppState, value: number): AppState {
  const n = PMBusMath.clamp(state.l16.n, -16, 15)
  const p = PMBusMath.pow2(n)
  const v = PMBusMath.clamp(Math.round(value / p), 0, 65535)
  return { ...state, raw: v }
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

/**
 * Apply a command selection the way legacy `selectCommand()` did:
 * numeric commands switch mode, load their default value/format parameters,
 * and re-encode raw. STATUS/BLOCK commands are informational only and do not
 * force a numeric conversion mode.
 */
function applyCommandSelection(state: AppState, commandKey: string | null): AppState {
  if (!commandKey) return { ...state, commandKey: null }

  const cfg = getCommandConfig(commandKey)
  if (!cfg) return state

  const next = { ...state, commandKey }

  if (!cfg.mode) {
    // STATUS / BLOCK payloads: no L11/L16/DIRECT/HALF conversion applies.
    return next
  }

  const mode = cfg.mode

  if (mode === 'L16') {
    const voutMode = cfg.voutMode ?? state.l16.voutMode
    const parsed = PMBusMath.parseVoutMode(voutMode)
    const n =
      typeof parsed.linearExponent === 'number' ? parsed.linearExponent : (cfg.n ?? state.l16.n)
    const withL16 = {
      ...next,
      mode: 'L16' as const,
      l16: { ...next.l16, voutMode, n },
    }
    if (cfg.val !== undefined) return encodeL16FromValue(withL16, cfg.val)
    return withL16
  }

  if (mode === 'L11') {
    const n = cfg.n ?? state.l11.n
    const withL11 = {
      ...next,
      mode: 'L11' as const,
      l11: { ...next.l11, n, valueInput: null },
    }
    if (cfg.val !== undefined) return encodeL11FromValue(withL11, cfg.val)
    return withL11
  }

  if (mode === 'DIRECT') {
    const direct = {
      y: next.direct.y,
      m: cfg.m ?? next.direct.m,
      b: cfg.b ?? next.direct.b,
      r: cfg.R ?? next.direct.r,
    }
    const withDirect = { ...next, mode: 'DIRECT' as const, direct }
    if (cfg.val !== undefined) {
      const y = PMBusMath.encodeDirect(cfg.val, direct.m, direct.b, direct.r)
      return {
        ...withDirect,
        direct: { ...direct, y },
        raw: y < 0 ? PMBusMath.fromSigned(y, 16) : y & 0xffff,
      }
    }
    return withDirect
  }

  if (mode === 'HALF') {
    const withHalf = { ...next, mode: 'HALF' as const }
    if (cfg.val !== undefined) return { ...withHalf, raw: PMBusMath.encodeHalf(cfg.val) }
    return withHalf
  }

  return next
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
      return applyCommandSelection(state, action.commandKey)

    case 'raw/set-from-hex': {
      const cleaned = action.hex.replace(/^0x/i, '').replace(/\s/g, '')
      const parsed = cleaned === '' ? 0 : parseInt(cleaned, 16)
      if (Number.isNaN(parsed)) return state
      // Legacy behavior: in L16 + big-endian mode, hex input is byte-swapped
      // into the internal little-endian PMBus word.
      const raw =
        state.mode === 'L16' && state.byteOrder === 'be' ? PMBusMath.swapBytes(parsed) : parsed
      return withRaw(state, raw)
    }

    case 'raw/set':
      if (!Number.isFinite(action.raw)) return state
      // Clamp, don't wrap: L16's manual V input promises 0~65535, and
      // `raw & 0xffff` would silently turn 70000 into 4464.
      return withRaw(state, PMBusMath.clamp(Math.trunc(action.raw), 0, 65535))

    case 'bit/toggle': {
      const mask = 1 << (15 - action.bit)
      return withRaw(state, state.raw ^ mask)
    }

    case 'value/set': {
      const value = parseFloatSafe(action.value)
      if (value === null || Number.isNaN(value) || !Number.isFinite(value)) return state
      if (state.mode === 'L11') return encodeL11FromValue(state, value)
      if (state.mode === 'L16') return encodeL16FromValue(state, value)
      return state
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
      if (Number.isNaN(voutMode)) return state
      const parsed = PMBusMath.parseVoutMode(voutMode)
      const l16 = {
        ...state.l16,
        voutMode: voutMode & 0xff,
        // Per PMBus 1.3: VOUT_MODE LINEAR sets N from the low 5 bits.
        // Non-LINEAR modes must not silently change the exponent.
        ...(typeof parsed.linearExponent === 'number' ? { n: parsed.linearExponent } : {}),
      }
      return { ...state, l16 }
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

    case 'byte-order/set':
      return { ...state, byteOrder: action.endian }

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

    case 'ui/toggle-debug':
      return { ...state, ui: { ...state.ui, debugOpen: !state.ui.debugOpen } }

    default:
      return state
  }
}

export { INITIAL_STATE }
