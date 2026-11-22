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
import { resolveDirectFidelity, resolveDirectPhysicalValueCopy } from './direct'
import { resolveHalfSpecial } from './half'
import { resolveL11NRangeText } from './l11'
import {
  buildL16PayloadVM,
  buildL16VoutModeInfo,
  resolveL16NRangeText,
  resolveL16PhysicalValueCopy,
} from './l16'
import { buildVoutModeVM } from './vout-mode'
import { buildResultContext } from './result-context'
import { buildResultWorkspace } from '../result-workspace'

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

  const directFidelity = resolveDirectFidelity(state)
  // Displayed physical value — also the reference for whether the committed
  // request lexeme is already fully visible to the user.
  const valueText = directFidelity?.approxValueText ?? computeValueText(state)
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
  const formula = getFormulaPresentation(state, valueText)
  const formulaText = formula.plainText

  const rawHex = state.mode === 'VOUT_MODE' ? formatByteHex(state.voutMode.byte) : formatRawHex(raw)
  const rawHexDigits =
    state.mode === 'VOUT_MODE'
      ? byteDigits(state.voutMode.byte)
      : (raw & 0xffff).toString(16).toUpperCase().padStart(4, '0')

  const halfSpecial = state.mode === 'HALF' ? resolveHalfSpecial(raw) : undefined

  const directCopy = resolveDirectPhysicalValueCopy(state, directFidelity)
  const physicalValueCopy = resolveL16PhysicalValueCopy(state) ?? directCopy.physicalValueCopy

  return {
    mode: state.mode,
    steps: buildCalculationSteps(state),
    valueText,
    valueLabel: getValueLabel(state.mode),
    resultContext: buildResultContext(state, {
      rawHex,
      voutModeInfo,
      l16Payload,
      physicalValueCopy,
    }),
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
    formulaSymbolicLatex: formula.symbolicLatex,
    workspace: buildResultWorkspace(state, {
      formula,
      valueText,
      voutModeInfo,
      voutModePage,
    }),
    deltaText,
    deltaKind,
    deltaNote,
    warnings: buildWarnings(state, directFidelity),
    bitGroups: buildBitGroups(raw),
    directY: state.mode === 'DIRECT' ? PMBusMath.toSigned(raw, 16) : undefined,
    commandNote: getCommandConfig(state.commandKey)?.note,
    nRangeText,
    l16Payload,
    physicalValueCopy,
    physicalValueCopyOverride: directCopy.physicalValueCopyOverride,
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
