import { useState, useCallback } from 'react'
import type { CalculatorViewModel } from '../../app/view-model'

interface Props {
  vm: CalculatorViewModel
}

export default function CopyToolbar({ vm }: Props) {
  const [feedback, setFeedback] = useState<string | null>(null)

  const copy = useCallback(
    async (text: string, label: string) => {
      try {
        await navigator.clipboard.writeText(text)
        setFeedback(`已复制: ${label}`)
      } catch {
        setFeedback('复制失败')
      }
      setTimeout(() => setFeedback(null), 1500)
    },
    []
  )

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <CopyButton
          onClick={() => copy(vm.rawHex, 'Hex')}
          label="📋 Hex"
        />
        <CopyButton
          onClick={() => copy(vm.valueText, '物理值')}
          label="📋 值"
        />
        <CopyButton
          onClick={() =>
            copy(
              `#define RAW_VALUE ${vm.rawHex} /* ${vm.formulaText} */`,
              'C 宏'
            )
          }
          label="C 代码"
        />
      </div>
      {feedback && (
        <div
          className="rounded-md px-3 py-1.5 text-xs font-medium"
          style={{
            background: 'var(--color-success)',
            color: '#fff',
          }}
          role="status"
          aria-live="polite"
        >
          {feedback}
        </div>
      )}
    </div>
  )
}

function CopyButton({
  onClick,
  label,
}: {
  onClick: () => void
  label: string
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-md px-3 py-1.5 text-xs font-medium transition-all hover:opacity-80 active:scale-95"
      style={{
        background: 'var(--color-surface-muted)',
        color: 'var(--color-text-primary)',
        border: '1px solid var(--color-border)',
      }}
    >
      {label}
    </button>
  )
}
