import type { CalculatorViewModel } from '../../app/view-model'
import type { ResultRowVM } from '../../app/view-model/types'
import { getResultValueSizeClass } from '../../app/result-presentation'
import MathFormula from '../math/MathFormula'
import TechnicalTerm from '../term/TechnicalTerm'

interface Props {
  vm: CalculatorViewModel
}

/**
 * Shared field/generic/substitution row body. Numeric rows typeset real
 * mathematics through the existing KaTeX path; VOUT_MODE rows render a
 * bit-field configuration walkthrough in UI/data font roles and must never
 * contain KaTeX.
 */
function RowBody({ row }: { row: ResultRowVM }) {
  if (row.presentation === 'fields') {
    return (
      <ul className="result-field-list" data-testid={'result-row-' + row.key}>
        {row.fields?.map((field) => (
          <li key={field.label} className="result-field">
            <span className="result-field-label">
              {field.termId ? (
                <TechnicalTerm termId={field.termId}>{field.label}</TechnicalTerm>
              ) : (
                field.label
              )}
            </span>
            <span className={'result-field-value' + (field.code ? ' result-field-code' : '')}>
              {field.value}
            </span>
          </li>
        ))}
      </ul>
    )
  }

  if (row.presentation === 'config') {
    return (
      <div className="result-segments" data-testid={'result-row-' + row.key}>
        {row.segments?.map((segment, index) =>
          segment.termId ? (
            <span key={row.key + '-' + index} className="result-segment" data-role={segment.role}>
              <TechnicalTerm termId={segment.termId}>{segment.text}</TechnicalTerm>
            </span>
          ) : (
            <span key={row.key + '-' + index} className="result-segment" data-role={segment.role}>
              {segment.text}
            </span>
          ),
        )}
      </div>
    )
  }

  return (
    <div className="math-scroll result-math" data-testid={'result-row-' + row.key}>
      <MathFormula latex={row.latex ?? ''} plainText={row.plainText ?? ''} displayMode />
    </div>
  )
}

/**
 * Result-first primary surface for all five modes.
 *
 * One structural skeleton: the headline value anchors the left; the right
 * column reserves the same three semantic rows (fields / generic rule /
 * current substitution or config parse) in every mode. The bottom context row
 * keeps four stable logical slots (Raw / Format / Parameters / Context) and a
 * central direction indicator derived only from committed request provenance.
 * VOUT_MODE keeps the same rhythm but renders structured config rows — a
 * configuration byte is not a math equation and never reaches KaTeX.
 */
export default function ResultSummary({ vm }: Props) {
  const valueSizeClass = getResultValueSizeClass(vm.valueText)
  const isVout = vm.mode === 'VOUT_MODE'
  const configAlert = isVout && vm.voutModePage ? !vm.voutModePage.structureLegal : false

  return (
    <section
      aria-label="结果面板"
      data-testid="result-panel"
      className="result-summary panel-surface min-w-0 rounded-xl p-2 md:p-4"
    >
      <div className="result-summary-grid">
        <div
          data-testid="result-tile"
          className="result-value-tile min-w-0 overflow-hidden rounded-xl px-3 py-2 text-center panel-surface-muted md:px-6 md:py-5"
        >
          <div className="text-xs font-medium color-text-muted">{vm.valueLabel}</div>
          <div
            data-testid="result-value"
            className={'result-value result-value-' + valueSizeClass + ' color-accent'}
            aria-live="polite"
          >
            {vm.valueText}
          </div>
        </div>

        <div
          key={vm.mode}
          className="result-summary-rows min-w-0"
          data-testid={isVout ? 'vout-mode-config-summary' : 'result-rows'}
          data-row-layout={vm.workspace.layout}
          data-alert={configAlert ? 'true' : undefined}
        >
          {vm.workspace.rows.map((row) => (
            <div
              key={row.key}
              className="result-row"
              data-row={row.key}
              data-presentation={row.presentation}
            >
              <div className="result-row-label">
                {isVout && row.key === 'fields' ? (
                  <>
                    <TechnicalTerm termId="vout-mode" /> {row.label}
                  </>
                ) : (
                  row.label
                )}
              </div>
              <div className="result-row-value">
                <RowBody row={row} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="result-context-row">
        <dl data-testid="result-context" className="result-context-grid">
          {vm.resultContext.map((item) => (
            <div key={item.key} className="result-context-slot" data-slot={item.key}>
              <dt className="result-context-label">{item.label}</dt>
              <dd className="result-context-value min-w-0 break-words">
                {item.kind === 'params' ? (
                  <span className="result-context-params" data-testid="result-context-params">
                    {item.params.map((pair, index) => (
                      <span className="result-context-param" key={pair.label + '-' + index}>
                        <span className="result-context-param-label">
                          {pair.termId ? (
                            <TechnicalTerm termId={pair.termId}>{pair.label}</TechnicalTerm>
                          ) : (
                            pair.label
                          )}
                        </span>
                        <span className="result-context-param-value">{pair.value}</span>
                      </span>
                    ))}
                  </span>
                ) : item.termId ? (
                  <TechnicalTerm termId={item.termId}>{item.value}</TechnicalTerm>
                ) : (
                  <span className={item.code ? 'font-mono' : undefined}>{item.value}</span>
                )}
              </dd>
            </div>
          ))}
        </dl>
        {vm.workspace.direction ? (
          <div
            className="result-direction"
            data-testid="result-direction"
            data-kind={vm.workspace.direction.kind}
          >
            {vm.workspace.direction.label}
          </div>
        ) : null}
      </div>
    </section>
  )
}
