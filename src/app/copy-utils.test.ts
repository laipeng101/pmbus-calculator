import { describe, it, expect, vi, afterEach } from 'vitest'
import { buildCMacro, copyTextToClipboard, sanitizeMacroName } from './copy-utils'

describe('sanitizeMacroName', () => {
  it('returns RAW_VALUE for null/empty', () => {
    expect(sanitizeMacroName(null)).toBe('RAW_VALUE')
    expect(sanitizeMacroName('')).toBe('RAW_VALUE')
    expect(sanitizeMacroName('   ')).toBe('RAW_VALUE')
  })

  it('preserves valid command names', () => {
    expect(sanitizeMacroName('VOUT_COMMAND')).toBe('VOUT_COMMAND')
    expect(sanitizeMacroName('READ_VIN')).toBe('READ_VIN')
  })

  it('cleans unsafe characters', () => {
    expect(sanitizeMacroName('READ EIN!')).toBe('READ_EIN')
  })

  it('prefixes names that start with a digit', () => {
    expect(sanitizeMacroName('2SPEED')).toBe('CMD_2SPEED')
  })
})

describe('buildCMacro', () => {
  it('uses RAW_VALUE when no command is selected', () => {
    expect(buildCMacro(null, '0x0C00', 'V=3072 × 2^-8')).toBe(
      '#define RAW_VALUE 0x0C00 /* V=3072 × 2^-8 */',
    )
  })

  it('uses the sanitized command name when a command is selected', () => {
    expect(buildCMacro('VOUT_COMMAND', '0x0C00', 'V=3072 × 2^-8')).toBe(
      '#define VOUT_COMMAND 0x0C00 /* V=3072 × 2^-8 */',
    )
  })
})

describe('copyTextToClipboard', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  it('prefers navigator.clipboard.writeText', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    await copyTextToClipboard('hello')
    expect(writeText).toHaveBeenCalledWith('hello')
  })

  it('falls back to execCommand copy when clipboard is unavailable', async () => {
    vi.stubGlobal('navigator', {})
    const execCommand = vi.fn().mockReturnValue(true)
    document.execCommand = execCommand
    await copyTextToClipboard('hello')
    expect(execCommand).toHaveBeenCalledWith('copy')
    expect(document.querySelector('textarea')).toBeNull()
  })

  it('throws when execCommand copy is rejected', async () => {
    vi.stubGlobal('navigator', {})
    document.execCommand = vi.fn().mockReturnValue(false)
    await expect(copyTextToClipboard('hello')).rejects.toThrow('copy rejected')
  })
})
