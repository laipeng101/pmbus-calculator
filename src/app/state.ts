/**
 * AppState — central state shape for the PMBus Calculator.
 *
 * Phase 1: React useReducer only. No external state libraries.
 */

import { CALCULATOR_LINEAR_EXAMPLE_VOUT_MODE } from '../legacy/vout-mode'

export type AppMode = 'L11' | 'L16' | 'DIRECT' | 'HALF' | 'VOUT_MODE'
export type Theme = 'light' | 'dark' | 'system'
export type Linear16PayloadKind = 'ulinear16' | 'slinear16-offset'
export type BitMappingPanelKey = 'rawWord' | 'voutMode'

/**
 * Last committed physical-value encoding request (modes other than L11,
 * which keeps its own l11.valueInput channel). Set only by a successful
 * ValueInput encode; cleared whenever raw or the decode parameters change
 * through any other path; never persisted.
 *
 * v2.5.12: the union is mode-discriminated and DIRECT keeps `text` — the
 * exact decimal lexeme the reducer actually fed to the exact encoder — so
 * request provenance and raw share one lexical truth instead of the lexeme
 * collapsing into a binary64 Number. `text` is a string (never a BigInt), so
 * debug serialization stays JSON-safe; the same invalidation events clear the
 * whole request.
 */
export type ValueRequest =
  | { mode: 'L16'; value: number }
  | { mode: 'HALF'; value: number }
  | { mode: 'DIRECT'; value: number; text: string }

export interface AppState {
  mode: AppMode
  /**
   * Canonical unsigned 16-bit raw word (v3.0.0): the single numeric bit-pattern
   * truth behind the main Raw Word Hex field, the bit grid, the formula
   * operand, decode/encode, the raw-word copy and the C macro. Byte order
   * never touches this identity — it exists only in the wire-byte
   * serialization layer (display/copy of the low-byte-first / MSB-first
   * sequences).
   */
  raw: number
  commandKey: string | null

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
   * (which keeps its own l11.valueInput channel). See ValueRequest for the
   * v2.5.12 discriminated-union contract.
   */
  valueRequest: ValueRequest | null

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
  }

  ui: {
    theme: Theme
    debugOpen: boolean
    /** Display preferences only; shared by panels that edit the same raw word/byte. */
    bitMappingOpen: Record<BitMappingPanelKey, boolean>
  }
}

export const INITIAL_STATE: AppState = {
  mode: 'L11',
  raw: 0,
  commandKey: null,

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
  },

  ui: {
    theme: 'system',
    debugOpen: false,
    bitMappingOpen: { rawWord: true, voutMode: true },
  },
}
