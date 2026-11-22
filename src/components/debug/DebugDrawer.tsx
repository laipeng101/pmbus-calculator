import type { AppMode, AppState } from '../../app/state'
import { formatByteHex, formatRawHex } from '../../app/view-model/format'
import ControlTooltip from '../help/ControlTooltip'
import { ChevronDownIcon, ChevronUpIcon } from '../icons/Icon'

interface Props {
  open: boolean
  state: AppState
  onToggle: () => void
}

const MODE_LABELS: Record<AppMode, string> = {
  L11: 'LINEAR11',
  L16: 'LINEAR16',
  DIRECT: 'DIRECT',
  HALF: 'HALF',
  VOUT_MODE: 'VOUT_MODE',
}

export default function DebugDrawer({ open, state, onToggle }: Props) {
  const debugEnabled =
    import.meta.env.DEV || new URLSearchParams(window.location.search).has('debug')

  if (debugEnabled === false) return null

  return (
    <div className="mt-4">
      <ControlTooltip help="debug-toggle" params={{ open }}>
        {(triggerProps) => (
          <button
            {...triggerProps}
            type="button"
            onClick={onToggle}
            aria-label={open ? '收起调试面板' : '展开调试面板'}
            aria-expanded={open}
            className="flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors panel-surface-muted color-text-muted"
          >
            <span className="inline-flex" aria-hidden="true">
              {open ? <ChevronUpIcon size={14} /> : <ChevronDownIcon size={14} />}
            </span>
            <span>调试面板</span>
            <span className="debug-dot ml-1 inline-block h-2 w-2 rounded-full" data-open={open} />
          </button>
        )}
      </ControlTooltip>

      {open && (
        <dl
          aria-label="调试信息"
          className="mt-2 space-y-1.5 rounded-xl p-4 font-mono text-xs panel-surface-muted color-text-secondary"
        >
          <div className="flex justify-between">
            <dt>模式</dt>
            <dd className="color-text-primary">{MODE_LABELS[state.mode]}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Raw Word</dt>
            <dd className="color-text-primary">{formatRawHex(state.raw)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>VOUT_MODE</dt>
            <dd className="color-text-primary">{formatByteHex(state.voutMode.byte)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>主题</dt>
            <dd className="color-text-primary">{state.ui.theme}</dd>
          </div>
        </dl>
      )}
    </div>
  )
}
