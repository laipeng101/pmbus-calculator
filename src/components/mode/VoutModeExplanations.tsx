import type { VoutModeExplanation } from '../../app/vout-mode-explanation'

interface Props {
  explanations: VoutModeExplanation[]
}

const SEVERITY_LABEL = {
  info: '信息',
  warning: '警告',
  error: '错误',
} as const

/**
 * Bilingual, structured VOUT_MODE explanation list. zh and en are rendered
 * side by side; the spec reference is shown as a stable machine-readable ref.
 */
export default function VoutModeExplanations({ explanations }: Props) {
  if (explanations.length === 0) return null

  return (
    <ul className="vout-explanation-list">
      {explanations.map((e) => (
        <li key={e.id} className="vout-explanation" data-severity={e.severity}>
          <div className="vout-explanation-head">
            <span className="vout-explanation-severity">{SEVERITY_LABEL[e.severity]}</span>
            <span className="vout-explanation-title-zh">{e.title.zh}</span>
            <span className="vout-explanation-title-en">{e.title.en}</span>
            <span className="vout-explanation-ref">{e.specRef}</span>
          </div>
          <p className="vout-explanation-detail">
            <span lang="zh-CN">{e.detail.zh}</span>
            <span className="vout-explanation-detail-sep" aria-hidden="true">
              ·
            </span>
            <span lang="en">{e.detail.en}</span>
          </p>
        </li>
      ))}
    </ul>
  )
}
