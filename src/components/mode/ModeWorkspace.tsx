import type { AppMode, AppState } from '../../app/state'
import type { AppAction } from '../../app/actions'
import type { CalculatorViewModel } from '../../app/view-model'
import BitGrid from '../bits/BitGrid'
import DecimalInput from '../inputs/DecimalInput'
import HexInput from '../inputs/HexInput'
import IntegerInput from '../inputs/IntegerInput'
import ValueInput from '../inputs/ValueInput'
import { MODE_PANEL_ID, modeTabId } from './modeTabs'
import { LockIcon, UnlockIcon } from '../icons/Icon'
import MathFormula from '../math/MathFormula'

function formatSignedRange(value: number): string {
  return String(value).replace('-', '−')
}

interface Props {
  mode: AppMode
  state: AppState
  vm: CalculatorViewModel
  dispatch: React.Dispatch<AppAction>
}

export default function ModeWorkspace({ mode, state, vm, dispatch }: Props) {
  return (
    <div role="tabpanel" id={MODE_PANEL_ID} aria-labelledby={modeTabId(mode)} className="space-y-4">
      {/* Hex Input */}
      <section
        className="rounded-xl p-4"
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
        }}
      >
        <h3
          className="mb-3 text-xs font-semibold uppercase tracking-wider"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          原始数据
        </h3>
        <div className="flex items-start gap-2">
          <label className="mt-2 text-sm" style={{ color: 'var(--color-text-muted)' }}>
            Hex
          </label>
          <HexInput
            id="raw-hex-input"
            value={vm.rawHex}
            maxDigits={4}
            ariaLabel="原始数据 Hex"
            placeholder="0x0000"
            className="flex-1 rounded-lg px-3 py-2 text-base font-mono outline-none"
            style={{
              background: 'var(--color-surface-muted)',
              color: 'var(--color-text-primary)',
              border: '1px solid var(--color-border)',
              fontFamily: 'var(--font-mono)',
            }}
            onCommit={(text) => dispatch({ type: 'raw/set-from-hex', hex: text })}
          />
        </div>

        {/* Bit Grid */}
        <BitGrid mode={mode} groups={vm.bitGroups} dispatch={dispatch} />
      </section>

      {/* Mode-specific workspace */}
      <section
        className="rounded-xl p-4"
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
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
                : 'IEEE 754 binary16（半精度）'}
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
                <div className="mx-auto w-28">
                  <IntegerInput
                    id="l11-y-input"
                    value={state.l11.y}
                    ariaLabel="Y (11-bit)"
                    onCommit={(text) => dispatch({ type: 'l11/set-y', y: text })}
                    className="w-full rounded-lg px-3 py-2 text-center text-lg font-bold outline-none"
                    style={{
                      background: 'var(--color-surface)',
                      color: 'var(--color-text-primary)',
                      border: '1px solid var(--color-border)',
                      fontFamily: 'var(--font-mono)',
                    }}
                  />
                </div>
              </div>

              <div className="text-2xl font-bold" style={{ color: 'var(--color-text-secondary)' }}>
                ×
              </div>

              <div className="text-center">
                <div className="mb-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  2<sup>N</sup>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-20">
                    <IntegerInput
                      id="l11-n-input"
                      value={state.l11.n}
                      disabled={state.l11.autoN}
                      ariaLabel="N 值 (指数)"
                      onCommit={(text) => dispatch({ type: 'l11/set-n', n: text })}
                      className="w-full rounded-lg px-2 py-2 text-center text-lg font-bold outline-none"
                      style={{
                        background: 'var(--color-surface)',
                        color: 'var(--color-text-primary)',
                        border: '1px solid var(--color-border)',
                        fontFamily: 'var(--font-mono)',
                        opacity: state.l11.autoN ? 0.6 : 1,
                      }}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => dispatch({ type: 'l11/toggle-auto-n' })}
                    className="flex min-h-10 min-w-10 items-center justify-center rounded-md px-2 py-1.5 transition-colors"
                    title={state.l11.autoN ? 'N 已锁定（自动）' : 'N 已解锁（手动）'}
                    aria-label={state.l11.autoN ? 'N 已锁定（自动）' : 'N 已解锁（手动）'}
                    aria-pressed={state.l11.autoN}
                    style={{
                      background: state.l11.autoN
                        ? 'var(--color-accent-solid)'
                        : 'var(--color-surface)',
                      color: state.l11.autoN ? 'var(--color-on-accent)' : 'var(--color-text-muted)',
                      border: '1px solid var(--color-border)',
                    }}
                  >
                    {state.l11.autoN ? <LockIcon size={16} /> : <UnlockIcon size={16} />}
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
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <label className="w-24 text-sm" style={{ color: 'var(--color-text-muted)' }}>
                VOUT_MODE
              </label>
              <div className="w-28">
                <HexInput
                  id="vout-mode-input"
                  value={
                    vm.voutModeInfo?.hex ??
                    '0x' + state.l16.voutMode.toString(16).toUpperCase().padStart(2, '0')
                  }
                  maxDigits={2}
                  ariaLabel="VOUT_MODE"
                  placeholder="0x18"
                  className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                  style={{
                    background: 'var(--color-surface-muted)',
                    color: 'var(--color-text-primary)',
                    border: '1px solid var(--color-border)',
                    fontFamily: 'var(--font-mono)',
                  }}
                  onCommit={(text) => dispatch({ type: 'l16/set-vout-mode', hex: text })}
                />
              </div>
              <span
                className="text-xs"
                style={{
                  color: vm.voutModeInfo?.isLinear
                    ? 'var(--color-text-muted)'
                    : 'var(--color-warning)',
                }}
              >
                {vm.voutModeInfo?.isLinear
                  ? `${vm.voutModeInfo.modeName}, N=${state.l16.n}`
                  : `${vm.voutModeInfo?.modeName ?? '未知'} (非LINEAR)`}
              </span>
            </div>

            <div className="flex items-center gap-3">
              <label className="w-24 text-sm" style={{ color: 'var(--color-text-muted)' }}>
                字节序
              </label>
              <select
                value={state.byteOrder}
                onChange={(e) =>
                  dispatch({ type: 'byte-order/set', endian: e.target.value as 'le' | 'be' })
                }
                className="rounded-lg px-3 py-2 text-sm outline-none"
                style={{
                  background: 'var(--color-surface-muted)',
                  color: 'var(--color-text-primary)',
                  border: '1px solid var(--color-border)',
                }}
                aria-label="L16 字节序"
              >
                <option value="le">LE（低字节在前）</option>
                <option value="be">BE（高字节在前）</option>
              </select>
              <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                Hex 输入/显示按所选字节序解释
              </span>
            </div>

            {/* V raw input — direct LINEAR16 word value */}
            <div>
              <label
                className="mb-1 block text-xs font-medium"
                style={{ color: 'var(--color-text-muted)' }}
              >
                V（16 位无符号，0～65535）
              </label>
              <DecimalInput
                id="l16-v-input"
                value={state.raw}
                ariaLabel="V（16 位无符号，0～65535）"
                onCommit={(text) => dispatch({ type: 'raw/set', raw: text })}
                className="w-full rounded-lg px-3 py-2 text-base font-semibold outline-none"
                style={{
                  background: 'var(--color-surface-muted)',
                  color: 'var(--color-text-primary)',
                  border: '1px solid var(--color-border)',
                  fontFamily: 'var(--font-mono)',
                }}
              />
            </div>

            {/* Physical value input — encodes via value / 2^N */}
            <ValueInput vm={vm} dispatch={dispatch} />

            <div className="text-center text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {vm.nRangeText ? `可表示范围: ${vm.nRangeText}` : 'V 范围: 0 ~ 65535'}
            </div>
          </div>
        )}

        {mode === 'DIRECT' && (
          <div className="space-y-4">
            <div
              className="math-scroll rounded-lg px-3 py-2 text-center text-sm"
              style={{
                background: 'var(--color-surface-muted)',
                color: 'var(--color-text-primary)',
              }}
            >
              <MathFormula
                latex={vm.formulaGenericLatex}
                plainText="X = (1/m) × (Y × 10^(-R) - b)"
                displayMode
              />
            </div>

            {/* Signed Y input — raw is the only source of truth */}
            <div>
              <label
                className="mb-1 block text-xs font-medium"
                style={{ color: 'var(--color-text-muted)' }}
              >
                Y（16 位有符号，−32768～32767）
              </label>
              <IntegerInput
                id="direct-y-input"
                value={vm.directY ?? 0}
                ariaLabel="Y（16 位有符号，−32768～32767）"
                onCommit={(text) => dispatch({ type: 'direct/set-y', y: text })}
                className="w-full rounded-lg px-3 py-2 text-base font-semibold outline-none"
                style={{
                  background: 'var(--color-surface-muted)',
                  color: 'var(--color-text-primary)',
                  border: '1px solid var(--color-border)',
                  fontFamily: 'var(--font-mono)',
                }}
              />
            </div>

            {/* Physical value input — encodes via legacy DIRECT rounding */}
            <ValueInput vm={vm} dispatch={dispatch} />

            {/* Coefficients: m/b signed 16-bit integer, R signed 8-bit integer */}
            <div className="grid grid-cols-3 gap-3">
              {(
                [
                  ['m', state.direct.m, -32768, 32767],
                  ['b', state.direct.b, -32768, 32767],
                  ['r', state.direct.r, -128, 127],
                ] as const
              ).map(([name, val, min, max]) => (
                <div key={name} className="min-w-0">
                  <label
                    className="mb-1 block text-xs"
                    style={{ color: 'var(--color-text-muted)' }}
                  >
                    {name.toUpperCase()}（{formatSignedRange(min)}～{formatSignedRange(max)}）
                  </label>
                  <IntegerInput
                    id={`direct-coeff-${name}-input`}
                    value={val}
                    ariaLabel={`DIRECT 系数 ${name}`}
                    rangeBehavior="reject"
                    stateError={state.direct.errors[name]}
                    onCommit={(text) =>
                      dispatch({
                        type: 'direct/set-coeff',
                        name,
                        value: text,
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

            <div className="text-center text-xs" style={{ color: 'var(--color-text-muted)' }}>
              m、b 为 16-bit signed 整数；R 为 8-bit signed 整数；m ≠ 0。系数非法时不会静默接受。
            </div>
          </div>
        )}

        {mode === 'HALF' && (
          <div className="space-y-4">
            <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              IEEE 754 binary16（半精度）：符号 1 位、指数 5 位、尾数 10 位。物理值输入支持
              +0、-0、NaN、+Infinity、-Infinity。
            </p>
            <ValueInput vm={vm} dispatch={dispatch} />
          </div>
        )}
      </section>
    </div>
  )
}
