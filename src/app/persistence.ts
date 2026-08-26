/**
 * Persistence layer — the only place allowed to read/write localStorage.
 *
 * UI components and reducers must not touch localStorage directly.
 * The data is small preference state; parse failures or storage restrictions
 * fall back to the provided base state without crashing.
 */

import type { AppMode, AppState, Endian, Theme } from './state'

const KEYS = {
  theme: 'pmbus-calculator:theme',
  mode: 'pmbus-calculator:mode',
  byteOrder: 'pmbus-calculator:byteOrder',
  copy: 'pmbus-calculator:copy',
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

function isEndian(v: unknown): v is Endian {
  return v === 'le' || v === 'be'
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
  const byteOrder = read(KEYS.byteOrder)
  const copyRaw = read(KEYS.copy)
  const copy = parseJson<Partial<AppState['copy']>>(copyRaw)

  return {
    ...base,
    mode: isMode(mode) ? mode : base.mode,
    byteOrder: isEndian(byteOrder) ? byteOrder : base.byteOrder,
    copy: {
      ...base.copy,
      ...(copy && typeof copy === 'object' ? copy : {}),
      prefix0x: typeof copy?.prefix0x === 'boolean' ? copy.prefix0x : base.copy.prefix0x,
      spaceBetweenBytes:
        typeof copy?.spaceBetweenBytes === 'boolean'
          ? copy.spaceBetweenBytes
          : base.copy.spaceBetweenBytes,
      endian: isEndian(copy?.endian) ? (copy.endian as Endian) : base.copy.endian,
    },
    ui: {
      ...base.ui,
      theme: isTheme(theme) ? theme : base.ui.theme,
    },
  }
}

export function persistTheme(theme: Theme): void {
  write(KEYS.theme, theme)
}

export function persistMode(mode: AppMode): void {
  write(KEYS.mode, mode)
}

export function persistByteOrder(endian: Endian): void {
  write(KEYS.byteOrder, endian)
}

export function persistCopy(copy: AppState['copy']): void {
  write(KEYS.copy, JSON.stringify(copy))
}
