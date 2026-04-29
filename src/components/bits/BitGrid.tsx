import type { BitGroupVM } from '../../app/view-model'
import type { AppAction } from '../../app/actions'

interface Props {
  groups: BitGroupVM[]
  dispatch: React.Dispatch<AppAction>
}

function getBitRegion(index: number): 'n' | 'y' | 'other' {
  if (index >= 11 && index <= 15) return 'n'
  if (index >= 0 && index <= 10) return 'y'
  return 'other'
}

export default function BitGrid({ groups, dispatch }: Props) {
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
                border: '1px solid var(--color-border)',
                boxShadow: '0 2px 6px rgba(0,0,0,0.04)',
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
                  const region = getBitRegion(bit.index)
                  const isOn = bit.value === 1

                  const bgColor = isOn
                    ? region === 'n'
                      ? '#3b82f6'
                      : '#10b981'
                    : 'var(--color-surface-muted)'
                  const borderColor = isOn
                    ? region === 'n'
                      ? '#2563eb'
                      : '#059669'
                    : 'var(--color-border)'
                  const textColor = isOn ? '#fff' : 'var(--color-text-muted)'
                  const shadow = isOn
                    ? region === 'n'
                      ? '0 4px 12px rgba(59,130,246,0.3)'
                      : '0 4px 12px rgba(16,185,129,0.3)'
                    : '0 1px 2px rgba(0,0,0,0.04)'

                  return (
                    <button
                      key={bit.index}
                      onClick={() => dispatch({ type: 'bit/toggle', bit: 15 - bit.index })}
                      className="flex flex-col items-center gap-0.5"
                      aria-label={`位 ${bit.index}: ${isOn ? '1' : '0'}`}
                      title={`Bit ${bit.index}`}
                    >
                      <div
                        className="flex h-8 w-7 items-center justify-center rounded text-sm font-bold transition-all hover:scale-105 active:scale-95"
                        style={{
                          background: bgColor,
                          color: textColor,
                          border: `2px solid ${borderColor}`,
                          boxShadow: shadow,
                        }}
                      >
                        {bit.value}
                      </div>
                      <span
                        className="text-[9px] font-medium"
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
        <LegendItem color="#3b82f6" label="N [15:11]" />
        <LegendItem color="#10b981" label="Y [10:0]" />
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
