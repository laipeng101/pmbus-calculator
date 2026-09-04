import type { AppMode, AppState } from '../../app/state'
import type { AppAction } from '../../app/actions'
import type { CalculatorViewModel } from '../../app/view-model'
import BitFieldGrid from '../bits/BitFieldGrid'
import HexInput from '../inputs/HexInput'
import IntegerInput from '../inputs/IntegerInput'
import ValueInput from '../inputs/ValueInput'
import NominalVoutInput from '../inputs/NominalVoutInput'
import ExponentEditor from '../formula/ExponentEditor'
import LinearFormulaEditor from '../formula/LinearFormulaEditor'
import VoutModeComposer from './VoutModeComposer'
import HalfSpecialCard from './HalfSpecialCard'
import TechnicalTerm from '../term/TechnicalTerm'
import ControlTooltip from '../help/ControlTooltip'
import { MODE_PANEL_ID, modeTabId } from './modeTabs'
import { LockIcon, UnlockIcon } from '../icons/Icon'
import MathFormula from '../math/MathFormula'
import { getBitRegions } from '../../app/bit-regions'

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
      {/* Raw Word Hex Input + 16-bit Bit Grid (not for the 1-byte VOUT_MODE calculator) */}
      {mode !== 'VOUT_MODE' && (
        <section className="rounded-xl p-4 panel-surface-muted">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider color-text-secondary">
            原始数据
          </h3>
          <div className="flex items-start gap-2">
            <div className="mt-2 text-sm color-text-muted">
              <TechnicalTerm termId="raw-word" />
            </div>
            <HexInput
              id="raw-hex-input"
              value={vm.rawHexDigits}
              fixedPrefix="0x"
              maxDigits={4}
              ariaLabel="Raw Word（16 位原始字）"
              placeholder="0000"
              stepper
              className="w-full text-base"
              onCommit={(text) => dispatch({ type: 'raw/set-from-hex', hex: text })}
            />
          </div>

          {/* Scoped vertical gap: the editable Raw Word field and the bit
              grid are separate interaction layers and need >=8px of air;
              keep the spacing at this call site, not on BitFieldGrid. */}
          <div className="mt-3">
            <BitFieldGrid
              bitCount={16}
              groups={vm.bitGroups}
              regions={getBitRegions(mode, state.l16.payloadKind, state.voutMode.byte)}
              onToggle={(index) => dispatch({ type: 'bit/toggle', bit: 15 - index })}
              groupLabel="16 位编辑器"
            />
          </div>
        </section>
      )}

      {/* Mode-specific workspace */}
      <section className="rounded-xl p-4 panel-surface-muted">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider color-text-secondary">
          {mode === 'L11' ? (
            <>
              <TechnicalTerm termId="linear11" /> 参数
            </>
          ) : mode === 'L16' ? (
            <>
              <TechnicalTerm termId="linear16" /> / VOUT 参数
            </>
          ) : mode === 'DIRECT' ? (
            <>
              <TechnicalTerm termId="direct" /> 系数
            </>
          ) : mode === 'VOUT_MODE' ? (
            'VOUT_MODE 配置'
          ) : (
            <>
              <TechnicalTerm termId="binary16" />
              （半精度）
            </>
          )}
        </h3>

        {mode === 'L11' && (
          <div className="space-y-4">
            {/* Continuous formula: Y × 2^N with N anchored to the exponent slot */}
            <LinearFormulaEditor
              ariaLabel="LINEAR11 公式编辑器"
              valueCaption="Y（11 位有符号整数）"
              valueEditor={
                <div className="w-24">
                  <IntegerInput
                    id="l11-y-input"
                    value={state.l11.y}
                    ariaLabel="Y（11 位有符号整数）"
                    onCommit={(text) => dispatch({ type: 'l11/set-y', y: text })}
                    className="input-field color-text-primary w-full rounded-lg px-2 py-2 text-center text-lg font-bold outline-none"
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
                <ControlTooltip help="l11-n-lock" params={{ locked: state.l11.autoN }}>
                  {(triggerProps) => (
                    <button
                      {...triggerProps}
                      type="button"
                      onClick={() => dispatch({ type: 'l11/toggle-auto-n' })}
                      className="n-lock-button flex min-h-10 min-w-10 items-center justify-center rounded-md px-2 py-1.5 transition-colors"
                      aria-label={state.l11.autoN ? 'N 已锁定（自动）' : 'N 已解锁（手动）'}
                      aria-pressed={state.l11.autoN}
                    >
                      {state.l11.autoN ? <LockIcon size={16} /> : <UnlockIcon size={16} />}
                    </button>
                  )}
                </ControlTooltip>
              }
            />

            {/* Range hint */}
            <div className="text-center text-xs color-text-muted">
              {vm.nRangeText ? (
                <>
                  可表示范围: {vm.nRangeText}（<TechnicalTerm termId="linear11-exponent" />）
                </>
              ) : (
                'Y 范围: -1024 ~ 1023 · N 范围: -16 ~ 15'
              )}
            </div>

            {/* Physical value input — encodes via findBestLinear11 / manual N */}
            <ValueInput vm={vm} dispatch={dispatch} />
          </div>
        )}

        {mode === 'L16' && (
          <div className="space-y-3">
            {/* Shared VOUT_MODE composer: bits[6:5] locked to LINEAR */}
            {vm.voutModeInfo && (
              <VoutModeComposer
                state={state}
                info={vm.voutModeInfo}
                byte={state.voutMode.byte}
                dispatch={dispatch}
                embedded
              />
            )}

            {/* Payload semantics + byte order in one compact row */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <label
                className="flex items-center gap-2 text-sm color-text-muted"
                htmlFor="l16-payload-kind"
              >
                <span>数据解释</span>
                <select
                  id="l16-payload-kind"
                  value={state.l16.payloadKind}
                  onChange={(e) =>
                    dispatch({
                      type: 'l16/set-payload-kind',
                      payloadKind: e.target.value as 'ulinear16' | 'slinear16-offset',
                    })
                  }
                  className="input-field max-w-full min-w-0 rounded-lg px-3 py-2 text-sm outline-none"
                  aria-label="L16 数据解释类型"
                >
                  <option value="ulinear16">ULINEAR16（无符号）</option>
                  <option value="slinear16-offset">SLINEAR16（二补码偏移）</option>
                </select>
              </label>

              <span className="text-xs color-text-muted">
                Raw Word 是未交换的 16 位数值；SMBus/PMBus word 事务在线上按低字节在前传输 （SMBus
                3.0 §6.5.4），线上字节顺序只在 Wire Bytes 显示/复制层出现 （
                <TechnicalTerm termId="le" /> / <TechnicalTerm termId="be" />）
              </span>
              <span className="text-xs color-text-muted">
                解释语义：
                <TechnicalTerm termId="ulinear16" /> · <TechnicalTerm termId="slinear16" />
              </span>
            </div>

            {/* Relative ULINEAR16: nominal VOUT_COMMAND reference */}
            {vm.l16Payload?.requiresNominalReference && (
              <NominalVoutInput
                id="l16-nominal-vout"
                value={state.l16.nominalVout}
                ariaLabel="VOUT_COMMAND 标称参考值（V）"
                onCommit={(text) => dispatch({ type: 'l16/set-nominal-vout', nominalVout: text })}
                onClear={() => dispatch({ type: 'l16/clear-nominal-vout' })}
              />
            )}

            {/*
             * Physical-value entry is decided by the payload context, not by
             * the byte-level VOUT_MODE status: the signed offset payload
             * (§13.3/§13.4) ignores bit7, so 0x98 + SLINEAR16 keeps its
             * input; only relative ULINEAR16 (a ratio) blocks reverse encode.
             * Blocked states render the view-model's discriminated reason —
             * the component makes no spec judgements of its own.
             */}
            {vm.l16Payload?.physicalInputAvailable ? (
              <>
                {/* Physical value input — encodes via value / 2^N */}
                <ValueInput vm={vm} dispatch={dispatch} />

                <div className="text-center text-xs color-text-muted">
                  {vm.nRangeText ? `可表示范围: ${vm.nRangeText}` : '范围由数据解释类型决定'}
                </div>
              </>
            ) : vm.l16Payload?.blocked ? (
              <div className="workspace-l16-block rounded-lg px-4 py-3 text-sm" role="note">
                <p className="mb-2">{vm.l16Payload.blocked.title}</p>
                {vm.l16Payload.blocked.detailLines.map((line) => (
                  <p key={line} className="mb-2">
                    {line}
                  </p>
                ))}
                <p>
                  显式应用计算器 LINEAR 示例 0x18（absolute、N=-8）后才恢复 LINEAR16 编码。0x18
                  是本计算器的示例值，不是 PMBus 规范默认值，也不代表真实器件一定接受 VOUT_MODE
                  写入。
                </p>
              </div>
            ) : (
              <div className="workspace-l16-block rounded-lg px-4 py-3 text-sm">
                <p className="mb-2">
                  VOUT_MODE {vm.voutModeInfo?.hex} 为 {vm.voutModeInfo?.statusText}
                  ；当前数据解释为相对比值 R = Y_u × 2^N（仅适用于 §8.5 列出的相对阈值 命令），需
                  VOUT_COMMAND 标称参考值才能得到最终电压；本页不提供其物理值
                  反向编码，也不给出伪造的 LINEAR16 电压结果。SLINEAR16（二补码偏移） 解释不受 bit7
                  影响并保留物理值输入。
                </p>
              </div>
            )}
          </div>
        )}

        {mode === 'VOUT_MODE' && vm.voutModePage && (
          <VoutModeComposer
            state={state}
            info={vm.voutModePage}
            byte={state.voutMode.byte}
            dispatch={dispatch}
          />
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
                className="input-field w-full rounded-lg px-3 py-2 text-base font-semibold outline-none"
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
                    className="input-field w-full rounded-lg px-3 py-2 text-sm outline-none"
                  />
                </div>
              ))}
            </div>

            <div className="text-center text-xs color-text-muted">
              <TechnicalTerm termId="twos-complement" />
              整数：m、b 为 16 位，R 为 8 位；m ≠ 0。系数非法时不会静默接受。Y 按 §7.4 generic
              契约为有符号 16 位；输出电压命令的 DIRECT 数据按 §8.1.1/§8.4.3
              为无符号正值语义，需命令/器件上下文，本页不提供 unsigned profile。
            </div>
          </div>
        )}

        {mode === 'HALF' && (
          <div className="space-y-4">
            <p className="text-sm color-text-secondary">
              <TechnicalTerm termId="binary16" />
              （半精度）：符号 1 位、指数 5 位、尾数 10 位。物理值输入支持 +0、-0、
              <TechnicalTerm termId="fp-special">NaN、+Infinity、-Infinity</TechnicalTerm>。
            </p>
            <ValueInput vm={vm} dispatch={dispatch} />
            {vm.halfSpecial && <HalfSpecialCard semantics={vm.halfSpecial} />}
          </div>
        )}
      </section>
    </div>
  )
}
