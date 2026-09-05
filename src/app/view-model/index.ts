import { useMemo } from 'react'
import { PMBusMath } from '../../legacy/pmbus-math'
import { getCommandConfig } from '../../legacy/command-metadata'
import { buildCMacro } from '../copy-utils'
import { getFormulaPresentation } from '../formula-presentation'
import { buildCalculationSteps } from '../calculation-steps'
import type { AppState } from '../state'
import type { CalculatorViewModel, VoutModeInfoVM } from './types'
import {
  buildBitGroups,
  byteDigits,
  formatByteHex,
  formatBytes,
  formatRawHex,
  toBytesBE,
  toBytesLE,
} from './format'
import { computeValueText } from './value-text'
import { buildWarnings } from './warnings'
import { resolveQuantizationPresentation } from './quantization'
import { resolveDirectFidelity } from './direct'
import { resolveHalfSpecial } from './half'
import { resolveL11NRangeText } from './l11'
import {
  buildL16PayloadVM,
  buildL16VoutModeInfo,
  resolveL16NRangeText,
  resolveL16PhysicalValueCopy,
} from './l16'
import { buildVoutModeVM } from './vout-mode'

export type {
  BitGroupVM,
  CalculatorViewModel,
  DirectFidelityVM,
  L16BlockVM,
  L16PayloadContextVM,
  VoutModeBitVM,
  VoutModeInfoVM,
  VoutModeNibbleVM,
  WarningVM,
} from './types'

function getValueLabel(mode: AppState['mode']): string {
  return mode === 'VOUT_MODE' ? 'VOUT_MODE 字节' : '物理值'
}

/**
 * Shared assembler: canonical raw word, common serialization/copy/formula
 * fields and mode dispatch. All mode-specific derivation (value text,
 * warnings, quantization presentation, payload/fidelity/special contracts)
 * lives in the per-mode projectors consumed here — this entry owns no
 * mode-scoped math or copy policy.
 */
export function toCalculatorViewModel(state: AppState): CalculatorViewModel {
  const raw = state.raw & 0xffff
  const le = toBytesLE(raw)
  const be = toBytesBE(raw)

  // v2.5.11: DIRECT precision fidelity is resolved once and consumed by the
  // quantization readout, the copy override and the VM field alike.
  const directFidelity = resolveDirectFidelity(state)
  // Displayed physical value — also the reference for whether the committed
  // request lexeme is already fully visible to the user.
  const valueText = computeValueText(state)
  const { deltaText, deltaKind, deltaNote } = resolveQuantizationPresentation(
    state,
    valueText,
    directFidelity,
  )

  const nRangeText =
    state.mode === 'L11'
      ? resolveL11NRangeText(state)
      : state.mode === 'L16'
        ? resolveL16NRangeText(state)
        : undefined

  const l16Payload = buildL16PayloadVM(state)

  let voutModeInfo: VoutModeInfoVM | undefined
  let voutModePage: VoutModeInfoVM | undefined
  if (state.mode === 'L16') {
    voutModeInfo = buildL16VoutModeInfo(state)
  } else if (state.mode === 'VOUT_MODE') {
    voutModePage = buildVoutModeVM(state.voutMode.byte)
    voutModeInfo = voutModePage
  }

  // v3.0.0: the main Raw Word hex is the canonical numeric raw word in every
  // mode — parse(format(raw)) === raw holds without any byte-order transform,
  // mirroring the raw/set-from-hex reducer exactly.
  const formula = getFormulaPresentation(state)
  const formulaText = formula.plainText

  const rawHex = state.mode === 'VOUT_MODE' ? formatByteHex(state.voutMode.byte) : formatRawHex(raw)
  const rawHexDigits =
    state.mode === 'VOUT_MODE'
      ? byteDigits(state.voutMode.byte)
      : (raw & 0xffff).toString(16).toUpperCase().padStart(4, '0')

  const halfSpecial = state.mode === 'HALF' ? resolveHalfSpecial(raw) : undefined

  // v2.5.9: a relative-derivation range error disables the 物理值 copy with
  // an accessible reason; every other state keeps the copy enabled.
  let physicalValueCopyUnavailability = resolveL16PhysicalValueCopy(state)

  // v2.5.11: a precision-folded DIRECT decode swaps the 物理值 copy payload
  // for the verified safe re-entry text; when no verified text exists the
  // copy degrades to disabled instead of handing out the approximation.
  let physicalValueCopyOverride: { text: string; note: string } | undefined
  if (directFidelity) {
    if (directFidelity.safeReentryText !== null) {
      physicalValueCopyOverride = {
        text: directFidelity.safeReentryText,
        note: `物理值复制返回经验证可安全回录的精确文本 ${directFidelity.safeReentryText}（回输后回到当前 raw）；显示值 ${directFidelity.approxValueText} 是精度折叠的近似。`,
      }
    } else {
      physicalValueCopyUnavailability = {
        available: false,
        reason: `物理值复制不可用：显示值 ${directFidelity.approxValueText} 是精度折叠的近似，且当前无法生成经验证的精确回录文本。请使用 Raw Word / Wire 字节复制，或直接编辑 raw / Y 保留位级真值。`,
      }
    }
  }

  return {
    mode: state.mode,
    steps: buildCalculationSteps(state),
    valueText,
    valueLabel: getValueLabel(state.mode),
    rawHex,
    rawHexDigits,
    rawWordHex: state.mode === 'VOUT_MODE' ? formatByteHex(state.voutMode.byte) : formatRawHex(raw),
    wireBytes: formatBytes(le, {
      prefix0x: state.copy.prefix0x,
      space: state.copy.spaceBetweenBytes,
    }),
    msbFirstBytes: formatBytes(be, {
      prefix0x: state.copy.prefix0x,
      space: state.copy.spaceBetweenBytes,
    }),
    cMacroText: buildCMacro(state.commandKey, formatRawHex(raw), formulaText),
    formulaText,
    formulaLatex: formula.latex,
    formulaGenericLatex: formula.genericLatex,
    formulaDetailLines: formula.detailLines,
    deltaText,
    deltaKind,
    deltaNote,
    warnings: buildWarnings(state),
    bitGroups: buildBitGroups(raw),
    directY: state.mode === 'DIRECT' ? PMBusMath.toSigned(raw, 16) : undefined,
    commandNote: getCommandConfig(state.commandKey)?.note,
    nRangeText,
    l16Payload,
    physicalValueCopy: physicalValueCopyUnavailability,
    physicalValueCopyOverride,
    directFidelity: directFidelity ?? undefined,
    voutModeInfo,
    voutModePage,
    halfSpecial,
    visible: {
      voutMode: state.mode === 'L16',
      directCoefficients: state.mode === 'DIRECT',
      halfNote: state.mode === 'HALF',
      nRange: state.mode === 'L11' || state.mode === 'L16',
      byteCalculator: state.mode === 'VOUT_MODE',
    },
  }
}

/** React hook wrapper for useMemo */
export function useCalculatorViewModel(state: AppState): CalculatorViewModel {
  return useMemo(() => toCalculatorViewModel(state), [state])
}
