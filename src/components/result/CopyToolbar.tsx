import { useCallback, useEffect, useRef, useState } from 'react'
import type { CalculatorViewModel } from '../../app/view-model'
import type { AppState } from '../../app/state'
import { copyTextToClipboard } from '../../app/copy-utils'
import { CopyIcon } from '../icons/Icon'

interface Props {
  vm: CalculatorViewModel
  copyPrefs: AppState['copy']
  onTogglePrefix: () => void
  onToggleSpace: () => void
  onCopyEndianChange: (endian: AppState['copy']['endian']) => void
}

const FEEDBACK_DURATION_MS = 1800

export default function CopyToolbar({
  vm,
  copyPrefs,
  onTogglePrefix,
  onToggleSpace,
  onCopyEndianChange,
}: Props) {
  const [feedback, setFeedback] = useState<string | null>(null)
  const feedbackTimerRef = useRef<number | null>(null)

  const clearFeedbackTimer = useCallback(() => {
    if (feedbackTimerRef.current != null) {
      window.clearTimeout(feedbackTimerRef.current)
      feedbackTimerRef.current = null
    }
  }, [])

  useEffect(() => clearFeedbackTimer, [clearFeedbackTimer])

  const showFeedback = useCallback(
    (text: string) => {
      clearFeedbackTimer()
      setFeedback(text)
      feedbackTimerRef.current = window.setTimeout(() => {
        setFeedback(null)
        feedbackTimerRef.current = null
      }, FEEDBACK_DURATION_MS)
    },
    [clearFeedbackTimer],
  )

  const copy = useCallback(
    async (text: string, label: string) => {
      try {
        await copyTextToClipboard(text)
        showFeedback(`已复制: ${label}`)
      } catch {
        showFeedback('复制失败')
      }
    },
    [showFeedback],
  )

  const copyHex = copyPrefs.endian === 'be' ? vm.rawBytesBE : vm.rawBytesLE

  return (
    <div className="copy-toolbar space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <CopyButton onClick={() => copy(copyHex, 'Hex')} label="Hex" />
        <CopyButton onClick={() => copy(vm.rawBytesLE, 'LE bytes')} label="LE bytes" />
        <CopyButton onClick={() => copy(vm.rawBytesBE, 'BE bytes')} label="BE bytes" />
        <CopyButton onClick={() => copy(vm.valueText, '物理值')} label="物理值" />
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
        <span className="font-medium" style={{ color: 'var(--color-text-muted)' }}>
          格式偏好
        </span>
        <PreferenceButton pressed={copyPrefs.prefix0x} onClick={onTogglePrefix} label="0x 前缀" />
        <PreferenceButton
          pressed={copyPrefs.spaceBetweenBytes}
          onClick={onToggleSpace}
          label="字节空格"
        />
        <PreferenceButton
          pressed={copyPrefs.endian === 'be'}
          onClick={() => onCopyEndianChange(copyPrefs.endian === 'le' ? 'be' : 'le')}
          label={`HEX 复制: ${copyPrefs.endian.toUpperCase()}`}
        />
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
      className="flex min-h-10 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium"
      style={{
        background: 'var(--color-surface-muted)',
        color: 'var(--color-text-primary)',
        border: '1px solid var(--color-border)',
      }}
    >
      <CopyIcon size={14} />
      <span>{label}</span>
    </button>
  )
}

function PreferenceButton({
  pressed,
  onClick,
  label,
}: {
  pressed: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      className="min-h-9 rounded-md px-2.5 py-1 font-medium"
      style={{
        background: pressed ? 'var(--color-accent)' : 'var(--color-surface)',
        color: pressed ? '#fff' : 'var(--color-text-secondary)',
        border: `1px solid ${pressed ? 'var(--color-accent)' : 'var(--color-border)'}`,
        boxShadow: pressed ? '0 0 0 1px var(--color-accent)' : 'none',
      }}
    >
      {label}
    </button>
  )
}
