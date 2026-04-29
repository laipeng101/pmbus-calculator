import type { CalculatorViewModel } from '../../app/view-model'
import CopyToolbar from './CopyToolbar'

interface Props {
  vm: CalculatorViewModel
}

export default function ResultInspector({ vm }: Props) {
  return (
    <section
      aria-label="结果面板"
      className="rounded-xl p-4 md:p-5"
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

      {/* Value */}
      <div className="mb-4">
        <label
          className="mb-1 block text-xs"
          style={{ color: 'var(--color-text-muted)' }}
        >
          物理值
        </label>
        <div
          className="rounded-lg px-4 py-3 text-2xl font-bold tracking-tight md:text-3xl"
          style={{
            background: 'var(--color-surface-muted)',
            color: 'var(--color-accent)',
            fontFamily: 'var(--font-mono)',
          }}
          aria-live="polite"
        >
          {vm.valueText}
        </div>
      </div>

      {/* Raw Hex */}
      <div className="mb-4">
        <label
          className="mb-1 block text-xs"
          style={{ color: 'var(--color-text-muted)' }}
        >
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
      <div className="mb-4 grid grid-cols-2 gap-3">
        <div>
          <label
            className="mb-1 block text-xs"
            style={{ color: 'var(--color-text-muted)' }}
          >
            小端序 (LE)
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
        <div>
          <label
            className="mb-1 block text-xs"
            style={{ color: 'var(--color-text-muted)' }}
          >
            大端序 (BE)
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

      {/* Formula */}
      <div className="mb-4">
        <label
          className="mb-1 block text-xs"
          style={{ color: 'var(--color-text-muted)' }}
        >
          公式
        </label>
        <div
          className="rounded-lg px-4 py-2 text-sm"
          style={{
            background: 'var(--color-surface-muted)',
            color: 'var(--color-text-secondary)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          {vm.formulaText}
        </div>
      </div>

      {/* Copy Tools */}
      <CopyToolbar vm={vm} />
    </section>
  )
}
