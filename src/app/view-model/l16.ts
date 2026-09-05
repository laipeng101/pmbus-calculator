import { PMBusMath } from '../../legacy/pmbus-math'
import { analyzeVoutMode } from '../../legacy/vout-mode'
import { effectiveL16VoutMode } from '../vout-mode-selector'
import { resolveL16PayloadContext } from '../l16-payload-contract'
import type { L16FormatSemantics } from '../l16-payload-contract'
import {
  resolveRelativeVoltage,
  RELATIVE_VOLTAGE_OVERFLOW_NOTE,
  RELATIVE_VOLTAGE_UNDERFLOW_NOTE,
} from '../relative-voltage'
import type { RelativeVoltageResult } from '../relative-voltage'
import type { AppState } from '../state'
import type { L16BlockVM, L16PayloadContextVM, VoutModeInfoVM, WarningVM } from './types'
import { formatByteHex } from './format'
import { formatPlainNumber } from '../numeric-presentation'
import { buildVoutModeVM } from './vout-mode'

/**
 * Spec-accurate reason text per payload-contract status (v2.5.3). VID is
 * never described as a globally prohibited format: §8.4.2 supports it, only
 * VOUT_TRIM / VOUT_CAL_OFFSET are prohibited under VID (§13.3/§13.4) and a
 * relative byte × VID is invalid outright (§8.5.3).
 */
function buildL16BlockVM(
  semantics: L16FormatSemantics,
  byteHex: string,
  formatName: string,
): L16BlockVM {
  switch (semantics.status) {
    case 'linear-supported':
      throw new Error('linear-supported states have no blocked card')
    case 'vid-profile-required': {
      const detailLines = [
        'VID 是规范支持的输出电压数据格式（Part II §8.4.2），不是被禁止的数据格式。当前页面未选定任何 VID 表或产品 profile，无法在 VID 码与物理电压之间换算，也不允许借用 LINEAR16 指数 N 计算。',
      ]
      if (semantics.vidCodeKind === 'profile-required') {
        detailLines.push(
          `${byteHex} 的 VID code 为制造商自定义；码表与电压映射必须来自器件资料，本页不提供。`,
        )
      }
      return {
        status: semantics.status,
        title: `VOUT_MODE ${byteHex} 为 VID 格式（${semantics.vidCodeLabel}）`,
        detailLines,
      }
    }
    case 'vid-offset-prohibited':
      return {
        status: semantics.status,
        title: `VOUT_MODE ${byteHex} 为 VID 格式：二补码偏移命令被禁止`,
        detailLines: [
          '当前解释类型 SLINEAR16（二补码偏移）对应 VOUT_TRIM / VOUT_CAL_OFFSET 的命令语义；这两类命令在 VID 输出电压格式下被规范明确禁止（Part II §13.3 / §13.4），器件必须拒绝。该命令组合被禁止，本页不生成 word。',
          '禁止范围仅限这两条二补码偏移命令：VID 本身对其他输出电压相关命令（如 VOUT_COMMAND）是合法数据格式（Part II §8.4.2）。',
        ],
      }
    case 'vid-relative-invalid':
      return {
        status: semantics.status,
        title: `VOUT_MODE ${byteHex} 为相对 + VID 非法组合`,
        detailLines: [
          '相对数据格式不适用于 VID（Part II §8.5.3），该 VOUT_MODE 字节组合本身无效。本页不生成 word，也不显示相对比值结果。',
        ],
      }
    case 'direct-profile-required':
      return {
        status: semantics.status,
        title: `VOUT_MODE ${byteHex} 为 DIRECT 格式`,
        detailLines: [
          'DIRECT 需要 m / b / R 系数（来自 COEFFICIENTS 或器件资料）才能建立 word 与物理量的映射（Part II §7.4 / §8.4.3）。LINEAR16 页未实现 DIRECT 输出电压解释：不猜测系数，也不借用 LINEAR16 指数 N。本页不生成 word。',
        ],
      }
    case 'half-unsupported-in-l16':
      return {
        status: semantics.status,
        title: `VOUT_MODE ${byteHex} 为 ${formatName} 格式`,
        detailLines: [
          'IEEE Half 是合法的输出电压数据格式（Part II §8.4.4），但本页只实现 LINEAR16 解释：不做 Half 解码/编码，也不借用 LINEAR16 指数 N（HALF 模式页可做该格式的数学换算）。本页不生成 word。',
        ],
      }
    case 'reserved-or-invalid':
      return {
        status: semantics.status,
        title: `VOUT_MODE ${byteHex} 无有效解释合同`,
        detailLines: [
          `按 Part II §8.3 Table 2，${formatName} 模式的参数位必须为 00000b；当前字节为保留/非法配置（原因：${semantics.reason}），无任何输出电压解释合同。本页不生成 word。`,
        ],
      }
  }
}

/**
 * Shared relative-ULINEAR16 resolution (v2.5.9, extended v2.6.4): null for
 * every state that is not "relative ULINEAR16 with a LINEAR shared byte".
 * The result card, warnings and the physical-value copy answer the
 * overflow/underflow question from `result`, and the §8.5.2 relative-value
 * compliance question from the same single decoded `ratio` (the spec requires
 * the relative value to be positive, so a committed R=0 is non-compliant
 * data — the math itself stays an exact zero).
 */
export function resolveL16Relative(
  state: AppState,
): { result: RelativeVoltageResult; ratio: number } | null {
  if (state.mode !== 'L16') return null
  const eff = effectiveL16VoutMode(state)
  if (eff.source === 'non-linear') return null
  const a = analyzeVoutMode(eff.byte)
  if (a.format !== 0 || !a.isRelative) return null
  if (state.l16.payloadKind !== 'ulinear16') return null
  const ratio = PMBusMath.decodeUlinear16(state.raw, a.linearExponent ?? 0).value
  return { result: resolveRelativeVoltage(state.l16.nominalVout, ratio), ratio }
}

export function resolveL16ValueText(state: AppState): string {
  const eff = effectiveL16VoutMode(state)
  // Fail closed on a non-LINEAR shared byte (v2.5.2, §8.4): no value is
  // derived from an implicit 0x18 substitution.
  if (eff.source === 'non-linear') return '—'
  const a = analyzeVoutMode(eff.byte)
  const n = a.linearExponent ?? 0
  if (state.l16.payloadKind === 'slinear16-offset') {
    return formatPlainNumber(PMBusMath.decodeSlinear16(state.raw, n).value)
  }
  if (a.isRelative) {
    // v2.5.9: the derivation is classified — overflow / nonzero-factor
    // underflow show '—' instead of a fabricated Infinity / 0 result.
    const result = resolveRelativeVoltage(
      state.l16.nominalVout,
      PMBusMath.decodeUlinear16(state.raw, n).value,
    )
    if (result.kind !== 'finite') return '—'
    return formatPlainNumber(result.value)
  }
  return formatPlainNumber(PMBusMath.decodeUlinear16(state.raw, n).value)
}

/** Representable payload range line; absent for relative and non-LINEAR bytes. */
export function resolveL16NRangeText(state: AppState): string | undefined {
  if (state.mode !== 'L16') return undefined
  // Payload semantics first: the signed offset range applies to ANY
  // LINEAR byte (bit7 not part of its math); absolute ULINEAR16 keeps the
  // unsigned range; relative ULINEAR16 is a ratio with no voltage range.
  const eff = effectiveL16VoutMode(state)
  const a = analyzeVoutMode(eff.byte)
  if (a.format === 0 && state.l16.payloadKind === 'slinear16-offset') {
    const p = PMBusMath.pow2(a.linearExponent ?? 0)
    return `${formatPlainNumber(-32768 * p)} ~ ${formatPlainNumber(32767 * p)}`
  }
  if (a.format === 0 && a.isRelative === false) {
    const p = PMBusMath.pow2(a.linearExponent ?? 0)
    return '0 ~ ' + formatPlainNumber(65535 * p)
  }
  return undefined
}

/** Single semantic resolution of byte × payload (v2.5.3) into the VM contract. */
export function buildL16PayloadVM(state: AppState): L16PayloadContextVM | undefined {
  if (state.mode !== 'L16') return undefined
  // The shared byte is analyzed as-is — never a substituted 0x18 (v2.5.2) —
  // and the discriminated contract decides input availability, blocked copy
  // and profile questions for every non-LINEAR format.
  const ctx = resolveL16PayloadContext(state.voutMode.byte, state.l16.payloadKind)
  const nonLinear = ctx.source === 'non-linear'
  const a = analyzeVoutMode(ctx.byte)
  return {
    kind: state.l16.payloadKind,
    signedOffset: ctx.signedOffset,
    relativeRatio: ctx.relativeRatio,
    nonLinear,
    ...(nonLinear ? { nonLinearFormat: a.formatName } : {}),
    ...(ctx.semantics.status !== 'linear-supported'
      ? { blocked: buildL16BlockVM(ctx.semantics, formatByteHex(ctx.byte), a.formatName) }
      : {}),
    physicalInputAvailable: ctx.physicalInputAvailable,
    requiresNominalReference: ctx.requiresNominalReference,
  }
}

/** Linked-byte VOUT_MODE info for the L16 page, with payload nuance notes. */
export function buildL16VoutModeInfo(state: AppState): VoutModeInfoVM {
  const eff = effectiveL16VoutMode(state)
  const vm = buildVoutModeVM(eff.byte, eff.source)
  if (state.l16.payloadKind === 'slinear16-offset') {
    vm.explanations.unshift({
      id: 'slinear16-bit7-na',
      severity: 'info',
      title: 'bit7 对本 payload 不适用',
      detail:
        'SLINEAR16 offset 使用 16 位二补码 payload，bit7 只作用于 §8.5 的 8 个输出电压相关命令，不参与 X_offset = Y_s × 2^N；选择 offset 语义不会把公式切成“有符号比例”。',
      specRef: 'Part II §13.3 / §13.4 / §8.5',
    })
  }
  return vm
}

/** §8.4 fail-closed + VID offset-prohibition warnings for the L16 page. */
export function resolveL16NonlinearWarnings(state: AppState): WarningVM[] {
  if (state.mode !== 'L16') return []
  const eff = effectiveL16VoutMode(state)
  if (eff.source !== 'non-linear') return []
  const a = analyzeVoutMode(eff.byte)
  const warnings: WarningVM[] = [
    {
      id: 'l16-vout-mode-nonlinear',
      level: 'warning',
      text: `当前共享 VOUT_MODE ${formatByteHex(state.voutMode.byte)} 为 ${a.formatName}；输出电压相关命令的数据格式由当前 VOUT_MODE 决定（Part II §8.4），LINEAR16 页不隐式替换字节。显式应用计算器 LINEAR 示例 0x18（absolute、N=-8）后才恢复计算。0x18 是本计算器的示例值，不是 PMBus 规范默认值，也不代表真实器件一定接受 VOUT_MODE 写入。`,
    },
  ]
  // The offset-command prohibition is a spec-level error (§13.3/§13.4:
  // devices must reject VOUT_TRIM / VOUT_CAL_OFFSET under VID), so it is
  // announced at error level — distinct from the profile questions above.
  if (
    resolveL16PayloadContext(state.voutMode.byte, state.l16.payloadKind).semantics.status ===
    'vid-offset-prohibited'
  ) {
    warnings.push({
      id: 'vout-mode-vid-offset-prohibited',
      level: 'error',
      text: `SLINEAR16 偏移 payload 对应 VOUT_TRIM / VOUT_CAL_OFFSET，这两类命令在 VID 输出电压格式下被规范禁止（Part II §13.3 / §13.4）；本页不生成 word。`,
    })
  }
  return warnings
}

/** Relative ULINEAR16 derivation diagnostics (v2.5.9 overflow/underflow, v2.6.4 R=0). */
export function resolveL16RelativeDiagnostics(state: AppState): WarningVM[] {
  const relative = resolveL16Relative(state)
  if (!relative) return []
  if (relative.result.kind === 'overflow') {
    return [
      {
        id: 'l16-relative-overflow',
        level: 'warning',
        text: `${RELATIVE_VOLTAGE_OVERFLOW_NOTE}；最终电压显示为 —，标称值与比值仍按输入显示，Raw Word / Wire 字节复制不受影响。`,
      },
    ]
  }
  if (relative.result.kind === 'underflow') {
    return [
      {
        id: 'l16-relative-underflow',
        level: 'warning',
        text: `${RELATIVE_VOLTAGE_UNDERFLOW_NOTE}；最终电压显示为 —，标称值与比值仍按输入显示，Raw Word / Wire 字节复制不受影响。`,
      },
    ]
  }
  if (relative.ratio === 0) {
    return [
      {
        id: 'l16-relative-zero-ratio',
        level: 'warning',
        text: `当前 relative ULINEAR16 解码比值 R = 0（raw ${formatByteHex(state.raw)}，Y_u = 0）；Part II §8.5.2 要求相对值恒为正，该提交标记为非符合性。R = 0 是数学精确结果，不是派生下溢或饱和。`,
      },
    ]
  }
  return []
}

/**
 * v2.5.9: a relative-derivation range error disables the 物理值 copy with
 * an accessible reason; every other state keeps the copy enabled.
 */
export function resolveL16PhysicalValueCopy(
  state: AppState,
): { available: false; reason: string } | undefined {
  if (state.mode !== 'L16') return undefined
  const relative = resolveL16Relative(state)
  if (relative?.result.kind === 'overflow') {
    return {
      available: false,
      reason: `物理值复制不可用：${RELATIVE_VOLTAGE_OVERFLOW_NOTE}。Raw Word / Wire 字节复制仍可用。`,
    }
  }
  if (relative?.result.kind === 'underflow') {
    return {
      available: false,
      reason: `物理值复制不可用：${RELATIVE_VOLTAGE_UNDERFLOW_NOTE}。Raw Word / Wire 字节复制仍可用。`,
    }
  }
  return undefined
}
