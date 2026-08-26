import type { AppState } from '../../app/state'
import type { AppAction } from '../../app/actions'
import type { CalculatorViewModel } from '../../app/view-model'
import type { VoutModeFormat } from '../../legacy/vout-mode'
import { VID_CODE_TABLE } from '../../legacy/vout-mode'
import DecimalInput from '../inputs/DecimalInput'
import HexInput from '../inputs/HexInput'
import ExponentEditor from '../formula/ExponentEditor'
import LinearFormulaEditor from '../formula/LinearFormulaEditor'

interface Props {
  state: AppState
  vm: CalculatorViewModel
  dispatch: React.Dispatch<AppAction>
}

const FORMATS: Array<{ value: VoutModeFormat; label: string }> = [
  { value: 0, label: 'LINEAR' },
  { value: 1, label: 'VID' },
  { value: 2, label: 'DIRECT' },
  { value: 3, label: 'IEEE Half' },
]

function vidOptionLabel(code: number, kind: string): string {
  const hex = code.toString(16).toUpperCase().padStart(2, '0')
  if (kind === 'not-used') return hex + 'h · Not Used'
  if (kind === 'profile-required') return hex + 'h · 制造商自定义'
  return hex + 'h · Reserved'
}

/**
 * Structured VOUT_MODE composer: bit7 (absolute/relative), bits[6:5] (format),
 * bits[4:0] (parameter) plus a real-time canonical byte / binary / validity
 * readout and the expert Hex input. All controls dispatch reducer actions;
 * this component never computes domain state itself.
 */
export default function VoutModeComposer({ state, vm, dispatch }: Props) {
  const info = vm.voutModeInfo
  if (info == null) return null

  const isVid = info.mode === 1

  return (
    <div className="vout-composer min-w-0 space-y-3">
      {/* bit7 + bits[6:5] */}
      <div className="vout-composer-controls">
        <div role="radiogroup" aria-label="Absolute / Relative（bit7）" className="vout-seg">
          <button
            type="button"
            role="radio"
            aria-checked={info.isRelative === false}
            onClick={() => dispatch({ type: 'l16/set-vout-relative', relative: false })}
            className="vout-seg-btn"
          >
            Absolute
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={info.isRelative}
            aria-disabled={isVid}
            disabled={isVid}
            title={isVid ? 'Relative 不适用于 VID（Part II §8.5.3）' : undefined}
            onClick={() => dispatch({ type: 'l16/set-vout-relative', relative: true })}
            className="vout-seg-btn"
          >
            Relative
          </button>
        </div>

        <div role="radiogroup" aria-label="格式（bits[6:5]）" className="vout-seg vout-seg-format">
          {FORMATS.map((f) => (
            <button
              key={f.value}
              type="button"
              role="radio"
              aria-checked={info.mode === f.value}
              onClick={() => dispatch({ type: 'l16/set-vout-format', format: f.value })}
              className="vout-seg-btn"
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* bits[4:0] parameter */}
      {info.mode === 0 ? (
        <div className="vout-param-linear">
          <LinearFormulaEditor
            ariaLabel="LINEAR16 公式编辑器"
            valueCaption="V（16 位无符号）"
            valueEditor={
              <div className="w-24">
                <DecimalInput
                  id="l16-v-input"
                  value={state.raw}
                  ariaLabel="V（16 位无符号，0～65535）"
                  onCommit={(text) => dispatch({ type: 'raw/set', raw: text })}
                  className="input-surface w-full rounded-lg px-2 py-2 text-center text-base font-semibold outline-none"
                />
              </div>
            }
            exponentEditor={
              <ExponentEditor
                id="l16-n-input"
                value={info.linearExponent ?? 0}
                ariaLabel="L16 N（指数）"
                onCommit={(text) => dispatch({ type: 'l16/set-vout-linear-n', n: text })}
              />
            }
          />
          {info.isRelative && (
            <p className="vout-param-note text-xs">
              相对 LINEAR：V × 2^N 是比值编码，绝对电压需要 VOUT_COMMAND nominal reference。
            </p>
          )}
        </div>
      ) : info.mode === 1 ? (
        <div className="vout-param-vid">
          <label className="text-xs color-text-muted" htmlFor="vout-vid-code-select">
            VID Code Type（unsigned，0～31）
          </label>
          <select
            id="vout-vid-code-select"
            aria-label="VID Code Type"
            value={info.param}
            onChange={(e) =>
              dispatch({ type: 'l16/set-vout-vid-code', code: Number(e.target.value) })
            }
            className="panel-surface-muted rounded-lg px-3 py-2 text-sm outline-none"
          >
            {VID_CODE_TABLE.map((v) => (
              <option key={v.code} value={v.code}>
                {vidOptionLabel(v.code, v.kind)}
              </option>
            ))}
          </select>
          <span className="text-xs color-text-muted">{info.statusText}</span>
        </div>
      ) : (
        <div className="vout-param-fixed text-xs color-text-muted">
          bits[4:0] parameter = 00000b（Part II §8.3 Table 2 要求 {info.modeName} 参数恒为 0）
        </div>
      )}

      {/* Canonical byte + binary + validity */}
      <div className="vout-canonical" data-testid="vout-mode-canonical">
        <span className="vout-canonical-byte">{info.hex}</span>
        <span className="vout-canonical-binary" data-testid="vout-mode-binary">
          0b{info.binary}
        </span>
        <span
          className={
            'vout-canonical-status' + (info.status === 'ok' ? '' : ' vout-canonical-status-alert')
          }
          data-testid="vout-mode-status"
        >
          {info.statusText}
        </span>
      </div>

      {/* Expert Hex — bidirectional with the structured controls */}
      <div className="flex items-start gap-2">
        <label className="mt-2 text-sm color-text-muted" htmlFor="vout-mode-input">
          Hex
        </label>
        <HexInput
          id="vout-mode-input"
          value={info.hex}
          maxDigits={2}
          ariaLabel="VOUT_MODE"
          placeholder="0x18"
          className="input-surface w-full rounded-lg px-3 py-2 text-sm outline-none"
          onCommit={(text) => dispatch({ type: 'l16/set-vout-mode', hex: text })}
        />
      </div>
    </div>
  )
}
