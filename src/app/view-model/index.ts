import { useMemo } from 'react'
import { PMBusMath } from '../../legacy/pmbus-math'
import { getFormulaPresentation } from '../formula-presentation'
import { buildCalculationSteps } from '../calculation-steps'
import type { AppState } from '../state'
import type { CalculatorViewModel, VoutModeInfoVM } from './types'
import {
  buildBitGroups,
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

  const formula = getFormulaPresentation(state, valueText)
  const formulaText = formula.plainText

  const rawWordHex = formatRawHex(raw)
  const rawHex = state.mode === 'VOUT_MODE' ? formatByteHex(state.voutMode.byte) : rawWordHex

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
    rawHexDigits: rawHex.slice(2),
    wireBytes: formatBytes(le, {
      prefix0x: state.copy.prefix0x,
      space: state.copy.spaceBetweenBytes,
    }),
    msbFirstBytes: formatBytes(be, {
      prefix0x: state.copy.prefix0x,
      space: state.copy.spaceBetweenBytes,
    }),
    cMacroText: `#define RAW_VALUE ${rawWordHex} /* ${formulaText} */`,
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
    nRangeText,
    l16Payload,
    physicalValueCopy,
    physicalValueCopyOverride: directCopy.physicalValueCopyOverride,
    directFidelity: directFidelity ?? undefined,
    voutModeInfo,
    voutModePage,
    halfSpecial,
  }
}

/** React hook wrapper for useMemo */
export function useCalculatorViewModel(state: AppState): CalculatorViewModel {
  return useMemo(() => toCalculatorViewModel(state), [state])
}
