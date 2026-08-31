import type { TermId } from './terminology'

/**
 * Single source for the VOUT_MODE format → UI label / glossary term mapping.
 *
 * Previously `FORMAT_TERM_ID` was duplicated between VoutModeComposer and
 * VoutModeConfigSummary (v2.6.0 unified the copies). Components must consume
 * this module instead of redeclaring format/token/term maps.
 */

export type VoutModeFormatValue = 0 | 1 | 2 | 3

export interface VoutModeFormatOption {
  value: VoutModeFormatValue
  /** Canonical UI token shown on the format radio / summary. */
  label: string
  /** Glossary concept explaining the format. */
  termId: TermId
}

export const VOUT_MODE_FORMATS: readonly [
  VoutModeFormatOption,
  VoutModeFormatOption,
  VoutModeFormatOption,
  VoutModeFormatOption,
] = [
  { value: 0, label: 'LINEAR', termId: 'linear' },
  { value: 1, label: 'VID', termId: 'vid' },
  { value: 2, label: 'DIRECT', termId: 'direct' },
  { value: 3, label: 'IEEE Half', termId: 'binary16' },
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
