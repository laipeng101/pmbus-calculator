import { useId } from 'react'
import { HALF_SPECIAL_SPEC_REF, type HalfSpecialSemantics } from '../../app/half-special-semantics'

interface Props {
  semantics: HalfSpecialSemantics
}

export default function HalfSpecialCard({ semantics }: Props) {
  const titleId = useId()

  return (
    <aside
      className="half-special-card rounded-xl px-4 py-3 text-sm"
      data-testid="half-special-semantics"
      data-kind={semantics.id}
      role="note"
      aria-labelledby={titleId}
    >
      <p id={titleId} className="half-special-title font-semibold">
        {semantics.title}
      </p>
      <dl className="mt-2 space-y-2">
        <div className="min-w-0">
          <dt className="half-special-term text-xs font-semibold">写入设备时</dt>
          <dd className="mt-0.5">{semantics.write}</dd>
        </div>
        <div className="min-w-0">
          <dt className="half-special-term text-xs font-semibold">设备返回时</dt>
          <dd className="mt-0.5">{semantics.read}</dd>
        </div>
      </dl>
      <p className="half-special-ref mt-2 text-xs">
        设备读回主机先前写入的值时，须保留原始 IEEE 754 编码。（{HALF_SPECIAL_SPEC_REF}）
      </p>
    </aside>
  )
}
