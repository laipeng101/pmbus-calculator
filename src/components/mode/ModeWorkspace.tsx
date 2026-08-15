import type { AppMode, AppState } from '../../app/state'
import type { AppAction } from '../../app/actions'
import type { CalculatorViewModel } from '../../app/view-model'
import BitGrid from '../bits/BitGrid'
import IntegerInput from '../inputs/IntegerInput'
import ValueInput from '../inputs/ValueInput'

interface Props {
  mode: AppMode
  state: AppState
  vm: CalculatorViewModel
  dispatch: React.Dispatch<AppAction>
}

export default function ModeWorkspace({ mode, state, vm, dispatch }: Props) {
  return (
    <div className="space-y-4">
      {/* Hex Input */}
      <section
        className="rounded-xl p-4"
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          boxShadow: 'var(--shadow-panel)',
        }}
      >
        <h3
          className="mb-3 text-xs font-semibold uppercase tracking-wider"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          原始数据
        </h3>
        <div className="flex items-center gap-2">
          <label className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            Hex
          </label>
          <input
            type="text"
            value={vm.rawHex}
            onChange={(e) => dispatch({ type: 'raw/set-from-hex', hex: e.target.value })}
            className="flex-1 rounded-lg px-3 py-2 text-base font-mono outline-none"
            style={{
              background: 'var(--color-surface-muted)',
              color: 'var(--color-text-primary)',
              border: '1px solid var(--color-border)',
              fontFamily: 'var(--font-mono)',
            }}
            placeholder="0x0000"
          />
        </div>

        {/* Bit Grid */}
        <BitGrid groups={vm.bitGroups} dispatch={dispatch} />
      </section>

      {/* Mode-specific workspace */}
      <section
        className="rounded-xl p-4"
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          boxShadow: 'var(--shadow-panel)',
        }}
      >
        <h3
          className="mb-3 text-xs font-semibold uppercase tracking-wider"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          {mode === 'L11'
            ? 'LINEAR11 参数'
            : mode === 'L16'
              ? 'LINEAR16 / VOUT 参数'
              : mode === 'DIRECT'
                ? 'DIRECT 系数'
                : 'IEEE 754 Half-Precision'}
        </h3>

        {mode === 'L11' && (
          <div className="space-y-4">
            {/* Immersive formula: Y × 2^N */}
            <div
              className="flex items-center justify-center gap-3 rounded-xl px-4 py-5"
              style={{
                background: 'var(--color-surface-muted)',
                border: '1px solid var(--color-border)',
              }}
            >
              <div className="text-center">
                <div className="mb-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  Y (11-bit)
                </div>
                <IntegerInput
                  value={state.l11.y}
                  ariaLabel="Y (11-bit)"
                  onCommit={(text) => dispatch({ type: 'l11/set-y', y: text })}
                  className="w-28 rounded-lg px-3 py-2 text-center text-lg font-bold outline-none"
                  style={{
                    background: 'var(--color-surface)',
                    color: 'var(--color-text-primary)',
                    border: '1px solid var(--color-border)',
                    fontFamily: 'var(--font-mono)',
                  }}
                />
              </div>

              <div className="text-2xl font-bold" style={{ color: 'var(--color-text-secondary)' }}>
                ×
              </div>

              <div className="text-center">
                <div className="mb-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  2^N
                </div>
                <div className="flex items-center gap-1">
                  <IntegerInput
                    value={state.l11.n}
                    disabled={state.l11.autoN}
                    ariaLabel="N 值 (指数)"
                    onCommit={(text) => dispatch({ type: 'l11/set-n', n: text })}
                    className="w-20 rounded-lg px-2 py-2 text-center text-lg font-bold outline-none"
                    style={{
                      background: 'var(--color-surface)',
                      color: 'var(--color-text-primary)',
                      border: '1px solid var(--color-border)',
                      fontFamily: 'var(--font-mono)',
                      opacity: state.l11.autoN ? 0.6 : 1,
                    }}
                  />
                  <button
                    onClick={() => dispatch({ type: 'l11/toggle-auto-n' })}
                    className="rounded-md px-2 py-1.5 text-lg transition-colors"
                    title={state.l11.autoN ? 'N 已锁定（自动）' : 'N 已解锁（手动）'}
                    style={{
                      background: state.l11.autoN ? 'var(--color-accent)' : 'var(--color-surface)',
                      color: state.l11.autoN ? '#fff' : 'var(--color-text-muted)',
                      border: '1px solid var(--color-border)',
                    }}
                  >
                    {state.l11.autoN ? '🔒' : '🔓'}
                  </button>
                </div>
              </div>
            </div>

            {/* Range hint */}
            <div className="text-center text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {vm.nRangeText
                ? `可表示范围: ${vm.nRangeText}`
                : 'Y 范围: -1024 ~ 1023 · N 范围: -16 ~ 15'}
            </div>

            {/* Physical value input — encodes via findBestLinear11 / manual N */}
            <ValueInput vm={vm} dispatch={dispatch} />
          </div>
        )}

        {mode === 'L16' && (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <label className="w-24 text-sm" style={{ color: 'var(--color-text-muted)' }}>
                VOUT_MODE
              </label>
              <input
                type="text"
                value={'0x' + state.l16.voutMode.toString(16).toUpperCase().padStart(2, '0')}
                onChange={(e) => dispatch({ type: 'l16/set-vout-mode', hex: e.target.value })}
                className="w-24 rounded-lg px-3 py-2 text-sm outline-none"
                style={{
                  background: 'var(--color-surface-muted)',
                  color: 'var(--color-text-primary)',
                  border: '1px solid var(--color-border)',
                  fontFamily: 'var(--font-mono)',
                }}
              />
              <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                N = {state.l16.n}
              </span>
            </div>
          </div>
        )}

        {mode === 'DIRECT' && (
          <div className="grid grid-cols-3 gap-3">
            {(
              [
                ['m', state.direct.m],
                ['b', state.direct.b],
                ['r', state.direct.r],
              ] as const
            ).map(([name, val]) => (
              <div key={name}>
                <label className="mb-1 block text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  {name.toUpperCase()}
                </label>
                <input
                  type="number"
                  value={val}
                  onChange={(e) =>
                    dispatch({
                      type: 'direct/set-coeff',
                      name,
                      value: e.target.value,
                    })
                  }
                  className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                  style={{
                    background: 'var(--color-surface-muted)',
                    color: 'var(--color-text-primary)',
                    border: '1px solid var(--color-border)',
                    fontFamily: 'var(--font-mono)',
                  }}
                />
              </div>
            ))}
          </div>
        )}

        {mode === 'HALF' && (
          <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            IEEE 754 binary16 半精度浮点。符号 1 位，指数 5 位，尾数 10 位。
          </p>
        )}
      </section>
    </div>
  )
}
