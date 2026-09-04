import { useRef } from 'react'
import type { AppState } from '../../app/state'
import type { AppAction } from '../../app/actions'
import type { VoutModeInfoVM } from '../../app/view-model'
import { findRadioNeighbor, radioArrowDirection, radioTabStop } from '../../app/radio-navigation'
import { VID_CODE_TABLE } from '../../legacy/vout-mode'
import { PMBusMath } from '../../legacy/pmbus-math'
import DecimalInput from '../inputs/DecimalInput'
import IntegerInput from '../inputs/IntegerInput'
import HexInput from '../inputs/HexInput'
import ExponentEditor from '../formula/ExponentEditor'
import LinearFormulaEditor from '../formula/LinearFormulaEditor'
import TechnicalTerm from '../term/TechnicalTerm'
import ControlTooltip from '../help/ControlTooltip'
import {
  VOUT_MODE_FORMATS,
  voutModeFormatTerm,
  l16FormatBitDisabledHint,
} from '../../app/vout-mode-formats'
import { getBitRegions } from '../../app/bit-regions'
import BitFieldGrid from '../bits/BitFieldGrid'
import VoutModeExplanations from './VoutModeExplanations'

interface Props {
  state: AppState
  info: VoutModeInfoVM
  /** Shared byte edited by the expert Hex input. */
  byte: number
  dispatch: React.Dispatch<AppAction>
  /** L16 embedded editor locks bits[6:5] and shows the linked/non-linear source. */
  embedded?: boolean
}

function vidOptionLabel(v: { code: number; kind: string; reservedReason?: string }): string {
  const hex = v.code.toString(16).toUpperCase().padStart(2, '0')
  if (v.kind === 'not-used') return hex + 'h · 未使用'
  if (v.kind === 'profile-required') return hex + 'h · 制造商自定义'
  // Listed-reserved options must state the Table 3 listing and never read
  // "未列出"; unlisted ones state their absence (v2.5.6 provenance split).
  if (v.kind === 'listed-reserved') {
    return v.reservedReason
      ? hex + 'h · 保留（Table 3 明列，' + v.reservedReason + '）'
      : hex + 'h · 保留（Table 3 明列）'
  }
  return hex + 'h · 保留（Table 3 未列出）'
}

const byteDigits = (byte: number) => (byte & 0xff).toString(16).toUpperCase().padStart(2, '0')

/**
 * Structured VOUT_MODE composer shared by the standalone VOUT_MODE calculator
 * and the embedded LINEAR16 editor.
 *
 * - raw Hex / raw bit buttons are lossless and can form any 0x00..0xFF;
 * - semantic controls canonicalize (VID forces Absolute, DIRECT/Half force
 *   parameter 0);
 * - on the L16 page the effective byte drives the editor and bits[6:5] are
 *   locked to 00b (LINEAR); editing bit7/N writes a canonical LINEAR byte back
 *   to the shared source and flips the page into the linked state.
 */
export default function VoutModeComposer({ state, info, byte, dispatch, embedded = false }: Props) {
  const isVid = info.format === 1
  const disabledBits = embedded ? new Set([5, 6]) : undefined
  const bits65Hint = embedded ? l16FormatBitDisabledHint(info.source) : undefined

  // ARIA APG radio pattern (v2.6.2): roving tabindex on the selected radio,
  // arrow keys move focus and select, wrapping and skipping disabled options.
  // The rel radio is disabled only for VID; a raw illegal byte (relative +
  // VID) can select a disabled radio, in which case radioTabStop falls back
  // to the first enabled radio so the keyboard never dead-ends.
  const absRelRefs = useRef<(HTMLButtonElement | null)[]>([])
  const formatRefs = useRef<(HTMLButtonElement | null)[]>([])
  const absRelDisabled = (index: number) => index === 1 && isVid
  const absRelSelected = info.isRelative === false ? 0 : info.isRelative === true ? 1 : -1
  const absRelStop = radioTabStop(2, absRelSelected, absRelDisabled)
  const formatSelected = VOUT_MODE_FORMATS.findIndex((f) => f.value === info.format)
  const formatStop = radioTabStop(VOUT_MODE_FORMATS.length, formatSelected, () => false)

  const onRadioArrowKey = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    refs: React.RefObject<(HTMLButtonElement | null)[]>,
    count: number,
    index: number,
    isDisabled: (i: number) => boolean,
    select: (next: number) => void,
  ) => {
    const direction = radioArrowDirection(event.key)
    if (direction == null) return
    event.preventDefault()
    const next = findRadioNeighbor(count, index, direction, isDisabled)
    if (next < 0) return
    refs.current[next]?.focus()
    // Selection follows focus; the same idempotent guards as click apply.
    select(next)
  }

  return (
    <div className="vout-composer min-w-0 space-y-1">
      {/* 8-bit interactive editor */}
      <BitFieldGrid
        bitCount={8}
        groups={info.nibbles}
        regions={getBitRegions('VOUT_MODE')}
        disabledBits={disabledBits}
        disabledHint={bits65Hint}
        disabledDescribedBy={embedded ? 'vout-bits65-disabled-reason' : undefined}
        density={embedded ? 'compact' : 'regular'}
        onToggle={(bit) => dispatch({ type: 'vout-mode/toggle-bit', bit })}
        groupLabel="VOUT_MODE 8 位编辑器"
      />

      {/* 原生 disabled 的位按钮不产生指针/焦点事件，bits[6:5] 的禁用原因
          必须有 tooltip 之外的可见路径，并经 aria-describedby 关联到位按钮。 */}
      {embedded && bits65Hint && (
        <p
          className="text-xs color-text-muted"
          data-testid="vout-bits65-disabled-reason"
          id="vout-bits65-disabled-reason"
        >
          {bits65Hint}（bits[6:5]，Part II §8.3）。
        </p>
      )}

      {/* bit7 + bits[6:5] semantic controls */}
      <div className="vout-composer-controls">
        <div role="radiogroup" aria-label="绝对值 / 相对值（bit7）" className="vout-seg">
          <ControlTooltip help="vout-abs" params={undefined}>
            {(triggerProps) => (
              <button
                {...triggerProps}
                type="button"
                role="radio"
                aria-checked={info.isRelative === false}
                ref={(el) => {
                  absRelRefs.current[0] = el
                  triggerProps.ref?.(el)
                }}
                tabIndex={absRelStop === 0 ? 0 : -1}
                onClick={() => {
                  // Re-selecting the active semantic control must not dispatch a
                  // state write: the reducer would keep the byte, but not
                  // dispatching keeps the transaction contract explicit (v2.5.7).
                  if (info.isRelative !== false) {
                    dispatch({ type: 'vout-mode/set-relative', relative: false })
                  }
                }}
                onKeyDown={(e) =>
                  onRadioArrowKey(e, absRelRefs, 2, 0, absRelDisabled, (next) => {
                    if (next === 0 && info.isRelative !== false) {
                      dispatch({ type: 'vout-mode/set-relative', relative: false })
                    } else if (next === 1 && info.isRelative !== true) {
                      dispatch({ type: 'vout-mode/set-relative', relative: true })
                    }
                  })
                }
                className="vout-seg-btn"
              >
                绝对值
              </button>
            )}
          </ControlTooltip>
          <ControlTooltip
            help="vout-rel"
            params={isVid ? { disabledReason: '相对值不适用于 VID（Part II §8.5.3）' } : {}}
          >
            {(triggerProps) => (
              <button
                {...triggerProps}
                type="button"
                role="radio"
                aria-checked={info.isRelative}
                disabled={isVid}
                ref={(el) => {
                  absRelRefs.current[1] = el
                  triggerProps.ref?.(el)
                }}
                tabIndex={absRelStop === 1 ? 0 : -1}
                onClick={() => {
                  if (info.isRelative !== true) {
                    dispatch({ type: 'vout-mode/set-relative', relative: true })
                  }
                }}
                onKeyDown={(e) =>
                  onRadioArrowKey(e, absRelRefs, 2, 1, absRelDisabled, (next) => {
                    if (next === 0 && info.isRelative !== false) {
                      dispatch({ type: 'vout-mode/set-relative', relative: false })
                    } else if (next === 1 && info.isRelative !== true) {
                      dispatch({ type: 'vout-mode/set-relative', relative: true })
                    }
                  })
                }
                className="vout-seg-btn"
              >
                相对值
              </button>
            )}
          </ControlTooltip>
        </div>
        {/* 原生 disabled 的控件不产生指针/焦点事件，禁用原因必须有可见路径。 */}
        {isVid && (
          <p className="text-xs color-text-muted" data-testid="vout-rel-disabled-reason">
            相对值不适用于 VID（Part II §8.5.3）。
          </p>
        )}

        {!embedded && (
          <div
            role="radiogroup"
            aria-label="格式（bits[6:5]）"
            className="vout-seg vout-seg-format"
          >
            {VOUT_MODE_FORMATS.map((f, formatIndex) => (
              <ControlTooltip key={f.value} help={f.helpId} params={undefined}>
                {(triggerProps) => (
                  <button
                    {...triggerProps}
                    type="button"
                    role="radio"
                    aria-checked={info.format === f.value}
                    ref={(el) => {
                      formatRefs.current[formatIndex] = el
                      triggerProps.ref?.(el)
                    }}
                    tabIndex={formatStop === formatIndex ? 0 : -1}
                    onClick={() => {
                      if (info.format !== f.value) {
                        dispatch({ type: 'vout-mode/set-format', format: f.value })
                      }
                    }}
                    onKeyDown={(e) =>
                      onRadioArrowKey(
                        e,
                        formatRefs,
                        VOUT_MODE_FORMATS.length,
                        formatIndex,
                        () => false,
                        (next) => {
                          const target = VOUT_MODE_FORMATS[next]
                          if (info.format !== target.value) {
                            dispatch({ type: 'vout-mode/set-format', format: target.value })
                          }
                        },
                      )
                    }
                    className="vout-seg-btn"
                  >
                    {f.label}
                  </button>
                )}
              </ControlTooltip>
            ))}
          </div>
        )}
      </div>

      {!embedded && (
        <div className="vout-term-row" data-testid="vout-term-row">
          <span className="text-xs color-text-muted">配置字节：</span>
          <TechnicalTerm termId="vout-mode" />
          <span className="text-xs color-text-muted">bit7 语义：</span>
          <TechnicalTerm termId="abs-rel" />
          {info.format === 0 && (
            <>
              <span className="text-xs color-text-muted">指数：</span>
              <TechnicalTerm termId="exponent" />
            </>
          )}
          <span className="text-xs color-text-muted">当前格式：</span>
          <TechnicalTerm termId={voutModeFormatTerm(info.format)} />
        </div>
      )}

      {/* bits[4:0] parameter */}
      {info.format === 0 ? (
        <div className="vout-param-linear">
          {embedded ? (
            <LinearFormulaEditor
              ariaLabel="LINEAR16 公式编辑器"
              valueCaption={
                state.l16.payloadKind === 'slinear16-offset'
                  ? 'Y_s（16 位有符号）'
                  : 'V（16 位无符号）'
              }
              valueEditor={
                <div className="w-28">
                  {state.l16.payloadKind === 'slinear16-offset' ? (
                    <IntegerInput
                      id="l16-v-input"
                      value={PMBusMath.toSigned(state.raw, 16)}
                      ariaLabel="Y_s（16 位二补码偏移，−32768～32767）"
                      onCommit={(text) => dispatch({ type: 'l16/set-slinear-y', y: text })}
                      className="input-field w-full rounded-lg px-2 py-2 text-center text-base font-semibold outline-none"
                    />
                  ) : (
                    <DecimalInput
                      id="l16-v-input"
                      value={state.raw}
                      ariaLabel="V（16 位无符号，0～65535）"
                      onCommit={(text) => dispatch({ type: 'raw/set', raw: text })}
                      className="input-field w-full rounded-lg px-2 py-2 text-center text-base font-semibold outline-none"
                    />
                  )}
                </div>
              }
              exponentEditor={
                <ExponentEditor
                  id="l16-n-input"
                  value={info.linearExponent ?? 0}
                  ariaLabel="L16 N（指数）"
                  onCommit={(text) => dispatch({ type: 'vout-mode/set-linear-n', n: text })}
                />
              }
            />
          ) : (
            <div className="vout-param-n-only">
              <label className="text-xs color-text-muted" htmlFor="vout-mode-n-input">
                N（5 位二补码，−16～15）
              </label>
              <ExponentEditor
                id="vout-mode-n-input"
                value={info.linearExponent ?? 0}
                ariaLabel="VOUT_MODE N（指数）"
                onCommit={(text) => dispatch({ type: 'vout-mode/set-linear-n', n: text })}
              />
            </div>
          )}
          {info.isRelative && (
            <p className="vout-param-note text-xs">
              {state.l16.payloadKind === 'slinear16-offset' ? (
                'bit7 相对值仅作用于 §8.5 相对阈值命令；当前 SLINEAR16 offset 是有符号命令 payload（§13.3/§13.4），bit7 不参与其数学，无需标称参考值。'
              ) : (
                <>
                  相对 LINEAR：payload 与 <TechnicalTerm termId="vout-command" />
                  同格式，解出比值 R；最终电压需要 VOUT_COMMAND 标称参考值。
                </>
              )}
            </p>
          )}
        </div>
      ) : info.format === 1 ? (
        <div className="vout-param-vid">
          <div className="text-xs color-text-muted">
            <TechnicalTerm termId="vid-code-type">VID 代码类型</TechnicalTerm>（无符号，0～31）
          </div>
          <select
            id="vout-vid-code-select"
            aria-label="VID 代码类型"
            value={info.param}
            onChange={(e) =>
              dispatch({ type: 'vout-mode/set-parameter', parameter: Number(e.target.value) })
            }
            className="input-field w-full min-w-0 rounded-lg px-3 py-2 text-sm outline-none"
          >
            {VID_CODE_TABLE.map((v) => (
              <option key={v.code} value={v.code}>
                {vidOptionLabel(v)}
              </option>
            ))}
          </select>
          <span className="text-xs color-text-muted">{info.statusText}</span>
        </div>
      ) : (
        <div className="vout-param-fixed text-xs color-text-muted">
          bits[4:0] 参数 = 00000b（Part II §8.3 Table 2 要求 {info.formatName} 参数恒为 0）
        </div>
      )}

      {/* Canonical byte + binary + validity + source */}
      <div className="vout-canonical" data-testid="vout-mode-canonical">
        <span className="vout-canonical-byte" data-testid="vout-mode-byte">
          {info.hex}
        </span>
        <span className="vout-canonical-binary" data-testid="vout-mode-binary">
          0b{info.binary}
        </span>
        <span
          className={
            'vout-canonical-status' + (info.structureLegal ? '' : ' vout-canonical-status-alert')
          }
          data-testid="vout-mode-status"
        >
          {info.statusText}
        </span>
        {info.source && (
          <span className="vout-canonical-source" data-testid="vout-mode-source">
            {info.source === 'linked' ? '已关联' : '非 LINEAR'}
          </span>
        )}
      </div>

      {/* Expert Hex — lossless raw byte edit */}
      <div className="flex items-start gap-2">
        <div className="mt-2 text-sm color-text-muted">
          <TechnicalTerm termId="hex" />
        </div>
        <HexInput
          id="vout-mode-input"
          value={byteDigits(byte)}
          fixedPrefix="0x"
          maxDigits={2}
          ariaLabel="VOUT_MODE"
          placeholder="18"
          stepper
          className="w-full text-sm"
          onCommit={(text) => dispatch({ type: 'vout-mode/set-byte', hex: text })}
        />
      </div>

      {/* Explicit recovery action: the calculator's LINEAR example byte. */}
      {embedded ? (
        info.source === 'non-linear' ? (
          <>
            <ControlTooltip help="vout-apply-example" params={undefined}>
              {(triggerProps) => (
                <button
                  {...triggerProps}
                  type="button"
                  onClick={() => dispatch({ type: 'l16/apply-calculator-linear-example' })}
                  className="vout-apply-default min-h-9 rounded-md px-3 py-1.5 text-xs font-semibold"
                >
                  应用计算器 LINEAR 示例 0x18
                </button>
              )}
            </ControlTooltip>
            <p className="text-xs color-text-muted">
              0x18（absolute、N=-8）是本计算器的初始/恢复示例值，不是 PMBus
              规范默认值，也不代表真实器件一定接受 VOUT_MODE 写入。
            </p>
          </>
        ) : null
      ) : (
        <ControlTooltip help="vout-normalize" params={undefined}>
          {(triggerProps) => (
            <button
              {...triggerProps}
              type="button"
              onClick={() => dispatch({ type: 'vout-mode/normalize' })}
              className="vout-normalize min-h-9 rounded-md px-3 py-1.5 text-xs font-semibold"
            >
              规范化
            </button>
          )}
        </ControlTooltip>
      )}

      <details className="vout-explanations-details">
        <ControlTooltip
          help="vout-explanations-toggle"
          params={{ count: info.explanations.length }}
        >
          {(triggerProps) => (
            <summary {...triggerProps}>说明（{info.explanations.length}）</summary>
          )}
        </ControlTooltip>
        <VoutModeExplanations explanations={info.explanations} />
      </details>
    </div>
  )
}
