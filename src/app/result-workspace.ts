/**
 * Unified result workspace — one structural skeleton for all five modes.
 *
 * The result card is "one engineering instrument with five gears": a headline
 * value on the left and, for numeric modes, exactly two semantic rows on the
 * right — the live fields and ONE complete canonical equation
 * (symbolic relation → substituted values → final result). VOUT_MODE keeps the
 * same spatial rhythm but renders a three-row bit-field configuration parser
 * (UI/data font roles, never KaTeX). The row layout is declared on the
 * workspace VM so the container sizes its tracks from a data attribute rather
 * than an inline style.
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
import type { TermId } from './terminology'
import type {
  ConfigResultRowKey,
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

function field(label: string, value: number | string, termId?: TermId, code = true): ResultFieldVM {
  const base = { label, value: String(value) }
  if (code) {
    return termId ? { ...base, code: true, termId } : { ...base, code: true }
  }
  return termId ? { ...base, termId } : base
}

function fieldsRow(fields: ResultFieldVM[]): ResultRowVM {
  return { layout: 'numeric', key: 'fields', label: '字段', presentation: 'fields', fields }
}

/**
 * Row 2: the complete canonical first-screen equation straight from the
 * formula-presentation source. The workspace never infers it from auxiliary
 * lines and never rebuilds the equation from raw state.
 */
function equationRow(formula: FormulaPresentation): ResultRowVM {
  return {
    layout: 'numeric',
    key: 'substitution',
    label: '数值代入',
    presentation: 'math',
    latex: formula.equationLatex,
    plainText: formula.equationPlainText,
  }
}

function mathRows(fields: ResultFieldVM[], formula: FormulaPresentation): ResultRowVM[] {
  return [fieldsRow(fields), equationRow(formula)]
}

function l11Rows(state: AppState, formula: FormulaPresentation): ResultRowVM[] {
  const { n, y } = PMBusMath.decodeLinear11(state.raw)
  return mathRows([field('N', n, 'linear11-exponent'), field('Y', y, 'linear11-y')], formula)
}

function l16Rows(state: AppState, formula: FormulaPresentation): ResultRowVM[] {
  const { analysis, interpretation } = deriveL16Semantics(state)
  const raw = state.raw & 0xffff
  const byteField = field('VOUT_MODE', formatByteHex(analysis.byte), 'vout-mode')
  switch (interpretation.kind) {
    case 'non-linear':
      // Fail closed: expose the actual shared byte and format, never a pseudo N.
      return mathRows([byteField, { label: '格式', value: analysis.formatName }], formula)
    case 'signed-offset':
      return mathRows(
        [
          field('Y_s', interpretation.y, 'l16-ys'),
          field('N', interpretation.n, 'exponent'),
          byteField,
        ],
        formula,
      )
    case 'relative-ratio':
      return mathRows(
        [
          field('Y_u', raw, 'l16-yu'),
          field('N', interpretation.n, 'exponent'),
          field(
            'V_NOM',
            interpretation.nominal === null ? '—' : formatPlainNumber(interpretation.nominal),
            'l16-vnom',
            false,
          ),
          byteField,
        ],
        formula,
      )
    case 'absolute-unsigned':
      return mathRows(
        [field('V', raw, 'ulinear16-v'), field('N', interpretation.n, 'exponent'), byteField],
        formula,
      )
  }
}

function directRows(state: AppState, formula: FormulaPresentation): ResultRowVM[] {
  const { m, b, r } = state.direct
  return mathRows(
    [
      field('Y', PMBusMath.toSigned(state.raw, 16), 'direct-y'),
      field('m', m, 'direct-m'),
      field('b', b, 'direct-b'),
      field('R', r, 'direct-r'),
    ],
    formula,
  )
}

function halfRows(state: AppState, formula: FormulaPresentation): ResultRowVM[] {
  const facts = classifyHalf(state.raw)
  return mathRows(
    [
      field('s', facts.sign, 'half-s'),
      field('E', facts.exponent, 'half-e'),
      field('F', facts.fraction, 'half-f'),
      { label: '类别', value: facts.label },
    ],
    formula,
  )
}

function configRow(
  key: ConfigResultRowKey,
  label: string,
  segments: ResultSegmentVM[],
): ResultRowVM {
  return { layout: 'config', key, label, presentation: 'config', segments }
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
    configRow('bitParse', '位解析', [
      { text: info.hex, role: 'data' },
      { text: ' = ', role: 'ui' },
      { text: signBit, role: 'data' },
      { text: ' | ', role: 'ui' },
      { text: formatBits, role: 'data' },
      { text: ' | ', role: 'ui' },
      { text: paramBits, role: 'data' },
    ]),
    configRow('result', '结果', classification),
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
  const layout = state.mode === 'VOUT_MODE' ? 'config' : 'numeric'
  return direction ? { layout, rows, direction } : { layout, rows }
}
