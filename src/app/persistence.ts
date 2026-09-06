/**
 * Persistence layer — the only place allowed to read/write localStorage.
 *
 * UI components and reducers must not touch localStorage directly.
 * The data is small preference state; parse failures or storage restrictions
 * fall back to the provided base state without crashing.
 *
 * v3.0.0: the `pmbus-calculator:byteOrder` key and the `copy.endian` field
 * are no longer read. Storage left by older versions stays untouched and
 * harmless: loadPersistedState picks copy fields explicitly, so stale JSON
 * properties can never leak into the state shape or reinterpret the raw word.
 */

import type { AppMode, AppState, Theme } from './state'

const KEYS = {
  theme: 'pmbus-calculator:theme',
  mode: 'pmbus-calculator:mode',
  copy: 'pmbus-calculator:copy',
  bitMappingOpen: 'pmbus-calculator:bitMappingOpen',
} as const

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Private mode or restricted storage: preferences are ephemeral.
  }
}

function isTheme(v: unknown): v is Theme {
  return v === 'light' || v === 'dark' || v === 'system'
}

function isMode(v: unknown): v is AppMode {
  return v === 'L11' || v === 'L16' || v === 'DIRECT' || v === 'HALF' || v === 'VOUT_MODE'
}

function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export function loadPersistedState(base: AppState): AppState {
  const theme = read(KEYS.theme)
  const mode = read(KEYS.mode)
  const copy = parseJson<Record<string, unknown>>(read(KEYS.copy))
  const bitMappingOpen = parseJson<Record<string, unknown>>(read(KEYS.bitMappingOpen))

  // Explicit field picking (v3.0.0): unknown or stale properties in old
  // storage (e.g. a leftover `endian` from v2.x) are ignored, never spread
  // into the state.
  return {
    ...base,
    mode: isMode(mode) ? mode : base.mode,
    copy: {
      prefix0x: typeof copy?.prefix0x === 'boolean' ? copy.prefix0x : base.copy.prefix0x,
      spaceBetweenBytes:
        typeof copy?.spaceBetweenBytes === 'boolean'
          ? copy.spaceBetweenBytes
          : base.copy.spaceBetweenBytes,
    },
    ui: {
      ...base.ui,
      theme: isTheme(theme) ? theme : base.ui.theme,
      bitMappingOpen: {
        rawWord:
          typeof bitMappingOpen?.rawWord === 'boolean'
            ? bitMappingOpen.rawWord
            : base.ui.bitMappingOpen.rawWord,
        voutMode:
          typeof bitMappingOpen?.voutMode === 'boolean'
            ? bitMappingOpen.voutMode
            : base.ui.bitMappingOpen.voutMode,
      },
    },
  }
}

export function persistTheme(theme: Theme): void {
  write(KEYS.theme, theme)
}

export function persistMode(mode: AppMode): void {
  write(KEYS.mode, mode)
}

export function persistCopy(copy: AppState['copy']): void {
  write(KEYS.copy, JSON.stringify(copy))
}

export function persistBitMappingOpen(open: AppState['ui']['bitMappingOpen']): void {
  write(KEYS.bitMappingOpen, JSON.stringify(open))
}
