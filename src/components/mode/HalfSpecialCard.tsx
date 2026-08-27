import type { HalfSpecialSemantics } from '../../app/half-special-semantics'

interface Props {
  semantics: HalfSpecialSemantics
}

/**
 * PMBus §7.6.2 operational-semantics notice for a HALF NaN / ±Infinity raw
 * word (v2.5.5). Pure presentation: the view-model decides presence, kind and
 * copy; this component never inspects the value itself. Rendered for BOTH
 * user paths (raw decode and value encode) because it is driven by the shared
 * raw word, and it always lists the write-side and read-side interpretations
 * without guessing the actual command direction.
 */
export default function HalfSpecialCard({ semantics }: Props) {
  return (
    <aside
      className="half-special-card rounded-xl px-4 py-3 text-sm"
      data-testid="half-special-semantics"
      data-kind={semantics.id}
      data-level={semantics.severity}
      role="note"
      aria-label={`PMBus 特殊值操作语义：${semantics.title}`}
    >
      <p className="half-special-title font-semibold">{semantics.title}</p>
      <p className="half-special-scope mt-1 text-xs">{semantics.scopeNote}</p>
      <dl className="mt-2 space-y-2">
        <div className="min-w-0">
          <dt className="half-special-term text-xs font-semibold">作为写入数据</dt>
          <dd className="mt-0.5">{semantics.send}</dd>
        </div>
        <div className="min-w-0">
          <dt className="half-special-term text-xs font-semibold">作为设备读回值</dt>
          <dd className="mt-0.5">{semantics.read}</dd>
        </div>
      </dl>
      <p className="half-special-ref mt-2 text-xs">{semantics.specRef}</p>
    </aside>
  )
}
