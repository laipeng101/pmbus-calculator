import type { ReactNode } from 'react'
import { HelpOverlayContext, useHelpOverlayState } from './help-overlay-context'

/**
 * Mounts the app-wide single-open help coordination (see help-overlay-context
 * for the contract). Wrap the app once; help surfaces subscribe through
 * `useHelpOverlay`.
 */
export default function HelpOverlayProvider({ children }: { children: ReactNode }) {
  const value = useHelpOverlayState()
  return <HelpOverlayContext.Provider value={value}>{children}</HelpOverlayContext.Provider>
}
