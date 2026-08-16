import { useState, useCallback } from 'react'
import type { CalculatorViewModel } from '../../app/view-model'
import type { AppState } from '../../app/state'
import { copyTextToClipboard } from '../../app/copy-utils'

interface Props {
  vm: CalculatorViewModel
  copyPrefs: AppState['copy']
  onTogglePrefix: () => void
  onToggleSpace: () => void
  onCopyEndianChange: (endian: AppState['copy']['endian']) => void
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
      await copyTextToClipboard(text)
      setFeedback(`已复制: ${label}`)
    } catch {
      setFeedback('复制失败')
    }
  }, [])

  const copyHex = copyPrefs.endian === 'be' ? vm.rawBytesBE : vm.rawBytesLE

  return (
    <div className="copy-toolbar space-y-2">
      <div className="flex flex-wrap gap-2">
        <CopyButton onClick={() => copy(copyHex, 'Hex')} label="📋 Hex" />
        <CopyButton onClick={() => copy(vm.rawBytesLE, 'LE bytes')} label="📋 LE bytes" />
        <CopyButton onClick={() => copy(vm.rawBytesBE, 'BE bytes')} label="📋 BE bytes" />
        <CopyButton onClick={() => copy(vm.valueText, '物理值')} label="📋 值" />
        <CopyButton onClick={() => copy(vm.cMacroText, 'C 宏')} label="C 代码" />
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
          type="button"
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
          type="button"
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
          type="button"
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
          className="copy-feedback rounded-md px-3 py-1.5 text-xs font-medium"
          style={{
            background: 'var(--color-success)',
            color: '#fff',
          }}
          role="status"
          aria-live="polite"
          onAnimationEnd={() => setFeedback(null)}
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
      type="button"
      onClick={onClick}
      className="rounded-md px-3 py-1.5 text-xs font-medium"
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
