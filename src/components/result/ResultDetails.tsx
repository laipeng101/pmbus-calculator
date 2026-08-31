import type { CalculatorViewModel } from '../../app/view-model'
import type { AppState } from '../../app/state'
import TechnicalTerm from '../term/TechnicalTerm'
import CalculationSteps from './CalculationSteps'
import ErrorDelta from './ErrorDelta'
import CopyToolbar from './CopyToolbar'
import InfoPanel from './InfoPanel'

interface Props {
  vm: CalculatorViewModel
  copyPrefs: AppState['copy']
  onTogglePrefix: () => void
  onToggleSpace: () => void
  onCopyEndianChange: (endian: AppState['copy']['endian']) => void
}

/**
 * Auxiliary result tools shown in the workspace secondary column.
 *
 * The primary physical result lives in ResultSummary above the workspace; this
 * panel keeps raw Hex, byte order, quantization error, copy tools, warnings and
 * the collapsible calculation walkthrough. It deliberately does NOT carry the
 * result-panel live-region contract, so there is only one live result region.
 */
export default function ResultDetails({
  vm,
  copyPrefs,
  onTogglePrefix,
  onToggleSpace,
  onCopyEndianChange,
}: Props) {
  return (
    <section
      aria-label="辅助结果"
      data-testid="result-details"
      className="panel-surface min-w-0 rounded-xl p-4 md:p-5"
    >
      <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider color-text-secondary">
        辅助结果
      </h2>

      <div className="space-y-3">
        <CalculationSteps steps={vm.steps} />

        {vm.mode !== 'VOUT_MODE' && (
          <>
            {/* Raw Hex */}
            <div className="min-w-0">
              <div className="mb-1 text-xs color-text-muted">
                原始 <TechnicalTerm termId="hex" />
              </div>
              <div className="input-surface rounded-lg px-4 py-2 text-lg font-semibold">
                {vm.rawHex}
              </div>
            </div>

            {/* Byte Order */}
            <div className="grid grid-cols-2 gap-3">
              <div className="min-w-0">
                <div className="mb-1 text-xs color-text-muted">
                  小端序（
                  <TechnicalTerm termId="le" />）
                </div>
                <div className="input-surface rounded-lg px-3 py-2 text-sm font-medium">
                  {vm.rawBytesLE}
                </div>
              </div>
              <div className="min-w-0">
                <div className="mb-1 text-xs color-text-muted">
                  大端序（
                  <TechnicalTerm termId="be" />）
                </div>
                <div className="input-surface rounded-lg px-3 py-2 text-sm font-medium">
                  {vm.rawBytesBE}
                </div>
              </div>
            </div>

            {/* Quantization error (L11/L16/DIRECT/HALF) */}
            <ErrorDelta vm={vm} />

            {/* Copy Tools */}
            <CopyToolbar
              vm={vm}
              copyPrefs={copyPrefs}
              onTogglePrefix={onTogglePrefix}
              onToggleSpace={onToggleSpace}
              onCopyEndianChange={onCopyEndianChange}
            />
          </>
        )}

        <InfoPanel warnings={vm.warnings} />
      </div>
    </section>
  )
}
