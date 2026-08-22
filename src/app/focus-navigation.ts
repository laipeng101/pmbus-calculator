const TABBABLE_SELECTOR = 'a[href], button, input, select, textarea, [tabindex]'

/**
 * Find the logical tab neighbour of `from` in DOM order, skipping candidates
 * inside `exclude` (e.g. an open portal popup). Returns null at either end —
 * like the browser's own Tab, it never wraps around.
 */
export function findTabNeighbor(
  from: HTMLElement,
  direction: 1 | -1,
  exclude?: HTMLElement | null,
): HTMLElement | null {
  if (typeof document === 'undefined' || from.isConnected === false) return null
  const candidates = Array.from(document.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR)).filter(
    (el) => {
      if (exclude != null && exclude.contains(el)) return false
      // tabIndex >= 0 keeps natively focusable elements with tabindex="-1"
      // (e.g. inactive roving-tabindex tabs) out of the tab order.
      if (el.tabIndex < 0) return false
      if (el.hidden || el.matches(':disabled')) return false
      // jsdom has no layout engine; treat every candidate as visible there.
      return el.checkVisibility?.() ?? true
    },
  )
  const index = candidates.indexOf(from)
  if (index === -1) return null
  return candidates[index + direction] ?? null
}
