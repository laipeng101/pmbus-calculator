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

type FeedbackKind = 'success' | 'error'

const FEEDBACK_DURATION_MS = 1800

export default function CopyToolbar({
  vm,
  copyPrefs,
  onTogglePrefix,
  onToggleSpace,
  onCopyEndianChange,
}: Props) {
  const [feedback, setFeedback] = useState<{ text: string; kind: FeedbackKind } | null>(null)
  const feedbackTimerRef = useRef<number | null>(null)

  const clearFeedbackTimer = useCallback(() => {
    if (feedbackTimerRef.current != null) {
      window.clearTimeout(feedbackTimerRef.current)
      feedbackTimerRef.current = null
    }
  }, [])

  useEffect(() => clearFeedbackTimer, [clearFeedbackTimer])

  const showFeedback = useCallback(
    (text: string, kind: FeedbackKind) => {
      clearFeedbackTimer()
      setFeedback({ text, kind })
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
        showFeedback(`已复制: ${label}`, 'success')
      } catch {
        showFeedback('复制失败', 'error')
      }
    },
    [showFeedback],
  )

  const copyHex = copyPrefs.endian === 'be' ? vm.rawBytesBE : vm.rawBytesLE

  return (
    <div className="copy-toolbar space-y-3">
      <div className="grid grid-cols-6 gap-2">
        <CopyButton className="col-span-2" onClick={() => copy(copyHex, 'Hex')} label="Hex" />
        <CopyButton
          className="col-span-2"
          onClick={() => copy(vm.rawBytesLE, 'LE bytes')}
          label="LE 字节"
        />
        <CopyButton
          className="col-span-2"
          onClick={() => copy(vm.rawBytesBE, 'BE bytes')}
          label="BE 字节"
        />
        <CopyButton
          className="col-span-3"
          onClick={() => copy(vm.valueText, '物理值')}
          label="物理值"
        />
        <CopyButton
          className="col-span-3"
          onClick={() => copy(vm.cMacroText, 'C 宏')}
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
        <span className="font-medium" style={{ color: 'var(--color-text-muted)' }}>
          格式偏好
        </span>
        <PreferenceButton pressed={copyPrefs.prefix0x} onClick={onTogglePrefix} label="0x 前缀" />
        <PreferenceButton
          pressed={copyPrefs.spaceBetweenBytes}
          onClick={onToggleSpace}
          label="字节空格"
        />
        <span className="font-medium" style={{ color: 'var(--color-text-muted)' }}>
          复制字节序
        </span>
        <div
          className="inline-flex rounded-md p-0.5"
          style={{
            background: 'var(--color-surface-muted)',
            border: '1px solid var(--color-border)',
          }}
          role="group"
          aria-label="复制字节序"
        >
          <EndianButton
            pressed={copyPrefs.endian === 'le'}
            onClick={() => onCopyEndianChange('le')}
            label="LE"
          />
          <EndianButton
            pressed={copyPrefs.endian === 'be'}
            onClick={() => onCopyEndianChange('be')}
            label="BE"
          />
        </div>
      </div>

      {feedback && (
        <div
          className="copy-feedback rounded-md px-3 py-1.5 text-xs font-medium"
          style={{
            background:
              feedback.kind === 'success'
                ? 'var(--color-success-surface)'
                : 'var(--color-danger-surface)',
            color:
              feedback.kind === 'success'
                ? 'var(--color-success-text)'
                : 'var(--color-danger-text)',
            border:
              feedback.kind === 'success'
                ? '1px solid var(--color-success-border)'
                : '1px solid var(--color-danger-border)',
          }}
          role="status"
          aria-live="polite"
        >
          {feedback.text}
        </div>
      )}
    </div>
  )
}

function CopyButton({
  onClick,
  label,
  className = '',
}: {
  onClick: () => void
  label: string
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-10 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-medium ${className}`}
      style={{
        background: 'var(--color-surface-muted)',
        color: 'var(--color-text-primary)',
        border: '1px solid var(--color-border)',
        whiteSpace: 'nowrap',
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
        background: pressed ? 'var(--color-accent-solid)' : 'var(--color-surface)',
        color: pressed ? 'var(--color-on-accent)' : 'var(--color-text-secondary)',
        border: `1px solid ${pressed ? 'var(--color-accent-solid)' : 'var(--color-border)'}`,
      }}
    >
      {label}
    </button>
  )
}

function EndianButton({
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
      className="min-h-8 rounded px-2.5 py-1 text-xs font-semibold"
      style={{
        background: pressed ? 'var(--color-accent-solid)' : 'transparent',
        color: pressed ? 'var(--color-on-accent)' : 'var(--color-text-secondary)',
        border: '1px solid transparent',
      }}
    >
      {label}
    </button>
  )
}
