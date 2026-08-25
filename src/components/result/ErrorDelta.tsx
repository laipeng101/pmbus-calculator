import type { CalculatorViewModel } from '../../app/view-model'

interface Props {
  vm: CalculatorViewModel
}

/**
 * L11 quantization-error readout.
 *
 * The sign of the error only indicates direction. Severity is decided by the
 * threshold in the view-model, never by the sign.
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
      量化误差:{' '}
      <span className="error-delta-value font-semibold font-mono" data-kind={vm.deltaKind ?? 'ok'}>
        {vm.deltaText}
      </span>
    </div>
  )
}
