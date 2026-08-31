import { useEffect, useId, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { autoUpdate, flip, offset, shift, size, useFloating } from '@floating-ui/react-dom'
import { controlHelpText } from '../../app/control-help'
import type { ControlHelpId, ControlHelpParams } from '../../app/control-help'
import { useHelpOverlay } from './help-overlay-context'

/**
 * Props the host control spreads onto its trigger element. `ref` wires the
 * floating-ui reference (a plain callback so it fits any element type); the
 * event handlers implement the hover/focus trigger strategy described below.
 */
export interface ControlTriggerProps {
  ref?: (instance: HTMLElement | null) => void
  'aria-describedby'?: string
  onPointerEnter?: React.PointerEventHandler<HTMLElement>
  onPointerLeave?: React.PointerEventHandler<HTMLElement>
  onFocus?: React.FocusEventHandler<HTMLElement>
  onBlur?: React.FocusEventHandler<HTMLElement>
}

interface Props<K extends ControlHelpId> {
  help: K
  params: ControlHelpParams[K]
  children: (triggerProps: ControlTriggerProps, open: boolean) => ReactNode
}

/**
 * Unified hover/keyboard-focus tooltip for buttons and button-like controls
 * (v2.6.0). It shares the floating surface visuals and the app-level
 * single-open state with the glossary term popovers, but uses the control
 * trigger strategy:
 *
 * - fine-pointer hover opens immediately and pointerleave closes right away —
 *   never click-gated, never hijacking the control's own click action;
 * - keyboard `:focus-visible` opens (the a11y-equivalent path) and blur/Escape
 *   closes;
 * - coarse pointers stay untouched: the matchMedia gate plus the
 *   `pointerType === 'mouse'` filter keep touch taps free of sticky hover or
 *   first-tap hijacking;
 * - the surface is non-interactive prose with tooltip semantics
 *   (`role="tooltip"` + `aria-describedby`, no aria-expanded — the trigger is
 *   not a disclosure);
 * - unmounting (mode switch, conditional rendering) closes the surface so no
 *   orphan portal or stale active id survives.
 */
export default function ControlTooltip<K extends ControlHelpId>({
  help,
  params,
  children,
}: Props<K>) {
  const panelId = useId()
  const { isActive, openControl, closeIfActive, registerSurface } = useHelpOverlay()
  // Instance-scoped key (see TechnicalTerm): the same ControlHelpId could be
  // mounted twice, and only the interacted instance may show a surface.
  const surfaceKey = useMemo(
    () => ({ kind: 'control' as const, id: help + '#' + panelId }),
    [help, panelId],
  )
  const open = isActive(surfaceKey)
  const text = controlHelpText(help, params)

  const { refs, floatingStyles } = useFloating<HTMLElement>({
    open,
    placement: 'top',
    middleware: [
      offset(8),
      flip(),
      shift({ padding: 8 }),
      size({
        apply({ availableHeight, elements }) {
          Object.assign(elements.floating.style, {
            maxHeight: Math.max(availableHeight, 32) + 'px',
          })
        },
      }),
    ],
    whileElementsMounted: autoUpdate,
  })

  // Fine-pointer gate, evaluated lazily on first use and kept for the
  // component lifetime. Matched with the event-level pointerType filter so
  // touch pointer events can never open the tooltip.
  const finePointerRef = useRef<boolean | null>(null)
  const isFinePointer = () => {
    if (finePointerRef.current == null) {
      finePointerRef.current = window.matchMedia('(hover: hover) and (pointer: fine)').matches
    }
    return finePointerRef.current
  }

  // If this control unmounts while its surface is active (mode switch,
  // conditional render), drop the surface — no orphan portal, no stale id.
  // closeIfActive is a stable provider callback, so this runs once.
  useEffect(() => {
    return () => closeIfActive(surfaceKey)
  }, [surfaceKey, closeIfActive])

  const triggerProps: ControlTriggerProps = {
    ref: (node: HTMLElement | null) => {
      refs.setReference(node)
    },
    'aria-describedby': open ? panelId : undefined,
    onPointerEnter: (event) => {
      if (event.pointerType !== 'mouse' || !isFinePointer()) return
      openControl(surfaceKey, 'hover', event.currentTarget)
    },
    onPointerLeave: (event) => {
      if (event.pointerType !== 'mouse') return
      closeIfActive(surfaceKey, ['hover'])
    },
    onFocus: (event) => {
      if (!event.currentTarget.matches(':focus-visible')) return
      openControl(surfaceKey, 'focus', event.currentTarget)
    },
    onBlur: () => {
      closeIfActive(surfaceKey, ['focus'])
    },
  }

  return (
    <>
      {children(triggerProps, open)}
      {open &&
        createPortal(
          <div
            // floating-ui 定位是逐帧动态坐标；仓库门禁禁止 JSX inline style
            // prop，因此用 callback ref 直接把定位写入 DOM style。
            ref={(node: HTMLDivElement | null) => {
              refs.setFloating(node)
              registerSurface(surfaceKey, node)
              const floating = refs.floating.current
              if (floating == null) return
              for (const [key, value] of Object.entries(floatingStyles)) {
                floating.style.setProperty(key, value === undefined ? '' : String(value))
              }
              floating.style.zIndex = '50'
            }}
            id={panelId}
            role="tooltip"
            data-testid={'control-tooltip-' + help}
            className="term-popover popover-enter"
          >
            {text}
          </div>,
          document.body,
        )}
    </>
  )
}
