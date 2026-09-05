/**
 * Canonical plain-text numeric presentation policy — the single fact source
 * for how a domain Number becomes user-visible text on every presentation
 * surface (result view-model, formula plain text, calculation steps).
 *
 * The policy:
 *   NaN        -> 'NaN'
 *   +Infinity  -> '+Infinity'
 *   -Infinity  -> '-Infinity'
 *   -0         -> '-0'
 *   integers   -> Number.prototype.toString (shortest exact decimal)
 *   otherwise  -> 12 significant digits, trailing zeros folded
 *                 (parseFloat(value.toPrecision(12)).toString())
 *
 * Surface-specific presentation (LaTeX typesetting, sign-explicit endpoint
 * labels, the signed-error readout) must compose these helpers instead of
 * re-implementing the numeric rules; ADR 0005 records the contract.
 */

/** Canonical plain text for any domain Number, special values included. */
export function formatPlainNumber(value: number): string {
  if (Number.isNaN(value)) return 'NaN'
  if (value === Infinity) return '+Infinity'
  if (value === -Infinity) return '-Infinity'
  if (Object.is(value, -0)) return '-0'
  if (Number.isInteger(value)) return value.toString()
  return parseFloat(value.toPrecision(12)).toString()
}

/** KaTeX adapter: identical numeric semantics with LaTeX-safe special wrappers. */
export function formatPlainNumberLatex(value: number): string {
  if (Number.isNaN(value)) return '\\text{NaN}'
  if (value === Infinity) return '+\\infty'
  if (value === -Infinity) return '-\\infty'
  return formatPlainNumber(value)
}

/**
 * Sign-explicit rendering for quantization readout endpoints: special values
 * share the canonical text, zeroes always carry their sign ('+0' / '-0').
 */
export function formatSpecial(value: number): string {
  if (Number.isNaN(value)) return 'NaN'
  if (value > 0) return '+Infinity'
  if (value < 0) return '-Infinity'
  return Object.is(value, -0) ? '-0' : '+0'
}
