import type { ControlHelpParams } from './control-help'
import type { TermId } from './terminology'

/**
 * Single source for the VOUT_MODE format → UI label / glossary term mapping.
 *
 * Previously `FORMAT_TERM_ID` was duplicated between VoutModeComposer and
 * VoutModeConfigSummary (v2.6.0 unified the copies). Components must consume
 * this module instead of redeclaring format/token/term maps.
 */

export type VoutModeFormatValue = 0 | 1 | 2 | 3

type FormatHelpId = keyof Pick<
  ControlHelpParams,
  'vout-format-linear' | 'vout-format-vid' | 'vout-format-direct' | 'vout-format-half'
>

export interface VoutModeFormatOption {
  value: VoutModeFormatValue
  /** Canonical UI token shown on the format radio / summary. */
  label: string
  /** Glossary concept explaining the format. */
  termId: TermId
  /** Control tooltip registry id for the format radio. */
  helpId: FormatHelpId
}

export const VOUT_MODE_FORMATS: readonly [
  VoutModeFormatOption,
  VoutModeFormatOption,
  VoutModeFormatOption,
  VoutModeFormatOption,
] = [
  { value: 0, label: 'LINEAR', termId: 'linear', helpId: 'vout-format-linear' },
  { value: 1, label: 'VID', termId: 'vid', helpId: 'vout-format-vid' },
  { value: 2, label: 'DIRECT', termId: 'direct', helpId: 'vout-format-direct' },
  { value: 3, label: 'IEEE Half', termId: 'binary16', helpId: 'vout-format-half' },
]

function findFormat(format: number): VoutModeFormatOption {
  return VOUT_MODE_FORMATS.find((f) => f.value === format) ?? VOUT_MODE_FORMATS[0]
}

export function voutModeFormatTerm(format: number): TermId {
  return findFormat(format).termId
}

export function voutModeFormatLabel(format: number): string {
  return findFormat(format).label
}

/**
 * Visible disabled reasons for the L16-embedded bits[6:5] lock (v2.6.2).
 * One source feeds the bit aria-labels, the disabled-bit tooltip params AND
 * the always-visible reason line: a natively disabled button emits no pointer
 * or focus events, so the reason must exist outside any hover overlay too.
 */
export const L16_FORMAT_BIT_DISABLED_HINTS = {
  linked: '格式位固定为 LINEAR',
  'non-linear': '格式位不可在本页切换（当前字节非 LINEAR）',
} as const

export function l16FormatBitDisabledHint(source: 'linked' | 'non-linear' | undefined): string {
  return source === 'non-linear'
    ? L16_FORMAT_BIT_DISABLED_HINTS['non-linear']
    : L16_FORMAT_BIT_DISABLED_HINTS.linked
}
