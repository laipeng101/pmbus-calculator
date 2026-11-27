import { describe, expect, it } from 'vitest'
import {
  formatRawWordCopyText,
  getQuantizationTextColorToken,
  getResultValueSizeClass,
} from './result-presentation'

describe('getResultValueSizeClass', () => {
  it('uses the expected font sizes at each text-length boundary', () => {
    for (const [length, size] of [
      [8, 'xl'],
      [9, 'lg'],
      [12, 'lg'],
      [13, 'md'],
      [16, 'md'],
      [17, 'sm'],
    ] as const) {
      expect(getResultValueSizeClass('0'.repeat(length)), String(length)).toBe(size)
    }
  })
})

describe('getQuantizationTextColorToken', () => {
  it('maps ok to success, warn to warning and error to danger', () => {
    expect(getQuantizationTextColorToken('ok')).toBe('var(--color-success-text)')
    expect(getQuantizationTextColorToken('warn')).toBe('var(--color-warning-text)')
    expect(getQuantizationTextColorToken('error')).toBe('var(--color-danger-text)')
  })
})

describe('formatRawWordCopyText', () => {
  it('copies the canonical raw word with or without the 0x prefix', () => {
    expect(formatRawWordCopyText('0x1234', true)).toBe('0x1234')
    expect(formatRawWordCopyText('0x1234', false)).toBe('1234')
    expect(formatRawWordCopyText('0xC000', true)).toBe('0xC000')
    expect(formatRawWordCopyText('0x0000', false)).toBe('0000')
  })
})
