import type { AppMode, Linear16PayloadKind, Theme } from './state'
import type { VoutModeFormat } from '../legacy/vout-mode'

export type AppAction =
  | { type: 'mode/set'; mode: AppMode }
  | { type: 'command/set'; commandKey: string | null }
  | { type: 'raw/set-from-hex'; hex: string }
  | { type: 'raw/set'; raw: string }
  | { type: 'bit/toggle'; bit: number }
  | { type: 'value/set'; value: string }
  | { type: 'l11/set-n'; n: string }
  | { type: 'l11/set-y'; y: string }
  | { type: 'l11/toggle-auto-n' }
  // Shared VOUT_MODE byte (standalone page + LINEAR16 page)
  | { type: 'vout-mode/set-byte'; hex: string }
  | { type: 'vout-mode/toggle-bit'; bit: number }
  | { type: 'vout-mode/set-relative'; relative: boolean }
  | { type: 'vout-mode/set-format'; format: VoutModeFormat }
  | { type: 'vout-mode/set-linear-n'; n: string }
  | { type: 'vout-mode/set-parameter'; parameter: number }
  | { type: 'vout-mode/normalize' }
  // LINEAR16 payload semantics (not VOUT_MODE bits)
  | { type: 'l16/set-payload-kind'; payloadKind: Linear16PayloadKind }
  | { type: 'l16/set-slinear-y'; y: string }
  | { type: 'l16/set-nominal-vout'; nominalVout: string }
  | { type: 'l16/clear-nominal-vout' }
  | { type: 'l16/apply-calculator-linear-example' }
  | { type: 'direct/set-y'; y: string }
  | { type: 'direct/set-coeff'; name: 'm' | 'b' | 'r'; value: string }
  | { type: 'copy/toggle-prefix' }
  | { type: 'copy/toggle-space' }
  | { type: 'ui/set-theme'; theme: Theme }
  | { type: 'ui/toggle-debug' }
