import { PMBusMath } from '../../legacy/pmbus-math'
import { formatPlainNumber } from '../numeric-presentation'
import type { AppState } from '../state'
import { classifyHalf } from '../half-class'
import type { CalculatorViewModel, ResultContextItemVM } from './types'

type ContextSource = Pick<
  CalculatorViewModel,
  'rawHex' | 'voutModeInfo' | 'l16Payload' | 'physicalValueCopy'
>

/**
 * Stable four-slot result context (UI_CONVENTIONS §16): raw identity, active
 * format, active parameters and context/source/direction. Every mode returns
 * exactly these four logical slots in this order so switching tabs never
 * reflows the semantic anchors. Values come from the same canonical
 * interpretation the rest of the view-model already projects — this module
 * formats, it never re-derives PMBus semantics.
 */
export function buildResultContext(state: AppState, source: ContextSource): ResultContextItemVM[] {
  switch (state.mode) {
    case 'L11': {
      const { n } = PMBusMath.decodeLinear11(state.raw)
      return [
        { key: 'raw', label: 'Raw Word', value: source.rawHex, code: true },
        { key: 'format', label: '格式', value: 'LINEAR11' },
        { key: 'parameters', label: '参数', value: `N = ${n}`, code: true },
        { key: 'context', label: '上下文', value: state.l11.autoN ? '自动 N' : '手动 N' },
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
      const parameters = info.isLinear ? `${info.hex} · N = ${info.linearExponent}` : info.hex

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
        { key: 'raw', label: 'Raw Word', value: source.rawHex, code: true },
        { key: 'format', label: '数据解释', value: format },
        { key: 'parameters', label: '参数', value: parameters, code: true },
        { key: 'context', label: '上下文', value: contextParts.join(' · ') },
      ]
    }
    case 'DIRECT': {
      return [
        { key: 'raw', label: 'Raw Word', value: source.rawHex, code: true },
        { key: 'format', label: '格式', value: 'DIRECT（有符号 Y）' },
        {
          key: 'parameters',
          label: '参数',
          value: `m = ${state.direct.m}, b = ${state.direct.b}, R = ${state.direct.r}`,
          code: true,
        },
        { key: 'context', label: '来源', value: '器件相关', termId: 'direct' },
      ]
    }
    case 'HALF': {
      const facts = classifyHalf(state.raw)
      return [
        { key: 'raw', label: 'Raw Word', value: source.rawHex, code: true },
        { key: 'format', label: '格式', value: 'IEEE 754 binary16' },
        {
          key: 'parameters',
          label: '参数',
          value: `s = ${facts.sign}, E = ${facts.exponent}, F = ${facts.fraction}`,
          code: true,
        },
        { key: 'context', label: '类别', value: facts.label },
      ]
    }
    case 'VOUT_MODE': {
      const info = source.voutModeInfo!
      return [
        { key: 'raw', label: 'Raw Byte', value: info.hex, code: true },
        { key: 'format', label: '格式', value: info.formatName },
        {
          key: 'parameters',
          label: '参数',
          value: info.isLinear
            ? `N = ${info.linearExponent}`
            : `bits[4:0] = ${info.binary.slice(3)}`,
          code: true,
        },
        { key: 'context', label: '状态', value: info.statusText },
      ]
    }
  }
}
