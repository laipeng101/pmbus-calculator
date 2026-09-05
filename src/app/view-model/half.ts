import { PMBusMath } from '../../legacy/pmbus-math'
import { resolveHalfSpecialSemantics } from '../half-special-semantics'
import type { HalfSpecialSemantics } from '../half-special-semantics'
import { formatNumber } from './format'

export function resolveHalfValueText(raw: number): string {
  const r = PMBusMath.decodeHalf(raw)
  if (Number.isNaN(r.value)) return 'NaN'
  if (!Number.isFinite(r.value)) return r.value > 0 ? '+Infinity' : '-Infinity'
  return formatNumber(r.value)
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
