import type { CalculatorViewModel } from '../../app/view-model'
import { getResultValueSizeClass } from '../../app/result-presentation'
import MathFormula from '../math/MathFormula'

interface Props {
  vm: CalculatorViewModel
}

/**
 * Result-first primary summary.
 *
 * This is the single result-panel contract holder. It sits between the mode
 * switcher and the workspace so the physical value is visible without
 * scrolling. It only renders view-model values and formula presentation lines;
 * it never computes anything itself.
 */
export default function ResultSummary({ vm }: Props) {
  const valueSizeClass = getResultValueSizeClass(vm.valueText)

  return (
    <section
      aria-label="结果面板"
      data-testid="result-panel"
      className="result-summary panel-surface min-w-0 rounded-xl p-4 md:p-5"
    >
      <div className="result-summary-grid">
        <div
          data-testid="result-tile"
          className="result-value-tile min-w-0 overflow-hidden rounded-xl px-4 py-4 text-center panel-surface-muted md:px-6 md:py-5"
        >
          <div className="text-xs font-medium color-text-muted">物理值</div>
          <div
            data-testid="result-value"
            className={`result-value result-value-${valueSizeClass} color-accent`}
            aria-live="polite"
          >
            {vm.valueText}
          </div>
        </div>

        <div className="result-summary-formula min-w-0">
          {vm.formulaDetailLines.length > 0 ? (
            <div className="space-y-1.5">
              {vm.formulaDetailLines.map((line, index) =>
                line.kind === 'summary' ? (
                  <div
                    key={`${line.kind}-${index}`}
                    data-testid="formula-summary"
                    className="formula-summary text-center md:text-left"
                  >
                    {line.plainText}
                  </div>
                ) : (
                  <div
                    key={`${line.kind}-${index}`}
                    className="math-scroll flex justify-center text-sm font-medium color-text-secondary md:justify-start"
                    data-testid="formula-line"
                  >
                    <MathFormula latex={line.latex} plainText={line.plainText} displayMode />
                  </div>
                ),
              )}
            </div>
          ) : (
            <div className="math-scroll flex justify-center text-sm font-medium color-text-secondary md:justify-start">
              <MathFormula latex={vm.formulaLatex} plainText={vm.formulaText} displayMode />
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
