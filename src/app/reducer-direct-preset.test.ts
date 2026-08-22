import { describe, it, expect, vi } from 'vitest'

// Isolate the DIRECT preset path without adding a built-in DIRECT profile to
// the production command metadata (hard constraint: no datasheet-backed
// profile, no fabricated DIRECT presets).
vi.mock('../legacy/command-metadata', () => {
  return {
    getCommandConfig: (key: string | null) =>
      key === 'TEST_DIRECT'
        ? {
            key: 'TEST_DIRECT',
            label: 'TEST_DIRECT',
            cmd: 0x00,
            transactions: { write: { type: 'write_word', dataBytes: 2 } },
            valueType: 'scalar',
            units: '—',
            spec: 'test fixture',
            encodingRule: 'device_defined',
            preset: {
              mode: 'DIRECT',
              value: 5,
              m: 2,
              b: 0,
              R: 0,
              sourceKind: 'project-demo',
              source: 'test',
              appliesTo: 'test fixture only',
              direction: 'write',
            },
          }
        : null,
  }
})

import { appReducer } from './reducer'
import { INITIAL_STATE } from './state'

describe('appReducer — DIRECT preset error clearing (mocked metadata)', () => {
  it('applying a valid DIRECT preset clears the previous coefficient error', () => {
    const bad = appReducer(INITIAL_STATE, {
      type: 'direct/set-coeff',
      name: 'm',
      value: '2.5',
    })
    expect(bad.direct.errors.m).toBeTruthy()

    const applied = appReducer(bad, {
      type: 'command/apply-preset',
      commandKey: 'TEST_DIRECT',
    })

    expect(applied.mode).toBe('DIRECT')
    expect(applied.direct.errors).toEqual({ m: null, b: null, r: null })
    expect(applied.direct.m).toBe(2)
    expect(applied.direct.b).toBe(0)
    expect(applied.direct.r).toBe(0)
    // encodeDirect(5, m=2, b=0, R=0) => round((2*5 + 0) * 10^0) = 10
    expect(applied.raw).toBe(10)
  })

  it('unknown command keys are still ignored', () => {
    const s = appReducer(INITIAL_STATE, {
      type: 'command/apply-preset',
      commandKey: 'MISSING',
    })
    expect(s).toBe(INITIAL_STATE)
  })
})
