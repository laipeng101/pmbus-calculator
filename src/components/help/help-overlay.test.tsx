// jsdom unit contract for the app-level help overlay coordination (v2.6.1).
//
// Locks the unmount half of the single-open contract that only the provider
// state can observe: when a `TechnicalTerm` unmounts while its surface is the
// active one (mode switch / conditional rendering, e.g. the L11-only exponent
// term on Ctrl+1..5), the provider must drop the active surface, no orphan
// portal may survive, a new surface must still open as the only one, and the
// shared document listeners must stay add/remove-symmetric under StrictMode.
//
// The tests render the REAL HelpOverlayProvider + TechnicalTerm — no mocks —
// and observe provider state through a read-only Probe component that calls
// `useHelpOverlay()`.

import { StrictMode, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TechnicalTerm from '../term/TechnicalTerm'
import HelpOverlayProvider from './HelpOverlayProvider'
import { useHelpOverlay } from './help-overlay-context'

// floating-ui's autoUpdate uses ResizeObserver while a surface is open; jsdom
// does not implement it and the coordination contract under test does not
// depend on actual measurements.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
;(globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function Probe() {
  const help = useHelpOverlay()
  return <div data-testid="probe-active">{help.active ? help.active.key.id : 'none'}</div>
}

function ConditionalTerm({ mounted }: { mounted: boolean }) {
  // Mirrors the mode-switch pattern: the L11-only exponent term is
  // conditionally rendered and disappears on Ctrl+1..5.
  return mounted ? <TechnicalTerm termId="linear11-exponent" /> : null
}

function Host({ mounted }: { mounted: boolean }) {
  return (
    <StrictMode>
      <HelpOverlayProvider>
        <ConditionalTerm mounted={mounted} />
        <Probe />
      </HelpOverlayProvider>
    </StrictMode>
  )
}

function SecondHost() {
  return (
    <StrictMode>
      <HelpOverlayProvider>
        <TechnicalTerm termId="hex" />
        <Probe />
      </HelpOverlayProvider>
    </StrictMode>
  )
}

describe('help overlay active surface on term unmount', () => {
  let container: HTMLElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
  })

  function render(tree: React.ReactNode): void {
    act(() => {
      root.render(tree)
    })
  }

  function probeText(): string {
    return container.querySelector('[data-testid="probe-active"]')!.textContent ?? ''
  }

  function clickFirstTrigger(): HTMLButtonElement {
    const trigger = container.querySelector<HTMLButtonElement>('.term-trigger')
    expect(trigger).not.toBeNull()
    act(() => {
      trigger!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    return trigger!
  }

  it('opens a term through the provider', () => {
    render(<Host mounted={true} />)
    const trigger = clickFirstTrigger()
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(probeText()).toContain('linear11-exponent')
    expect(document.querySelectorAll('.term-popover')).toHaveLength(1)
  })

  it('clears the active surface when the open term unmounts', () => {
    render(<Host mounted={true} />)
    clickFirstTrigger()
    expect(probeText()).toContain('linear11-exponent')

    render(<Host mounted={false} />)

    expect(probeText()).toBe('none')
    expect(document.querySelectorAll('.term-popover')).toHaveLength(0)
  })

  it('opens a later surface as the only one after the stale surface is dropped', () => {
    render(<Host mounted={true} />)
    clickFirstTrigger()
    render(<Host mounted={false} />)
    expect(probeText()).toBe('none')

    render(<SecondHost />)
    const trigger = clickFirstTrigger()

    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(document.querySelectorAll('.term-popover')).toHaveLength(1)
    expect(document.querySelectorAll('[data-testid^="term-popover-"]')).toHaveLength(1)
    expect(probeText()).toContain('hex')
  })

  it('keeps the shared document listeners add/remove symmetric under StrictMode', () => {
    const addSpy = vi.spyOn(document, 'addEventListener')
    const removeSpy = vi.spyOn(document, 'removeEventListener')
    let added = 0
    let removed = 0
    try {
      render(<Host mounted={true} />)
      clickFirstTrigger()
      render(<Host mounted={false} />)
      const surfaceEvents = (spy: { mock: { calls: unknown[][] } }): number =>
        spy.mock.calls.filter(([type]) => type === 'keydown' || type === 'pointerdown').length
      added = surfaceEvents(addSpy)
      removed = surfaceEvents(removeSpy)
    } finally {
      addSpy.mockRestore()
      removeSpy.mockRestore()
    }
    expect(added).toBeGreaterThan(0)
    expect(added).toBe(removed)
  })
})
