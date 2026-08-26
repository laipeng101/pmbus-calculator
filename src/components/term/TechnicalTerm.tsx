import { useEffect, useId, useState } from 'react'
import { createPortal } from 'react-dom'
import { autoUpdate, flip, offset, shift, size, useFloating } from '@floating-ui/react-dom'
import { getGlossaryTerm } from '../../app/terminology'
import type { TermId } from '../../app/terminology'

interface Props {
  termId: TermId
  /** Override the visible token; defaults to the glossary canonical token. */
  children?: React.ReactNode
}

/**
 * Accessible, click-toggled glossary popover for a canonical technical term.
 *
 * - The trigger is a real, focusable <button> that looks like inline text with
 *   a dotted underline (not a normal button surface).
 * - Click toggles; opening a second term closes the first (each instance owns
 *   its own local open state, and the document-level outside-pointer handler
 *   closes any open popover).
 * - Clicking outside closes; clicking inside the popover does not.
 * - Escape closes and restores focus to the trigger.
 * - Works on touch (pointer events + click) — never hover-dependent.
 * - Floating UI keeps it inside the viewport (flip/shift/size/autoUpdate) and
 *   portal-rendered so it never affects the surrounding layout.
 *
 * The popover content is non-interactive prose, so it uses tooltip semantics
 * (aria-describedby + aria-expanded + aria-controls on the trigger).
 */
export default function TechnicalTerm({ termId, children }: Props) {
  const term = getGlossaryTerm(termId)
  const [open, setOpen] = useState(false)
  const panelId = useId()

  const { refs, floatingStyles } = useFloating<HTMLButtonElement>({
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

  // Outside pointer down closes the popover (but not pointer down inside the
  // trigger or inside the popover itself).
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (refs.reference.current?.contains(target)) return
      if (refs.floating.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open, refs])

  // Escape closes and restores focus to the trigger.
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        refs.reference.current?.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, refs])

  if (!term) return <>{children ?? null}</>

  return (
    <>
      <button
        type="button"
        ref={refs.setReference}
        className="term-trigger"
        data-testid={'term-trigger-' + termId}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-describedby={open ? panelId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        {children ?? term.token}
      </button>
      {open &&
        createPortal(
          <div
            ref={refs.setFloating}
            id={panelId}
            role="tooltip"
            data-testid={'term-popover-' + termId}
            className="term-popover popover-enter"
            style={{ ...floatingStyles, zIndex: 50 }}
          >
            <span className="term-popover-name">{term.name}</span>
            <span className="term-popover-detail">{term.detail}</span>
          </div>,
          document.body,
        )}
    </>
  )
}
