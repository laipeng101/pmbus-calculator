import type { AppMode, Endian, Theme } from './state'
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
  | { type: 'l16/set-vout-mode'; hex: string }
  | { type: 'l16/set-vout-relative'; relative: boolean }
  | { type: 'l16/set-vout-format'; format: VoutModeFormat }
  | { type: 'l16/set-vout-linear-n'; n: string }
  | { type: 'l16/set-vout-vid-code'; code: number }
  | { type: 'direct/set-y'; y: string }
  | { type: 'direct/set-coeff'; name: 'm' | 'b' | 'r'; value: string }
  | { type: 'byte-order/set'; endian: Endian }
  | { type: 'copy/toggle-prefix' }
  | { type: 'copy/toggle-space' }
  | { type: 'copy/set-endian'; endian: Endian }
  | { type: 'ui/set-theme'; theme: Theme }
  | { type: 'ui/toggle-debug' }
