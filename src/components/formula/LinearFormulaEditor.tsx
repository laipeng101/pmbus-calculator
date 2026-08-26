import type { ReactNode } from 'react'

interface Props {
  valueEditor: ReactNode
  valueCaption: string
  exponentEditor: ReactNode
  lockButton?: ReactNode
  ariaLabel: string
}

/**
 * Shared continuous LINEAR formula: value × 2^(exponent).
 *
 * The base digit "2", the "×" operator and the value slot live in fixed grid
 * slots; the exponent editor is anchored to the top-right exponent slot of the
 * base. The optional lock button occupies its own adjacent slot so it never
 * overlaps the exponent or shifts the base/operator anchors. Used by both L11
 * (Y × 2^N) and L16 (V × 2^N) so they share one visual and a11y contract.
 */
export default function LinearFormulaEditor({
  valueEditor,
  valueCaption,
  exponentEditor,
  lockButton,
  ariaLabel,
}: Props) {
  return (
    <div className="linear-formula" role="group" aria-label={ariaLabel}>
      <div className="linear-formula-value min-w-0">
        <div className="linear-formula-caption">{valueCaption}</div>
        {valueEditor}
      </div>

      <span className="linear-op" data-testid="linear-op" aria-hidden="true">
        ×
      </span>

      <span className="power-term">
        <span className="power-base" data-testid="power-base" aria-hidden="true">
          2
        </span>
        <span className="power-exponent" data-testid="power-exponent">
          {exponentEditor}
        </span>
      </span>

      {lockButton != null && <span className="power-lock">{lockButton}</span>}
    </div>
  )
}
