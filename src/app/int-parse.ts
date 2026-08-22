/**
 * Strict decimal integer parsing shared by every integer input field
 * (L11 N/Y, L16 V, DIRECT Y and DIRECT coefficients) and the reducer.
 *
 * The unified integer syntax is: 可选正负号 + 十进制数字.  Partial parses
 * (`12abc`), scientific notation (`1e2`), floats (`1.5`), hex (`0x10`),
 * sign-only finals and unsafe integers are rejected so the reducer and the
 * input components never disagree about what a valid integer looks like.
 */

export type IntParseResult =
  | { ok: true; value: number; empty: boolean }
  | { ok: false; error: string }

const DECIMAL_DIGITS = /^[0-9]+$/

export function parseIntegerStrict(input: string): IntParseResult {
  const trimmed = String(input).trim()

  // The input components normalize empty drafts to '0' on blur/Enter, but the
  // reducer should still be explicit when it receives an empty string.
  if (trimmed === '') return { ok: true, value: 0, empty: true }

  let sign = 1
  let digits = trimmed
  if (digits.startsWith('+') || digits.startsWith('-')) {
    sign = digits.startsWith('-') ? -1 : 1
    digits = digits.slice(1)
  }

  if (digits === '') {
    return { ok: false, error: '十进制整数输入不完整：符号后需要至少一位数字' }
  }

  if (!DECIMAL_DIGITS.test(digits)) {
    return {
      ok: false,
      error: '仅允许十进制整数（可选正负号 + 0-9 数字），不支持小数、科学计数法或部分解析',
    }
  }

  const value = sign * Number.parseInt(digits, 10)
  if (!Number.isSafeInteger(value)) {
    return { ok: false, error: '数值过大，超出 JavaScript 安全整数范围，请输入更小的整数' }
  }

  return { ok: true, value, empty: false }
}

/** True while the user may still be typing a complete integer ('', '+', '-'). */
export function isTransitionalIntegerText(input: string): boolean {
  const trimmed = input.trim()
  return trimmed === '' || trimmed === '+' || trimmed === '-'
}
