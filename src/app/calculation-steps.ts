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
    field('l11-n', 'N（5-bit signed）', String(decoded.n)),
    field('l11-y', 'Y（11-bit signed）', String(decoded.y)),
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

  if (state.l11.valueInput != null && Number.isFinite(state.l11.valueInput)) {
    const delta = state.l11.valueInput - decoded.value
    steps.push(intermediate('l11-quantization', '量化误差（请求值 − 表示值）', formatNumber(delta)))
  }

  return steps
}

function buildL16Steps(state: AppState): CalculationStepVM[] {
  const parsed = PMBusMath.parseVoutMode(state.l16.voutMode)
  const hex = `0x${state.l16.voutMode.toString(16).toUpperCase().padStart(2, '0')}`
  const steps: CalculationStepVM[] = [
    field('l16-vout-mode', 'VOUT_MODE', hex),
    field(
      'l16-vout-mode-bit7',
      'bit7 absolute/relative',
      parsed.isRelative ? 'relative (1)' : 'absolute (0)',
    ),
    field('l16-vout-mode-mode', 'bits[6:5] mode', `${parsed.modeName} (${parsed.mode})`),
    field('l16-vout-mode-param', 'bits[4:0] parameter', String(parsed.param)),
  ]

  // Non-LINEAR VOUT_MODE (VID / DIRECT / IEEE Half): the raw word is NOT a
  // LINEAR16 V×2^N payload — no V/N fields, no range, no result.
  if (parsed.mode !== 0) {
    steps.push(
      warningStep(
        'l16-unsupported',
        `${parsed.modeName}：需要器件 Profile，当前不计算 LINEAR16 电压；raw 不是 LINEAR16 V/N 编码。`,
      ),
    )
    return steps
  }

  if (parsed.isRelative) {
    // relative LINEAR：VOUT_MODE 参数位携带指数 N，可解释为比值缩放语义；
    // 但绝对电压需要参考值，不把 raw 标成绝对电压。
    steps.push(field('l16-n', 'N（来自 VOUT_MODE 参数位）', String(state.l16.n)))
    steps.push(intermediate('l16-2n', '2^N（比值缩放）', formatNumber(PMBusMath.pow2(state.l16.n))))
    steps.push(
      warningStep(
        'l16-unsupported',
        '相对 LINEAR：VOUT_MODE 给出指数/比值语义，但绝对电压需要参考值；当前不把 raw 标为绝对电压。',
      ),
    )
    return steps
  }

  // absolute LINEAR: full V → X = V × 2^N chain.
  steps.push(field('l16-v', 'V（16-bit 无符号）', String(state.raw)))
  steps.push(field('l16-n', 'N（来自 VOUT_MODE 参数位）', String(state.l16.n)))
  const p = PMBusMath.pow2(state.l16.n)
  steps.push(
    formula('l16-formula', '通用公式', 'X = V × 2^N', 'X = V \\times 2^N'),
    intermediate('l16-2n', '2^N', formatNumber(p)),
    formula(
      'l16-substitution',
      '数值代入',
      `X = ${state.raw} × 2^${state.l16.n}`,
      `X = ${state.raw} \\times 2^{${state.l16.n}}`,
    ),
    resultStep(formatNumber(PMBusMath.decodeLinear16(state.raw, state.l16.n).value)),
  )
  return steps
}

function buildDirectSteps(state: AppState): CalculationStepVM[] {
  const y = PMBusMath.toSigned(state.raw, 16)
  const { m, b, r } = state.direct
  const steps: CalculationStepVM[] = [
    field('direct-y', 'Y（16-bit signed）', String(y)),
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
    field('half-e', 'E（指数 5-bit）', String(exponent)),
    field('half-f', 'F（尾数 10-bit）', String(fraction)),
  ]

  if (exponent === 0 && fraction === 0) {
    steps.push(
      formula('half-class', '分类', 'zero（±0）'),
      formula('half-formula', '分段公式', `X = ${signPower} × 0`),
      resultStep(formatNumber(value)),
    )
  } else if (exponent === 0) {
    const p = PMBusMath.pow2(-14)
    const fTerm = fraction / 1024
    steps.push(
      formula('half-class', '分类', 'subnormal（次正规数）'),
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
      formula('half-class', '分类', 'normal（正规数）'),
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

export function buildCalculationSteps(state: AppState): CalculationStepVM[] {
  switch (state.mode) {
    case 'L11':
      return buildL11Steps(state)
    case 'L16':
      return buildL16Steps(state)
    case 'DIRECT':
      return buildDirectSteps(state)
    case 'HALF':
      return buildHalfSteps(state)
    default:
      return []
  }
}
