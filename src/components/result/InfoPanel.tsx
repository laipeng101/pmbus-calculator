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
          className="flex items-start gap-2 rounded-lg px-4 py-3 text-sm"
          role="alert"
          style={{
            background:
              w.level === 'error'
                ? 'var(--color-danger-surface)'
                : w.level === 'warning'
                  ? 'var(--color-warning-surface)'
                  : 'var(--color-info-surface)',
            border: '1px solid var(--color-border)',
            borderLeft: `3px solid ${
              w.level === 'error'
                ? 'var(--color-danger)'
                : w.level === 'warning'
                  ? 'var(--color-warning)'
                  : 'var(--color-info)'
            }`,
            color: 'var(--color-text-primary)',
          }}
        >
          <span className="mt-0.5 inline-flex" aria-hidden="true" style={{ color: 'currentColor' }}>
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
