import { PMBusMath } from '../../legacy/pmbus-math'
import { resolveHalfSpecialSemantics } from '../half-special-semantics'
import type { HalfSpecialSemantics } from '../half-special-semantics'
import { formatPlainNumber } from '../numeric-presentation'

export function resolveHalfValueText(raw: number): string {
  // Specials (NaN / ±Infinity / ±0) share the canonical plain-number policy
  // with the formula and step surfaces (ADR 0005).
  return formatPlainNumber(PMBusMath.decodeHalf(raw).value)
}

/**
 * HALF §7.6.2 special-value semantics: derived from the current raw word so
 * BOTH user paths (raw Hex edit and physical-value encode) surface the same
 * notice; it can never go stale because it is never stored in state.
 */
export function resolveHalfSpecial(raw: number): HalfSpecialSemantics | undefined {
  const semantics = resolveHalfSpecialSemantics(PMBusMath.decodeHalf(raw).value)
  return semantics.presentable ? semantics : undefined
}
