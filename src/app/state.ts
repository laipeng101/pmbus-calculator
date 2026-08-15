/**
 * AppState — central state shape for the PMBus Calculator.
 *
 * Phase 1: React useReducer only. No external state libraries.
 */

export type AppMode = 'L11' | 'L16' | 'DIRECT' | 'HALF'
export type Endian = 'le' | 'be'
export type Theme = 'light' | 'dark' | 'system'

export interface AppState {
  mode: AppMode
  raw: number
  commandKey: string | null
  byteOrder: Endian

  l11: {
    n: number
    y: number
    autoN: boolean
    /** Physical value requested by the user via ValueInput; null when not in value-edit context. */
    valueInput: number | null
  }

  l16: {
    n: number
    voutMode: number
  }

  direct: {
    /**
     * Coefficients only.  Y is never stored here; in DIRECT mode Y is always
     * derived from `raw` via `toSigned(raw, 16)`.  `state.raw` is the single
     * source of truth for the encoded 16-bit word.
     */
    m: number
    b: number
    r: number
    /** Transient validation error for the last coefficient input. */
    error: string | null
  }

  copy: {
    prefix0x: boolean
    spaceBetweenBytes: boolean
    endian: Endian
  }

  ui: {
    theme: Theme
    debugOpen: boolean
  }
}

export const INITIAL_STATE: AppState = {
  mode: 'L11',
  raw: 0,
  commandKey: null,
  byteOrder: 'le',

  l11: {
    n: 0,
    y: 0,
    autoN: true,
    valueInput: null,
  },

  l16: {
    n: -8,
    voutMode: 0x18,
  },

  direct: {
    m: 1,
    b: 0,
    r: 0,
    error: null,
  },

  copy: {
    prefix0x: true,
    spaceBetweenBytes: true,
    endian: 'le',
  },

  ui: {
    theme: 'system',
    debugOpen: false,
  },
}
