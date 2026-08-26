import type { AppMode, AppState } from '../../app/state'
import type { AppAction } from '../../app/actions'
import type { CalculatorViewModel } from '../../app/view-model'
import BitGrid from '../bits/BitGrid'
import HexInput from '../inputs/HexInput'
import IntegerInput from '../inputs/IntegerInput'
import ValueInput from '../inputs/ValueInput'
import ExponentEditor from '../formula/ExponentEditor'
import LinearFormulaEditor from '../formula/LinearFormulaEditor'
import VoutModeComposer from './VoutModeComposer'
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
      <section className="rounded-xl p-4 panel-surface-muted">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider color-text-secondary">
          原始数据
        </h3>
        <div className="flex items-start gap-2">
          <label className="mt-2 text-sm color-text-muted">Hex</label>
          <HexInput
            id="raw-hex-input"
            value={vm.rawHex}
            maxDigits={4}
            ariaLabel="原始数据 Hex"
            placeholder="0x0000"
            className="input-surface flex-1 rounded-lg px-3 py-2 text-base font-mono outline-none"
            onCommit={(text) => dispatch({ type: 'raw/set-from-hex', hex: text })}
          />
        </div>

        {/* Bit Grid */}
        <BitGrid mode={mode} groups={vm.bitGroups} dispatch={dispatch} />
      </section>

      {/* Mode-specific workspace */}
      <section className="rounded-xl p-4 panel-surface-muted">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider color-text-secondary">
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
            {/* Continuous formula: Y × 2^N with N anchored to the exponent slot */}
            <LinearFormulaEditor
              ariaLabel="LINEAR11 公式编辑器"
              valueCaption="Y（11-bit）"
              valueEditor={
                <div className="w-24">
                  <IntegerInput
                    id="l11-y-input"
                    value={state.l11.y}
                    ariaLabel="Y (11-bit)"
                    onCommit={(text) => dispatch({ type: 'l11/set-y', y: text })}
                    className="surface border-default color-text-primary font-mono w-full rounded-lg px-2 py-2 text-center text-lg font-bold outline-none"
                  />
                </div>
              }
              exponentEditor={
                <ExponentEditor
                  id="l11-n-input"
                  value={state.l11.n}
                  disabled={state.l11.autoN}
                  ariaLabel="N 值 (指数)"
                  onCommit={(text) => dispatch({ type: 'l11/set-n', n: text })}
                />
              }
              lockButton={
                <button
                  type="button"
                  onClick={() => dispatch({ type: 'l11/toggle-auto-n' })}
                  className="n-lock-button flex min-h-10 min-w-10 items-center justify-center rounded-md px-2 py-1.5 transition-colors"
                  title={state.l11.autoN ? 'N 已锁定（自动）' : 'N 已解锁（手动）'}
                  aria-label={state.l11.autoN ? 'N 已锁定（自动）' : 'N 已解锁（手动）'}
                  aria-pressed={state.l11.autoN}
                >
                  {state.l11.autoN ? <LockIcon size={16} /> : <UnlockIcon size={16} />}
                </button>
              }
            />

            {/* Range hint */}
            <div className="text-center text-xs color-text-muted">
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
            {/* Structured VOUT_MODE composer (bit7 / format / parameter / byte) */}
            <VoutModeComposer state={state} vm={vm} dispatch={dispatch} />

            <div className="flex flex-wrap items-center gap-3">
              <label className="w-24 text-sm color-text-muted">字节序</label>
              <select
                value={state.byteOrder}
                onChange={(e) =>
                  dispatch({ type: 'byte-order/set', endian: e.target.value as 'le' | 'be' })
                }
                className="panel-surface-muted rounded-lg px-3 py-2 text-sm outline-none"
                aria-label="L16 字节序"
              >
                <option value="le">LE（低字节在前）</option>
                <option value="be">BE（高字节在前）</option>
              </select>
              <span className="text-xs color-text-muted">
                PMBus/SMBus word 默认低字节在前；BE 仅用于寄存器显示或复制
              </span>
            </div>

            {vm.voutModeInfo?.status === 'ok' ? (
              <>
                {/* Physical value input — encodes via value / 2^N */}
                <ValueInput vm={vm} dispatch={dispatch} />

                <div className="text-center text-xs color-text-muted">
                  {vm.nRangeText ? `可表示范围: ${vm.nRangeText}` : 'V 范围: 0 ~ 65535'}
                </div>
              </>
            ) : (
              <div className="workspace-l16-block rounded-lg px-4 py-3 text-sm">
                <p className="mb-2">
                  VOUT_MODE {vm.voutModeInfo?.hex} 为 {vm.voutModeInfo?.statusText}
                  ；本页仅支持 absolute LINEAR，不给出伪造的 LINEAR16 电压结果。
                </p>
                {vm.voutModeInfo?.mode === 3 && (
                  <button
                    type="button"
                    onClick={() => dispatch({ type: 'mode/set', mode: 'HALF' })}
                    className="workspace-half-switch min-h-9 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors"
                  >
                    切换到 HALF 模式
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {mode === 'DIRECT' && (
          <div className="space-y-4">
            <div className="math-scroll rounded-lg px-3 py-2 text-center text-sm surface-muted color-text-primary">
              <MathFormula
                latex={vm.formulaGenericLatex}
                plainText="X = (1/m) × (Y × 10^(-R) - b)"
                displayMode
              />
            </div>

            {/* Signed Y input — raw is the only source of truth */}
            <div>
              <label className="mb-1 block text-xs font-medium color-text-muted">
                Y（16 位有符号，−32768～32767）
              </label>
              <IntegerInput
                id="direct-y-input"
                value={vm.directY ?? 0}
                ariaLabel="Y（16 位有符号，−32768～32767）"
                onCommit={(text) => dispatch({ type: 'direct/set-y', y: text })}
                className="input-surface w-full rounded-lg px-3 py-2 text-base font-semibold outline-none"
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
                  <label className="mb-1 block text-xs color-text-muted">
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
                    className="input-surface w-full rounded-lg px-3 py-2 text-sm outline-none"
                  />
                </div>
              ))}
            </div>

            <div className="text-center text-xs color-text-muted">
              m、b 为 16-bit signed 整数；R 为 8-bit signed 整数；m ≠ 0。系数非法时不会静默接受。
            </div>
          </div>
        )}

        {mode === 'HALF' && (
          <div className="space-y-4">
            <p className="text-sm color-text-secondary">
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
