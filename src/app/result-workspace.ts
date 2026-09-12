/**
 * Unified result workspace — one structural skeleton for all five modes.
 *
 * The result card is "one engineering instrument with five gears": a headline
 * value on the left and three reserved semantic rows on the right. Numeric
 * modes (L11 / L16 / DIRECT / HALF) fill the rows with canonical fields, the
 * generic relation and the current substitution, all typeset by KaTeX.
 * VOUT_MODE keeps the same three-row spatial rhythm but renders a bit-field
 * configuration parser walkthrough (UI/data font roles, never KaTeX).
 *
 * This module owns presentation facts only: it consumes the canonical
 * derivations (deriveL16Semantics, PMBusMath, classifyHalf, the VOUT_MODE
 * view-model) and formats their results. Components render the rows and never
 * recompute PMBus semantics in JSX.
 */
import { PMBusMath } from '../legacy/pmbus-math'
import type { AppState } from './state'
import type { FormulaPresentation } from './formula-presentation'
import { deriveL16Semantics } from './l16-derivation'
import { classifyHalf } from './half-class'
import { formatPlainNumber } from './numeric-presentation'
import { formatByteHex } from './view-model/format'
import { voutModeFormatTerm } from './vout-mode-formats'
import type {
  ResultDirectionVM,
  ResultFieldVM,
  ResultRowVM,
  ResultSegmentVM,
  ResultWorkspaceVM,
  VoutModeInfoVM,
} from './view-model/types'

export interface ResultWorkspaceSource {
  formula: FormulaPresentation
  valueText: string
  voutModeInfo?: VoutModeInfoVM
  voutModePage?: VoutModeInfoVM
}

function field(label: string, value: number | string, code = true): ResultFieldVM {
  return code ? { label, value: String(value), code: true } : { label, value: String(value) }
}

function fieldsRow(fields: ResultFieldVM[]): ResultRowVM {
  return { key: 'fields', label: '字段', presentation: 'fields', fields }
}

/** Row 2: generic relation straight from the single formula-presentation source. */
function genericRow(formula: FormulaPresentation): ResultRowVM {
  return {
    key: 'generic',
    label: '通用公式',
    presentation: 'math',
    latex: formula.genericLatex,
    plainText: formula.genericPlainText,
  }
}

/**
 * Row 3: the current numeric substitution. The latest canonical expansion
 * line is used; the top-level formula is the fallback for fail-closed states
 * that intentionally carry no expansion (e.g. non-LINEAR L16).
 */
function substitutionRow(formula: FormulaPresentation): ResultRowVM {
  const expansion = [...formula.detailLines].reverse().find((line) => line.kind === 'expansion')
  return {
    key: 'substitution',
    label: '数值代入',
    presentation: 'math',
    latex: expansion?.latex ?? formula.latex,
    plainText: expansion?.plainText ?? formula.plainText,
  }
}

function mathRows(fields: ResultFieldVM[], formula: FormulaPresentation): ResultRowVM[] {
  return [fieldsRow(fields), genericRow(formula), substitutionRow(formula)]
}

function l11Rows(state: AppState, formula: FormulaPresentation): ResultRowVM[] {
  const { n, y } = PMBusMath.decodeLinear11(state.raw)
  return mathRows([field('N', n), field('Y', y)], formula)
}

function l16Rows(state: AppState, formula: FormulaPresentation): ResultRowVM[] {
  const { analysis, interpretation } = deriveL16Semantics(state)
  const raw = state.raw & 0xffff
  const byteField = field('VOUT_MODE', formatByteHex(analysis.byte))
  switch (interpretation.kind) {
    case 'non-linear':
      // Fail closed: expose the actual shared byte and format, never a pseudo N.
      return mathRows([byteField, { label: '格式', value: analysis.formatName }], formula)
    case 'signed-offset':
      return mathRows(
        [field('Y_s', interpretation.y), field('N', interpretation.n), byteField],
        formula,
      )
    case 'relative-ratio':
      return mathRows(
        [
          field('Y_u', raw),
          field('N', interpretation.n),
          field(
            'V_NOM',
            interpretation.nominal === null ? '—' : formatPlainNumber(interpretation.nominal),
          ),
          byteField,
        ],
        formula,
      )
    case 'absolute-unsigned':
      return mathRows([field('V', raw), field('N', interpretation.n), byteField], formula)
  }
}

function directRows(state: AppState, formula: FormulaPresentation): ResultRowVM[] {
  const { m, b, r } = state.direct
  return mathRows(
    [field('Y', PMBusMath.toSigned(state.raw, 16)), field('m', m), field('b', b), field('R', r)],
    formula,
  )
}

function halfRows(state: AppState, formula: FormulaPresentation): ResultRowVM[] {
  const facts = classifyHalf(state.raw)
  return mathRows(
    [
      field('s', facts.sign),
      field('E', facts.exponent),
      field('F', facts.fraction),
      { label: '类别', value: facts.label },
    ],
    formula,
  )
}

function configRow(
  key: ResultRowVM['key'],
  label: string,
  segments: ResultSegmentVM[],
): ResultRowVM {
  return { key, label, presentation: 'config', segments }
}

/**
 * VOUT_MODE configuration parser walkthrough: field split, bit parse and the
 * decoded classification. Bit semantics come from the canonical VOUT_MODE VM
 * (analyzeVoutMode + requirement discriminator), never from JSX.
 */
function voutRows(info: VoutModeInfoVM): ResultRowVM[] {
  const signBit = info.isRelative ? '1' : '0'
  const formatBits = (info.format & 0b11).toString(2).padStart(2, '0')
  const paramBits = (info.parameter & 0x1f).toString(2).padStart(5, '0')

  const classification: ResultSegmentVM[] = [
    { text: info.isRelative ? '相对值' : '绝对值', role: 'ui' },
    { text: ' · ', role: 'ui' },
    { text: info.formatName, role: 'ui', termId: voutModeFormatTerm(info.format) },
  ]
  if (info.isLinear && info.linearExponent !== null) {
    classification.push(
      { text: ' · ', role: 'ui' },
      { text: 'N = ' + info.linearExponent, role: 'data' },
    )
  } else {
    classification.push(
      { text: ' · ', role: 'ui' },
      { text: 'bits[4:0] = ' + paramBits, role: 'data' },
    )
  }
  if (!info.structureLegal) {
    // Centralized domain validity warning (DIRECT/Half parameter must be 00000b).
    classification.push({ text: ' · ', role: 'ui' }, { text: info.statusText, role: 'ui' })
  }

  return [
    configRow('fields', '字段', [
      { text: 'bit7', role: 'data' },
      { text: ' = ', role: 'ui' },
      { text: signBit, role: 'data' },
      { text: ' · ', role: 'ui' },
      { text: 'bits[6:5]', role: 'data' },
      { text: ' = ', role: 'ui' },
      { text: formatBits, role: 'data' },
      { text: ' · ', role: 'ui' },
      { text: 'bits[4:0]', role: 'data' },
      { text: ' = ', role: 'ui' },
      { text: paramBits, role: 'data' },
    ]),
    configRow('generic', '位解析', [
      { text: info.hex, role: 'data' },
      { text: ' = ', role: 'ui' },
      { text: signBit, role: 'data' },
      { text: ' | ', role: 'ui' },
      { text: formatBits, role: 'data' },
      { text: ' | ', role: 'ui' },
      { text: paramBits, role: 'data' },
    ]),
    configRow('substitution', '结果', classification),
  ]
}

/**
 * Central direction provenance. Encode is asserted ONLY by a committed
 * physical-value request carried in state (L11's own channel or the
 * mode-discriminated valueRequest); every other committed state is a decode
 * of the canonical raw word. A state with no derivable value gets no
 * direction rather than a guess. VOUT_MODE has no physical value at all.
 */
function resolveDirection(state: AppState, valueText: string): ResultDirectionVM | undefined {
  if (state.mode === 'VOUT_MODE') return undefined
  const encodeRequested =
    state.mode === 'L11' ? state.l11.valueInput !== null : state.valueRequest?.mode === state.mode
  if (encodeRequested) return { kind: 'encode', label: '编码 值 → Raw' }
  if (valueText === '—') return undefined
  return { kind: 'decode', label: '解码 Raw → 值' }
}

export function buildResultWorkspace(
  state: AppState,
  source: ResultWorkspaceSource,
): ResultWorkspaceVM {
  const rows = (() => {
    switch (state.mode) {
      case 'L11':
        return l11Rows(state, source.formula)
      case 'L16':
        return l16Rows(state, source.formula)
      case 'DIRECT':
        return directRows(state, source.formula)
      case 'HALF':
        return halfRows(state, source.formula)
      case 'VOUT_MODE':
        return voutRows(source.voutModePage!)
    }
  })()

  const direction = resolveDirection(state, source.valueText)
  return direction ? { rows, direction } : { rows }
}
