import { describe, expect, it } from 'vitest'
import { analyzeVoutMode } from '../legacy/vout-mode'
import { resolveVoutModeRequirement } from './vout-mode-requirements'

describe('VOUT_MODE 配置需要哪些换算条件', () => {
  // 代表字节验证原因代码。条件字段在下面按所有字节统一验证。
  for (const [byte, id] of [
    [0x18, 'linear-absolute'],
    [0x98, 'linear-relative'],
    [0x40, 'direct-absolute'],
    [0xc0, 'direct-relative'],
    [0x60, 'half-absolute'],
    [0xe0, 'half-relative'],
    [0x41, 'direct-or-half-param-invalid'],
    [0x61, 'direct-or-half-param-invalid'],
    [0xe1, 'direct-or-half-param-invalid'],
    [0x20, 'vid-not-used'],
    [0x21, 'vid-reserved-listed'],
    [0x25, 'vid-reserved-unlisted'],
    [0x3e, 'vid-profile-required'],
    [0xa0, 'vid-relative-invalid'],
  ] as const) {
    const hex = '0x' + byte.toString(16).toUpperCase().padStart(2, '0')
    it(`${hex} 的换算条件为 ${id}`, () => {
      expect(resolveVoutModeRequirement(analyzeVoutMode(byte)).id).toBe(id)
    })
  }

  it('对每个字节区分结构合法性、器件资料和标称参考值要求', () => {
    const vidRequirement = {
      'not-used': 'vid-not-used',
      'profile-required': 'vid-profile-required',
      'listed-reserved': 'vid-reserved-listed',
      'unlisted-reserved': 'vid-reserved-unlisted',
    } as const
    for (let byte = 0; byte <= 0xff; byte++) {
      const analysis = analyzeVoutMode(byte)
      const requirement = resolveVoutModeRequirement(analysis)
      const hex = '0x' + byte.toString(16).padStart(2, '0')
      const format = (byte >> 5) & 0x03
      const relative = (byte & 0x80) !== 0
      const parameter = byte & 0x1f
      // PMBus Part II 表 2、表 3 和 §8.5.3。
      const manufacturerSpecific = !relative && format === 1 && parameter >= 0x1e
      const structureLegal =
        format === 0 || manufacturerSpecific || (format >= 2 && parameter === 0)
      expect(requirement, hex).toMatchObject({
        structureLegal,
        requiresDeviceCoefficients: format === 2 && structureLegal,
        requiresVidProfile: manufacturerSpecific,
        requiresNominalReference: relative && structureLegal,
        standardBinary16: format === 3 && structureLegal,
      })
      if (!relative && format === 1) {
        expect(analysis.vidCode, hex).toBeDefined()
        expect(requirement.id, hex).toBe(vidRequirement[analysis.vidCode!.kind])
      }
    }
  })
})
