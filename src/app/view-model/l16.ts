import { PMBusMath } from '../../legacy/pmbus-math'
import { deriveL16Semantics } from '../l16-derivation'
import type { L16FormatSemantics } from '../l16-payload-contract'
import {
  RELATIVE_VOLTAGE_OVERFLOW_NOTE,
  RELATIVE_VOLTAGE_UNDERFLOW_NOTE,
} from '../relative-voltage'
import type { AppState } from '../state'
import type { L16BlockVM, L16PayloadContextVM, VoutModeInfoVM, WarningVM } from './types'
import { formatByteHex } from './format'
import { formatPlainNumber } from '../numeric-presentation'
import { buildVoutModeVM } from './vout-mode'
import { SLINEAR16_OFFSET_BIT7_NOTE } from '../vout-mode-explanation'

const VID_OFFSET_RESTRICTION =
  'VID 格式下不能使用 VOUT_TRIM / VOUT_CAL_OFFSET（Part II §13.3 / §13.4）。'

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
    case 'vid-profile-required':
      return {
        status: semantics.status,
        title: `VOUT_MODE ${byteHex} 为 VID 格式（${semantics.vidCodeLabel}）`,
        detail:
          semantics.vidCodeKind === 'profile-required'
            ? '请查器件资料中的 VID 码表，用原始数据字查找对应电压（Part II §8.4.2）。'
            : '此 VID 代码类型没有可用的电压映射。请核对器件的 VOUT_MODE 字节（Part II §8.4.2）。',
      }
    case 'vid-offset-prohibited':
      return {
        status: semantics.status,
        title: `VOUT_MODE ${byteHex} 为 VID 格式，无法换算电压偏移`,
        detail: `${VID_OFFSET_RESTRICTION} 若器件使用 LINEAR 格式，请输入该器件的 VOUT_MODE 字节。`,
      }
    case 'vid-relative-invalid':
      return {
        status: semantics.status,
        title: `VOUT_MODE ${byteHex} 的相对值和 VID 组合无效`,
        detail: 'VID 只支持绝对值（Part II §8.5.3）。请核对器件的 VOUT_MODE 字节。',
      }
    case 'direct-profile-required':
      return {
        status: semantics.status,
        title: `VOUT_MODE ${byteHex} 为 DIRECT 格式`,
        detail:
          '请从 COEFFICIENTS 或器件手册取得 m、b、R 系数，并核对命令的数据格式（Part II §7.4、§8.4.3）。16 位有符号数可在 DIRECT 页换算。',
      }
    case 'half-unsupported-in-l16':
      return {
        status: semantics.status,
        title: `VOUT_MODE ${byteHex} 为 ${formatName} 格式`,
        detail: '请切换到 HALF 页，按 IEEE 754 binary16 换算原始数据字（Part II §8.4.4）。',
      }
    case 'reserved-or-invalid':
      return {
        status: semantics.status,
        title: `VOUT_MODE ${byteHex} 的参数无效`,
        detail: `${formatName} 格式的参数位必须为 00000b（PMBus Part II §8.3 表 2）。请检查器件的 VOUT_MODE 字节。`,
      }
  }
}

/** Result-card value text: rendered from the canonical interpretation facts. */
export function resolveL16ValueText(state: AppState): string {
  const { interpretation } = deriveL16Semantics(state)
  switch (interpretation.kind) {
    case 'non-linear':
      // Fail closed on a non-LINEAR shared byte (v2.5.2, §8.4): no value is
      // derived from an implicit 0x18 substitution.
      return '—'
    case 'signed-offset':
      return formatPlainNumber(interpretation.value)
    case 'relative-ratio':
      // Overflow / nonzero-factor underflow show '—' instead of a fabricated
      // Infinity / 0 result (v2.5.9); a missing nominal shows only '—' too.
      return interpretation.finalVoltage.kind === 'finite'
        ? formatPlainNumber(interpretation.finalVoltage.value)
        : '—'
    case 'absolute-unsigned':
      return formatPlainNumber(interpretation.value)
  }
}

/** Representable payload range line; absent for relative and non-LINEAR bytes. */
export function resolveL16NRangeText(state: AppState): string | undefined {
  if (state.mode !== 'L16') return undefined
  // Payload semantics first: the signed offset range applies to ANY
  // LINEAR byte (bit7 not part of its math); absolute ULINEAR16 keeps the
  // unsigned range; relative ULINEAR16 is a ratio with no voltage range.
  const { interpretation } = deriveL16Semantics(state)
  switch (interpretation.kind) {
    case 'signed-offset': {
      const p = PMBusMath.pow2(interpretation.n)
      return `${formatPlainNumber(-32768 * p)} ~ ${formatPlainNumber(32767 * p)}`
    }
    case 'absolute-unsigned': {
      const p = PMBusMath.pow2(interpretation.n)
      return '0 ~ ' + formatPlainNumber(65535 * p)
    }
    default:
      return undefined
  }
}

/** Single semantic resolution of byte × payload (v2.5.3) into the VM contract. */
export function buildL16PayloadVM(state: AppState): L16PayloadContextVM | undefined {
  if (state.mode !== 'L16') return undefined
  // The canonical facts already carry the byte × payload discriminated
  // contract — input availability, blocked copy and profile questions come
  // from that one resolution, never re-derived here.
  const { analysis, payloadContext } = deriveL16Semantics(state)
  const nonLinear = payloadContext.source === 'non-linear'
  return {
    kind: state.l16.payloadKind,
    signedOffset: payloadContext.signedOffset,
    relativeRatio: payloadContext.relativeRatio,
    nonLinear,
    ...(nonLinear ? { nonLinearFormat: analysis.formatName } : {}),
    ...(payloadContext.semantics.status !== 'linear-supported'
      ? {
          blocked: buildL16BlockVM(
            payloadContext.semantics,
            formatByteHex(payloadContext.byte),
            analysis.formatName,
          ),
        }
      : {}),
    physicalInputAvailable: payloadContext.physicalInputAvailable,
    requiresNominalReference: payloadContext.requiresNominalReference,
  }
}

/** Linked-byte VOUT_MODE info for the L16 page, with payload nuance notes. */
export function buildL16VoutModeInfo(state: AppState): VoutModeInfoVM {
  const { analysis, source } = deriveL16Semantics(state)
  const vm = buildVoutModeVM(analysis.byte, source)
  if (state.l16.payloadKind === 'slinear16-offset') {
    vm.explanations.unshift({
      id: 'slinear16-bit7-na',
      severity: 'info',
      title: '第 7 位不影响电压偏移',
      detail: SLINEAR16_OFFSET_BIT7_NOTE,
      specRef: 'Part II §13.3 / §13.4 / §8.5',
    })
  }
  return vm
}

/** §8.4 fail-closed + VID offset-prohibition warnings for the L16 page. */
export function resolveL16NonlinearWarnings(state: AppState): WarningVM[] {
  if (state.mode !== 'L16') return []
  const { source, analysis, payloadContext } = deriveL16Semantics(state)
  if (source !== 'non-linear') return []
  const warnings: WarningVM[] = [
    {
      id: 'l16-vout-mode-nonlinear',
      level: 'warning',
      text: `VOUT_MODE ${formatByteHex(state.voutMode.byte)} 使用 ${analysis.formatName} 格式，无法按 LINEAR16 换算。`,
    },
  ]
  // The offset-command prohibition is a spec-level error (§13.3/§13.4:
  // devices must reject VOUT_TRIM / VOUT_CAL_OFFSET under VID), so it is
  // announced at error level — distinct from the profile questions above.
  if (payloadContext.semantics.status === 'vid-offset-prohibited') {
    warnings.push({
      id: 'vout-mode-vid-offset-prohibited',
      level: 'error',
      text: VID_OFFSET_RESTRICTION,
    })
  }
  return warnings
}

/** Relative ULINEAR16 derivation diagnostics (v2.5.9 overflow/underflow, v2.6.4 R=0). */
export function resolveL16RelativeDiagnostics(state: AppState): WarningVM[] {
  if (state.mode !== 'L16') return []
  const { interpretation } = deriveL16Semantics(state)
  if (interpretation.kind !== 'relative-ratio') return []
  const { finalVoltage, ratio } = interpretation
  if (finalVoltage.kind === 'overflow' || finalVoltage.kind === 'underflow') {
    const note =
      finalVoltage.kind === 'overflow'
        ? RELATIVE_VOLTAGE_OVERFLOW_NOTE
        : RELATIVE_VOLTAGE_UNDERFLOW_NOTE
    return [
      {
        id: `l16-relative-${finalVoltage.kind}`,
        level: 'warning',
        text: `${note}。仍可查看标称值和比值，也可以复制原始数据字或传输字节。`,
      },
    ]
  }
  if (ratio === 0) {
    return [
      {
        id: 'l16-relative-zero-ratio',
        level: 'warning',
        text: '原始数据字解出的比值 R = 0。PMBus 要求相对值大于 0（Part II §8.5.2）。请核对原始数据字。',
      },
    ]
  }
  return []
}

/**
 * Physical-value copy follows the same canonical interpretation as the
 * result card: a missing result is not a copyable numeric value.
 */
export function resolveL16PhysicalValueCopy(
  state: AppState,
): { available: false; reason: string } | undefined {
  if (state.mode !== 'L16') return undefined
  const { interpretation, payloadContext, analysis } = deriveL16Semantics(state)
  if (interpretation.kind === 'non-linear') {
    const blocked = buildL16BlockVM(
      payloadContext.semantics,
      formatByteHex(state.voutMode.byte),
      analysis.formatName,
    )
    return {
      available: false,
      reason: `物理值复制不可用：${blocked.title}；当前页面没有物理值结果。Raw Word / Wire 字节复制仍可用。`,
    }
  }
  if (interpretation.kind !== 'relative-ratio') return undefined
  if (interpretation.finalVoltage.kind === 'missing-reference') {
    return {
      available: false,
      reason:
        '物理值复制不可用：尚未提供 VOUT_COMMAND 标称参考值，无法计算最终电压。Raw Word / Wire 字节复制仍可用。',
    }
  }
  if (interpretation.finalVoltage.kind === 'overflow') {
    return {
      available: false,
      reason: `物理值复制不可用：${RELATIVE_VOLTAGE_OVERFLOW_NOTE}。Raw Word / Wire 字节复制仍可用。`,
    }
  }
  if (interpretation.finalVoltage.kind === 'underflow') {
    return {
      available: false,
      reason: `物理值复制不可用：${RELATIVE_VOLTAGE_UNDERFLOW_NOTE}。Raw Word / Wire 字节复制仍可用。`,
    }
  }
  return undefined
}
