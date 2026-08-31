/**
 * Pure helpers for the ARIA APG radio-group keyboard contract (v2.6.2).
 *
 * The VOUT_MODE semantic controls are `<button role="radio">` groups rendered
 * through ControlTooltip render props: the DOM glue (refs, keydown handlers)
 * stays in the component, while the walk / tab-stop decisions live here so
 * they are unit-testable under the coverage gates.
 */

export type RadioDirection = 'next' | 'previous'

/** Map an arrow key to walk direction; null for any other key. */
export function radioArrowDirection(key: string): RadioDirection | null {
  if (key === 'ArrowRight' || key === 'ArrowDown') return 'next'
  if (key === 'ArrowLeft' || key === 'ArrowUp') return 'previous'
  return null
}

/**
 * Nearest enabled radio in walk order, wrapping around the ends; -1 when no
 * other radio is enabled (the caller keeps focus where it is).
 */
export function findRadioNeighbor(
  count: number,
  current: number,
  direction: RadioDirection,
  isDisabled: (index: number) => boolean,
): number {
  if (count <= 1 || current < 0 || current >= count) return -1
  const step = direction === 'next' ? 1 : count - 1
  for (let i = 1; i < count; i++) {
    const candidate = (current + step * i) % count
    if (!isDisabled(candidate)) return candidate
  }
  return -1
}

/**
 * Roving tabindex stop for a radio group: the selected radio, or — only when
 * the selection itself is disabled (reachable through a raw illegal byte such
 * as relative + VID) — the first enabled radio, so the group never becomes a
 * keyboard dead end. -1 when nothing is enabled.
 */
export function radioTabStop(
  count: number,
  selectedIndex: number,
  isDisabled: (index: number) => boolean,
): number {
  if (count <= 0) return -1
  if (selectedIndex >= 0 && selectedIndex < count && !isDisabled(selectedIndex)) {
    return selectedIndex
  }
  for (let i = 0; i < count; i++) {
    if (!isDisabled(i)) return i
  }
  return -1
}
