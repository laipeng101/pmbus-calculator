import type { CalculatorViewModel } from '../../app/view-model'

interface Props {
  vm: CalculatorViewModel
}

/**
 * L11 quantization-error readout.
 *
 * The color is intentionally mapped to CSS variables so it follows the active
 * theme; `deltaKind === 'ok'` means the encoded value is within tolerance.
 */
export default function ErrorDelta({ vm }: Props) {
  if (!vm.deltaText) return null

  const color =
    vm.deltaKind === 'warn' || vm.deltaKind === 'error'
      ? 'var(--color-danger)'
      : 'var(--color-success)'

  return (
    <div
      className="mt-3 rounded-lg px-4 py-2 text-sm"
      style={{
        background: 'var(--color-surface-muted)',
        border: '1px solid var(--color-border)',
        color: 'var(--color-text-secondary)',
      }}
      aria-live="polite"
    >
      误差:{' '}
      <span className="font-semibold" style={{ color, fontFamily: 'var(--font-mono)' }}>
        {vm.deltaText}
      </span>
    </div>
  )
}
