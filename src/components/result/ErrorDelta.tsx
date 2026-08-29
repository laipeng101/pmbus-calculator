import type { CalculatorViewModel } from '../../app/view-model'

interface Props {
  vm: CalculatorViewModel
}

/**
 * Format-encoding quantization readout shared by every mode with a
 * physical-value input (LINEAR11, LINEAR16, DIRECT, IEEE Half).
 *
 * Rendered only when an explicit encoding request exists (provenance in the
 * view-model) — an unknown error is never presented as zero. Severity comes
 * from the outcome class, never from the sign or a cross-format threshold.
 */
export default function ErrorDelta({ vm }: Props) {
  if (vm.deltaText == null || vm.deltaText === '') return null

  return (
    <div
      data-testid="quantization-error"
      data-kind={vm.deltaKind ?? 'ok'}
      className="mt-3 rounded-lg px-4 py-2 text-sm panel-surface-muted color-text-secondary"
      aria-live="polite"
    >
      格式编码量化误差:{' '}
      <span className="error-delta-value font-semibold font-mono" data-kind={vm.deltaKind ?? 'ok'}>
        {vm.deltaText}
      </span>
      {vm.deltaNote && (
        <div className="mt-1 text-xs break-all color-text-muted">{vm.deltaNote}</div>
      )}
    </div>
  )
}
