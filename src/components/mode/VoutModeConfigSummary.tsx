import type { VoutModeInfoVM } from '../../app/view-model'
import type { TermId } from '../../app/terminology'
import TechnicalTerm from '../term/TechnicalTerm'

const FORMAT_TOKEN: Record<number, string> = {
  0: 'LINEAR',
  1: 'VID',
  2: 'DIRECT',
  3: 'IEEE Half',
}

const FORMAT_TERM_ID: Record<number, TermId> = {
  0: 'linear',
  1: 'vid',
  2: 'direct',
  3: 'binary16',
}

function stateLabel(info: VoutModeInfoVM): string {
  switch (info.domainStatus) {
    case 'valid':
      return info.isRelative ? '相对值' : '绝对值'
    case 'invalid-combination':
      return '非法组合'
    case 'invalid-parameter':
      return '参数非法'
    case 'not-used':
      return '未使用'
    case 'reserved':
      return '保留'
    case 'profile-required':
      return '需器件资料'
    default:
      return info.isRelative ? '相对值' : '绝对值'
  }
}

interface Props {
  info: VoutModeInfoVM
}

/**
 * VOUT_MODE result-panel configuration summary.
 *
 * This is structured configuration state, NOT a math equation: the byte stays
 * in the mono/data role and the tokens/state stay in the UI role. It must not
 * be typeset with KaTeX/serif (M39 font-role contract); real equations keep
 * using KaTeX elsewhere.
 */
export default function VoutModeConfigSummary({ info }: Props) {
  const format = info.format
  return (
    <div
      className="vout-config-summary"
      data-testid="vout-mode-config-summary"
      data-alert={info.structureLegal ? undefined : 'true'}
    >
      <TechnicalTerm termId="vout-mode" />
      <span className="vout-config-seq">=</span>
      <span className="vout-config-byte">{info.hex}</span>
      <span className="vout-config-sep">·</span>
      <TechnicalTerm termId={FORMAT_TERM_ID[format]}>{FORMAT_TOKEN[format]}</TechnicalTerm>
      <span className="vout-config-sep">·</span>
      <span className="vout-config-state">{stateLabel(info)}</span>
    </div>
  )
}
