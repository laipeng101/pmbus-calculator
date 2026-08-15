import { INITIAL_STATE } from './state'
import type { AppState } from './state'
import type { AppAction } from './actions'
import { PMBusMath } from '../legacy/pmbus-math'
import { getCommandConfig } from '../legacy/command-metadata'
import { parseHexStrict } from './hex-parse'
import { parseDecimalIntStrict } from './decimal-parse'

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

/** Parse a signed integer within [min, max]; returns null when invalid. */
function parseIntegerRange(s: string, min: number, max: number): number | null {
  const n = parseIntegerSafe(s)
  if (n === null || n < min || n > max) return null
  return n
}

/** Encode a physical value into DIRECT raw via legacy rounding. */
function encodeDirectFromValue(state: AppState, value: number): AppState {
  const y = PMBusMath.encodeDirect(value, state.direct.m, state.direct.b, state.direct.r)
  return { ...state, raw: PMBusMath.fromSigned(y, 16) }
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
 * Apply an optional command preset only when the user explicitly asks for it.
 *
 * `command/set` never applies parameters.  `command/apply-preset` is the only
 * path that may switch mode, load parameters, and re-encode raw.  Presets that
 * carry project-demo values are therefore never mistaken for standard defaults.
 */
function applyCommandPreset(state: AppState, commandKey: string | null): AppState {
  if (!commandKey) return { ...state, commandKey: null }

  const cfg = getCommandConfig(commandKey)
  if (!cfg) return state

  const next = { ...state, commandKey }
  const preset = cfg.preset
  if (!preset) return next

  if (preset.mode === 'L16') {
    const voutMode = preset.voutMode ?? state.l16.voutMode
    const parsed = PMBusMath.parseVoutMode(voutMode)
    const n =
      typeof parsed.linearExponent === 'number' ? parsed.linearExponent : (preset.n ?? state.l16.n)
    const withL16 = {
      ...next,
      mode: 'L16' as const,
      l16: { ...next.l16, voutMode, n },
    }
    return encodeL16FromValue(withL16, preset.value)
  }

  if (preset.mode === 'L11') {
    const n = preset.n ?? state.l11.n
    const withL11 = {
      ...next,
      mode: 'L11' as const,
      l11: { ...next.l11, n, valueInput: null },
    }
    return encodeL11FromValue(withL11, preset.value)
  }

  if (preset.mode === 'DIRECT') {
    const direct = {
      m: preset.m ?? next.direct.m,
      b: preset.b ?? next.direct.b,
      r: preset.R ?? next.direct.r,
      error: null,
    }
    const withDirect = { ...next, mode: 'DIRECT' as const, direct }
    const y = PMBusMath.encodeDirect(preset.value, direct.m, direct.b, direct.r)
    return { ...withDirect, raw: PMBusMath.fromSigned(y, 16) }
  }

  if (preset.mode === 'HALF') {
    const withHalf = { ...next, mode: 'HALF' as const }
    return { ...withHalf, raw: PMBusMath.encodeHalf(preset.value) }
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
      // Selecting a command only records the selection and shows command info.
      // It must not switch modes or rewrite raw; device/demo presets stay inert
      // until the user explicitly applies them.
      return action.commandKey === null
        ? { ...state, commandKey: null }
        : {
            ...state,
            commandKey: getCommandConfig(action.commandKey) ? action.commandKey : state.commandKey,
          }

    case 'command/apply-preset':
      return applyCommandPreset(state, action.commandKey)

    case 'raw/set-from-hex': {
      const parsed = parseHexStrict(action.hex, 4)
      if (parsed.ok === false) return state
      // In L16 + big-endian mode, hex input is byte-swapped into the internal
      // little-endian PMBus word.  Over-long input is rejected above, so no
      // silent truncation occurs here.
      const raw =
        state.mode === 'L16' && state.byteOrder === 'be'
          ? PMBusMath.swapBytes(parsed.value)
          : parsed.value
      return withRaw(state, raw)
    }

    case 'raw/set': {
      const parsed = parseDecimalIntStrict(action.raw)
      if (!parsed.ok) return state
      // Clamp, don't wrap: L16's manual V input promises 0~65535, and
      // `raw & 0xffff` would silently turn 70000 into 4464.
      return withRaw(state, PMBusMath.clamp(Math.trunc(parsed.value), 0, 65535))
    }

    case 'bit/toggle': {
      const mask = 1 << (15 - action.bit)
      return withRaw(state, state.raw ^ mask)
    }

    case 'value/set': {
      const value = parseFloatSafe(action.value)
      if (value === null) return state
      if (state.mode === 'L11') {
        if (Number.isNaN(value) || !Number.isFinite(value)) return state
        return encodeL11FromValue(state, value)
      }
      if (state.mode === 'L16') {
        if (Number.isNaN(value) || !Number.isFinite(value)) return state
        return encodeL16FromValue(state, value)
      }
      if (state.mode === 'DIRECT') {
        if (Number.isNaN(value) || !Number.isFinite(value)) return state
        if (state.direct.m === 0) return state
        return encodeDirectFromValue(state, value)
      }
      if (state.mode === 'HALF') {
        // HALF supports NaN and ±Infinity as first-class values.
        return { ...state, raw: PMBusMath.encodeHalf(value) }
      }
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
      const parsedHex = parseHexStrict(action.hex, 2)
      if (parsedHex.ok === false) return state
      const voutMode = parsedHex.value
      const parsed = PMBusMath.parseVoutMode(voutMode)
      const l16 = {
        ...state.l16,
        voutMode,
        // Per PMBus 1.3 Part II §8.3: VOUT_MODE LINEAR sets N from the low
        // 5 bits.  Non-LINEAR modes must not silently change the exponent.
        ...(typeof parsed.linearExponent === 'number' ? { n: parsed.linearExponent } : {}),
      }
      return { ...state, l16 }
    }

    case 'direct/set-y': {
      const y = parseIntegerSafe(action.y)
      if (y === null) return state
      // Y is signed 16-bit; clamp then encode to raw.  raw stays the only
      // source of truth — Y is derived back from raw by the view-model.
      const clamped = PMBusMath.clamp(y, -32768, 32767)
      if (state.mode !== 'DIRECT') return state
      return { ...state, raw: PMBusMath.fromSigned(clamped, 16) }
    }

    case 'direct/set-coeff': {
      const isM = action.name === 'm'
      const isR = action.name === 'r'
      const min = isR ? -128 : -32768
      const max = isR ? 127 : 32767
      const val = parseIntegerRange(action.value, min, max)
      if (val === null) {
        const label = action.name.toUpperCase()
        return {
          ...state,
          direct: {
            ...state.direct,
            error: `${label} 必须是 ${min}..${max} 的整数，不得为浮点数或超范围值`,
          },
        }
      }
      if (isM && val === 0) {
        // m=0 is stored so the existing m-zero warning is visible, but it is
        // still an explicit error state rather than a silent acceptance.
        return {
          ...state,
          direct: { ...state.direct, m: 0, error: 'DIRECT 系数 m 不能为 0' },
        }
      }
      return {
        ...state,
        direct: { ...state.direct, [action.name]: val, error: null },
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
