import type { AppState } from '../../app/state'
import type { AppAction } from '../../app/actions'
import type { VoutModeInfoVM } from '../../app/view-model'
import type { VoutModeFormat } from '../../legacy/vout-mode'
import { VID_CODE_TABLE } from '../../legacy/vout-mode'
import { PMBusMath } from '../../legacy/pmbus-math'
import DecimalInput from '../inputs/DecimalInput'
import IntegerInput from '../inputs/IntegerInput'
import HexInput from '../inputs/HexInput'
import ExponentEditor from '../formula/ExponentEditor'
import LinearFormulaEditor from '../formula/LinearFormulaEditor'
import TechnicalTerm from '../term/TechnicalTerm'
import type { TermId } from '../../app/terminology'
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

const FORMATS: Array<{ value: VoutModeFormat; label: string }> = [
  { value: 0, label: 'LINEAR' },
  { value: 1, label: 'VID' },
  { value: 2, label: 'DIRECT' },
  { value: 3, label: 'IEEE Half' },
]

const FORMAT_TERM_ID: Record<VoutModeFormat, TermId> = {
  0: 'linear',
  1: 'vid',
  2: 'direct',
  3: 'binary16',
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

  return (
    <div className="vout-composer min-w-0 space-y-1">
      {/* 8-bit interactive editor */}
      <BitFieldGrid
        bitCount={8}
        groups={info.nibbles}
        regions={getBitRegions('VOUT_MODE')}
        disabledBits={disabledBits}
        disabledHint={
          embedded
            ? info.source === 'non-linear'
              ? '格式位不可在本页切换（当前字节非 LINEAR）'
              : '格式位固定为 LINEAR'
            : undefined
        }
        density={embedded ? 'compact' : 'regular'}
        onToggle={(bit) => dispatch({ type: 'vout-mode/toggle-bit', bit })}
        groupLabel="VOUT_MODE 8 位编辑器"
      />

      {/* bit7 + bits[6:5] semantic controls */}
      <div className="vout-composer-controls">
        <div role="radiogroup" aria-label="绝对值 / 相对值（bit7）" className="vout-seg">
          <button
            type="button"
            role="radio"
            aria-checked={info.isRelative === false}
            onClick={() => dispatch({ type: 'vout-mode/set-relative', relative: false })}
            className="vout-seg-btn"
          >
            绝对值
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={info.isRelative}
            aria-disabled={isVid}
            disabled={isVid}
            title={isVid ? '相对值不适用于 VID（Part II §8.5.3）' : undefined}
            onClick={() => dispatch({ type: 'vout-mode/set-relative', relative: true })}
            className="vout-seg-btn"
          >
            相对值
          </button>
        </div>

        {!embedded && (
          <div
            role="radiogroup"
            aria-label="格式（bits[6:5]）"
            className="vout-seg vout-seg-format"
          >
            {FORMATS.map((f) => (
              <button
                key={f.value}
                type="button"
                role="radio"
                aria-checked={info.format === f.value}
                onClick={() => dispatch({ type: 'vout-mode/set-format', format: f.value })}
                className="vout-seg-btn"
              >
                {f.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {!embedded && (
        <div className="vout-term-row" data-testid="vout-term-row">
          <span className="text-xs color-text-muted">配置字节：</span>
          <TechnicalTerm termId="vout-mode" />
          <span className="text-xs color-text-muted">当前格式：</span>
          <TechnicalTerm termId={FORMAT_TERM_ID[info.format]} />
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
                      className="input-surface w-full rounded-lg px-2 py-2 text-center text-base font-semibold outline-none"
                    />
                  ) : (
                    <DecimalInput
                      id="l16-v-input"
                      value={state.raw}
                      ariaLabel="V（16 位无符号，0～65535）"
                      onCommit={(text) => dispatch({ type: 'raw/set', raw: text })}
                      className="input-surface w-full rounded-lg px-2 py-2 text-center text-base font-semibold outline-none"
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
              {state.l16.payloadKind === 'slinear16-offset'
                ? 'bit7 相对值仅作用于 §8.5 相对阈值命令；当前 SLINEAR16 offset 是有符号命令 payload（§13.3/§13.4），bit7 不参与其数学，无需标称参考值。'
                : '相对 LINEAR：payload 与 VOUT_COMMAND 同格式，解出比值 R；最终电压需要 VOUT_COMMAND 标称参考值。'}
            </p>
          )}
        </div>
      ) : info.format === 1 ? (
        <div className="vout-param-vid">
          <label className="text-xs color-text-muted" htmlFor="vout-vid-code-select">
            VID 代码类型（无符号，0～31）
          </label>
          <select
            id="vout-vid-code-select"
            aria-label="VID 代码类型"
            value={info.param}
            onChange={(e) =>
              dispatch({ type: 'vout-mode/set-parameter', parameter: Number(e.target.value) })
            }
            className="panel-surface-muted w-full min-w-0 rounded-lg px-3 py-2 text-sm outline-none"
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
        <label className="mt-2 text-sm color-text-muted" htmlFor="vout-mode-input">
          Hex
        </label>
        <HexInput
          id="vout-mode-input"
          value={byteDigits(byte)}
          fixedPrefix="0x"
          maxDigits={2}
          ariaLabel="VOUT_MODE"
          placeholder="18"
          className="input-surface w-full rounded-lg px-3 py-2 text-sm outline-none"
          onCommit={(text) => dispatch({ type: 'vout-mode/set-byte', hex: text })}
        />
      </div>

      {/* Explicit canonicalization action */}
      {embedded ? (
        info.source === 'non-linear' ? (
          <button
            type="button"
            onClick={() => dispatch({ type: 'l16/apply-default-vout-mode' })}
            className="vout-apply-default min-h-9 rounded-md px-3 py-1.5 text-xs font-semibold"
          >
            应用默认 VOUT_MODE
          </button>
        ) : null
      ) : (
        <button
          type="button"
          onClick={() => dispatch({ type: 'vout-mode/normalize' })}
          className="vout-normalize min-h-9 rounded-md px-3 py-1.5 text-xs font-semibold"
        >
          规范化
        </button>
      )}

      <details className="vout-explanations-details">
        <summary>说明（{info.explanations.length}）</summary>
        <VoutModeExplanations explanations={info.explanations} />
      </details>
    </div>
  )
}
