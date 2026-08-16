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

function getLegend(mode: AppMode): Array<{ color: string; border?: string; label: string }> {
  if (mode === 'L11') {
    return [
      { color: '#3b82f6', label: 'N [15:11]' },
      { color: '#10b981', label: 'Y [10:0]' },
    ]
  }
  if (mode === 'HALF') {
    return [
      { color: '#f59e0b', label: 'Sign [15]' },
      { color: '#3b82f6', label: 'Exponent [14:10]' },
      { color: '#10b981', label: 'Mantissa [9:0]' },
    ]
  }
  if (mode === 'DIRECT') {
    return [{ color: '#10b981', label: 'Y [15:0]' }]
  }
  return [{ color: '#10b981', label: 'V [15:0]' }]
}

export default function BitGrid({ mode, groups, dispatch }: Props) {
  return (
    <div className="mt-4">
      <div className="bit-grid-container">
        <div className="bit-grid-inner">
          {groups.map((group) => (
            <div
              key={group.nibbleIndex}
              className="flex flex-col items-center rounded-lg p-1"
              style={{
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border-subtle)',
              }}
            >
              <div
                className="mb-1 rounded px-2 py-0.5 text-xs font-bold"
                style={{
                  background: 'var(--color-surface-muted)',
                  color: 'var(--color-accent)',
                  fontFamily: 'var(--font-mono)',
                  border: '1px dashed var(--color-border)',
                }}
              >
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
                  const regionBg = `var(--color-bit-${tokenPrefix}-bg)`
                  const regionBorder = `var(--color-bit-${tokenPrefix}-border)`
                  const regionText = `var(--color-bit-${tokenPrefix}-text)`
                  const bgColor = isOn ? regionBg : 'var(--color-surface-muted)'
                  const borderColor = isOn ? regionBorder : 'var(--color-border)'
                  const textColor = isOn ? regionText : 'var(--color-text-muted)'

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
                        className="flex h-8 w-7 items-center justify-center rounded text-sm font-bold transition-all hover:scale-105 active:scale-95"
                        style={{
                          background: bgColor,
                          color: textColor,
                          border: `2px solid ${borderColor}`,
                          boxShadow: 'none',
                        }}
                      >
                        {bit.value}
                      </div>
                      <span
                        className="text-[10px] font-medium"
                        style={{ color: 'var(--color-text-muted)' }}
                      >
                        {bit.index}
                      </span>
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
        <LegendItem color="var(--color-surface-muted)" border="var(--color-border)" label="0" />
      </div>
    </div>
  )
}

function LegendItem({ color, border, label }: { color: string; border?: string; label: string }) {
  return (
    <div className="flex items-center gap-1">
      <span
        className="inline-block h-2.5 w-2.5 rounded-sm"
        style={{
          background: color,
          border: `1px solid ${border || color}`,
        }}
      />
      <span style={{ color: 'var(--color-text-muted)' }}>{label}</span>
    </div>
  )
}
