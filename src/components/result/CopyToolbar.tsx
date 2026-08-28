import { useCallback, useEffect, useRef, useState } from 'react'
import type { CalculatorViewModel } from '../../app/view-model'
import type { AppState } from '../../app/state'
import { copyTextToClipboard } from '../../app/copy-utils'
import { getCopyHexLabel } from '../../app/result-presentation'
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
  const copyHexLabel = getCopyHexLabel(copyPrefs.endian)
  // v2.5.9: a relative-derivation range error disables the 物理值 copy with
  // an accessible, visible reason; raw Hex / LE / BE copies stay available.
  const physicalCopyUnavailable = vm.physicalValueCopy?.available === false

  return (
    <div className="copy-toolbar space-y-3">
      <div className="grid grid-cols-6 gap-2">
        <CopyButton
          className="col-span-2"
          onClick={() => copy(copyHex, copyHexLabel)}
          label={copyHexLabel}
        />
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
          onClick={() => {
            if (!physicalCopyUnavailable) void copy(vm.valueText, '物理值')
          }}
          label="物理值"
          disabled={physicalCopyUnavailable}
          describedBy={physicalCopyUnavailable ? 'physical-value-copy-reason' : undefined}
        />
        <CopyButton
          className="col-span-3"
          onClick={() => copy(vm.cMacroText, 'C 宏')}
          label="C 代码"
        />
      </div>

      {physicalCopyUnavailable && vm.physicalValueCopy && (
        <p id="physical-value-copy-reason" role="status" className="text-xs color-text-secondary">
          {vm.physicalValueCopy.reason}
        </p>
      )}

      <div className="copy-prefs space-y-2 rounded-lg px-3 py-2 text-xs panel-surface-muted color-text-secondary">
        <div
          role="group"
          aria-labelledby="copy-hex-format-label"
          className="flex flex-wrap items-center gap-2"
        >
          <span id="copy-hex-format-label" className="copy-pref-group-label">
            Hex 格式
          </span>
          <PreferenceButton pressed={copyPrefs.prefix0x} onClick={onTogglePrefix} label="0x 前缀" />
          <PreferenceButton
            pressed={copyPrefs.spaceBetweenBytes}
            onClick={onToggleSpace}
            label="字节空格"
          />
        </div>
        <div
          role="group"
          aria-labelledby="copy-hex-order-label"
          className="flex flex-wrap items-center gap-2"
        >
          <span id="copy-hex-order-label" className="copy-pref-group-label">
            Hex 复制顺序
          </span>
          <div className="inline-flex rounded-md p-0.5 surface-muted border-default">
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
      </div>

      {feedback && (
        <div
          className="copy-feedback rounded-md px-3 py-1.5 text-xs font-medium"
          data-kind={feedback.kind}
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
  disabled = false,
  describedBy,
}: {
  onClick: () => void
  label: string
  className?: string
  disabled?: boolean
  describedBy?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-describedby={describedBy}
      className={`surface-muted border-default color-text-primary flex min-h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-2 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
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
      className="preference-button min-h-9 rounded-md px-2.5 py-1 font-medium"
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
      className="endian-button min-h-8 rounded px-2.5 py-1 text-xs font-semibold"
    >
      {label}
    </button>
  )
}
