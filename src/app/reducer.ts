import { INITIAL_STATE } from './state'
import type { AppState } from './state'
import type { AppAction } from './actions'
import { PMBusMath } from '../legacy/pmbus-math'
import { analyzeVoutMode, composeVoutMode, DEFAULT_LINEAR_VOUT_MODE } from '../legacy/vout-mode'
import { getCommandConfig } from '../legacy/command-metadata'
import { parseHexStrict } from './hex-parse'
import { parseIntegerStrict } from './int-parse'
import { parseFloatSafe } from './float-parse'
import { effectiveL16VoutMode } from './vout-mode-selector'

/**
 * Strict integer parser for reducer-managed numeric fields (L11 N/Y, DIRECT
 * Y and coefficients).  Unified syntax: 可选正负号 + 十进制数字 — rejects
 * `1e2`, `0x10`, `1.5`, `12abc` and unsafe integers instead of relying on
 * Number()'s lenient coercion.
 */
function parseIntegerSafe(s: string): number | null {
  const parsed = parseIntegerStrict(s)
  if (!parsed.ok || parsed.empty) return null
  return parsed.value
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
  return { ...state, raw: PMBusMath.fromSigned(y, 16), valueRequest: { mode: 'DIRECT', value } }
}

/**
 * Clear the stale last-request marker (see AppState.valueRequest). Idempotent:
 * states without a marker keep their reference so reducers stay cheap.
 */
function withoutValueRequest(state: AppState): AppState {
  return state.valueRequest === null ? state : { ...state, valueRequest: null }
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
 * Encode a physical value into the LINEAR16 payload word.
 *
 * Order matters (Part II §8.5 vs §13.3/§13.4):
 * - SLINEAR16 offset is a signed command payload (VOUT_TRIM /
 *   VOUT_CAL_OFFSET): bit7 belongs to another command group and does not
 *   participate in its math, so it encodes for ANY LINEAR byte including
 *   relative ones such as 0x98.
 * - ULINEAR16 + relative LINEAR is a dimensionless ratio — no reverse encode.
 * - ULINEAR16 + absolute LINEAR keeps the V = X / 2^N behaviour.
 * - Non-LINEAR shared bytes never reach a payload decision: the effective
 *   byte falls back to 0x18 (see effectiveL16VoutMode), which is LINEAR.
 */
function encodeL16FromValue(state: AppState, value: number): AppState {
  const eff = effectiveL16VoutMode(state)
  const a = analyzeVoutMode(eff.byte)
  if (a.format !== 0) return state
  const n = a.linearExponent ?? 0
  if (state.l16.payloadKind === 'slinear16-offset') {
    return {
      ...state,
      raw: PMBusMath.encodeSlinear16(value, n),
      valueRequest: { mode: 'L16', value },
    }
  }
  // Relative ULINEAR16 is a ratio, not a reverse-encodable physical value.
  if (a.isRelative) return state
  return {
    ...state,
    raw: PMBusMath.encodeUlinear16(value, n),
    valueRequest: { mode: 'L16', value },
  }
}

/**
 * Set raw and, when in L11 mode, re-sync N/Y from the raw bits.
 * Any raw edit through this path invalidates the last encoding request:
 * the quantization-error baseline falls back to request == represented.
 */
function withRaw(state: AppState, raw: number): AppState {
  const nextRaw = raw & 0xffff
  if (state.mode !== 'L11') return withoutValueRequest({ ...state, raw: nextRaw })
  const decoded = PMBusMath.decodeLinear11(nextRaw)
  return withoutValueRequest({
    ...state,
    raw: nextRaw,
    l11: { ...state.l11, n: decoded.n, y: decoded.y, valueInput: null },
  })
}

/**
 * Write a VOUT_MODE byte. On the L16 page every byte change can move the
 * effective exponent or format, so the previous value request goes stale.
 */
function setVoutModeByte(state: AppState, byte: number): AppState {
  return withoutValueRequest({ ...state, voutMode: { byte: byte & 0xff } })
}

/**
 * The byte that semantic VOUT_MODE controls operate on. On the L16 page this is
 * the effective byte (shared byte when LINEAR, otherwise the explicit 0x18
 * fallback); editing it writes a canonical LINEAR byte back to the shared
 * source and therefore flips the page into the linked state.
 */
function voutSemanticBase(state: AppState): number {
  return state.mode === 'L16' ? effectiveL16VoutMode(state).byte : state.voutMode.byte
}

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'mode/set': {
      // Re-selecting the active mode (same tab click or shortcut) is a no-op:
      // it changes neither raw bits nor the encoding interpretation, so a
      // still-valid value request keeps its provenance.
      if (action.mode === state.mode) return state
      if (action.mode === 'L11') {
        const decoded = PMBusMath.decodeLinear11(state.raw)
        return withoutValueRequest({
          ...state,
          mode: 'L11',
          l11: { ...state.l11, n: decoded.n, y: decoded.y, valueInput: null },
        })
      }
      return withoutValueRequest({ ...state, mode: action.mode })
    }

    case 'command/set':
      // Kept for state-level compatibility only; the UI command reference is
      // read-only and never dispatches this action.  It must not switch modes
      // or rewrite raw.
      return action.commandKey === null
        ? { ...state, commandKey: null }
        : {
            ...state,
            commandKey: getCommandConfig(action.commandKey) ? action.commandKey : state.commandKey,
          }

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
      const parsed = parseIntegerStrict(action.raw)
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
        // The quantization readout hides itself for non-finite pairs.
        return { ...state, raw: PMBusMath.encodeHalf(value), valueRequest: { mode: 'HALF', value } }
      }
      // VOUT_MODE is a byte configuration, not a physical value.
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

    // ---- Shared VOUT_MODE byte ----

    case 'vout-mode/set-byte': {
      // Lossless raw byte edit: the user can intentionally produce any
      // 0x00..0xFF (including invalid/non-canonical combinations).
      const parsed = parseHexStrict(action.hex, 2)
      if (parsed.ok === false) return state
      return setVoutModeByte(state, parsed.value)
    }

    case 'vout-mode/toggle-bit': {
      if (!Number.isInteger(action.bit) || action.bit < 0 || action.bit > 7) return state
      // The L16 embedded editor locks bits[6:5] to 00b (LINEAR).
      if (state.mode === 'L16' && (action.bit === 5 || action.bit === 6)) return state
      const base = voutSemanticBase(state)
      return setVoutModeByte(state, base ^ (1 << action.bit))
    }

    case 'vout-mode/set-relative': {
      const base = voutSemanticBase(state)
      const a = analyzeVoutMode(base)
      if (a.status === 'invalid-input') return state
      // Relative is not available for VID (§8.5.3); refuse setting it, but
      // still allow clearing an invalid relative-VID byte back to absolute.
      if (a.format === 1 && action.relative) return state
      const next = (base & 0x7f) | (action.relative ? 0x80 : 0x00)
      return setVoutModeByte(state, next)
    }

    case 'vout-mode/set-format': {
      const base = voutSemanticBase(state)
      const a = analyzeVoutMode(base)
      if (a.status === 'invalid-input') return state
      const format = action.format
      if (!Number.isInteger(format) || format < 0 || format > 3) return state
      // Canonicalization: DIRECT / IEEE Half force parameter to 0; selecting
      // VID forces absolute (Relative is not available for VID, §8.5.3).
      const parameter = format === 2 || format === 3 ? 0 : a.parameter
      const relative = format === 1 ? false : a.isRelative
      const next = ((format & 0x03) << 5) | (parameter & 0x1f) | (relative ? 0x80 : 0x00)
      return setVoutModeByte(state, next)
    }

    case 'vout-mode/set-linear-n': {
      const base = voutSemanticBase(state)
      const a = analyzeVoutMode(base)
      if (a.format !== 0) return state
      const n = parseIntegerSafe(action.n)
      if (n === null) return state
      const clamped = PMBusMath.clamp(n, -16, 15)
      const next = (base & 0xe0) | (clamped & 0x1f)
      return setVoutModeByte(state, next)
    }

    case 'vout-mode/set-parameter': {
      const base = voutSemanticBase(state)
      const a = analyzeVoutMode(base)
      if (a.status === 'invalid-input') return state
      const p = action.parameter
      if (!Number.isInteger(p)) return state
      if (a.format === 0) {
        // LINEAR parameter is a signed 5-bit exponent.
        if (p < -16 || p > 15) return state
        return setVoutModeByte(state, (base & 0xe0) | (p & 0x1f))
      }
      if (a.format === 1) {
        // VID parameter is an unsigned code (Relative is already excluded).
        if (p < 0 || p > 31) return state
        return setVoutModeByte(state, (base & 0xe0) | (p & 0x1f))
      }
      // DIRECT / IEEE Half parameter is fixed at 00000b.
      return state
    }

    case 'vout-mode/normalize': {
      const byte = state.voutMode.byte
      const a = analyzeVoutMode(byte)
      if (a.status === 'invalid-input') return state
      let next: number | null = null
      if (a.status === 'invalid-combination') {
        next = composeVoutMode({ relative: false, format: 1, parameter: a.parameter })
      } else if (a.status === 'invalid-parameter') {
        next = composeVoutMode({ relative: a.isRelative, format: a.format, parameter: 0 })
      } else {
        next = composeVoutMode({ relative: a.isRelative, format: a.format, parameter: a.parameter })
      }
      return next === null ? state : setVoutModeByte(state, next)
    }

    // ---- LINEAR16 payload semantics ----

    case 'l16/set-payload-kind': {
      if (action.payloadKind !== 'ulinear16' && action.payloadKind !== 'slinear16-offset') {
        return state
      }
      // Switching signedness reinterprets the same raw word, so a previous
      // ULINEAR16 request no longer describes the represented value.
      return withoutValueRequest({
        ...state,
        l16: { ...state.l16, payloadKind: action.payloadKind },
      })
    }

    case 'l16/set-slinear-y': {
      if (state.mode !== 'L16' || state.l16.payloadKind !== 'slinear16-offset') return state
      const y = parseIntegerSafe(action.y)
      if (y === null) return state
      const clamped = PMBusMath.clamp(y, -32768, 32767)
      return { ...state, raw: PMBusMath.fromSigned(clamped, 16) }
    }

    case 'l16/set-nominal-vout': {
      const value = parseFloatSafe(action.nominalVout)
      if (value === null) return state
      // Decode accepts finite non-negative nominal references. Reverse encode
      // from a final voltage would require a strict divisor > 0, but this
      // slice is decode-only, so 0 is still accepted as a displayed nominal.
      if (!Number.isFinite(value) || value < 0) return state
      return { ...state, l16: { ...state.l16, nominalVout: value } }
    }

    case 'l16/apply-default-vout-mode':
      return setVoutModeByte(state, DEFAULT_LINEAR_VOUT_MODE)

    // ---- DIRECT ----

    case 'direct/set-y': {
      const y = parseIntegerSafe(action.y)
      if (y === null) return state
      // Y is signed 16-bit; clamp then encode to raw.  raw stays the only
      // source of truth — Y is derived back from raw by the view-model.
      const clamped = PMBusMath.clamp(y, -32768, 32767)
      if (state.mode !== 'DIRECT') return state
      return withoutValueRequest({ ...state, raw: PMBusMath.fromSigned(clamped, 16) })
    }

    case 'direct/set-coeff': {
      const isM = action.name === 'm'
      const isR = action.name === 'r'
      const min = isR ? -128 : -32768
      const max = isR ? 127 : 32767
      const label = action.name.toUpperCase()
      const val = parseIntegerRange(action.value, min, max)
      if (val === null) {
        // Per-field error: reject and keep the last valid value without
        // touching the other fields' stored values or errors.
        return {
          ...state,
          direct: {
            ...state.direct,
            errors: {
              ...state.direct.errors,
              [action.name]: `${label} 必须是 ${min}..${max} 的整数，不得为浮点数或超范围值`,
            },
          },
        }
      }
      if (isM && val === 0) {
        // m=0 is stored so the field-level m=0 error stays visible, but it is
        // still an explicit error state rather than a silent acceptance.
        return withoutValueRequest({
          ...state,
          direct: {
            ...state.direct,
            m: 0,
            errors: { ...state.direct.errors, m: 'DIRECT 系数 m 不能为 0' },
          },
        })
      }
      // Coefficient edits change what the unchanged raw word decodes to, so
      // a previous value request no longer describes the represented value.
      return withoutValueRequest({
        ...state,
        direct: {
          ...state.direct,
          [action.name]: val,
          errors: { ...state.direct.errors, [action.name]: null },
        },
      })
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
