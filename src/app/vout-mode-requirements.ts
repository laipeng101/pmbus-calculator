import type { VoutModeAnalysis } from '../legacy/vout-mode'

/**
 * Exhaustive requirement metadata for a VOUT_MODE byte verdict (PMBus Part II
 * §7.2 / §7.4 / §7.6 / §8.3 Table 2 / §8.4.2 / §8.4.3 / §8.4.4 / §8.5.2).
 *
 * Single semantic source for the standalone VOUT_MODE page's status text,
 * InfoPanel warnings, explanations and calculation steps — no surface may
 * re-derive spec conclusions from `format` numbers or shared booleans.
 *
 * Key distinction (v2.5.4): DIRECT (bits[6:5] = 10b) needs device-specific
 * m/b/R coefficients from the COEFFICIENTS command or the product literature
 * (§7.4 / §8.4.3). IEEE Half (bits[6:5] = 11b) is standard IEEE 754 binary16
 * (§7.6 / §8.4.4): bit15 sign, bits[14:10] exponent, bits[9:0] mantissa — its
 * word ↔ value conversion needs no device coefficients, no VID code list and
 * no product profile. Only a relative byte needs a VOUT_COMMAND nominal
 * reference to obtain final volts (§8.5.2), for any format. §7.2 additionally
 * makes Half and LINEAR/DIRECT mutually exclusive per device — a device-level
 * adoption rule documented in DOMAIN_MODEL, not a per-byte decode condition.
 *
 * v2.5.5 separates structural legality from calculability: VID Code Types
 * 1Eh/1Fh are explicitly listed in §8.4.2 Table 3 as PMBus device
 * manufacturer specific — the byte is a STRUCTURALLY LEGAL configuration
 * (`structureLegal: true`) whose voltage mapping must come from the product
 * literature (`requiresVidProfile: true`), so it is legal-but-needs-external-
 * data, never reserved or illegal. `00h` (Not Used) and unlisted codes
 * (reserved) remain non-usable configurations (`structureLegal: false`).
 */
export interface VoutModeRequirement {
  /** Machine-testable discriminator; exhaustive over the byte space. */
  id:
    | 'linear-absolute'
    | 'linear-relative'
    | 'direct-absolute'
    | 'direct-relative'
    | 'half-absolute'
    | 'half-relative'
    | 'vid-relative-invalid'
    | 'direct-or-half-param-invalid'
    | 'vid-not-used'
    | 'vid-reserved-listed'
    | 'vid-reserved-unlisted'
    | 'vid-profile-required'
    | 'invalid-input'
  /**
   * The byte is a structurally legal PMBus VOUT_MODE configuration
   * (§8.3 / §8.4.2 Table 3). Orthogonal to calculability: 1Eh/1Fh are legal
   * but not calculable without the device VID table. Never reuse this flag
   * for "needs external data" — that is `requiresDeviceCoefficients` /
   * `requiresVidProfile`.
   */
  structureLegal: boolean
  /** Word ↔ physical conversion needs device m/b/R coefficients (§7.4). */
  requiresDeviceCoefficients: boolean
  /** Voltage mapping needs a device VID code list / product profile (§8.4.2). */
  requiresVidProfile: boolean
  /** Final volts need a VOUT_COMMAND nominal reference (§8.5.2). */
  requiresNominalReference: boolean
  /** Payload is standard IEEE 754 binary16 — no device numbers involved. */
  standardBinary16: boolean
}

const LINEAR_ABSOLUTE: VoutModeRequirement = {
  id: 'linear-absolute',
  structureLegal: true,
  requiresDeviceCoefficients: false,
  requiresVidProfile: false,
  requiresNominalReference: false,
  standardBinary16: false,
}

const LINEAR_RELATIVE: VoutModeRequirement = {
  ...LINEAR_ABSOLUTE,
  id: 'linear-relative',
  requiresNominalReference: true,
}

const DIRECT_ABSOLUTE: VoutModeRequirement = {
  id: 'direct-absolute',
  structureLegal: true,
  requiresDeviceCoefficients: true,
  requiresVidProfile: false,
  requiresNominalReference: false,
  standardBinary16: false,
}

const DIRECT_RELATIVE: VoutModeRequirement = {
  ...DIRECT_ABSOLUTE,
  id: 'direct-relative',
  requiresNominalReference: true,
}

const HALF_ABSOLUTE: VoutModeRequirement = {
  id: 'half-absolute',
  structureLegal: true,
  requiresDeviceCoefficients: false,
  requiresVidProfile: false,
  requiresNominalReference: false,
  standardBinary16: true,
}

const HALF_RELATIVE: VoutModeRequirement = {
  ...HALF_ABSOLUTE,
  id: 'half-relative',
  requiresNominalReference: true,
}

const VID_RELATIVE_INVALID: VoutModeRequirement = {
  id: 'vid-relative-invalid',
  structureLegal: false,
  requiresDeviceCoefficients: false,
  requiresVidProfile: false,
  requiresNominalReference: false,
  standardBinary16: false,
}

const DIRECT_OR_HALF_PARAM_INVALID: VoutModeRequirement = {
  id: 'direct-or-half-param-invalid',
  structureLegal: false,
  requiresDeviceCoefficients: false,
  requiresVidProfile: false,
  requiresNominalReference: false,
  standardBinary16: false,
}

const VID_NOT_USED: VoutModeRequirement = {
  id: 'vid-not-used',
  structureLegal: false,
  requiresDeviceCoefficients: false,
  requiresVidProfile: false,
  requiresNominalReference: false,
  standardBinary16: false,
}

const VID_RESERVED_LISTED: VoutModeRequirement = {
  ...VID_NOT_USED,
  id: 'vid-reserved-listed',
}

const VID_RESERVED_UNLISTED: VoutModeRequirement = {
  ...VID_NOT_USED,
  id: 'vid-reserved-unlisted',
}

const VID_PROFILE_REQUIRED: VoutModeRequirement = {
  id: 'vid-profile-required',
  structureLegal: true,
  requiresDeviceCoefficients: false,
  requiresVidProfile: true,
  requiresNominalReference: false,
  standardBinary16: false,
}

const INVALID_INPUT: VoutModeRequirement = {
  id: 'invalid-input',
  structureLegal: false,
  requiresDeviceCoefficients: false,
  requiresVidProfile: false,
  requiresNominalReference: false,
  standardBinary16: false,
}

/**
 * Total, pure resolver over the analyzer verdict. Every legal DIRECT byte
 * demands m/b/R; every legal IEEE Half byte never does — the two formats
 * share no requirement surface.
 */
export function resolveVoutModeRequirement(a: VoutModeAnalysis): VoutModeRequirement {
  switch (a.status) {
    case 'valid':
      if (a.format === 0) return a.isRelative ? LINEAR_RELATIVE : LINEAR_ABSOLUTE
      if (a.format === 2) return a.isRelative ? DIRECT_RELATIVE : DIRECT_ABSOLUTE
      return a.isRelative ? HALF_RELATIVE : HALF_ABSOLUTE
    case 'invalid-combination':
      return VID_RELATIVE_INVALID
    case 'invalid-parameter':
      return DIRECT_OR_HALF_PARAM_INVALID
    case 'not-used':
      return VID_NOT_USED
    case 'reserved':
      // v2.5.6 provenance split: codes PRINTED in §8.4.2 Table 3 (01h..04h
      // Intel, 10h..11h AMD, 1Ch..1Dh future use) are listed-reserved; every
      // other code is absent from Table 3. Both stay non-usable
      // configurations, but user-facing reason text must never conflate them.
      return a.vidCode?.kind === 'listed-reserved' ? VID_RESERVED_LISTED : VID_RESERVED_UNLISTED
    case 'profile-required':
      return VID_PROFILE_REQUIRED
    case 'invalid-input':
      return INVALID_INPUT
  }
}
