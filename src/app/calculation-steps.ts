/**
 * Calculation steps — domain display layer shared by all four modes.
 *
 * Every mode exposes the same skeleton:
 *   fields (字段解析) -> generic formula (计算公式) -> intermediates (计算过程)
 *   -> result (物理值) -> warnings (真实错误/饱和提示)
 *
 * Components must never recompute these values in JSX; they only render the
 * steps produced here and by src/app/view-model.ts.
 */
import type { AppState } from './state'
import { PMBusMath } from '../legacy/pmbus-math'
import { analyzeVoutMode } from '../legacy/vout-mode'
import { resolveVoutModeRequirement } from './vout-mode-requirements'
import { effectiveL16VoutMode } from './vout-mode-selector'
import { computeQuantizationOutcome } from './quantization-error'
import type { QuantizationOutcome } from './quantization-error'

/** Step text mirrors the shared readout panel wording. */
function quantizationStepValue(outcome: QuantizationOutcome): string {
  switch (outcome.status) {
    case 'exact':
      return '0（精确编码）'
    case 'quantized':
      return formatNumber(outcome.absoluteError ?? 0)
    case 'saturated':
      return `${formatNumber(outcome.absoluteError ?? 0)}（已饱和到边界值）`
    case 'overflow':
      return `（有限值编码溢出为 ${outcome.represented > 0 ? '+Infinity' : '-Infinity'}）`
    case 'special':
      return '（特殊值，量化误差不适用）'
  }
}

export interface CalculationStepVM {
  id: string
  label: string
  plainText: string
  latex?: string
  value?: string
  kind: 'field' | 'formula' | 'intermediate' | 'result' | 'warning'
}

function formatNumber(value: number): string {
  if (Number.isNaN(value)) return 'NaN'
  if (Number.isFinite(value) === false) return value > 0 ? '+Infinity' : '-Infinity'
  if (Object.is(value, -0)) return '-0'
  if (Number.isInteger(value)) return value.toString()
  return parseFloat(value.toPrecision(12)).toString()
}

function field(id: string, label: string, value: string): CalculationStepVM {
  return { id, label, plainText: `${label} = ${value}`, value, kind: 'field' }
}

function formula(id: string, label: string, plainText: string, latex?: string): CalculationStepVM {
  return { id, label, plainText, latex, kind: 'formula' }
}

function intermediate(id: string, label: string, value: string): CalculationStepVM {
  return { id, label, plainText: `${label} = ${value}`, value, kind: 'intermediate' }
}

function resultStep(value: string): CalculationStepVM {
  return {
    id: 'result',
    label: '物理值',
    plainText: `X = ${value}`,
    value,
    kind: 'result',
  }
}

function warningStep(id: string, text: string): CalculationStepVM {
  return { id, label: '提示', plainText: text, kind: 'warning' }
}

function buildL11Steps(state: AppState): CalculationStepVM[] {
  const decoded = PMBusMath.decodeLinear11(state.raw)
  const p = PMBusMath.pow2(decoded.n)
  const steps: CalculationStepVM[] = [
    field('l11-n', 'N（5 位二补码指数）', String(decoded.n)),
    field('l11-y', 'Y（11 位有符号整数）', String(decoded.y)),
    formula('l11-formula', '通用公式', 'X = Y × 2^N', 'X = Y \\times 2^N'),
    intermediate('l11-2n', '2^N', formatNumber(p)),
    formula(
      'l11-substitution',
      '数值代入',
      `X = ${decoded.y} × 2^${decoded.n}`,
      `X = ${decoded.y} \\times 2^{${decoded.n}}`,
    ),
    resultStep(formatNumber(decoded.value)),
  ]

  if (state.l11.valueInput != null && Number.isFinite(state.l11.valueInput)) {
    // auto-N 用全格式全局范围（N=15 极值）判断饱和；锁定 N 用该 N 的
    // Y=-1024..1023 范围判断（Y=1023/-1024 本身是合法边界编码）。
    const { min, max } = state.l11.autoN
      ? { min: PMBusMath.minLinear11(), max: PMBusMath.maxLinear11() }
      : PMBusMath.linear11RangeForN(state.l11.n)
    if (state.l11.valueInput > max || state.l11.valueInput < min) {
      steps.push(
        warningStep(
          'l11-saturation',
          `输入值超出 LINEAR11 可表示范围（${formatNumber(min)} ~ ${formatNumber(max)}），编码器已饱和到极值`,
        ),
      )
    }
  }

  return steps
}

function buildL16Steps(state: AppState): CalculationStepVM[] {
  const eff = effectiveL16VoutMode(state)
  const a = analyzeVoutMode(eff.byte)
  const n = a.linearExponent ?? 0
  const hex = `0x${state.voutMode.byte.toString(16).toUpperCase().padStart(2, '0')}`
  const steps: CalculationStepVM[] = [field('l16-vout-mode', 'VOUT_MODE（共享字节）', hex)]

  // Fail closed on a non-LINEAR shared byte (v2.5.2, Part II §8.4): the page
  // shows the actual byte and refuses to derive N / results / quantization
  // from an implicit 0x18 substitution. No LINEAR math below this point.
  if (eff.source === 'non-linear') {
    steps.push(
      warningStep(
        'l16-nonlinear',
        `共享 VOUT_MODE ${hex} 为 ${a.formatName}；输出电压相关命令的数据格式由当前 VOUT_MODE 决定（Part II §8.4），本页不隐式替换字节。显式应用计算器 LINEAR 示例 0x18（absolute、N=-8）后才恢复计算。`,
      ),
    )
    return steps
  }

  steps.push(
    field('l16-vout-mode-bit7', 'bit7 绝对值/相对值', a.isRelative ? '相对值 (1)' : '绝对值 (0)'),
    field('l16-vout-mode-mode', 'bits[6:5] 格式', `${a.formatName} (${a.format})`),
    field('l16-vout-mode-param', 'bits[4:0] 参数', String(a.parameter)),
  )

  // SLINEAR16 offset: bit7 belongs to another command group and must not
  // switch the signed offset formula or its unit.
  if (state.l16.payloadKind === 'slinear16-offset') {
    const y = PMBusMath.toSigned(state.raw, 16)
    const p = PMBusMath.pow2(n)
    steps.push(field('l16-vout-mode-bit7-na', 'bit7 对本 payload', '不适用（有符号偏移量）'))
    steps.push(field('l16-ys', 'Y_s（16 位有符号整数）', String(y)))
    steps.push(field('l16-n', 'N（来自 VOUT_MODE 参数位）', String(n)))
    steps.push(
      formula('l16-formula', '通用公式', 'X_offset = Y_s × 2^N', 'X_{offset} = Y_s \\times 2^N'),
      intermediate('l16-2n', '2^N', formatNumber(p)),
      formula(
        'l16-substitution',
        '数值代入',
        `X_offset = ${y} × 2^${n}`,
        `X_{offset} = ${y} \\times 2^{${n}}`,
      ),
      resultStep(formatNumber(PMBusMath.decodeSlinear16(state.raw, n).value)),
    )
    return steps
  }

  if (a.isRelative) {
    const ratio = PMBusMath.decodeUlinear16(state.raw, n).value
    steps.push(field('l16-n', 'N（来自 VOUT_MODE 参数位）', String(n)))
    steps.push(intermediate('l16-2n', '2^N（比值缩放）', formatNumber(PMBusMath.pow2(n))))
    steps.push(intermediate('l16-ratio', 'R = Y_u × 2^N（比值）', formatNumber(ratio)))
    if (state.l16.nominalVout == null) {
      steps.push(
        warningStep(
          'l16-relative-nominal-missing',
          '缺少 VOUT_COMMAND 标称参考值；已解出比值 R，但最终电压 X = V_NOM × R 不显示伪值。',
        ),
      )
    } else {
      const final = state.l16.nominalVout * ratio
      steps.push(
        intermediate(
          'l16-nominal',
          'V_NOM（VOUT_COMMAND 标称值）',
          formatNumber(state.l16.nominalVout),
        ),
        formula(
          'l16-final',
          '最终电压',
          `X = ${formatNumber(state.l16.nominalVout)} × ${formatNumber(ratio)} = ${formatNumber(final)} V`,
        ),
        resultStep(formatNumber(final)),
      )
    }
    return steps
  }

  // absolute LINEAR: full V → X = V × 2^N chain.
  steps.push(field('l16-v', 'V（16 位无符号整数）', String(state.raw)))
  steps.push(field('l16-n', 'N（来自 VOUT_MODE 参数位）', String(n)))
  const p = PMBusMath.pow2(n)
  steps.push(
    formula('l16-formula', '通用公式', 'X = V × 2^N', 'X = V \\times 2^N'),
    intermediate('l16-2n', '2^N', formatNumber(p)),
    formula(
      'l16-substitution',
      '数值代入',
      `X = ${state.raw} × 2^${n}`,
      `X = ${state.raw} \\times 2^{${n}}`,
    ),
    resultStep(formatNumber(PMBusMath.decodeLinear16(state.raw, n).value)),
  )
  return steps
}

function buildDirectSteps(state: AppState): CalculationStepVM[] {
  const y = PMBusMath.toSigned(state.raw, 16)
  const { m, b, r } = state.direct
  const steps: CalculationStepVM[] = [
    field('direct-y', 'Y（16 位有符号整数）', String(y)),
    field('direct-m', 'M（斜率）', String(m)),
    field('direct-b', 'B（偏移）', String(b)),
    field('direct-r', 'R（指数）', String(r)),
    formula(
      'direct-formula',
      '通用公式',
      'X = (1/m) × (Y × 10^(-R) − b)',
      'X = \\frac{1}{m}\\left(Y \\times 10^{-R} - b\\right)',
    ),
  ]

  if (m === 0) {
    steps.push(warningStep('direct-m-zero', 'm=0：DIRECT 系数 m 不能为 0，无法解码'))
    return steps
  }

  const pow10 = Math.pow(10, -r)
  const yTerm = y * pow10
  const yMinusB = yTerm - b
  const invM = 1 / m
  steps.push(
    intermediate('direct-pow10', `10^(-R) = 10^${-r}`, formatNumber(pow10)),
    intermediate('direct-y-term', 'Y × 10^(-R)', formatNumber(yTerm)),
    intermediate('direct-y-minus-b', 'Y × 10^(-R) − b', formatNumber(yMinusB)),
    intermediate('direct-inv-m', '1/m', formatNumber(invM)),
    formula(
      'direct-substitution',
      '数值代入',
      `X = ${formatNumber(invM)} × (${formatNumber(yTerm)} − ${formatNumber(b)})`,
    ),
    resultStep(formatNumber(invM * yMinusB)),
  )
  return steps
}

function buildHalfSteps(state: AppState): CalculationStepVM[] {
  const raw = state.raw & 0xffff
  const sign = (raw >> 15) & 1
  const exponent = (raw >> 10) & 0x1f
  const fraction = raw & 0x3ff
  const signPower = `(-1)^${sign}`
  const value = PMBusMath.decodeHalf(raw).value

  const steps: CalculationStepVM[] = [
    field('half-s', 'S（符号位）', String(sign)),
    field('half-e', 'E（指数 5 位）', String(exponent)),
    field('half-f', 'F（尾数 10 位）', String(fraction)),
  ]

  if (exponent === 0 && fraction === 0) {
    steps.push(
      formula('half-class', '分类', '零（±0）'),
      formula('half-formula', '分段公式', `X = ${signPower} × 0`),
      resultStep(formatNumber(value)),
    )
  } else if (exponent === 0) {
    const p = PMBusMath.pow2(-14)
    const fTerm = fraction / 1024
    steps.push(
      formula('half-class', '分类', '次正规数'),
      formula('half-formula', '分段公式', `X = ${signPower} × 2^-14 × F/1024`),
      intermediate('half-2e', '2^-14', formatNumber(p)),
      intermediate('half-fraction', 'F/1024', formatNumber(fTerm)),
      formula(
        'half-substitution',
        '数值代入',
        `X = ${signPower} × ${formatNumber(p)} × ${formatNumber(fTerm)}`,
      ),
      resultStep(formatNumber(value)),
    )
  } else if (exponent === 0x1f && fraction === 0) {
    steps.push(
      formula('half-class', '分类', `${sign ? '−' : '+'}Infinity`),
      formula('half-formula', '分段公式', `X = ${signPower} × ∞`),
      resultStep(formatNumber(value)),
    )
  } else if (exponent === 0x1f) {
    steps.push(
      formula('half-class', '分类', 'NaN'),
      formula('half-formula', '分段公式', 'X = NaN（E=31, F≠0）'),
      resultStep('NaN'),
    )
  } else {
    const exp = exponent - 15
    const p = PMBusMath.pow2(exp)
    const mant = 1 + fraction / 1024
    steps.push(
      formula('half-class', '分类', '正规数'),
      formula('half-formula', '分段公式', `X = ${signPower} × 2^(E−15) × (1 + F/1024)`),
      intermediate('half-e-minus', 'E − 15', String(exp)),
      intermediate('half-2e', '2^(E−15)', formatNumber(p)),
      intermediate('half-mantissa', '1 + F/1024', formatNumber(mant)),
      formula(
        'half-substitution',
        '数值代入',
        `X = ${signPower} × ${formatNumber(p)} × ${formatNumber(mant)}`,
      ),
      resultStep(formatNumber(value)),
    )
  }

  return steps
}

function buildVoutModeSteps(state: AppState): CalculationStepVM[] {
  const byte = state.voutMode.byte
  const a = analyzeVoutMode(byte)
  // v2.5.5: the requirement verdict comes only from the shared discriminator;
  // branches select on `req.id`, never on format numbers or status strings.
  const req = resolveVoutModeRequirement(a)
  const hex = `0x${byte.toString(16).toUpperCase().padStart(2, '0')}`
  const steps: CalculationStepVM[] = [
    field('vout-mode-byte', 'VOUT_MODE', hex),
    field('vout-mode-bit7', 'bit7 绝对值/相对值', a.isRelative ? '相对值 (1)' : '绝对值 (0)'),
    field('vout-mode-format', 'bits[6:5] 格式', `${a.formatName} (${a.format})`),
    field('vout-mode-param', 'bits[4:0] 参数', String(a.parameter)),
  ]

  switch (req.id) {
    case 'linear-absolute': {
      steps.push(
        field('vout-mode-n', 'N（5 位二补码指数）', String(a.linearExponent ?? 0)),
        formula(
          'vout-mode-linear',
          'LINEAR 语义',
          'X = Y × 2^N（ULINEAR16 / SLINEAR16 偏移量）',
          'X = Y \\times 2^N',
        ),
        warningStep('vout-mode-absolute-note', '结构合法；绝对 LINEAR 可在 L16 页计算绝对电压。'),
      )
      break
    }
    case 'linear-relative': {
      steps.push(
        field('vout-mode-n', 'N（5 位二补码指数）', String(a.linearExponent ?? 0)),
        formula(
          'vout-mode-linear',
          'LINEAR 语义',
          'X = Y × 2^N（ULINEAR16 / SLINEAR16 偏移量）',
          'X = Y \\times 2^N',
        ),
        warningStep(
          'vout-mode-relative-note',
          '结构合法；相对 LINEAR 需 VOUT_COMMAND 标称参考值才能计算最终电压。',
        ),
      )
      break
    }
    case 'direct-absolute':
      steps.push(
        warningStep(
          'vout-mode-direct',
          'DIRECT 参数为 0，结构合法；需要器件 m/b/R 系数（来自 COEFFICIENTS 或器件资料）才能计算（Part II §7.4）。',
        ),
      )
      break
    case 'direct-relative':
      steps.push(
        warningStep(
          'vout-mode-direct',
          'DIRECT 参数为 0，结构合法；需要器件 m/b/R 系数（来自 COEFFICIENTS 或器件资料）才能计算（Part II §7.4），最终电压还需 VOUT_COMMAND 标称参考值（§8.5.2）。',
        ),
      )
      break
    case 'half-absolute':
      // IEEE Half is standard binary16 (Part II §7.6/§8.4.4): no device
      // coefficients; the HALF page already performs the conversion.
      steps.push(
        warningStep(
          'vout-mode-half',
          'IEEE Half 参数为 0，结构合法；word 是标准 IEEE 754 binary16，可在 HALF 模式页换算，不需要器件系数（Part II §7.6 / §8.4.4）。',
        ),
      )
      break
    case 'half-relative':
      steps.push(
        warningStep(
          'vout-mode-half',
          'IEEE Half 参数为 0，结构合法；payload 是标准 IEEE 754 binary16，换算不需要器件系数，相对阈值还需 VOUT_COMMAND 标称参考值才能得到最终电压（Part II §8.5.2）。',
        ),
      )
      break
    case 'vid-not-used':
      steps.push(
        warningStep(
          'vout-mode-vid-not-used',
          `${a.vidCode?.label ?? 'VID code 00h'}；不构成有效 VID profile，不能当作有效配置使用（Part II §8.4.2 Table 3）。`,
        ),
      )
      break
    case 'vid-reserved-listed': {
      const reason = a.vidCode?.reservedReason
      steps.push(
        warningStep(
          'vout-mode-vid-reserved',
          `${a.vidCode?.label ?? 'VID code 保留'}；该 code 是 Part II §8.4.2 Table 3 明列的保留值${
            reason ? `（${reason}）` : ''
          }，不得当作有通用电压映射的 profile。`,
        ),
      )
      break
    }
    case 'vid-reserved-unlisted':
      steps.push(
        warningStep(
          'vout-mode-vid-reserved',
          `${a.vidCode?.label ?? 'VID code 保留'}；Table 3 未列出该 code，保留供未来使用，不得当作有通用电压映射的 profile（Part II §8.4.2 Table 3）。`,
        ),
      )
      break
    case 'vid-profile-required':
      // Table-3-listed manufacturer-specific VID: structurally legal but not
      // calculable here — its own branch, never the invalid one.
      steps.push(
        warningStep(
          'vout-mode-vid-profile',
          `${a.vidCode?.label ?? 'VID code 制造商自定义'}；结构合法（Part II §8.4.2 Table 3 明列），但码表与电压映射必须来自器件资料，当前计算器不可换算。`,
        ),
      )
      break
    case 'vid-relative-invalid':
      steps.push(warningStep('vout-mode-invalid-combination', '相对 + VID 非法组合（§8.5.3）。'))
      break
    case 'direct-or-half-param-invalid':
      steps.push(
        warningStep(
          'vout-mode-param-invalid',
          `${a.formatName} 参数必须为 00000b（§8.3 Table 2）。`,
        ),
      )
      break
    case 'invalid-input':
      steps.push(warningStep('vout-mode-invalid-input', '无效 VOUT_MODE 输入。'))
      break
  }
  return steps
}

/**
 * Append the quantization-error intermediate for every mode whose physical
 * value came from an explicit encoding request. L11 produces its own step
 * inside buildL11Steps and keeps that historical placement; the other modes
 * share the domain layer here so the wording stays identical.
 */
/**
 * Append the format-encoding quantization intermediate for every mode whose
 * physical value came from an explicit encoding request (L11 included —
 * same provenance contract as the shared readout panel).
 */
function appendQuantizationStep(state: AppState, steps: CalculationStepVM[]): void {
  const outcome = computeQuantizationOutcome(state)
  if (outcome) {
    steps.push(
      intermediate(
        `${state.mode.toLowerCase()}-quantization`,
        '格式编码量化误差（请求值 − 表示值）',
        quantizationStepValue(outcome),
      ),
    )
  }
}

export function buildCalculationSteps(state: AppState): CalculationStepVM[] {
  const steps = (() => {
    switch (state.mode) {
      case 'L11':
        return buildL11Steps(state)
      case 'L16':
        return buildL16Steps(state)
      case 'DIRECT':
        return buildDirectSteps(state)
      case 'HALF':
        return buildHalfSteps(state)
      case 'VOUT_MODE':
        return buildVoutModeSteps(state)
      default:
        return []
    }
  })()
  appendQuantizationStep(state, steps)
  return steps
}
