import { useId, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { autoUpdate, flip, offset, shift, size, useFloating } from '@floating-ui/react-dom'
import { getGlossaryTerm } from '../../app/terminology'
import type { TermId } from '../../app/terminology'
import { useHelpOverlay } from '../help/help-overlay-context'

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
 * - Click toggles; the app-level help overlay (HelpOverlayProvider) owns the
 *   single-open contract, so opening a second term — by mouse OR keyboard —
 *   closes the first, and one document listener handles outside-close and
 *   Escape with deterministic focus restore (v2.6.0).
 * - Clicking outside closes; clicking inside the popover does not.
 * - Works on touch (pointer events + click) — never hover-dependent.
 * - Floating UI keeps it inside the viewport (flip/shift/size/autoUpdate) and
 *   portal-rendered so it never affects the surrounding layout.
 *
 * The popover content is non-interactive prose, so it uses tooltip semantics
 * (aria-describedby + aria-expanded + aria-controls on the trigger).
 */
export default function TechnicalTerm({ termId, children }: Props) {
  const term = getGlossaryTerm(termId)
  const panelId = useId()
  const help = useHelpOverlay()
  // The overlay tracks surface INSTANCES, not concepts: the same TermId can be
  // mounted in several places (config summary + workspace term row), and only
  // the trigger the user interacted with may show its popover.
  const surfaceKey = useMemo(
    () => ({ kind: 'term' as const, id: termId + '#' + panelId }),
    [termId, panelId],
  )
  const open = help.isActive(surfaceKey)

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
        onClick={(event) => help.toggleTerm(surfaceKey, event.currentTarget)}
      >
        {children ?? term.token}
      </button>
      {open &&
        createPortal(
          <div
            // floating-ui 定位是逐帧动态坐标；仓库门禁禁止 JSX inline style
            // prop，因此用 callback ref 直接把定位写入 DOM style。
            ref={(node: HTMLDivElement | null) => {
              refs.setFloating(node)
              help.registerSurface(surfaceKey, node)
              const floating = refs.floating.current
              if (floating == null) return
              for (const [key, value] of Object.entries(floatingStyles)) {
                floating.style.setProperty(key, value === undefined ? '' : String(value))
              }
              floating.style.zIndex = '50'
            }}
            id={panelId}
            role="tooltip"
            data-testid={'term-popover-' + termId}
            className="term-popover popover-enter"
          >
            <span className="term-popover-name">{term.name}</span>
            <span className="term-popover-detail">{term.detail}</span>
          </div>,
          document.body,
        )}
    </>
  )
}
