import type { BitFieldRegion } from '../../app/bit-regions'

export interface BitFieldBit {
  index: number
  value: number
  /** Optional Chinese semantic label (VOUT_MODE). */
  semantic?: string
}

export interface BitFieldNibble {
  nibbleIndex: number
  hex: string
  bits: readonly BitFieldBit[]
}

interface Props {
  bitCount: 8 | 16
  groups: readonly BitFieldNibble[]
  regions: readonly BitFieldRegion[]
  disabledBits?: ReadonlySet<number>
  /** Shown in the aria-label of a disabled bit (e.g. L16 format bits fixed). */
  disabledHint?: string
  density?: 'regular' | 'compact'
  onToggle: (bit: number) => void
  /** Accessible group name. */
  groupLabel: string
}

function regionFor(regions: readonly BitFieldRegion[], index: number): BitFieldRegion | undefined {
  return regions.find((region) => region.bitRange.includes(index))
}

/**
 * Single shared nibble/bit/legend editor used by both the 16-bit field grids
 * (L11 / L16 / DIRECT / HALF) and the 8-bit VOUT_MODE editor (standalone and
 * the compact LINEAR16-embedded variant).
 *
 * - 16-bit always renders 4 nibble groups; 8-bit always renders 2 nibble groups.
 * - The compact density only changes sizing/spacing under the same tokens — it
 *   never collapses the two nibble groups into an ungrouped flat row.
 * - On-bit coloring, the legend and disabled state all derive from regions;
 *   this component performs no PMBus field computation.
 * - A bit's accessible name is Chinese-primary and never bilingual.
 */
export default function BitFieldGrid({
  bitCount,
  groups,
  regions,
  disabledBits,
  disabledHint,
  density = 'regular',
  onToggle,
  groupLabel,
}: Props) {
  return (
    <div className="bitfield" data-bit-count={bitCount} data-density={density}>
      <div className="bitfield-grid" role="group" aria-label={groupLabel}>
        {groups.map((group) => (
          <div key={group.nibbleIndex} className="bitfield-nibble">
            <div className="bitfield-nibble-hex" aria-hidden="true">
              {group.hex}
            </div>
            <div className="bitfield-nibble-bits">
              {group.bits.map((bit) => {
                const region = regionFor(regions, bit.index)
                const disabled = disabledBits?.has(bit.index) === true
                const on = bit.value === 1
                const label = bit.semantic
                  ? '第 ' +
                    bit.index +
                    ' 位，' +
                    (disabled && disabledHint ? disabledHint : bit.semantic) +
                    '，当前为 ' +
                    bit.value
                  : '位 ' + bit.index + ': ' + bit.value
                return (
                  <button
                    key={bit.index}
                    type="button"
                    onClick={() => onToggle(bit.index)}
                    disabled={disabled}
                    aria-pressed={on}
                    aria-label={label}
                    className="bitfield-bit"
                  >
                    <div
                      className="bitfield-cell"
                      data-region={region?.colorToken}
                      data-on={on}
                      aria-hidden="true"
                    >
                      {bit.value}
                    </div>
                    <span className="bitfield-index" aria-hidden="true">
                      {bit.index}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
      <BitFieldLegend regions={regions} />
    </div>
  )
}

export function BitFieldLegend({ regions }: { regions: readonly BitFieldRegion[] }) {
  return (
    <div className="bitfield-legend">
      {regions.map((region) => (
        <span key={region.id} className="bitfield-legend-item">
          <span className={'legend-swatch legend-' + region.colorToken} aria-hidden="true" />
          <span className="bitfield-legend-label">{region.label}</span>
        </span>
      ))}
      <span className="bitfield-legend-item">
        <span className="legend-swatch legend-zero" aria-hidden="true" />
        <span className="bitfield-legend-label">0（未置位）</span>
      </span>
    </div>
  )
}
