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
 *
 * Collapsed by default behind a native disclosure; opening or closing it is
 * purely presentational and never changes calculator state. Renders only
 * view-model produced steps; never computes values itself.
 */
export default function CalculationSteps({ steps }: Props) {
  if (steps.length === 0) return null

  return (
    <details
      className="calc-steps-disclosure min-w-0 rounded-xl"
      data-testid="calculation-steps-disclosure"
    >
      <summary className="calc-steps-summary" data-testid="calculation-steps-summary">
        计算过程（{steps.length} 步）
      </summary>

      <section
        aria-label="计算过程"
        data-testid="calculation-steps"
        className="calc-steps-panel min-w-0 rounded-xl px-4 py-3"
      >
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
    </details>
  )
}
