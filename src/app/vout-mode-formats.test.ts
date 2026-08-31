import { describe, expect, it } from 'vitest'
import { L16_FORMAT_BIT_DISABLED_HINTS, l16FormatBitDisabledHint } from './vout-mode-formats'

describe('l16FormatBitDisabledHint (v2.6.2 single source)', () => {
  it('uses the linked wording for the linked and unspecified sources', () => {
    expect(l16FormatBitDisabledHint('linked')).toBe(L16_FORMAT_BIT_DISABLED_HINTS.linked)
    expect(l16FormatBitDisabledHint(undefined)).toBe(L16_FORMAT_BIT_DISABLED_HINTS.linked)
    expect(L16_FORMAT_BIT_DISABLED_HINTS.linked).toBe('格式位固定为 LINEAR')
  })

  it('uses the non-linear wording only for a non-linear shared byte', () => {
    expect(l16FormatBitDisabledHint('non-linear')).toBe(L16_FORMAT_BIT_DISABLED_HINTS['non-linear'])
    expect(L16_FORMAT_BIT_DISABLED_HINTS['non-linear']).toBe(
      '格式位不可在本页切换（当前字节非 LINEAR）',
    )
  })
})
