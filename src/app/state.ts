/**
 * AppState — central state shape for the PMBus Calculator.
 *
 * Phase 1: React useReducer only. No external state libraries.
 */

import { CALCULATOR_LINEAR_EXAMPLE_VOUT_MODE } from '../legacy/vout-mode'

export type AppMode = 'L11' | 'L16' | 'DIRECT' | 'HALF' | 'VOUT_MODE'
export type Endian = 'le' | 'be'
export type Theme = 'light' | 'dark' | 'system'
export type Linear16PayloadKind = 'ulinear16' | 'slinear16-offset'

export interface AppState {
  mode: AppMode
  raw: number
  commandKey: string | null
  byteOrder: Endian

  /**
   * Shared VOUT_MODE data byte (0..255) — the single source of truth for both
   * the standalone VOUT_MODE calculator and the LINEAR16 page.
   */
  voutMode: {
    byte: number
  }

  l11: {
    n: number
    y: number
    autoN: boolean
    /** Physical value requested by the user via ValueInput; null when not in value-edit context. */
    valueInput: number | null
  }

  /**
   * Last committed physical-value encoding request for modes other than L11
   * (which keeps its own l11.valueInput channel). Mirrors the same contract:
   * set only by a successful ValueInput encode, cleared whenever raw or the
   * decode parameters change through any other path, and never persisted.
   */
  valueRequest: { mode: AppMode; value: number } | null

  l16: {
    /**
     * How the 16-bit payload word is interpreted. This is a command-payload
     * semantic and is NOT encoded into VOUT_MODE; switching it only changes the
     * signedness/meaning of `raw`, never the VOUT_MODE byte or raw bits.
     */
    payloadKind: Linear16PayloadKind
    /**
     * Nominal VOUT_COMMAND reference (volts) for ULINEAR16 Relative mode.
     * null when not provided; the final voltage is blocked until it is finite
     * and non-negative.
     */
    nominalVout: number | null
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
    /**
     * Per-field validation errors for the coefficient inputs.  Editing one
     * coefficient never overwrites or clears another field's still-valid
     * error; errors survive mode switches and are rendered inline next to
     * the corresponding field (never duplicated in the InfoPanel).
     */
    errors: { m: string | null; b: string | null; r: string | null }
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

  voutMode: {
    byte: CALCULATOR_LINEAR_EXAMPLE_VOUT_MODE,
  },

  l11: {
    n: 0,
    y: 0,
    autoN: true,
    valueInput: null,
  },

  valueRequest: null,

  l16: {
    payloadKind: 'ulinear16',
    nominalVout: null,
  },

  direct: {
    m: 1,
    b: 0,
    r: 0,
    errors: { m: null, b: null, r: null },
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
