import { PMBusMath } from '../../legacy/pmbus-math'
import type { AppState } from '../state'
import type { WarningVM } from './types'
import { formatPlainNumber } from '../numeric-presentation'

export function resolveL11ValueText(raw: number): string {
  const r = PMBusMath.decodeLinear11(raw)
  return formatPlainNumber(r.value)
}

/**
 * Saturation diagnostics per the encoding mode: auto-N searches the full
 * format range (N=15 extremes), a locked N clamps Y to -1024..1023 at that
 * N. Boundary encodings themselves never warn (DOMAIN_MODEL §2.1).
 */
export function resolveL11SaturationWarning(state: AppState): WarningVM | null {
  if (state.mode !== 'L11') return null
  if (state.l11.valueInput == null || !Number.isFinite(state.l11.valueInput)) return null
  const requested = state.l11.valueInput
  const { min, max } = state.l11.autoN
    ? { min: PMBusMath.minLinear11(), max: PMBusMath.maxLinear11() }
    : PMBusMath.linear11RangeForN(state.l11.n)
  if (requested > max || requested < min) {
    return {
      id: 'l11-saturation',
      level: 'warning',
      text: `输入值超出 LINEAR11 可表示范围（${formatPlainNumber(min)} ~ ${formatPlainNumber(max)}），编码器已饱和到极值；量化误差见误差面板。`,
    }
  }
  return null
}

export function resolveL11NRangeText(state: AppState): string | undefined {
  if (state.mode !== 'L11') return undefined
  const decoded = PMBusMath.decodeLinear11(state.raw & 0xffff)
  const p = PMBusMath.pow2(decoded.n)
  return `${formatPlainNumber(-1024 * p)} ~ ${formatPlainNumber(1023 * p)}`
}
