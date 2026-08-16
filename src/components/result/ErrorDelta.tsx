import type { CalculatorViewModel } from '../../app/view-model'
import { getQuantizationTextColorToken } from '../../app/result-presentation'

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

  const color = getQuantizationTextColorToken(vm.deltaKind ?? 'ok')

  return (
    <div
      data-testid="quantization-error"
      data-kind={vm.deltaKind ?? 'ok'}
      className="mt-3 rounded-lg px-4 py-2 text-sm"
      style={{
        background: 'var(--color-surface-muted)',
        border: '1px solid var(--color-border)',
        color: 'var(--color-text-secondary)',
      }}
      aria-live="polite"
    >
      量化误差:{' '}
      <span className="font-semibold" style={{ color, fontFamily: 'var(--font-mono)' }}>
        {vm.deltaText}
      </span>
    </div>
  )
}
