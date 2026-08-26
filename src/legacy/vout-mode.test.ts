import { describe, test, expect } from 'vitest'
import { analyzeVoutMode, classifyVidCode, composeVoutMode, VID_CODE_TABLE } from './vout-mode'

describe('analyzeVoutMode — golden vectors (Part II §8.3 Table 2 / §8.4.2 Table 3 / §8.5.3)', () => {
  const cases: Array<{
    byte: number
    isRelative: boolean
    format: 0 | 1 | 2 | 3
    formatName: string
    parameter: number
    linearExponent: number | null
    status: string
    reason: string
    vidKind?: string
  }> = [
    {
      byte: 0x00,
      isRelative: false,
      format: 0,
      formatName: 'LINEAR',
      parameter: 0,
      linearExponent: 0,
      status: 'valid',
      reason: 'absolute-linear',
    },
    {
      byte: 0x0f,
      isRelative: false,
      format: 0,
      formatName: 'LINEAR',
      parameter: 0x0f,
      linearExponent: 15,
      status: 'valid',
      reason: 'absolute-linear',
    },
    {
      byte: 0x10,
      isRelative: false,
      format: 0,
      formatName: 'LINEAR',
      parameter: 0x10,
      linearExponent: -16,
      status: 'valid',
      reason: 'absolute-linear',
    },
    {
      byte: 0x18,
      isRelative: false,
      format: 0,
      formatName: 'LINEAR',
      parameter: 0x18,
      linearExponent: -8,
      status: 'valid',
      reason: 'absolute-linear',
    },
    {
      byte: 0x1f,
      isRelative: false,
      format: 0,
      formatName: 'LINEAR',
      parameter: 0x1f,
      linearExponent: -1,
      status: 'valid',
      reason: 'absolute-linear',
    },
    {
      byte: 0x80,
      isRelative: true,
      format: 0,
      formatName: 'LINEAR',
      parameter: 0,
      linearExponent: 0,
      status: 'valid',
      reason: 'relative-linear',
    },
    {
      byte: 0x98,
      isRelative: true,
      format: 0,
      formatName: 'LINEAR',
      parameter: 0x18,
      linearExponent: -8,
      status: 'valid',
      reason: 'relative-linear',
    },
    {
      byte: 0x20,
      isRelative: false,
      format: 1,
      formatName: 'VID',
      parameter: 0,
      linearExponent: null,
      status: 'not-used',
      reason: 'absolute-vid-not-used',
      vidKind: 'not-used',
    },
    {
      byte: 0x3e,
      isRelative: false,
      format: 1,
      formatName: 'VID',
      parameter: 0x1e,
      linearExponent: null,
      status: 'profile-required',
      reason: 'absolute-vid-profile-required',
      vidKind: 'profile-required',
    },
    {
      byte: 0x3f,
      isRelative: false,
      format: 1,
      formatName: 'VID',
      parameter: 0x1f,
      linearExponent: null,
      status: 'profile-required',
      reason: 'absolute-vid-profile-required',
      vidKind: 'profile-required',
    },
    {
      byte: 0x21,
      isRelative: false,
      format: 1,
      formatName: 'VID',
      parameter: 1,
      linearExponent: null,
      status: 'reserved',
      reason: 'absolute-vid-reserved',
      vidKind: 'reserved',
    },
    {
      byte: 0xa0,
      isRelative: true,
      format: 1,
      formatName: 'VID',
      parameter: 0,
      linearExponent: null,
      status: 'invalid-combination',
      reason: 'relative-vid',
    },
    {
      byte: 0x40,
      isRelative: false,
      format: 2,
      formatName: 'DIRECT',
      parameter: 0,
      linearExponent: null,
      status: 'valid',
      reason: 'absolute-direct',
    },
    {
      byte: 0xc0,
      isRelative: true,
      format: 2,
      formatName: 'DIRECT',
      parameter: 0,
      linearExponent: null,
      status: 'valid',
      reason: 'relative-direct',
    },
    {
      byte: 0x41,
      isRelative: false,
      format: 2,
      formatName: 'DIRECT',
      parameter: 1,
      linearExponent: null,
      status: 'invalid-parameter',
      reason: 'direct-param-nonzero',
    },
    {
      byte: 0x5f,
      isRelative: false,
      format: 2,
      formatName: 'DIRECT',
      parameter: 0x1f,
      linearExponent: null,
      status: 'invalid-parameter',
      reason: 'direct-param-nonzero',
    },
    {
      byte: 0xc1,
      isRelative: true,
      format: 2,
      formatName: 'DIRECT',
      parameter: 1,
      linearExponent: null,
      status: 'invalid-parameter',
      reason: 'direct-param-nonzero',
    },
    {
      byte: 0x60,
      isRelative: false,
      format: 3,
      formatName: 'IEEE Half',
      parameter: 0,
      linearExponent: null,
      status: 'valid',
      reason: 'absolute-half',
    },
    {
      byte: 0xe0,
      isRelative: true,
      format: 3,
      formatName: 'IEEE Half',
      parameter: 0,
      linearExponent: null,
      status: 'valid',
      reason: 'relative-half',
    },
    {
      byte: 0x61,
      isRelative: false,
      format: 3,
      formatName: 'IEEE Half',
      parameter: 1,
      linearExponent: null,
      status: 'invalid-parameter',
      reason: 'half-param-nonzero',
    },
    {
      byte: 0x7f,
      isRelative: false,
      format: 3,
      formatName: 'IEEE Half',
      parameter: 0x1f,
      linearExponent: null,
      status: 'invalid-parameter',
      reason: 'half-param-nonzero',
    },
    {
      byte: 0xe1,
      isRelative: true,
      format: 3,
      formatName: 'IEEE Half',
      parameter: 1,
      linearExponent: null,
      status: 'invalid-parameter',
      reason: 'half-param-nonzero',
    },
  ]

  for (const c of cases) {
    test('0x' + c.byte.toString(16).toUpperCase().padStart(2, '0') + ' -> ' + c.reason, () => {
      const a = analyzeVoutMode(c.byte)
      expect(a.byte).toBe(c.byte)
      expect(a.isRelative).toBe(c.isRelative)
      expect(a.format).toBe(c.format)
      expect(a.formatName).toBe(c.formatName)
      expect(a.parameter).toBe(c.parameter)
      expect(a.linearExponent).toBe(c.linearExponent)
      expect(a.status).toBe(c.status)
      expect(a.reason).toBe(c.reason)
      expect(a.isLegal).toBe(c.status === 'valid')
      if (c.vidKind) {
        expect(a.vidCode?.kind).toBe(c.vidKind)
      } else {
        expect(a.vidCode).toBeUndefined()
      }
    })
  }
})

describe('analyzeVoutMode — exhaustive invariants (0x00..0xFF)', () => {
  test('no throw, field extraction is identity, status is deterministic', () => {
    for (let byte = 0; byte <= 0xff; byte++) {
      const a = analyzeVoutMode(byte)
      expect(a.format).toBe((byte >> 5) & 0x03)
      expect(a.formatName).toBe(
        a.format === 0
          ? 'LINEAR'
          : a.format === 1
            ? 'VID'
            : a.format === 2
              ? 'DIRECT'
              : 'IEEE Half',
      )
      expect(a.parameter).toBe(byte & 0x1f)
      expect(a.isRelative).toBe((byte & 0x80) !== 0)
      if (a.format === 0) {
        expect(a.linearExponent).toBe(a.parameter >= 16 ? a.parameter - 32 : a.parameter)
        expect(a.status).toBe('valid')
      } else if (a.format === 1) {
        expect(a.linearExponent).toBeNull()
        expect(a.status).toBe(a.isRelative ? 'invalid-combination' : a.vidCode?.kind)
      } else {
        expect(a.linearExponent).toBeNull()
        expect(a.status).toBe(a.parameter === 0 ? 'valid' : 'invalid-parameter')
      }
    }
  })

  test('only absolute LINEAR is legal-computable and isLegal is derived from status', () => {
    for (let byte = 0; byte <= 0xff; byte++) {
      const a = analyzeVoutMode(byte)
      expect(a.isLegal).toBe(a.status === 'valid')
      // A valid byte is never a VID format (VID is classified, never "valid").
      if (a.status === 'valid') expect(a.format).not.toBe(1)
    }
  })
})

describe('analyzeVoutMode — non-byte inputs are explicit, never silently masked', () => {
  for (const bad of [NaN, Infinity, -Infinity, -1, 256, 1.5, -0.5]) {
    test(String(bad) + ' -> invalid-input', () => {
      const a = analyzeVoutMode(bad)
      expect(a.status).toBe('invalid-input')
      expect(a.reason).toBe('input-not-a-byte')
      expect(a.isLegal).toBe(false)
    })
  }
})

describe('classifyVidCode', () => {
  test('00h is not-used', () => expect(classifyVidCode(0).kind).toBe('not-used'))
  test('1Eh/1Fh are profile-required', () => {
    expect(classifyVidCode(0x1e).kind).toBe('profile-required')
    expect(classifyVidCode(0x1f).kind).toBe('profile-required')
  })
  test('01h-04h / 10h-11h / 1Ch-1Dh and all other unlisted codes are reserved', () => {
    for (const code of [0x01, 0x02, 0x03, 0x04, 0x10, 0x11, 0x1c, 0x1d, 0x05, 0x0f, 0x12, 0x1b]) {
      expect(classifyVidCode(code).kind, '0x' + code.toString(16)).toBe('reserved')
    }
  })
  test('VID_CODE_TABLE has exactly 32 entries 0..31 with stable kinds', () => {
    expect(VID_CODE_TABLE).toHaveLength(32)
    for (let code = 0; code < 32; code++) {
      expect(VID_CODE_TABLE[code].code).toBe(code)
      expect(VID_CODE_TABLE[code].kind).toBe(classifyVidCode(code).kind)
    }
  })
})

describe('composeVoutMode — canonical encode and round-trip', () => {
  const cases: Array<{
    input: { relative: boolean; format: 0 | 1 | 2 | 3; parameter: number }
    byte: number
  }> = [
    { input: { relative: false, format: 0, parameter: 0 }, byte: 0x00 },
    { input: { relative: false, format: 0, parameter: 0x0f }, byte: 0x0f },
    { input: { relative: false, format: 0, parameter: 0x10 }, byte: 0x10 },
    { input: { relative: false, format: 0, parameter: 0x18 }, byte: 0x18 },
    { input: { relative: false, format: 0, parameter: 0x1f }, byte: 0x1f },
    { input: { relative: true, format: 0, parameter: 0x18 }, byte: 0x98 },
    { input: { relative: false, format: 1, parameter: 0x00 }, byte: 0x20 },
    { input: { relative: false, format: 1, parameter: 0x1e }, byte: 0x3e },
    { input: { relative: false, format: 2, parameter: 0 }, byte: 0x40 },
    { input: { relative: true, format: 2, parameter: 0 }, byte: 0xc0 },
    { input: { relative: false, format: 3, parameter: 0 }, byte: 0x60 },
    { input: { relative: true, format: 3, parameter: 0 }, byte: 0xe0 },
  ]

  for (const c of cases) {
    test(
      'compose -> 0x' + c.byte.toString(16).toUpperCase().padStart(2, '0') + ' and round-trips',
      () => {
        const byte = composeVoutMode(c.input)
        expect(byte).toBe(c.byte)
        const a = analyzeVoutMode(byte!)
        expect(a.isRelative).toBe(c.input.relative)
        expect(a.format).toBe(c.input.format)
        expect(a.parameter).toBe(
          c.input.format === 2 || c.input.format === 3 ? 0 : c.input.parameter,
        )
      },
    )
  }

  test('DIRECT / IEEE Half force parameter to 0 regardless of input', () => {
    expect(composeVoutMode({ relative: false, format: 2, parameter: 0x1f })).toBe(0x40)
    expect(composeVoutMode({ relative: true, format: 3, parameter: 0x1f })).toBe(0xe0)
  })

  test('rejects relative VID, bad format and bad parameter', () => {
    expect(composeVoutMode({ relative: true, format: 1, parameter: 0 })).toBeNull()
    expect(composeVoutMode({ relative: false, format: 4 as 0, parameter: 0 })).toBeNull()
    expect(composeVoutMode({ relative: false, format: 0, parameter: 32 })).toBeNull()
    expect(composeVoutMode({ relative: false, format: 0, parameter: -1 })).toBeNull()
    expect(composeVoutMode({ relative: false, format: 0, parameter: 1.5 })).toBeNull()
  })

  test('LINEAR encode/decode covers the full signed N range -16..15', () => {
    for (let n = -16; n <= 15; n++) {
      const param = n & 0x1f
      const byte = composeVoutMode({ relative: false, format: 0, parameter: param })
      expect(analyzeVoutMode(byte!).linearExponent).toBe(n)
    }
  })
})
