import type { AppState } from '../../app/state'
import type { AppMode } from '../../app/state'

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
}

export default function DebugDrawer({ open, state, onToggle }: Props) {
  return (
    <div className="mt-4">
      <button
        onClick={onToggle}
        aria-label={open ? '收起调试面板' : '展开调试面板'}
        aria-expanded={open}
        className="flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors"
        style={{
          background: 'var(--color-surface-muted)',
          color: 'var(--color-text-muted)',
          border: '1px solid var(--color-border)',
        }}
      >
        <span>{open ? '^' : 'v'}</span>
        <span>调试面板</span>
        <span
          className="ml-1 inline-block h-2 w-2 rounded-full"
          style={{
            background: open ? 'var(--color-success)' : 'var(--color-text-muted)',
          }}
        />
      </button>

      {open && (
        <div
          className="mt-2 space-y-3 rounded-xl p-4 text-sm"
          style={{
            background: 'var(--color-surface-muted)',
            border: '1px solid var(--color-border)',
          }}
        >
          {/* Quality gates — the UI must not claim CI test status at runtime */}
          <div className="flex items-center gap-2">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ background: 'var(--color-info)' }}
            />
            <span style={{ color: 'var(--color-text-secondary)' }}>
              质量门禁：npm run test:run · npm run test:e2e · npm run test:coverage
            </span>
          </div>

          {/* Diagnostics */}
          <div
            className="space-y-1.5 rounded-lg p-3 font-mono text-xs"
            style={{
              background: 'var(--color-surface)',
              color: 'var(--color-text-secondary)',
            }}
          >
            <div className="flex justify-between">
              <span>模式</span>
              <span style={{ color: 'var(--color-text-primary)' }}>{MODE_LABELS[state.mode]}</span>
            </div>
            <div className="flex justify-between">
              <span>Raw</span>
              <span style={{ color: 'var(--color-text-primary)' }}>
                0x{state.raw.toString(16).toUpperCase().padStart(4, '0')}
              </span>
            </div>
            <div className="flex justify-between">
              <span>命令</span>
              <span style={{ color: 'var(--color-text-primary)' }}>{state.commandKey ?? '—'}</span>
            </div>
            <div className="flex justify-between">
              <span>字节序</span>
              <span style={{ color: 'var(--color-text-primary)' }}>
                {state.byteOrder.toUpperCase()}
              </span>
            </div>
            <div className="flex justify-between">
              <span>主题</span>
              <span style={{ color: 'var(--color-text-primary)' }}>{state.ui.theme}</span>
            </div>
          </div>

          {/* Future: boundary test runner */}
          <p className="text-xs italic" style={{ color: 'var(--color-text-muted)' }}>
            边界测试快捷入口待 Milestone 8 接入
          </p>
        </div>
      )}
    </div>
  )
}
