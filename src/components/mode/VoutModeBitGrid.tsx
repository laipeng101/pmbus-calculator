import type { VoutModeNibbleVM } from '../../app/view-model'

interface Props {
  nibbles: VoutModeNibbleVM[]
  onToggle: (bit: number) => void
  disabledBits?: ReadonlySet<number>
  /** Single compact 8-bit row (L16 embedded) instead of two nibble cards. */
  compact?: boolean
}

const ALL_BITS = [7, 6, 5, 4, 3, 2, 1, 0]

/**
 * Interactive 8-bit VOUT_MODE editor.
 *
 * - bit7..bit0 are focusable toggle buttons (Space/Enter via native button),
 *   each exposing bit number, current value and semantic via its accessible
 *   name (aria-label).
 * - The default layout splits bits into the two 4-bit nibble cards [7:4] and
 *   [3:0], each with its current hex digit.
 * - The compact layout renders one flat 8-bit row for the embedded LINEAR16
 *   editor, keeping the L16 page height bounded.
 * - disabledBits locks selected bits (L16 embedded editor locks bits[6:5]).
 */
export default function VoutModeBitGrid({
  nibbles,
  onToggle,
  disabledBits,
  compact = false,
}: Props) {
  if (compact) {
    return (
      <div className="vout-bit-grid-compact" role="group" aria-label="VOUT_MODE 8 位编辑器">
        {ALL_BITS.map((index) => {
          const nib = nibbles.find((n) => n.bits.some((b) => b.index === index))
          const bit = nib?.bits.find((b) => b.index === index)
          const disabled = disabledBits?.has(index) === true
          const isOn = (bit?.value ?? 0) === 1
          return (
            <button
              key={index}
              type="button"
              onClick={() => onToggle(index)}
              disabled={disabled}
              aria-pressed={isOn}
              aria-label={`第 ${index} 位，${bit?.semantic ?? '参数'}，当前为 ${bit?.value ?? 0}`}
              className="vout-bit-btn"
            >
              <span
                className="vout-bit-cell vout-bit-cell-compact"
                data-region={bit?.region ?? 'parameter'}
                data-on={isOn}
                aria-hidden="true"
              >
                {bit?.value ?? 0}
              </span>
              <span className="vout-bit-index" aria-hidden="true">
                {index}
              </span>
            </button>
          )
        })}
      </div>
    )
  }

  return (
    <div className="vout-bit-grid">
      {nibbles.map((nibble) => (
        <div key={nibble.nibbleIndex} className="vout-bit-nibble">
          <div className="vout-bit-nibble-hex" aria-hidden="true">
            {nibble.hex}
          </div>
          <div className="vout-bit-nibble-bits">
            {nibble.bits.map((bit) => {
              const disabled = disabledBits?.has(bit.index) === true
              const isOn = bit.value === 1
              return (
                <button
                  key={bit.index}
                  type="button"
                  onClick={() => onToggle(bit.index)}
                  disabled={disabled}
                  aria-pressed={isOn}
                  aria-label={`第 ${bit.index} 位，${bit.semantic}，当前为 ${bit.value}`}
                  className="vout-bit-btn"
                >
                  <span
                    className="vout-bit-cell"
                    data-region={bit.region}
                    data-on={isOn}
                    aria-hidden="true"
                  >
                    {bit.value}
                  </span>
                  <span className="vout-bit-index" aria-hidden="true">
                    {bit.index}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
