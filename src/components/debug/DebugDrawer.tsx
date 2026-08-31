import type { AppState } from '../../app/state'
import type { AppMode } from '../../app/state'
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
        <div className="mt-2 space-y-3 rounded-xl p-4 text-sm panel-surface-muted">
          {/* Quality gates — the UI must not claim CI test status at runtime */}
          <div className="flex items-center gap-2">
            <span className="debug-info-dot inline-block h-2.5 w-2.5 rounded-full" />
            <span className="color-text-secondary">
              质量门禁：npm run test:run · npm run test:e2e · npm run test:coverage
            </span>
          </div>

          {/* Diagnostics */}
          <div className="space-y-1.5 rounded-lg p-3 font-mono text-xs surface color-text-secondary">
            <div className="flex justify-between">
              <span>模式</span>
              <span className="color-text-primary">{MODE_LABELS[state.mode]}</span>
            </div>
            <div className="flex justify-between">
              <span>Raw</span>
              <span className="color-text-primary">
                0x{state.raw.toString(16).toUpperCase().padStart(4, '0')}
              </span>
            </div>
            <div className="flex justify-between">
              <span>命令</span>
              <span className="color-text-primary">{state.commandKey ?? '—'}</span>
            </div>
            <div className="flex justify-between">
              <span>字节序</span>
              <span className="color-text-primary">{state.byteOrder.toUpperCase()}</span>
            </div>
            <div className="flex justify-between">
              <span>主题</span>
              <span className="color-text-primary">{state.ui.theme}</span>
            </div>
          </div>

          <p className="text-xs italic color-text-muted">
            边界测试由 Vitest golden cases 覆盖，无需 UI 入口
          </p>
        </div>
      )}
    </div>
  )
}
