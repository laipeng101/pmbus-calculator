import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import type { AppState } from './state'
import { INITIAL_STATE } from './state'
import {
  loadPersistedState,
  persistByteOrder,
  persistCopy,
  persistMode,
  persistTheme,
} from './persistence'

const KEYS = {
  theme: 'pmbus-calculator:theme',
  mode: 'pmbus-calculator:mode',
  byteOrder: 'pmbus-calculator:byteOrder',
  copy: 'pmbus-calculator:copy',
} as const

function makeStore(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial))
  return {
    store,
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, String(value))
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key)
    }),
  }
}

type MockStore = ReturnType<typeof makeStore>

function installStorage(store: MockStore) {
  vi.stubGlobal('localStorage', {
    getItem: store.getItem,
    setItem: store.setItem,
    removeItem: store.removeItem,
  })
}

function baseState(): AppState {
  return structuredClone(INITIAL_STATE)
}

describe('persistence', () => {
  let store: MockStore

  beforeEach(() => {
    store = makeStore()
    installStorage(store)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('loadPersistedState', () => {
    it('falls back to base state when storage is empty', () => {
      const base = baseState()
      expect(loadPersistedState(base)).toEqual(base)
    })

    it('restores mode, theme, byteOrder, and copy preferences', () => {
      store.store.set(KEYS.mode, 'L16')
      store.store.set(KEYS.theme, 'dark')
      store.store.set(KEYS.byteOrder, 'be')
      store.store.set(
        KEYS.copy,
        JSON.stringify({ prefix0x: false, spaceBetweenBytes: false, endian: 'be' }),
      )
      const s = loadPersistedState(baseState())
      expect(s.mode).toBe('L16')
      expect(s.ui.theme).toBe('dark')
      expect(s.byteOrder).toBe('be')
      expect(s.copy).toEqual({ prefix0x: false, spaceBetweenBytes: false, endian: 'be' })
    })

    it('restores prefix/space/endian settings after a simulated reload', () => {
      const first = loadPersistedState(baseState())
      persistCopy({ ...first.copy, prefix0x: false, spaceBetweenBytes: false, endian: 'be' })
      const second = loadPersistedState(baseState())
      expect(second.copy.prefix0x).toBe(false)
      expect(second.copy.spaceBetweenBytes).toBe(false)
      expect(second.copy.endian).toBe('be')
    })

    it('restores the VOUT_MODE mode key', () => {
      store.store.set(KEYS.mode, 'VOUT_MODE')
      const s = loadPersistedState(baseState())
      expect(s.mode).toBe('VOUT_MODE')
    })

    it('ignores invalid JSON for the copy preference', () => {
      store.store.set(KEYS.copy, '{not-json')
      store.store.set(KEYS.mode, 'L16')
      const s = loadPersistedState(baseState())
      expect(s.copy).toEqual(baseState().copy)
      expect(s.mode).toBe('L16')
    })

    it('fills missing copy fields from the base state', () => {
      store.store.set(KEYS.copy, JSON.stringify({ prefix0x: false }))
      const base = baseState()
      const s = loadPersistedState(base)
      expect(s.copy.prefix0x).toBe(false)
      expect(s.copy.spaceBetweenBytes).toBe(base.copy.spaceBetweenBytes)
      expect(s.copy.endian).toBe(base.copy.endian)
    })

    it('ignores invalid enum values for mode, theme, byteOrder, and copy.endian', () => {
      store.store.set(KEYS.mode, 'L99')
      store.store.set(KEYS.theme, 'blue')
      store.store.set(KEYS.byteOrder, 'middle')
      store.store.set(KEYS.copy, JSON.stringify({ endian: 'middle', prefix0x: 'yes' }))
      const s = loadPersistedState(baseState())
      expect(s.mode).toBe(baseState().mode)
      expect(s.ui.theme).toBe(baseState().ui.theme)
      expect(s.byteOrder).toBe(baseState().byteOrder)
      expect(s.copy.endian).toBe(baseState().copy.endian)
      expect(s.copy.prefix0x).toBe(baseState().copy.prefix0x)
    })

    it('ignores legacy/unknown persisted keys and still loads valid fields', () => {
      store.store.set(KEYS.mode, 'DIRECT')
      store.store.set('pmbus-calculator:legacy:raw', '999')
      const s = loadPersistedState(baseState())
      expect(s.mode).toBe('DIRECT')
      expect(s.raw).toBe(baseState().raw)
    })

    it('does not pollute base state with invalid persisted data', () => {
      store.store.set(KEYS.mode, 'NOT_A_MODE')
      store.store.set(KEYS.copy, '"not-an-object"')
      const s = loadPersistedState(baseState())
      expect(s).toEqual(baseState())
    })

    it('returns base state when getItem throws', () => {
      vi.stubGlobal('localStorage', {
        getItem: vi.fn(() => {
          throw new Error('storage blocked')
        }),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      })
      expect(loadPersistedState(baseState())).toEqual(baseState())
    })

    it('returns base state when storage is unavailable (SSR-style global undefined)', () => {
      vi.stubGlobal('localStorage', undefined)
      expect(loadPersistedState(baseState())).toEqual(baseState())
    })
  })

  describe('persist helpers', () => {
    it('persistTheme writes the theme key', () => {
      persistTheme('dark')
      expect(store.setItem).toHaveBeenCalledWith(KEYS.theme, 'dark')
    })

    it('persistMode writes the mode key', () => {
      persistMode('HALF')
      expect(store.setItem).toHaveBeenCalledWith(KEYS.mode, 'HALF')
    })

    it('persistByteOrder writes the byteOrder key', () => {
      persistByteOrder('be')
      expect(store.setItem).toHaveBeenCalledWith(KEYS.byteOrder, 'be')
    })

    it('persistCopy writes JSON copy preferences', () => {
      const copy = { prefix0x: false, spaceBetweenBytes: true, endian: 'le' } as const
      persistCopy(copy)
      expect(store.setItem).toHaveBeenCalledWith(KEYS.copy, JSON.stringify(copy))
    })

    it('persist helpers do not throw when setItem throws', () => {
      vi.stubGlobal('localStorage', {
        getItem: vi.fn(() => null),
        setItem: vi.fn(() => {
          throw new Error('quota exceeded')
        }),
        removeItem: vi.fn(),
      })
      expect(() => {
        persistTheme('dark')
        persistMode('L16')
        persistByteOrder('be')
        persistCopy({ prefix0x: true, spaceBetweenBytes: true, endian: 'le' })
      }).not.toThrow()
    })
  })
})
