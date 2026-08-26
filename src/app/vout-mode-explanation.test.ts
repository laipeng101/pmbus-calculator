import { describe, expect, it } from 'vitest'
import { analyzeVoutMode } from '../legacy/vout-mode'
import { buildVoutModeExplanations } from './vout-mode-explanation'

const BANNED_BILINGUAL = [
  'Absolute',
  'Relative',
  'Not Used',
  'Reserved',
  'parameter must be 0',
  'is invalid',
  'is not available',
  'nominal reference',
  'This byte is structurally legal',
]

describe('M39 VOUT_MODE explanation model (Chinese-primary)', () => {
  const cases: Array<[number, string[]]> = [
    [0x18, ['ar-command-scope', 'linear-exponent']],
    [0x98, ['ar-command-scope', 'linear-exponent', 'relative-linear-ratio']],
    [0x96, ['ar-command-scope', 'linear-exponent', 'relative-linear-ratio']],
    [0x20, ['ar-command-scope', 'vid-not-used']],
    [0x21, ['ar-command-scope', 'vid-reserved']],
    [0x3e, ['ar-command-scope', 'vid-profile-required']],
    [0xa0, ['ar-command-scope', 'relative-vid-invalid']],
    [0x40, ['ar-command-scope', 'nonlinear-profile-required']],
    [0x41, ['ar-command-scope', 'nonlinear-param-invalid']],
    [0x60, ['ar-command-scope', 'nonlinear-profile-required']],
    [0x61, ['ar-command-scope', 'nonlinear-param-invalid']],
    [0xc0, ['ar-command-scope', 'nonlinear-profile-required']],
    [0xe0, ['ar-command-scope', 'nonlinear-profile-required']],
  ]

  for (const [byte, expectedIds] of cases) {
    it(
      '0x' +
        byte.toString(16).toUpperCase().padStart(2, '0') +
        ' outputs Chinese-only explanations with stable ids',
      () => {
        const a = analyzeVoutMode(byte)
        const ex = buildVoutModeExplanations(a)
        expect(ex.map((e) => e.id)).toEqual(expectedIds)
        for (const e of ex) {
          expect(typeof e.title).toBe('string')
          expect(typeof e.detail).toBe('string')
          expect(e.specRef.startsWith('Part II')).toBe(true)
          expect(e.severity === 'info' || e.severity === 'warning' || e.severity === 'error').toBe(
            true,
          )
          const joined = e.title + ' ' + e.detail
          for (const banned of BANNED_BILINGUAL) {
            expect(joined, 'unexpected bilingual copy: ' + banned).not.toContain(banned)
          }
        }
      },
    )
  }

  it('keeps canonical tokens and spec refs while narrating in Chinese', () => {
    const ex = buildVoutModeExplanations(analyzeVoutMode(0x98))
    const relative = ex.find((e) => e.id === 'relative-linear-ratio')
    expect(relative).toBeDefined()
    expect(relative?.title).toBe('相对 LINEAR：比值为正')
    expect(relative?.detail).toContain('VOUT_COMMAND')
    expect(relative?.detail).toContain('R = Y_u × 2^N')
    expect(relative?.specRef).toBe('Part II §8.5.2')
  })

  it('VID not-used explanation uses the Chinese 未使用 label', () => {
    const ex = buildVoutModeExplanations(analyzeVoutMode(0x20))
    expect(ex.find((e) => e.id === 'vid-not-used')?.title).toBe('VID code 00h：未使用')
  })
})
