import { useState, useCallback } from 'react'
import type { CalculatorViewModel } from '../../app/view-model'
import type { AppState } from '../../app/state'

interface Props {
  vm: CalculatorViewModel
  copyPrefs: AppState['copy']
  onTogglePrefix: () => void
  onToggleSpace: () => void
  onCopyEndianChange: (endian: AppState['copy']['endian']) => void
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }

  // Fallback for non-secure contexts / older browsers.
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  const ok = document.execCommand('copy')
  textarea.remove()
  if (!ok) throw new Error('copy rejected')
}

export default function CopyToolbar({
  vm,
  copyPrefs,
  onTogglePrefix,
  onToggleSpace,
  onCopyEndianChange,
}: Props) {
  const [feedback, setFeedback] = useState<string | null>(null)

  const copy = useCallback(async (text: string, label: string) => {
    try {
      await copyText(text)
      setFeedback(`已复制: ${label}`)
    } catch {
      setFeedback('复制失败')
    }
    setTimeout(() => setFeedback(null), 1500)
  }, [])

  const copyHex = copyPrefs.endian === 'be' ? vm.rawBytesBE : vm.rawBytesLE

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <CopyButton onClick={() => copy(copyHex, 'Hex')} label="📋 Hex" />
        <CopyButton onClick={() => copy(vm.valueText, '物理值')} label="📋 值" />
        <CopyButton
          onClick={() => copy(`#define RAW_VALUE ${vm.rawHex} /* ${vm.formulaText} */`, 'C 宏')}
          label="C 代码"
        />
      </div>

      <div
        className="flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-xs"
        style={{
          background: 'var(--color-surface-muted)',
          border: '1px solid var(--color-border)',
          color: 'var(--color-text-secondary)',
        }}
      >
        <button
          onClick={onTogglePrefix}
          aria-pressed={copyPrefs.prefix0x}
          className="rounded px-2 py-1 font-medium"
          style={{
            background: copyPrefs.prefix0x ? 'var(--color-accent)' : 'var(--color-surface)',
            color: copyPrefs.prefix0x ? '#fff' : 'var(--color-text-secondary)',
            border: '1px solid var(--color-border)',
          }}
        >
          0x 前缀
        </button>
        <button
          onClick={onToggleSpace}
          aria-pressed={copyPrefs.spaceBetweenBytes}
          className="rounded px-2 py-1 font-medium"
          style={{
            background: copyPrefs.spaceBetweenBytes
              ? 'var(--color-accent)'
              : 'var(--color-surface)',
            color: copyPrefs.spaceBetweenBytes ? '#fff' : 'var(--color-text-secondary)',
            border: '1px solid var(--color-border)',
          }}
        >
          字节空格
        </button>
        <button
          onClick={() => onCopyEndianChange(copyPrefs.endian === 'le' ? 'be' : 'le')}
          aria-pressed={copyPrefs.endian === 'be'}
          className="rounded px-2 py-1 font-medium"
          style={{
            background: copyPrefs.endian === 'be' ? 'var(--color-accent)' : 'var(--color-surface)',
            color: copyPrefs.endian === 'be' ? '#fff' : 'var(--color-text-secondary)',
            border: '1px solid var(--color-border)',
          }}
        >
          HEX 复制: {copyPrefs.endian.toUpperCase()}
        </button>
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

function CopyButton({ onClick, label }: { onClick: () => void; label: string }) {
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
