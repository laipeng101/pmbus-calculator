import { INITIAL_STATE } from './state'
import type { AppState } from './state'
import type { AppAction } from './actions'

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'mode/set':
      return { ...state, mode: action.mode }

    case 'command/set':
      return { ...state, commandKey: action.commandKey }

    case 'raw/set-from-hex': {
      const cleaned = action.hex.replace(/^0x/i, '').replace(/\s/g, '')
      const raw = cleaned === '' ? 0 : parseInt(cleaned, 16)
      return { ...state, raw: Number.isNaN(raw) ? state.raw : raw & 0xffff }
    }

    case 'raw/set':
      return { ...state, raw: action.raw & 0xffff }

    case 'bit/toggle': {
      const mask = 1 << (15 - action.bit)
      return { ...state, raw: state.raw ^ mask }
    }

    case 'value/set':
      // Phase 2: wired to actual encode/decode
      return state

    case 'l11/set-n': {
      const n = parseInt(action.n, 10)
      return Number.isNaN(n) ? state : { ...state, l11: { ...state.l11, n } }
    }

    case 'l11/set-y': {
      const y = parseInt(action.y, 10)
      return Number.isNaN(y) ? state : { ...state, l11: { ...state.l11, y } }
    }

    case 'l11/toggle-auto-n':
      return { ...state, l11: { ...state.l11, autoN: !state.l11.autoN } }

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
