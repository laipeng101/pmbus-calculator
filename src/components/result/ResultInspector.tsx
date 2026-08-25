import type { CalculatorViewModel } from '../../app/view-model'
import type { AppState } from '../../app/state'
import { getResultValueSizeClass } from '../../app/result-presentation'
import CopyToolbar from './CopyToolbar'
import ErrorDelta from './ErrorDelta'
import MathFormula from '../math/MathFormula'
import CalculationSteps from './CalculationSteps'

interface Props {
  vm: CalculatorViewModel
  copyPrefs: AppState['copy']
  onTogglePrefix: () => void
  onToggleSpace: () => void
  onCopyEndianChange: (endian: AppState['copy']['endian']) => void
}

export default function ResultInspector({
  vm,
  copyPrefs,
  onTogglePrefix,
  onToggleSpace,
  onCopyEndianChange,
}: Props) {
  const valueSizeClass = getResultValueSizeClass(vm.valueText)

  return (
    <section
      aria-label="结果面板"
      data-testid="result-panel"
      className="min-w-0 rounded-xl p-4 md:p-5"
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        boxShadow: 'var(--shadow-panel)',
      }}
    >
      <h2
        className="mb-4 text-xs font-semibold uppercase tracking-wider"
        style={{ color: 'var(--color-text-secondary)' }}
      >
        计算结果
      </h2>

      {/* Unified calculation process: fields -> formula -> intermediates -> result */}
      <CalculationSteps steps={vm.steps} />

      {/* Primary Value — adaptive mono headline, never truncated or scaled. */}
      <div
        data-testid="result-tile"
        className="result-value-tile mb-4 min-w-0 rounded-xl px-4 py-5 text-center md:px-6 md:py-6"
        style={{
          background: 'var(--color-surface-muted)',
          border: '1px solid var(--color-border)',
          overflow: 'hidden',
        }}
      >
        <div className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
          物理值
        </div>
        <div
          data-testid="result-value"
          className={`result-value result-value-${valueSizeClass}`}
          style={{
            color: 'var(--color-accent)',
          }}
          aria-live="polite"
        >
          {vm.valueText}
        </div>

        <div className="result-formula mt-1">
          {vm.formulaDetailLines.length > 0 ? (
            <div className="space-y-1.5">
              {vm.formulaDetailLines.map((line, index) =>
                line.kind === 'summary' ? (
                  <div
                    key={`${line.kind}-${index}`}
                    data-testid="formula-summary"
                    className="formula-summary"
                  >
                    {line.plainText}
                  </div>
                ) : (
                  <div
                    key={`${line.kind}-${index}`}
                    className="math-scroll flex justify-center text-sm font-medium"
                    style={{ color: 'var(--color-text-secondary)' }}
                    data-testid="formula-line"
                  >
                    <MathFormula latex={line.latex} plainText={line.plainText} displayMode />
                  </div>
                ),
              )}
            </div>
          ) : (
            <div
              className="math-scroll flex justify-center text-sm font-medium"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              <MathFormula latex={vm.formulaLatex} plainText={vm.formulaText} displayMode />
            </div>
          )}
        </div>
      </div>

      {/* Raw Hex */}
      <div className="mb-3 min-w-0">
        <label className="mb-1 block text-xs" style={{ color: 'var(--color-text-muted)' }}>
          原始 Hex
        </label>
        <div
          className="rounded-lg px-4 py-2 text-lg font-semibold"
          style={{
            background: 'var(--color-surface-muted)',
            color: 'var(--color-text-primary)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          {vm.rawHex}
        </div>
      </div>

      {/* Byte Order */}
      <div className="mb-3 grid grid-cols-2 gap-3">
        <div className="min-w-0">
          <label className="mb-1 block text-xs" style={{ color: 'var(--color-text-muted)' }}>
            小端序（LE）
          </label>
          <div
            className="rounded-lg px-3 py-2 text-sm font-medium"
            style={{
              background: 'var(--color-surface-muted)',
              color: 'var(--color-text-primary)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            {vm.rawBytesLE}
          </div>
        </div>
        <div className="min-w-0">
          <label className="mb-1 block text-xs" style={{ color: 'var(--color-text-muted)' }}>
            大端序（BE）
          </label>
          <div
            className="rounded-lg px-3 py-2 text-sm font-medium"
            style={{
              background: 'var(--color-surface-muted)',
              color: 'var(--color-text-primary)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            {vm.rawBytesBE}
          </div>
        </div>
      </div>

      {/* Quantization error (L11) */}
      <ErrorDelta vm={vm} />

      {/* Copy Tools */}
      <CopyToolbar
        vm={vm}
        copyPrefs={copyPrefs}
        onTogglePrefix={onTogglePrefix}
        onToggleSpace={onToggleSpace}
        onCopyEndianChange={onCopyEndianChange}
      />
    </section>
  )
}
