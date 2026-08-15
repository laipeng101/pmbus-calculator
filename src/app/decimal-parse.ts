/**
 * Strict decimal integer parsing for the L16 V (raw word) input.
 *
 * The previous UI used `parseInt(text, 10)` directly in ModeWorkspace, which
 * accepted partial parses like `12abc` and scientific notation like `1e2`.
 * This module intentionally requires the whole trimmed string to match an
 * optional sign followed by decimal digits only.
 */

export type DecimalParseResult =
  | { ok: true; value: number; empty: boolean }
  | { ok: false; error: string }

const DECIMAL_DIGITS = /^[0-9]+$/

export function parseDecimalIntStrict(input: string): DecimalParseResult {
  const trimmed = String(input).trim()

  // The input component normalizes empty drafts to '0' on blur/Enter, but the
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
    return { ok: false, error: '数值过大，请输入 0..65535 范围内的整数' }
  }

  return { ok: true, value, empty: false }
}
