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
      className="calc-steps-panel mb-4 min-w-0 rounded-xl px-4 py-3"
    >
      <h3 className="calc-steps-heading mb-3 text-xs font-semibold uppercase tracking-wider">
        计算过程
      </h3>
      <ol className="space-y-2">
        {steps.map((step) => {
          return (
            <li
              key={step.id}
              data-step-kind={step.kind}
              className="calc-steps-row flex min-w-0 items-start gap-2 text-sm"
            >
              <span className="calc-steps-kind mt-0.5 inline-flex shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                {KIND_LABELS[step.kind]}
              </span>
              <div className="min-w-0">
                <div className="calc-steps-label font-medium">{step.label}</div>
                <div className="math-scroll min-w-0">
                  {step.latex ? (
                    <MathFormula
                      latex={step.latex}
                      plainText={step.plainText}
                      displayMode={false}
                    />
                  ) : (
                    <span className="calc-steps-plain break-words">{step.plainText}</span>
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
