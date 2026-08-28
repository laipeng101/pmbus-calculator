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
      reason: 'absolute-vid-listed-reserved',
      vidKind: 'listed-reserved',
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
        // Coarse status: listed/unlisted reserved codes share the 'reserved'
        // verdict; the provenance split lives on vidCode.kind (v2.5.6).
        const expectedStatus = a.isRelative
          ? 'invalid-combination'
          : a.vidCode?.kind === 'not-used'
            ? 'not-used'
            : a.vidCode?.kind === 'profile-required'
              ? 'profile-required'
              : 'reserved'
        expect(a.status).toBe(expectedStatus)
      } else {
        expect(a.linearExponent).toBeNull()
        expect(a.status).toBe(a.parameter === 0 ? 'valid' : 'invalid-parameter')
      }
      // A "valid" byte is never a VID format (VID is classified, never "valid").
      if (a.status === 'valid') expect(a.format).not.toBe(1)
    }
  })

  // v2.5.6: the unused, contradictory `isLegal` field was removed. Structural
  // legality is owned solely by resolveVoutModeRequirement().structureLegal
  // (src/app/vout-mode-requirements.ts), which reads 'valid' AND
  // 'profile-required' as legal — so 0x3E/0x3F can never again be reported
  // illegal by one field and legal by another.
})

describe('analyzeVoutMode — non-byte inputs are explicit, never silently masked', () => {
  for (const bad of [NaN, Infinity, -Infinity, -1, 256, 1.5, -0.5]) {
    test(String(bad) + ' -> invalid-input', () => {
      const a = analyzeVoutMode(bad)
      expect(a.status).toBe('invalid-input')
      expect(a.reason).toBe('input-not-a-byte')
    })
  }
})

describe('classifyVidCode — §8.4.2 Table 3 provenance classes (v2.5.6)', () => {
  test('00h is not-used', () => expect(classifyVidCode(0).kind).toBe('not-used'))
  test('1Eh/1Fh are profile-required', () => {
    expect(classifyVidCode(0x1e).kind).toBe('profile-required')
    expect(classifyVidCode(0x1f).kind).toBe('profile-required')
  })
  test('01h..04h are listed-reserved for a future Intel processor generation', () => {
    for (const code of [0x01, 0x02, 0x03, 0x04]) {
      const info = classifyVidCode(code)
      expect(info.kind, '0x' + code.toString(16)).toBe('listed-reserved')
      expect(info.reservedFamily, '0x' + code.toString(16)).toBe('intel-future')
      expect(info.reservedReason, '0x' + code.toString(16)).toBe('留给未来 Intel 处理器')
    }
  })
  test('10h..11h are listed-reserved for a future AMD processor generation', () => {
    for (const code of [0x10, 0x11]) {
      const info = classifyVidCode(code)
      expect(info.kind, '0x' + code.toString(16)).toBe('listed-reserved')
      expect(info.reservedFamily, '0x' + code.toString(16)).toBe('amd-future')
      expect(info.reservedReason, '0x' + code.toString(16)).toBe('留给未来 AMD 处理器')
    }
  })
  test('1Ch..1Dh are listed-reserved for future use', () => {
    for (const code of [0x1c, 0x1d]) {
      const info = classifyVidCode(code)
      expect(info.kind, '0x' + code.toString(16)).toBe('listed-reserved')
      expect(info.reservedFamily, '0x' + code.toString(16)).toBe('future-use')
      expect(info.reservedReason, '0x' + code.toString(16)).toBe('留作未来使用')
    }
  })
  test('05h..0Fh and 12h..1Bh are unlisted-reserved (absent from Table 3)', () => {
    for (const code of [
      0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x12, 0x13, 0x14, 0x15,
      0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b,
    ]) {
      const info = classifyVidCode(code)
      expect(info.kind, '0x' + code.toString(16)).toBe('unlisted-reserved')
      expect(info.reservedFamily, '0x' + code.toString(16)).toBeUndefined()
      expect(info.reservedReason, '0x' + code.toString(16)).toBeUndefined()
    }
  })
  test('exhaustive 0..31: every code lands in exactly one provenance class', () => {
    for (let code = 0; code <= 31; code++) {
      const info = classifyVidCode(code)
      const expected: string =
        code === 0x00
          ? 'not-used'
          : code === 0x1e || code === 0x1f
            ? 'profile-required'
            : (code >= 0x01 && code <= 0x04) ||
                (code >= 0x10 && code <= 0x11) ||
                (code >= 0x1c && code <= 0x1d)
              ? 'listed-reserved'
              : 'unlisted-reserved'
      expect(info.kind, '0x' + code.toString(16)).toBe(expected)
    }
  })
  test('labels never call a listed-reserved code unlisted and vice versa', () => {
    for (let code = 0; code <= 31; code++) {
      const info = classifyVidCode(code)
      if (info.kind === 'listed-reserved') {
        expect(info.label, '0x' + code.toString(16)).toContain('Table 3 明列')
        expect(info.label, '0x' + code.toString(16)).not.toContain('未列出')
      }
      if (info.kind === 'unlisted-reserved') {
        expect(info.label, '0x' + code.toString(16)).toContain('Table 3 未列出')
      }
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

  test('every byte 0x00..0xFF is losslessly analyzable (format from bits[6:5] only)', () => {
    for (let byte = 0; byte <= 0xff; byte++) {
      const a = analyzeVoutMode(byte)
      expect(a.byte, `0x${byte.toString(16)}`).toBe(byte)
      expect(a.format, `0x${byte.toString(16)}`).toBe((byte >> 5) & 0x03)
      expect(a.isRelative, `0x${byte.toString(16)}`).toBe(((byte >> 7) & 1) === 1)
      expect(a.parameter, `0x${byte.toString(16)}`).toBe(byte & 0x1f)
    }
  })

  test('official Relative example 0x96: R = 1.099609375 = 109.9609375%', () => {
    const a = analyzeVoutMode(0x96)
    expect(a.isRelative).toBe(true)
    expect(a.format).toBe(0)
    expect(a.linearExponent).toBe(-10)
  })
})
