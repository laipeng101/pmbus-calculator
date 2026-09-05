import { useCallback, useEffect, useRef, useState } from 'react'
import type { CalculatorViewModel } from '../../app/view-model'
import type { AppState } from '../../app/state'
import { copyTextToClipboard } from '../../app/copy-utils'
import { formatRawWordCopyText } from '../../app/result-presentation'
import ControlTooltip from '../help/ControlTooltip'
import type { ControlTriggerProps } from '../help/ControlTooltip'
import { CopyIcon } from '../icons/Icon'

interface Props {
  vm: CalculatorViewModel
  copyPrefs: AppState['copy']
  onTogglePrefix: () => void
  onToggleSpace: () => void
}

type FeedbackKind = 'success' | 'error'

const FEEDBACK_DURATION_MS = 1800

export default function CopyToolbar({ vm, copyPrefs, onTogglePrefix, onToggleSpace }: Props) {
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

  // v3.0.0: explicit representation actions replace the ambiguous endian
  // switch — each button copies exactly the representation its name states.
  const rawWordText = formatRawWordCopyText(vm.rawWordHex, copyPrefs.prefix0x)
  // v2.5.9: a relative-derivation range error disables the 物理值 copy with
  // an accessible, visible reason; Raw Word / wire-byte copies stay available.
  const physicalCopyUnavailable = vm.physicalValueCopy?.available === false
  // v2.5.11: a precision-folded DIRECT decode swaps the copied payload for
  // the verified safe re-entry text — the display approximation must never
  // be handed out as if it round-tripped.
  const physicalCopyOverride = vm.physicalValueCopyOverride

  return (
    <div className="copy-toolbar space-y-3">
      <div className="grid grid-cols-6 gap-2">
        <ControlTooltip help="copy-raw-word" params={{ prefixed: copyPrefs.prefix0x }}>
          {(triggerProps) => (
            <CopyButton
              className="col-span-2"
              triggerProps={triggerProps}
              onClick={() => copy(rawWordText, 'Raw Word Hex')}
              label="Raw Word Hex"
            />
          )}
        </ControlTooltip>
        <ControlTooltip help="copy-wire-bytes" params={undefined}>
          {(triggerProps) => (
            <CopyButton
              className="col-span-2"
              triggerProps={triggerProps}
              onClick={() => copy(vm.wireBytes, 'Wire 字节')}
              label="Wire 字节"
            />
          )}
        </ControlTooltip>
        <ControlTooltip help="copy-msb-first-bytes" params={undefined}>
          {(triggerProps) => (
            <CopyButton
              className="col-span-2"
              triggerProps={triggerProps}
              onClick={() => copy(vm.msbFirstBytes, 'MSB-first 字节')}
              label="MSB-first 字节"
            />
          )}
        </ControlTooltip>
        <ControlTooltip
          help="copy-physical"
          params={{
            available: !physicalCopyUnavailable,
            usesOverride: physicalCopyOverride != null,
            overrideKind: physicalCopyOverride?.kind,
            unavailableReason: vm.physicalValueCopy?.reason,
          }}
        >
          {(triggerProps) => (
            <CopyButton
              className="col-span-3"
              triggerProps={triggerProps}
              onClick={() => {
                if (!physicalCopyUnavailable) {
                  void copy(
                    physicalCopyOverride ? physicalCopyOverride.text : vm.valueText,
                    '物理值',
                  )
                }
              }}
              label="物理值"
              disabled={physicalCopyUnavailable}
              describedBy={
                physicalCopyUnavailable
                  ? 'physical-value-copy-reason'
                  : physicalCopyOverride
                    ? 'physical-value-copy-note'
                    : undefined
              }
            />
          )}
        </ControlTooltip>
        <ControlTooltip help="copy-c-macro" params={undefined}>
          {(triggerProps) => (
            <CopyButton
              className="col-span-3"
              triggerProps={triggerProps}
              onClick={() => copy(vm.cMacroText, 'C 宏')}
              label="C 代码"
            />
          )}
        </ControlTooltip>
      </div>

      {physicalCopyUnavailable && vm.physicalValueCopy && (
        <p id="physical-value-copy-reason" role="status" className="text-xs color-text-secondary">
          {vm.physicalValueCopy.reason}
        </p>
      )}

      {physicalCopyOverride && (
        <p id="physical-value-copy-note" role="status" className="text-xs color-text-secondary">
          {physicalCopyOverride.note}
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
          <ControlTooltip help="copy-pref-prefix" params={{ pressed: copyPrefs.prefix0x }}>
            {(triggerProps) => (
              <PreferenceButton
                triggerProps={triggerProps}
                pressed={copyPrefs.prefix0x}
                onClick={onTogglePrefix}
                label="0x 前缀"
              />
            )}
          </ControlTooltip>
          <ControlTooltip help="copy-pref-space" params={{ pressed: copyPrefs.spaceBetweenBytes }}>
            {(triggerProps) => (
              <PreferenceButton
                triggerProps={triggerProps}
                pressed={copyPrefs.spaceBetweenBytes}
                onClick={onToggleSpace}
                label="字节空格"
              />
            )}
          </ControlTooltip>
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
  triggerProps,
}: {
  onClick: () => void
  label: string
  className?: string
  disabled?: boolean
  describedBy?: string
  triggerProps?: ControlTriggerProps
}) {
  return (
    <button
      {...triggerProps}
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-describedby={
        triggerProps?.['aria-describedby'] != null ? triggerProps['aria-describedby'] : describedBy
      }
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
  triggerProps,
}: {
  pressed: boolean
  onClick: () => void
  label: string
  triggerProps?: ControlTriggerProps
}) {
  return (
    <button
      {...triggerProps}
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      className="preference-button min-h-9 rounded-md px-2.5 py-1 font-medium"
    >
      {label}
    </button>
  )
}
