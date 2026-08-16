import { describe, expect, it } from 'vitest'
import {
  getCopyHexLabel,
  getQuantizationTextColorToken,
  getResultValueSizeClass,
} from './result-presentation'

describe('getResultValueSizeClass', () => {
  it('uses predictable length-based font steps', () => {
    expect(getResultValueSizeClass('0')).toBe('xl')
    expect(getResultValueSizeClass('-12.5')).toBe('xl')
    expect(getResultValueSizeClass('4.49255371094')).toBe('md')
    expect(getResultValueSizeClass('-0.000473737716675')).toBe('sm')
  })

  it('never produces ellipsis or truncation classes for long exact values', () => {
    const longValue = '-0.000473737716675'
    expect(getResultValueSizeClass(longValue)).toBe('sm')
    expect(getResultValueSizeClass('255.99609375')).toBe('lg')
  })
})

describe('getQuantizationTextColorToken', () => {
  it('maps ok to success, warn to warning and error to danger', () => {
    expect(getQuantizationTextColorToken('ok')).toBe('var(--color-success-text)')
    expect(getQuantizationTextColorToken('warn')).toBe('var(--color-warning-text)')
    expect(getQuantizationTextColorToken('error')).toBe('var(--color-danger-text)')
  })
})

describe('getCopyHexLabel', () => {
  it('reflects current copy endianness', () => {
    expect(getCopyHexLabel('le')).toBe('Hex（LE）')
    expect(getCopyHexLabel('be')).toBe('Hex（BE）')
  })
})
