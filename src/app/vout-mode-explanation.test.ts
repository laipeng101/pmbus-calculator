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
    [0x21, ['ar-command-scope', 'vid-reserved-listed']],
    [0x25, ['ar-command-scope', 'vid-reserved-unlisted']],
    [0x3e, ['ar-command-scope', 'vid-profile-required']],
    [0xa0, ['ar-command-scope', 'relative-vid-invalid']],
    [0x40, ['ar-command-scope', 'direct-profile-required']],
    [0x41, ['ar-command-scope', 'nonlinear-param-invalid']],
    [0x60, ['ar-command-scope', 'half-standard-format']],
    [0x61, ['ar-command-scope', 'nonlinear-param-invalid']],
    [0xc0, ['ar-command-scope', 'direct-profile-required']],
    [0xe0, ['ar-command-scope', 'half-standard-format']],
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

describe('v2.5.4 DIRECT 与 IEEE Half 的 requirement 语义拆分', () => {
  // IEEE Half is standard binary16 (Part II §7.6/§8.4.4): its explanation may
  // never claim a device profile, coefficients or device data. DIRECT keeps
  // the m/b/R requirement (§7.4).
  const HALF_BANNED = ['需器件资料', '器件 Profile', 'Profile', 'm/b/R', 'DIRECT 系数', '设备数据']

  function explanationCopy(byte: number): string {
    const ex = buildVoutModeExplanations(analyzeVoutMode(byte))
    return ex.map((e) => `${e.title} ${e.detail}`).join('\n')
  }

  for (const byte of [0x60, 0xe0]) {
    it(
      '0x' + byte.toString(16) + ' explanation states standard binary16 without profile copy',
      () => {
        const copy = explanationCopy(byte)
        const half = buildVoutModeExplanations(analyzeVoutMode(byte)).find(
          (e) => e.id === 'half-standard-format',
        )
        expect(half, 'half-standard-format explanation present').toBeDefined()
        expect(half?.detail).toContain('标准 IEEE 754 binary16')
        expect(half?.specRef).toBe('Part II §7.6 / §8.4.4')
        for (const banned of HALF_BANNED) {
          expect(copy, 'unexpected profile copy: ' + banned).not.toContain(banned)
        }
      },
    )
  }

  it('0x60（绝对 Half）不含标称参考值要求；0xE0 明确需要 VOUT_COMMAND 标称参考值', () => {
    const absolute = explanationCopy(0x60)
    expect(absolute).not.toContain('标称参考值')
    expect(absolute).toContain('HALF 模式页')

    const relative = explanationCopy(0xe0)
    expect(relative).toContain('VOUT_COMMAND 标称参考值')
    expect(relative).toContain('§8.5.2')
    for (const banned of HALF_BANNED) {
      expect(relative, 'unexpected profile copy: ' + banned).not.toContain(banned)
    }
  })

  for (const byte of [0x40, 0xc0]) {
    it('0x' + byte.toString(16) + ' explanation keeps the device m/b/R requirement', () => {
      const copy = explanationCopy(byte)
      const direct = buildVoutModeExplanations(analyzeVoutMode(byte)).find(
        (e) => e.id === 'direct-profile-required',
      )
      expect(direct, 'direct-profile-required explanation present').toBeDefined()
      expect(direct?.detail).toContain('m/b/R')
      expect(direct?.detail).toContain('器件')
      expect(direct?.specRef).toBe('Part II §7.4 / §8.4.3')
      expect(copy).not.toContain('标准 IEEE 754 binary16')
    })
  }
})
