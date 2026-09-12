import { PMBusMath } from '../../legacy/pmbus-math'
import { formatPlainNumber } from '../numeric-presentation'
import type { AppState } from '../state'
import { classifyHalf } from '../half-class'
import { voutModeFormatTerm } from '../vout-mode-formats'
import type {
  CalculatorViewModel,
  ResultContextItemVM,
  ResultContextParamVM,
  ResultContextTextVM,
} from './types'

type ContextSource = Pick<
  CalculatorViewModel,
  'rawHex' | 'voutModeInfo' | 'l16Payload' | 'physicalValueCopy'
>

function text(
  key: ResultContextItemVM['key'],
  label: string,
  value: string,
  options: { code?: boolean; termId?: ResultContextTextVM['termId'] } = {},
): ResultContextItemVM {
  const base = { kind: 'text' as const, key, label, value }
  return {
    ...base,
    ...(options.code ? { code: true } : {}),
    ...(options.termId ? { termId: options.termId } : {}),
  }
}

function params(
  key: ResultContextItemVM['key'],
  label: string,
  pairs: ResultContextParamVM[],
): ResultContextItemVM {
  return { kind: 'params', key, label, params: pairs }
}

/**
 * Stable four-slot result context (UI_CONVENTIONS §16): raw identity, active
 * format, active parameters and context/source/direction. Every mode returns
 * exactly these four logical slots in this order so switching tabs never
 * reflows the semantic anchors. Values come from the same canonical
 * interpretation the rest of the view-model already projects — this module
 * formats, it never re-derives PMBus semantics.
 *
 * The `参数` slot is modelled as structured pairs (never one opaque string) so
 * each symbol can carry its own glossary term and its value can be spaced
 * independently.
 */
export function buildResultContext(state: AppState, source: ContextSource): ResultContextItemVM[] {
  switch (state.mode) {
    case 'L11': {
      const { n } = PMBusMath.decodeLinear11(state.raw)
      return [
        text('raw', 'Raw Word', source.rawHex, { code: true }),
        text('format', '格式', 'LINEAR11', { termId: 'linear11' }),
        params('parameters', '参数', [
          { label: 'N', value: String(n), termId: 'linear11-exponent' },
        ]),
        text('context', '上下文', state.l11.autoN ? '自动 N' : '手动 N'),
      ]
    }
    case 'L16': {
      const info = source.voutModeInfo!
      const payload = source.l16Payload!
      const format = payload.nonLinear
        ? '未按 LINEAR16 解释'
        : payload.signedOffset
          ? 'SLINEAR16 offset'
          : info.isRelative
            ? 'ULINEAR16 relative'
            : 'ULINEAR16'
      const formatTerm = payload.nonLinear
        ? voutModeFormatTerm(info.format)
        : payload.signedOffset
          ? ('slinear16' as const)
          : ('ulinear16' as const)
      const parameterPairs: ResultContextParamVM[] = [{ label: 'VOUT_MODE', value: info.hex }]
      if (info.isLinear && info.linearExponent !== null) {
        parameterPairs.push({ label: 'N', value: String(info.linearExponent), termId: 'exponent' })
      }

      const contextParts: string[] = []
      if (payload.blocked) {
        contextParts.push(payload.blocked.title)
      } else if (payload.requiresNominalReference) {
        contextParts.push(
          state.l16.nominalVout === null
            ? '待填标称参考值'
            : `V_NOM = ${formatPlainNumber(state.l16.nominalVout)} V`,
        )
        if (source.physicalValueCopy && state.l16.nominalVout !== null) {
          contextParts.push('派生电压暂无可用结果')
        }
      } else if (payload.signedOffset && info.isRelative) {
        contextParts.push('有符号偏移；bit7 不参与计算')
      } else {
        contextParts.push(info.isRelative ? '相对值' : '绝对值')
      }

      return [
        text('raw', 'Raw Word', source.rawHex, { code: true }),
        text('format', '数据解释', format, formatTerm ? { termId: formatTerm } : {}),
        params('parameters', '参数', parameterPairs),
        text('context', '上下文', contextParts.join(' · ')),
      ]
    }
    case 'DIRECT': {
      return [
        text('raw', 'Raw Word', source.rawHex, { code: true }),
        text('format', '格式', 'DIRECT（有符号 Y）', { termId: 'direct' }),
        params('parameters', '参数', [
          { label: 'm', value: String(state.direct.m), termId: 'direct-m' },
          { label: 'b', value: String(state.direct.b), termId: 'direct-b' },
          { label: 'R', value: String(state.direct.r), termId: 'direct-r' },
        ]),
        text('context', '来源', '器件相关', { termId: 'direct' }),
      ]
    }
    case 'HALF': {
      const facts = classifyHalf(state.raw)
      return [
        text('raw', 'Raw Word', source.rawHex, { code: true }),
        text('format', '格式', 'IEEE 754 binary16', { termId: 'binary16' }),
        params('parameters', '参数', [
          { label: 's', value: String(facts.sign), termId: 'half-s' },
          { label: 'E', value: String(facts.exponent), termId: 'half-e' },
          { label: 'F', value: String(facts.fraction), termId: 'half-f' },
        ]),
        text('context', '类别', facts.label),
      ]
    }
    case 'VOUT_MODE': {
      const info = source.voutModeInfo!
      const parameterPairs: ResultContextParamVM[] = info.isLinear
        ? [{ label: 'N', value: String(info.linearExponent), termId: 'exponent' }]
        : [{ label: 'bits[4:0]', value: info.binary.slice(3) }]
      return [
        text('raw', 'Raw Byte', info.hex, { code: true }),
        text('format', '格式', info.formatName, {
          termId: voutModeFormatTerm(info.format),
        }),
        params('parameters', '参数', parameterPairs),
        text('context', '状态', info.statusText),
      ]
    }
  }
}
