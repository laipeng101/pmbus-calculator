import { computeQuantizationOutcome } from '../quantization-error'
import type { QuantizationOutcome } from '../quantization-error'
import {
  formatExactDecimal,
  formatExactDelta,
  formatExactPercent,
  formatExactRational,
} from '../direct-exact'
import type { AppState } from '../state'
import type { DirectFidelityVM } from './types'
import { formatSignedError } from './format'
import { formatPlainNumber, formatSpecial } from '../numeric-presentation'
import { directFoldQuantizationNote } from './direct'

/**
 * Present one quantization outcome for the shared readout panel.
 *
 * Severity follows the outcome class only — exact/neutral, quantized/
 * informational, saturated or overflowing/error — with no cross-format
 * absolute threshold: PMBus device accuracy is a datasheet property
 * (Part II §7.8/§7.9), so no universal cut-off is implied.
 *
 * v2.5.12: DIRECT renders the exact rational verdict when one exists — the
 * binary64 Number fields cannot distinguish a folded delta from a real
 * zero, and a non-zero exact error must never display as 0.
 */
function presentQuantizationOutcome(outcome: QuantizationOutcome): {
  kind: 'ok' | 'warn' | 'error'
  text: string
  note?: string
} {
  if (outcome.directExact) {
    const exact = outcome.directExact
    const delta = formatExactDelta(exact.absoluteError)
    switch (outcome.status) {
      case 'exact':
        return { kind: 'ok', text: `+0.000000 (${formatExactPercent(exact.relativePercent)})` }
      case 'quantized':
        return {
          kind: 'warn',
          text: `${delta}（约 ${formatExactPercent(exact.relativePercent)}）`,
        }
      case 'saturated':
        return {
          kind: 'error',
          text: `${delta}（已编码到边界值）`,
          note: '请求值超出当前系数下的精确可表示范围，编码器已饱和',
        }
      // overflow / special are unreachable for a DIRECT exact transaction;
      // they fall through to the generic presentation below.
      default:
        break
    }
  }
  switch (outcome.status) {
    case 'exact': {
      const percent = outcome.relativeError === null ? '—' : `${outcome.relativeError.toFixed(4)}%`
      return { kind: 'ok', text: `+0.000000 (${percent})` }
    }
    case 'quantized': {
      const percent = outcome.relativeError === null ? '—' : `${outcome.relativeError.toFixed(4)}%`
      return {
        kind: 'warn',
        text: `${formatSignedError(outcome.absoluteError ?? 0)} (${percent})`,
      }
    }
    case 'saturated':
      return {
        kind: 'error',
        text: `${formatSignedError(outcome.absoluteError ?? 0)}（已编码到边界值）`,
        note: '请求值超出当前指数下的可表示范围，编码器已饱和',
      }
    case 'overflow':
      return {
        kind: 'error',
        text: `${formatPlainNumber(outcome.requested)} → ${formatSpecial(outcome.represented)}`,
        note: '有限值编码溢出（IEEE 754 binary16 范围 ±65504）',
      }
    case 'special':
      return {
        kind: 'warn',
        text: `${formatSpecial(outcome.requested)} → ${formatSpecial(outcome.represented)}`,
        note: '特殊值（NaN / ±Infinity）：量化误差不适用',
      }
  }
}

/**
 * Format-encoding quantization readout — shared by L11/L16/DIRECT/HALF via
 * the domain layer. Hidden entirely without an explicit request provenance
 * (error unknown, never fabricated zero); hidden for pages that cannot
 * decode a physical value (VOUT_MODE, relative LINEAR16, DIRECT m=0).
 */
export function resolveQuantizationPresentation(
  state: AppState,
  valueText: string,
  directFidelity: DirectFidelityVM | null,
): { deltaText?: string; deltaKind?: 'ok' | 'warn' | 'error'; deltaNote?: string } {
  const outcome = computeQuantizationOutcome(state)
  if (!outcome) return {}
  const presented = presentQuantizationOutcome(outcome)
  const notes: string[] = []
  if (presented.note) notes.push(presented.note)
  // v2.5.12: the panel keeps the committed exact request and the exact
  // represented value side by side whenever the displayed value cannot
  // show the request as-is (folded approximation, normalized display…).
  // A request that already IS the displayed value stays noise-free.
  if (outcome.directExact && valueText !== outcome.directExact.requestedText) {
    const e = outcome.directExact
    const representedText = formatExactDecimal(e.represented) ?? formatExactRational(e.represented)
    notes.push(`用户请求 ${e.requestedText}；raw 精确表示 ${representedText}`)
  }
  if (directFidelity) {
    // The binary64 delta may honestly be zero, but a display text that
    // cannot re-enter must never read as a clean exact result: flag it as a
    // warning and name the re-entry consequence.
    notes.push(directFoldQuantizationNote(directFidelity))
    return { deltaKind: 'warn', deltaText: presented.text, deltaNote: notes.join('；') }
  }
  return {
    deltaKind: presented.kind,
    deltaText: presented.text,
    ...(notes.length > 0 ? { deltaNote: notes.join('；') } : {}),
  }
}
