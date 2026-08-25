import type { BitGroupVM } from '../../app/view-model'
import type { AppMode } from '../../app/state'
import type { AppAction } from '../../app/actions'

interface Props {
  mode: AppMode
  groups: BitGroupVM[]
  dispatch: React.Dispatch<AppAction>
}

type BitRegion = 'primary' | 'secondary' | 'sign' | 'exponent' | 'mantissa'

function getBitRegion(index: number, mode: AppMode): BitRegion {
  if (mode === 'L11') return index >= 11 ? 'primary' : 'secondary'
  if (mode === 'HALF') {
    if (index === 15) return 'sign'
    if (index >= 10) return 'exponent'
    return 'mantissa'
  }
  return 'secondary' // L16 V[15:0] / DIRECT Y[15:0] use a single-value region
}

type LegendVariant = 'n' | 'y' | 'e' | 'zero'

function getLegend(mode: AppMode): Array<{ variant: LegendVariant; label: string }> {
  if (mode === 'L11') {
    return [
      { variant: 'n', label: 'N [15:11]' },
      { variant: 'y', label: 'Y [10:0]' },
    ]
  }
  if (mode === 'HALF') {
    return [
      { variant: 'e', label: 'Sign [15]' },
      { variant: 'n', label: 'Exponent [14:10]' },
      { variant: 'y', label: 'Mantissa [9:0]' },
    ]
  }
  if (mode === 'DIRECT') {
    return [{ variant: 'y', label: 'Y [15:0]' }]
  }
  return [{ variant: 'y', label: 'V [15:0]' }]
}

export default function BitGrid({ mode, groups, dispatch }: Props) {
  return (
    <div className="mt-4">
      <div className="bit-grid-container">
        <div className="bit-grid-inner">
          {groups.map((group) => (
            <div
              key={group.nibbleIndex}
              className="surface border-subtle flex flex-col items-center rounded-lg p-1"
            >
              <div className="bit-label mb-1 rounded px-2 py-0.5 text-xs font-bold">
                {group.hex}
              </div>
              <div className="flex gap-0.5">
                {group.bits.map((bit) => {
                  const region = getBitRegion(bit.index, mode)
                  const isOn = bit.value === 1

                  const tokenPrefix =
                    region === 'primary' || region === 'exponent'
                      ? 'n'
                      : region === 'sign'
                        ? 'e'
                        : 'y'

                  return (
                    <button
                      type="button"
                      key={bit.index}
                      onClick={() => dispatch({ type: 'bit/toggle', bit: 15 - bit.index })}
                      className="flex min-h-10 min-w-8 flex-col items-center justify-center gap-0.5"
                      aria-label={`位 ${bit.index}: ${isOn ? '1' : '0'}`}
                      aria-pressed={isOn}
                      title={`Bit ${bit.index}`}
                    >
                      <div
                        className="bit-cell flex h-8 w-7 items-center justify-center rounded text-sm font-bold transition-colors"
                        data-region={tokenPrefix}
                        data-on={isOn}
                      >
                        {bit.value}
                      </div>
                      <span className="text-[10px] font-medium color-text-muted">{bit.index}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="mt-2 flex flex-wrap justify-center gap-3 text-[10px]">
        {getLegend(mode).map((item) => (
          <LegendItem key={item.label} {...item} />
        ))}
        <LegendItem variant="zero" label="0" />
      </div>
    </div>
  )
}

function LegendItem({ variant, label }: { variant: LegendVariant; label: string }) {
  return (
    <div className="flex items-center gap-1">
      <span className={`legend-swatch legend-${variant} inline-block h-2.5 w-2.5 rounded-sm`} />
      <span className="color-text-muted">{label}</span>
    </div>
  )
}
