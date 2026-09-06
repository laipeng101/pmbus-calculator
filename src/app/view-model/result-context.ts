import { PMBusMath } from '../../legacy/pmbus-math'
import { formatPlainNumber } from '../numeric-presentation'
import type { AppState } from '../state'
import type { CalculatorViewModel, ResultContextItemVM } from './types'

type ContextSource = Pick<
  CalculatorViewModel,
  'rawHex' | 'voutModeInfo' | 'l16Payload' | 'physicalValueCopy'
>

/** Compact provenance for the result, using the same projected interpretation. */
export function buildResultContext(state: AppState, source: ContextSource): ResultContextItemVM[] {
  const raw: ResultContextItemVM = { label: 'Raw Word', value: source.rawHex, code: true }
  switch (state.mode) {
    case 'L11': {
      const { n } = PMBusMath.decodeLinear11(state.raw)
      return [
        raw,
        { label: '格式', value: 'LINEAR11' },
        { label: '指数', value: `N = ${n}（${state.l11.autoN ? '自动' : '手动'}）` },
      ]
    }
    case 'L16': {
      const info = source.voutModeInfo!
      const payload = source.l16Payload!
      const items: ResultContextItemVM[] = [
        raw,
        {
          label: '数据解释',
          value: payload.nonLinear
            ? '未按 LINEAR16 解释'
            : payload.signedOffset
              ? 'SLINEAR16 offset'
              : 'ULINEAR16',
        },
        {
          label: 'VOUT_MODE',
          value: info.isLinear ? `${info.hex} · N = ${info.linearExponent}` : info.hex,
          code: true,
        },
      ]
      if (payload.blocked) {
        items.push({ label: '状态', value: payload.blocked.title })
      } else if (payload.requiresNominalReference) {
        items.push({
          label: '参考',
          value:
            state.l16.nominalVout === null
              ? '待填标称参考值'
              : `V_NOM = ${formatPlainNumber(state.l16.nominalVout)} V`,
        })
        if (source.physicalValueCopy && state.l16.nominalVout !== null) {
          items.push({ label: '状态', value: '派生电压暂无可用结果' })
        }
      } else if (payload.signedOffset && info.isRelative) {
        items.push({ label: '语义', value: '有符号偏移；bit7 不参与计算' })
      }
      return items
    }
    case 'DIRECT':
      return [
        raw,
        { label: '格式', value: 'DIRECT（有符号 Y）' },
        {
          label: '系数',
          value: `m = ${state.direct.m}, b = ${state.direct.b}, R = ${state.direct.r}`,
          code: true,
        },
        { label: '来源', value: '请核对器件数据手册' },
      ]
    case 'HALF':
      return [raw, { label: '格式', value: 'IEEE 754 binary16' }]
    case 'VOUT_MODE': {
      const info = source.voutModeInfo!
      // The existing configuration summary already identifies the byte and
      // format. Parameter bits are configuration data, never a fake equation.
      return [
        {
          label: '参数',
          value: info.isLinear
            ? `N = ${info.linearExponent}`
            : `bits[4:0] = ${info.binary.slice(3)}`,
          code: true,
        },
        { label: '状态', value: info.statusText },
      ]
    }
  }
}
