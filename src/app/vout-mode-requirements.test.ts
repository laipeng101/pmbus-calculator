import { describe, expect, it } from 'vitest'
import { analyzeVoutMode } from '../legacy/vout-mode'
import { resolveVoutModeRequirement } from './vout-mode-requirements'

/**
 * Truth matrix from PMBus Part II §7.2 / §7.4 / §7.6 / §8.3 (Table 2) /
 * §8.4.3 / §8.4.4 / §8.5.2 (v2.5.4): DIRECT needs device m/b/R; IEEE Half is
 * standard binary16 and never does; only relative bytes need a VOUT_COMMAND
 * nominal reference.
 */
const TRUTH_ROWS: Array<{
  byte: number
  id: string
  requiresDeviceCoefficients: boolean
  requiresVidProfile: boolean
  requiresNominalReference: boolean
  standardBinary16: boolean
}> = [
  // absolute/relative LINEAR
  {
    byte: 0x18,
    id: 'linear-absolute',
    requiresDeviceCoefficients: false,
    requiresVidProfile: false,
    requiresNominalReference: false,
    standardBinary16: false,
  },
  {
    byte: 0x98,
    id: 'linear-relative',
    requiresDeviceCoefficients: false,
    requiresVidProfile: false,
    requiresNominalReference: true,
    standardBinary16: false,
  },
  // absolute/relative DIRECT — always device coefficients
  {
    byte: 0x40,
    id: 'direct-absolute',
    requiresDeviceCoefficients: true,
    requiresVidProfile: false,
    requiresNominalReference: false,
    standardBinary16: false,
  },
  {
    byte: 0xc0,
    id: 'direct-relative',
    requiresDeviceCoefficients: true,
    requiresVidProfile: false,
    requiresNominalReference: true,
    standardBinary16: false,
  },
  // absolute/relative IEEE Half — never device coefficients
  {
    byte: 0x60,
    id: 'half-absolute',
    requiresDeviceCoefficients: false,
    requiresVidProfile: false,
    requiresNominalReference: false,
    standardBinary16: true,
  },
  {
    byte: 0xe0,
    id: 'half-relative',
    requiresDeviceCoefficients: false,
    requiresVidProfile: false,
    requiresNominalReference: true,
    standardBinary16: true,
  },
  // non-zero DIRECT/Half parameters are invalid structures (§8.3 Table 2)
  {
    byte: 0x41,
    id: 'direct-or-half-param-invalid',
    requiresDeviceCoefficients: false,
    requiresVidProfile: false,
    requiresNominalReference: false,
    standardBinary16: false,
  },
  {
    byte: 0x61,
    id: 'direct-or-half-param-invalid',
    requiresDeviceCoefficients: false,
    requiresVidProfile: false,
    requiresNominalReference: false,
    standardBinary16: false,
  },
  {
    byte: 0xe1,
    id: 'direct-or-half-param-invalid',
    requiresDeviceCoefficients: false,
    requiresVidProfile: false,
    requiresNominalReference: false,
    standardBinary16: false,
  },
  // VID classifications — 01h is a Table-3-LISTED reserved code (v2.5.6)
  {
    byte: 0x20,
    id: 'vid-not-used',
    requiresDeviceCoefficients: false,
    requiresVidProfile: false,
    requiresNominalReference: false,
    standardBinary16: false,
  },
  {
    byte: 0x21,
    id: 'vid-reserved-listed',
    requiresDeviceCoefficients: false,
    requiresVidProfile: false,
    requiresNominalReference: false,
    standardBinary16: false,
  },
  {
    byte: 0x25,
    id: 'vid-reserved-unlisted',
    requiresDeviceCoefficients: false,
    requiresVidProfile: false,
    requiresNominalReference: false,
    standardBinary16: false,
  },
  {
    byte: 0x3e,
    id: 'vid-profile-required',
    requiresDeviceCoefficients: false,
    requiresVidProfile: true,
    requiresNominalReference: false,
    standardBinary16: false,
  },
  // relative VID is an invalid combination (§8.5.3)
  {
    byte: 0xa0,
    id: 'vid-relative-invalid',
    requiresDeviceCoefficients: false,
    requiresVidProfile: false,
    requiresNominalReference: false,
    standardBinary16: false,
  },
]

describe('resolveVoutModeRequirement (v2.5.4 discriminated truth matrix)', () => {
  for (const t of TRUTH_ROWS) {
    it(`0x${t.byte.toString(16).toUpperCase().padStart(2, '0')} → ${t.id}`, () => {
      const req = resolveVoutModeRequirement(analyzeVoutMode(t.byte))
      expect(req.id).toBe(t.id)
      expect(req.requiresDeviceCoefficients).toBe(t.requiresDeviceCoefficients)
      expect(req.requiresVidProfile).toBe(t.requiresVidProfile)
      expect(req.requiresNominalReference).toBe(t.requiresNominalReference)
      expect(req.standardBinary16).toBe(t.standardBinary16)
    })
  }

  it('exhaustive over all 256 bytes and never marks IEEE Half as profile-dependent', () => {
    for (let byte = 0; byte <= 0xff; byte++) {
      const req = resolveVoutModeRequirement(analyzeVoutMode(byte))
      expect(req.id, `byte 0x${byte.toString(16)}`).toBeTruthy()
      const isHalfFormat = ((byte >> 5) & 0x03) === 3
      if (isHalfFormat) {
        // No IEEE Half byte ever depends on device numbers: legal Half bytes
        // are standard binary16; illegal ones are invalid structures.
        expect(req.requiresDeviceCoefficients, `byte 0x${byte.toString(16)}`).toBe(false)
        expect(req.requiresVidProfile, `byte 0x${byte.toString(16)}`).toBe(false)
        expect(req.standardBinary16, `byte 0x${byte.toString(16)}`).toBe(
          req.id === 'half-absolute' || req.id === 'half-relative',
        )
      }
      if (req.id === 'direct-absolute' || req.id === 'direct-relative') {
        expect(req.requiresDeviceCoefficients, `byte 0x${byte.toString(16)}`).toBe(true)
      }
    }
  })
})

/**
 * v2.5.5: structural legality, calculability and the external-data question
 * are three ORTHOGONAL verdicts. §8.4.2 Table 3 lists 1Eh/1Fh as PMBus device
 * manufacturer specific VID Code Types — structurally legal bytes whose
 * voltage mapping must come from the product literature. 00h (Not Used) and
 * unlisted (reserved) codes stay non-usable configurations.
 */
describe('resolveVoutModeRequirement structureLegal vs calculability (v2.5.5)', () => {
  it('0x3E/0x3F are structurally legal, not calculable, and require the VID profile', () => {
    for (const byte of [0x3e, 0x3f]) {
      const req = resolveVoutModeRequirement(analyzeVoutMode(byte))
      expect(req.id, `byte 0x${byte.toString(16)}`).toBe('vid-profile-required')
      expect(req.structureLegal, `byte 0x${byte.toString(16)}`).toBe(true)
      expect(req.requiresVidProfile, `byte 0x${byte.toString(16)}`).toBe(true)
      // Legal structure ≠ calculable byte: no device table, no conversion.
      expect(req.requiresDeviceCoefficients, `byte 0x${byte.toString(16)}`).toBe(false)
      expect(req.requiresNominalReference, `byte 0x${byte.toString(16)}`).toBe(false)
    }
  })

  it('00h Not Used and reserved codes remain non-usable configurations', () => {
    // VID-format bytes 0x20|code: 00h not-used; listed-reserved codes
    // (01h..04h Intel, 10h..11h AMD, 1Ch..1Dh future use) and unlisted codes
    // are all reserved, non-usable configurations (v2.5.6 provenance split).
    for (const byte of [0x20, 0x21, 0x24, 0x30, 0x31, 0x3c, 0x3d, 0x25, 0x32, 0x3b]) {
      const req = resolveVoutModeRequirement(analyzeVoutMode(byte))
      expect(req.structureLegal, `byte 0x${byte.toString(16)}`).toBe(false)
      expect(req.requiresVidProfile, `byte 0x${byte.toString(16)}`).toBe(false)
      expect(
        req.id === 'vid-not-used' ||
          req.id === 'vid-reserved-listed' ||
          req.id === 'vid-reserved-unlisted',
        `0x${byte.toString(16)}`,
      ).toBe(true)
    }
  })

  it('0..255 exhaustive separation of structure legality, calculability and external data', () => {
    for (let byte = 0; byte <= 0xff; byte++) {
      const a = analyzeVoutMode(byte)
      const req = resolveVoutModeRequirement(a)
      const hex = `byte 0x${byte.toString(16).padStart(2, '0')}`

      // Structural legality: valid verdicts plus the Table-3-listed
      // manufacturer-specific VID codes, nothing else.
      const expectedStructureLegal = a.status === 'valid' || a.status === 'profile-required'
      expect(req.structureLegal, hex).toBe(expectedStructureLegal)

      // External data: DIRECT needs m/b/R; profile-required VID needs the
      // device table; no byte needs both; no illegal byte needs either.
      expect(req.requiresDeviceCoefficients && req.requiresVidProfile, hex).toBe(false)
      if (!req.structureLegal) {
        expect(req.requiresDeviceCoefficients || req.requiresVidProfile, hex).toBe(false)
      }

      // Relative-only nominal reference, and only on legal structures.
      expect(req.requiresNominalReference, hex).toBe(a.isRelative && req.structureLegal)

      // standardBinary16 exactly on legal Half bytes.
      expect(req.standardBinary16, hex).toBe(
        req.id === 'half-absolute' || req.id === 'half-relative',
      )
    }
  })

  it('absolute VID bytes 0x20..0x3F map every Table 3 code to its provenance id', () => {
    const expectedId = (code: number): string => {
      if (code === 0x00) return 'vid-not-used'
      if (code === 0x1e || code === 0x1f) return 'vid-profile-required'
      if (
        (code >= 0x01 && code <= 0x04) ||
        (code >= 0x10 && code <= 0x11) ||
        (code >= 0x1c && code <= 0x1d)
      ) {
        return 'vid-reserved-listed'
      }
      return 'vid-reserved-unlisted'
    }
    for (let code = 0; code <= 0x1f; code++) {
      const byte = 0x20 | code
      const req = resolveVoutModeRequirement(analyzeVoutMode(byte))
      expect(req.id, `byte 0x${byte.toString(16).padStart(2, '0')}`).toBe(expectedId(code))
      // Listed-reserved text surfaces must never be able to claim "unlisted":
      // the machine kind carries the provenance.
      const kind = analyzeVoutMode(byte).vidCode?.kind
      if (expectedId(code) === 'vid-reserved-listed') {
        expect(kind, `byte 0x${byte.toString(16).padStart(2, '0')}`).toBe('listed-reserved')
      }
      if (expectedId(code) === 'vid-reserved-unlisted') {
        expect(kind, `byte 0x${byte.toString(16).padStart(2, '0')}`).toBe('unlisted-reserved')
      }
    }
  })
})
