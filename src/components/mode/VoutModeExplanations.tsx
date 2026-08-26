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
 * Chinese-primary, structured VOUT_MODE explanation list. Each item renders a
 * single Chinese title and detail (canonical tokens stay verbatim) plus the
 * stable spec reference. There is no side-by-side English translation.
 */
export default function VoutModeExplanations({ explanations }: Props) {
  if (explanations.length === 0) return null

  return (
    <ul className="vout-explanation-list">
      {explanations.map((e) => (
        <li key={e.id} className="vout-explanation" data-severity={e.severity}>
          <div className="vout-explanation-head">
            <span className="vout-explanation-severity">{SEVERITY_LABEL[e.severity]}</span>
            <span className="vout-explanation-title">{e.title}</span>
            <span className="vout-explanation-ref">{e.specRef}</span>
          </div>
          <p className="vout-explanation-detail" lang="zh-CN">
            {e.detail}
          </p>
        </li>
      ))}
    </ul>
  )
}
