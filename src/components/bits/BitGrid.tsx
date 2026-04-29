import type { BitGroupVM } from '../../app/view-model'
import type { AppAction } from '../../app/actions'

interface Props {
  groups: BitGroupVM[]
  dispatch: React.Dispatch<AppAction>
}

export default function BitGrid({ groups, dispatch }: Props) {
  return (
    <div className="mt-4">
      <div className="bit-grid-container">
        <div className="bit-grid-inner">
          {groups.map((group) => (
            <div
              key={group.nibbleIndex}
              className="flex flex-col items-center rounded-xl p-2 transition-all hover:opacity-90"
              style={{
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                boxShadow: 'var(--shadow-card)',
              }}
            >
              <div
                className="mb-2 rounded-md px-3 py-0.5 text-sm font-bold"
                style={{
                  background: 'var(--color-surface-muted)',
                  color: 'var(--color-accent)',
                  fontFamily: 'var(--font-mono)',
                  border: '1px dashed var(--color-border)',
                }}
              >
                {group.hex}
              </div>
              <div className="flex gap-1">
                {group.bits.map((bit) => {
                  const isNibbleBoundary =
                    bit.index === 15 ||
                    bit.index === 11 ||
                    bit.index === 7 ||
                    bit.index === 3
                  const isYBoundary = bit.index === 10
                  return (
                    <button
                      key={bit.index}
                      onClick={() =>
                        dispatch({ type: 'bit/toggle', bit: 15 - bit.index })
                      }
                      className="flex flex-col items-center gap-0.5"
                      aria-label={`位 ${bit.index}: ${bit.value ? '1' : '0'}`}
                      title={`Bit ${bit.index}`}
                    >
                      <div
                        className="flex h-9 w-8 items-center justify-center rounded-lg text-sm font-bold transition-all hover:scale-105 active:scale-95 md:h-10 md:w-9 md:text-base"
                        style={{
                          background: bit.value
                            ? isYBoundary
                              ? 'var(--color-bit-y)'
                              : isNibbleBoundary
                                ? 'var(--color-bit-n)'
                                : 'var(--color-bit-e)'
                            : 'var(--color-surface-muted)',
                          color: bit.value ? '#fff' : 'var(--color-text-muted)',
                          border: `2px solid ${
                            bit.value
                              ? isYBoundary
                                ? 'var(--color-bit-y)'
                                : isNibbleBoundary
                                  ? 'var(--color-bit-n)'
                                  : 'var(--color-bit-e)'
                              : 'var(--color-border)'
                          }`,
                          boxShadow: bit.value
                            ? '0 2px 8px rgba(0,0,0,0.15)'
                            : 'none',
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
      <div className="mt-3 flex flex-wrap justify-center gap-4 text-[11px]">
        <LegendItem color="var(--color-bit-n)" label="Nibble 边界" />
        <LegendItem color="var(--color-bit-y)" label="Y 区域" />
        <LegendItem color="var(--color-bit-e)" label="指数区域" />
        <LegendItem color="var(--color-surface-muted)" label="0" />
      </div>
    </div>
  )
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className="inline-block h-2.5 w-2.5 rounded-sm"
        style={{ background: color, border: '1px solid var(--color-border)' }}
      />
      <span style={{ color: 'var(--color-text-muted)' }}>{label}</span>
    </div>
  )
}
