/**
 * Strict hexadecimal parsing for raw word and VOUT_MODE inputs.
 *
 * The legacy implementation used `parseInt(cleaned, 16)` and then masked the
 * result to 16 bits.  That silently accepted partial parses (`0x12ZZ`) and
 * truncated over-long values (`0x12345` -> `0x2345`).  The new web app
 * intentionally rejects both: a hex input must be a complete, bounded string.
 */

export type HexParseResult =
  | { ok: true; value: number; empty: boolean }
  | { ok: false; error: string }

const HEX_DIGITS = /^[0-9a-fA-F]+$/

export function parseHexStrict(input: string, maxDigits: number): HexParseResult {
  const trimmed = String(input).trim()

  // Empty input is explicitly interpreted as zero, matching the reducer's
  // historical reset-on-empty behavior for raw word and VOUT_MODE.
  if (trimmed === '') return { ok: true, value: 0, empty: true }

  let digits = trimmed
  let hasPrefix = false
  if (/^0x/i.test(digits)) {
    hasPrefix = true
    digits = digits.slice(2)
  }

  if (hasPrefix && digits === '') {
    return { ok: false, error: '十六进制输入不完整：0x/0X 后需要至少一位十六进制数字' }
  }

  if (!HEX_DIGITS.test(digits)) {
    return { ok: false, error: '仅允许十六进制数字（0-9、A-F、a-f），可选 0x/0X 前缀' }
  }

  if (digits.length > maxDigits) {
    return {
      ok: false,
      error: `最多 ${maxDigits} 位十六进制数字（当前 ${digits.length} 位）`,
    }
  }

  return { ok: true, value: Number.parseInt(digits, 16), empty: false }
}

/** Convenience helper for the raw 16-bit word. */
export function parseHexWord(input: string): HexParseResult {
  return parseHexStrict(input, 4)
}

/** Convenience helper for a single byte such as VOUT_MODE. */
export function parseHexByte(input: string): HexParseResult {
  return parseHexStrict(input, 2)
}
