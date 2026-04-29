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

      {/* Primary Value — large, emphasized */}
      <div
        className="mb-4 rounded-xl px-4 py-5 text-center md:px-6 md:py-6"
        style={{
          background:
            'linear-gradient(135deg, rgba(59,130,246,0.08) 0%, rgba(16,185,129,0.08) 100%)',
          border: '1px solid rgba(59,130,246,0.15)',
        }}
      >
        <div className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
          物理值
        </div>
        <div
          className="mt-1 text-3xl font-bold tracking-tight md:text-4xl"
          style={{
            color: 'var(--color-accent)',
            fontFamily: 'var(--font-mono)',
          }}
          aria-live="polite"
        >
          {vm.valueText}
        </div>
        <div className="mt-1 text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>
          {vm.formulaText}
        </div>
      </div>

      {/* Raw Hex */}
      <div className="mb-3">
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
        <div>
          <label className="mb-1 block text-xs" style={{ color: 'var(--color-text-muted)' }}>
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
          <label className="mb-1 block text-xs" style={{ color: 'var(--color-text-muted)' }}>
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

      {/* Copy Tools */}
      <CopyToolbar vm={vm} />
    </section>
  )
}
