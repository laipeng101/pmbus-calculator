/**
 * Canonical L16/VOUT semantic facts — classification contract of
 * `deriveL16Semantics` (ADR 0006). One case per matrix row of
 * l16-semantic-matrix.test.ts: these tests lock WHAT the facts say for each
 * domain state; the matrix file locks what every surface renders from them.
 */
import { describe, test, expect } from 'vitest'
import { deriveL16Semantics } from './l16-derivation'
import type { AppState } from './state'

const BASE: AppState = {
  mode: 'L16',
  raw: 0x0c00,
  commandKey: null,
  voutMode: { byte: 0x18 },
  l11: { n: 0, y: 0, autoN: true, valueInput: null },
  valueRequest: null,
  l16: { payloadKind: 'ulinear16', nominalVout: null },
  direct: { m: 1, b: 0, r: 0, errors: { m: null, b: null, r: null } },
  copy: { prefix0x: true, spaceBetweenBytes: true },
  ui: { theme: 'system', debugOpen: false },
}

function make(overrides: Partial<AppState> = {}): AppState {
  return { ...BASE, ...overrides }
}

describe('deriveL16Semantics — interpretation kinds', () => {
  test('case 1: absolute LINEAR → absolute-unsigned with N from the shared byte', () => {
    const facts = deriveL16Semantics(BASE)
    expect(facts.source).toBe('linked')
    expect(facts.analysis.format).toBe(0)
    expect(facts.analysis.isRelative).toBe(false)
    expect(facts.interpretation).toEqual({ kind: 'absolute-unsigned', n: -8, value: 12 })
    expect(facts.payloadContext.physicalInputAvailable).toBe(true)
    expect(facts.payloadContext.requiresNominalReference).toBe(false)
  })

  test('case 2/6: relative + finite nominal → ratio fact and finite final voltage', () => {
    const facts = deriveL16Semantics(
      make({
        voutMode: { byte: 0x83 },
        raw: 0x0002,
        l16: { payloadKind: 'ulinear16', nominalVout: 5 },
      }),
    )
    expect(facts.source).toBe('linked')
    expect(facts.analysis.isRelative).toBe(true)
    expect(facts.interpretation).toEqual({
      kind: 'relative-ratio',
      n: 3,
      ratio: 16,
      nominal: 5,
      finalVoltage: { kind: 'finite', value: 80 },
    })
    expect(facts.payloadContext.requiresNominalReference).toBe(true)
  })

  test('case 3: missing nominal → missing-reference, not zero', () => {
    const facts = deriveL16Semantics(make({ voutMode: { byte: 0x83 }, raw: 0x0002 }))
    expect(facts.interpretation).toMatchObject({
      kind: 'relative-ratio',
      ratio: 16,
      nominal: null,
      finalVoltage: { kind: 'missing-reference' },
    })
  })

  test('case 4: nominal = 0 → finite zero (distinct from missing and underflow)', () => {
    const facts = deriveL16Semantics(
      make({
        voutMode: { byte: 0x83 },
        raw: 0x0002,
        l16: { payloadKind: 'ulinear16', nominalVout: 0 },
      }),
    )
    expect(facts.interpretation).toMatchObject({
      kind: 'relative-ratio',
      ratio: 16,
      nominal: 0,
      finalVoltage: { kind: 'finite', value: 0 },
    })
  })

  test('case 5: ratio = 0 → finite fact carrying the exact zero ratio', () => {
    const facts = deriveL16Semantics(
      make({
        voutMode: { byte: 0x83 },
        raw: 0x0000,
        l16: { payloadKind: 'ulinear16', nominalVout: 5 },
      }),
    )
    expect(facts.interpretation).toMatchObject({
      kind: 'relative-ratio',
      ratio: 0,
      finalVoltage: { kind: 'finite', value: 0 },
    })
  })

  test('case 7: relative overflow → overflow final voltage, inputs preserved', () => {
    const facts = deriveL16Semantics(
      make({
        voutMode: { byte: 0x83 },
        raw: 0x0002,
        l16: { payloadKind: 'ulinear16', nominalVout: 1e308 },
      }),
    )
    expect(facts.interpretation).toMatchObject({
      kind: 'relative-ratio',
      ratio: 16,
      nominal: 1e308,
      finalVoltage: { kind: 'overflow' },
    })
  })

  test('case 8: nonzero-factor underflow → underflow final voltage', () => {
    const facts = deriveL16Semantics(
      make({
        voutMode: { byte: 0x90 },
        raw: 0x0001,
        l16: { payloadKind: 'ulinear16', nominalVout: 1e-320 },
      }),
    )
    expect(facts.interpretation).toMatchObject({
      kind: 'relative-ratio',
      n: -16,
      ratio: 1.52587890625e-5,
      finalVoltage: { kind: 'underflow' },
    })
  })

  test('case 9: signed offset payload → signed-offset fact on any LINEAR byte', () => {
    const absolute = deriveL16Semantics(
      make({ raw: 0xffff, l16: { payloadKind: 'slinear16-offset', nominalVout: null } }),
    )
    expect(absolute.interpretation).toEqual({
      kind: 'signed-offset',
      n: -8,
      y: -1,
      value: -0.00390625,
    })

    const relativeByte = deriveL16Semantics(
      make({
        voutMode: { byte: 0x98 },
        raw: 0xffff,
        l16: { payloadKind: 'slinear16-offset', nominalVout: null },
      }),
    )
    // bit7 is not part of the signed payload's math: same interpretation.
    expect(relativeByte.interpretation).toEqual({
      kind: 'signed-offset',
      n: -8,
      y: -1,
      value: -0.00390625,
    })
    expect(relativeByte.payloadContext.relativeRatio).toBe(false)
  })
})

describe('deriveL16Semantics — non-LINEAR fail-closed facts (§8.4 family)', () => {
  test.each([
    { label: 'VID not-used', byte: 0x20, status: 'vid-profile-required' },
    { label: 'VID 1Eh manufacturer', byte: 0x3e, status: 'vid-profile-required' },
    { label: 'DIRECT', byte: 0x40, status: 'direct-profile-required' },
    { label: 'IEEE Half', byte: 0x60, status: 'half-unsupported-in-l16' },
    { label: 'DIRECT nonzero param', byte: 0x41, status: 'reserved-or-invalid' },
    { label: 'Half nonzero param', byte: 0x61, status: 'reserved-or-invalid' },
    { label: 'relative VID', byte: 0xa0, status: 'vid-relative-invalid' },
  ] as const)('case 10-14: $label 0x$byte → non-linear with reason $status', ({ byte, status }) => {
    const facts = deriveL16Semantics(make({ voutMode: { byte } }))
    expect(facts.source).toBe('non-linear')
    expect(facts.interpretation).toEqual({ kind: 'non-linear' })
    expect(facts.payloadContext.semantics.status).toBe(status)
    expect(facts.payloadContext.physicalInputAvailable).toBe(false)
    // The byte truth is the actual shared byte — never a substituted 0x18.
    expect(facts.analysis.byte).toBe(byte)
  })

  test('case 10b: VID 1Eh stays structurally legal while requiring device data', () => {
    const facts = deriveL16Semantics(make({ voutMode: { byte: 0x3e } }))
    expect(facts.analysis.vidCode?.kind).toBe('profile-required')
    expect(facts.payloadContext.semantics.status).toBe('vid-profile-required')
  })

  test('case 13: signed-offset request on an absolute VID byte is prohibited (§13.3/§13.4)', () => {
    const facts = deriveL16Semantics(
      make({
        voutMode: { byte: 0x20 },
        l16: { payloadKind: 'slinear16-offset', nominalVout: null },
      }),
    )
    expect(facts.payloadContext.semantics.status).toBe('vid-offset-prohibited')
    expect(facts.interpretation).toEqual({ kind: 'non-linear' })
  })
})

describe('deriveL16Semantics — canonical single-source invariants', () => {
  test('exponent N comes only from the shared byte analysis (no second store)', () => {
    const facts = deriveL16Semantics(make({ voutMode: { byte: 0x18 }, raw: 0x0001 }))
    if (facts.interpretation.kind === 'non-linear') throw new Error('unreachable')
    expect(facts.interpretation.n).toBe(facts.analysis.linearExponent)
  })

  test('is total over every state without throwing', () => {
    expect(() => deriveL16Semantics(make({ raw: 0xffff, voutMode: { byte: 0xff } }))).not.toThrow()
    const facts = deriveL16Semantics(make({ voutMode: { byte: 0xff } }))
    expect(facts.interpretation.kind).toBe('non-linear')
  })
})
