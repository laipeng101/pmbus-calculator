import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

/**
 * App-level single-open coordination for every help surface (v2.6.0).
 *
 * At most one help surface is visible anywhere in the app — glossary term
 * popovers (click/tap toggled) and control tooltips (hover/focus shown) share
 * one active surface. Replacing the previous per-instance `useState(open)`
 * fixes the keyboard multi-open defect (keyboard activation produced no
 * pointerdown, so two popovers could stay open) and makes Escape handling
 * deterministic: one document listener owns close + focus restore instead of
 * competing per-instance listeners.
 *
 * This state is deliberately NOT part of the calculator reducer: hover/focus
 * transitions are high-frequency, and the provider only re-renders the help
 * components that subscribe. It is ephemeral UI state, never persisted.
 *
 * The context lives in a .ts module so the provider file exports only the
 * component (fast-refresh contract); consumers import `useHelpOverlay` from
 * here.
 */

export type HelpSurfaceKind = 'term' | 'control'

/** How the active surface was opened. */
export type HelpSurfaceSource = 'click' | 'hover' | 'focus'

export interface HelpSurfaceKey {
  kind: HelpSurfaceKind
  /** Glossary TermId or ControlHelpId. */
  id: string
}

export interface ActiveHelpSurface {
  key: HelpSurfaceKey
  source: HelpSurfaceSource
  /** Trigger element, kept for deterministic Escape focus restore. */
  trigger: HTMLElement | null
}

export interface HelpOverlayContextValue {
  active: ActiveHelpSurface | null
  isActive: (key: HelpSurfaceKey) => boolean
  activeSource: (key: HelpSurfaceKey) => HelpSurfaceSource | null
  /** Click/tap toggle for a term trigger; opening one surface closes any other. */
  toggleTerm: (key: HelpSurfaceKey, trigger: HTMLElement) => void
  /** Hover/focus open for a control tooltip; replaces any active surface. */
  openControl: (key: HelpSurfaceKey, source: 'hover' | 'focus', trigger: HTMLElement) => void
  /**
   * Close the surface when it is the active one; with `sources`, only when it
   * was opened through one of them (a hover leave must not close a surface
   * the user opened by keyboard and vice versa).
   */
  closeIfActive: (key: HelpSurfaceKey, sources?: HelpSurfaceSource[]) => void
  /**
   * Register/unregister the floating surface element so the outside-pointer
   * handler can ignore clicks on the (non-interactive) surface body.
   */
  registerSurface: (key: HelpSurfaceKey, element: HTMLElement | null) => void
}

export const HelpOverlayContext = createContext<HelpOverlayContextValue | null>(null)

function sameKey(a: HelpSurfaceKey, b: HelpSurfaceKey): boolean {
  return a.kind === b.kind && a.id === b.id
}

export function useHelpOverlay(): HelpOverlayContextValue {
  const value = useContext(HelpOverlayContext)
  if (value == null) {
    throw new Error('useHelpOverlay must be used inside <HelpOverlayProvider>')
  }
  return value
}

/**
 * Shared single-open state machine + document listeners. Used by the provider
 * component; kept beside the context so the whole coordination contract is
 * readable in one place.
 */
export function useHelpOverlayState(): HelpOverlayContextValue {
  const [active, setActive] = useState<ActiveHelpSurface | null>(null)
  const activeRef = useRef<ActiveHelpSurface | null>(null)
  const surfaceElementsRef = useRef(new Map<string, HTMLElement>())

  useEffect(() => {
    activeRef.current = active
  }, [active])

  const closeIfActive = useCallback((key: HelpSurfaceKey, sources?: HelpSurfaceSource[]) => {
    setActive((current) => {
      if (current == null || !sameKey(current.key, key)) return current
      if (sources != null && !sources.includes(current.source)) return current
      return null
    })
  }, [])

  const toggleTerm = useCallback((key: HelpSurfaceKey, trigger: HTMLElement) => {
    setActive((current) =>
      current != null && sameKey(current.key, key) ? null : { key, source: 'click', trigger },
    )
  }, [])

  const openControl = useCallback(
    (key: HelpSurfaceKey, source: 'hover' | 'focus', trigger: HTMLElement) => {
      setActive((current) => {
        if (current != null && sameKey(current.key, key) && current.source === source) {
          return current
        }
        return { key, source, trigger }
      })
    },
    [],
  )

  const registerSurface = useCallback((key: HelpSurfaceKey, element: HTMLElement | null) => {
    const mapKey = key.kind + ':' + key.id
    if (element == null) {
      surfaceElementsRef.current.delete(mapKey)
    } else {
      surfaceElementsRef.current.set(mapKey, element)
    }
  }, [])

  const isActive = useCallback(
    (key: HelpSurfaceKey) => active != null && sameKey(active.key, key),
    [active],
  )

  const activeSource = useCallback(
    (key: HelpSurfaceKey) => (active != null && sameKey(active.key, key) ? active.source : null),
    [active],
  )

  const value = useMemo<HelpOverlayContextValue>(
    () => ({
      active,
      isActive,
      activeSource,
      toggleTerm,
      openControl,
      closeIfActive,
      registerSurface,
    }),
    [active, isActive, activeSource, toggleTerm, openControl, closeIfActive, registerSurface],
  )

  // Single document listeners while a surface is open: outside pointerdown
  // closes, Escape closes and restores focus to the active trigger. Registered
  // once per open/closed transition (symmetric add/remove keeps Strict Mode
  // from leaking listeners).
  const open = active != null
  useEffect(() => {
    if (!open) return
    const isInside = (target: Node): boolean => {
      const current = activeRef.current
      if (current == null) return false
      if (current.trigger?.contains(target)) return true
      const surfaceEl = surfaceElementsRef.current.get(current.key.kind + ':' + current.key.id)
      return surfaceEl?.contains(target) ?? false
    }
    const onPointerDown = (event: PointerEvent) => {
      if (isInside(event.target as Node)) return
      setActive(null)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      const current = activeRef.current
      if (current == null) return
      setActive(null)
      current.trigger?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return value
}
