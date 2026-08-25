import type { CalculationStepVM } from '../../app/calculation-steps'
import MathFormula from '../math/MathFormula'

interface Props {
  steps: CalculationStepVM[]
}

const KIND_LABELS: Record<CalculationStepVM['kind'], string> = {
  field: '字段',
  formula: '公式',
  intermediate: '中间值',
  result: '结果',
  warning: '提示',
}

/**
 * Unified calculation-process readout shared by L11 / L16 / DIRECT / HALF.
 * Renders only view-model produced steps; never computes values itself.
 */
export default function CalculationSteps({ steps }: Props) {
  if (steps.length === 0) return null

  return (
    <section
      aria-label="计算过程"
      data-testid="calculation-steps"
      className="mb-4 min-w-0 rounded-xl px-4 py-3"
      style={{
        background: 'var(--color-surface-muted)',
        border: '1px solid var(--color-border)',
      }}
    >
      <h3
        className="mb-3 text-xs font-semibold uppercase tracking-wider"
        style={{ color: 'var(--color-text-secondary)' }}
      >
        计算过程
      </h3>
      <ol className="space-y-2">
        {steps.map((step) => {
          const isWarning = step.kind === 'warning'
          return (
            <li
              key={step.id}
              data-step-kind={step.kind}
              className="flex min-w-0 items-start gap-2 text-sm"
              style={{ color: 'var(--color-text-primary)' }}
            >
              <span
                className="mt-0.5 inline-flex shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                style={{
                  background: isWarning
                    ? 'var(--color-warning-surface)'
                    : step.kind === 'result'
                      ? 'var(--color-accent-solid)'
                      : 'var(--color-surface)',
                  color: isWarning
                    ? 'var(--color-warning)'
                    : step.kind === 'result'
                      ? 'var(--color-on-accent)'
                      : 'var(--color-text-muted)',
                  border: '1px solid var(--color-border)',
                }}
              >
                {KIND_LABELS[step.kind]}
              </span>
              <div className="min-w-0">
                <div className="font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                  {step.label}
                </div>
                <div className="math-scroll min-w-0">
                  {step.latex ? (
                    <MathFormula
                      latex={step.latex}
                      plainText={step.plainText}
                      displayMode={false}
                    />
                  ) : (
                    <span
                      className="break-words"
                      style={{
                        color: isWarning
                          ? 'var(--color-warning)'
                          : step.kind === 'result'
                            ? 'var(--color-accent)'
                            : 'var(--color-text-primary)',
                        fontFamily: step.kind === 'result' ? 'var(--font-mono)' : undefined,
                      }}
                    >
                      {step.plainText}
                    </span>
                  )}
                </div>
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
