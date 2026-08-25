import type { WarningVM } from '../../app/view-model'
import { ErrorIcon, InfoIcon, WarningIcon } from '../icons/Icon'

interface Props {
  warnings: WarningVM[]
}

export default function InfoPanel({ warnings }: Props) {
  if (warnings.length === 0) return null

  return (
    <section aria-label="提示信息" className="space-y-2">
      {warnings.map((w) => (
        <div
          key={w.id}
          className="alert-panel flex items-start gap-2 rounded-lg px-4 py-3 text-sm"
          data-level={w.level}
          role="alert"
        >
          <span className="mt-0.5 inline-flex" aria-hidden="true">
            {w.level === 'error' ? (
              <ErrorIcon size={16} />
            ) : w.level === 'warning' ? (
              <WarningIcon size={16} />
            ) : (
              <InfoIcon size={16} />
            )}
          </span>
          <span>{w.text}</span>
        </div>
      ))}
    </section>
  )
}
