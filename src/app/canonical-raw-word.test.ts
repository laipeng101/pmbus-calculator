import { describe, it, expect } from 'vitest'
import { appReducer } from './reducer'
import { INITIAL_STATE, type AppState } from './state'
import { toCalculatorViewModel } from './view-model'
import { formatRawWordCopyText } from './result-presentation'
import { PMBusMath } from '../legacy/pmbus-math'

// Raw Word、位网格和换算使用同一个 16 位原始字。字节序只影响显示和复制。
function base(): AppState {
  return structuredClone(INITIAL_STATE)
}

function typeHex(state: AppState, hex: string): AppState {
  return appReducer(state, { type: 'raw/set-from-hex', hex })
}

const ALL_NUMERIC_MODES = ['L11', 'L16', 'DIRECT', 'HALF'] as const

const PROBE_RAW_WORDS = [
  0x0000, 0x0001, 0x00ff, 0x0100, 0x1234, 0x3412, 0x7ffe, 0x7fff, 0x8000, 0x8001, 0xbfff, 0xc000,
  0xc100, 0x3c00, 0xfffe, 0xffff,
]

describe('原始数据字的显示和重输', () => {
  it.each(ALL_NUMERIC_MODES)(
    '%s formats the stored word, and re-entering that text restores the word',
    (mode) => {
      const start = appReducer(base(), { type: 'mode/set', mode })
      for (const raw of PROBE_RAW_WORDS) {
        const state = appReducer(start, { type: 'raw/set', raw: String(raw) })
        const vm = toCalculatorViewModel(state)
        const digits = raw.toString(16).toUpperCase().padStart(4, '0')
        expect(vm.rawHexDigits).toBe(digits)
        expect(vm.rawHex).toBe(`0x${digits}`)

        const draft = appReducer(state, { type: 'bit/toggle', bit: 15 })
        for (const text of [vm.rawHexDigits, vm.rawHex, `  ${vm.rawHex.toLowerCase()}  `]) {
          expect(typeHex(draft, text).raw, text).toBe(raw)
        }
      }
    },
  )

  it('L16 typing 3412 yields raw 0x3412 (the v2 LE byte-stream swap is deleted)', () => {
    const l16 = appReducer(base(), { type: 'mode/set', mode: 'L16' })
    const s = typeHex(l16, '3412')
    expect(s.raw).toBe(0x3412)
    const vm = toCalculatorViewModel(s)
    expect(vm.rawHex).toBe('0x3412')
  })
})

describe('canonical Raw Word — bit-grid identity', () => {
  it('bit toggle syncs raw word, bit grid, formula operand and decode path', () => {
    const l16 = appReducer(base(), { type: 'mode/set', mode: 'L16' })
    const s = typeHex(l16, 'C000') // VOUT_MODE 0x18 shared byte: absolute LINEAR N=-8
    const before = toCalculatorViewModel(s)
    expect(before.rawHex).toBe('0xC000')
    // Toggle word bit 4 (mask 0x0010) — reducer bit indexes count from the MSB.
    const toggled = appReducer(s, { type: 'bit/toggle', bit: 11 })
    expect(toggled.raw).toBe(0xc010)
    const vm = toCalculatorViewModel(toggled)
    expect(vm.rawHex).toBe('0xC010')
    // Nibble hex in the bit grid reflects the same word.
    expect(vm.bitGroups.map((g) => g.hex).join('')).toBe('C010')
    expect(vm.formulaText).toBe('V=49168 × 2^-8')
    expect(vm.valueText).toBe('192.0625')
  })
})

describe('canonical Raw Word — serialization invariants (SMBus 3.0 §6.5.4)', () => {
  it('wireBytes is low-byte-first and msbFirstBytes is its reverse', () => {
    for (const raw of PROBE_RAW_WORDS) {
      const vm = toCalculatorViewModel(appReducer(base(), { type: 'raw/set', raw: String(raw) }))
      const low = raw & 0xff
      const high = (raw >> 8) & 0xff
      const hex = (b: number) => b.toString(16).toUpperCase().padStart(2, '0')
      expect(vm.wireBytes).toBe(`0x ${hex(low)} ${hex(high)}`)
      expect(vm.msbFirstBytes).toBe(`0x ${hex(high)} ${hex(low)}`)
    }
  })

  it.each([
    { prefix0x: true, spaceBetweenBytes: true, wire: '0x 34 12', msb: '0x 12 34' },
    { prefix0x: false, spaceBetweenBytes: true, wire: '34 12', msb: '12 34' },
    { prefix0x: true, spaceBetweenBytes: false, wire: '0x 3412', msb: '0x 1234' },
    { prefix0x: false, spaceBetweenBytes: false, wire: '3412', msb: '1234' },
  ])('formats bytes with prefix=$prefix0x and spacing=$spaceBetweenBytes', (row) => {
    const { prefix0x, spaceBetweenBytes, wire, msb } = row
    const vm = toCalculatorViewModel({
      ...base(),
      raw: 0x1234,
      copy: { prefix0x, spaceBetweenBytes },
    })
    expect(vm.wireBytes).toBe(wire)
    expect(vm.msbFirstBytes).toBe(msb)
  })

  it('serialization preferences never alter raw, bit grid, decode or the C macro', () => {
    for (const mode of ALL_NUMERIC_MODES) {
      const start = appReducer(base(), { type: 'mode/set', mode })
      const s = appReducer(start, { type: 'raw/set', raw: '49220' }) // 0xC044
      const neutral = toCalculatorViewModel(s)
      // Toggle both copy preferences — display/copy formatting only.
      const flipped = {
        ...s,
        copy: { prefix0x: !s.copy.prefix0x, spaceBetweenBytes: !s.copy.spaceBetweenBytes },
      }
      const after = toCalculatorViewModel(flipped)
      expect(after.rawHex).toBe(neutral.rawHex)
      expect(after.bitGroups).toEqual(neutral.bitGroups)
      expect(after.valueText).toBe(neutral.valueText)
      expect(after.cMacroText).toBe(neutral.cMacroText)
      expect(after.formulaText).toBe(neutral.formulaText)
    }
  })

  it('the Raw Word copy action always emits the canonical word', () => {
    const vm = toCalculatorViewModel(appReducer(base(), { type: 'raw/set', raw: '49220' }))
    expect(formatRawWordCopyText(vm.rawHex, true)).toBe('0xC044')
    expect(formatRawWordCopyText(vm.rawHex, false)).toBe('C044')
    // The C macro always uses the canonical raw word.
    expect(vm.cMacroText).toContain('0xC044')
  })
})

describe('golden vectors — L16 (VOUT_MODE 0x14, N = -12)', () => {
  it('12 V encodes to canonical raw C000 with wire bytes 00 C0', () => {
    let s = appReducer(base(), { type: 'mode/set', mode: 'L16' })
    s = appReducer(s, { type: 'vout-mode/set-byte', hex: '14' })
    expect(PMBusMath.decodeUlinear16(0xc000, -12).value).toBe(12)
    // Value encode path: physical 12 → 0xC000.
    const encoded = appReducer(s, { type: 'value/set', value: '12' })
    expect(encoded.raw).toBe(0xc000)
    const vm = toCalculatorViewModel(encoded)
    expect(vm.rawHex).toBe('0xC000')
    expect(vm.wireBytes).toBe('0x 00 C0')
    expect(vm.msbFirstBytes).toBe('0x C0 00')
  })

  it('raw BFFF decodes 11.999755859375 and stays adjacent to C000 numerically', () => {
    let s = appReducer(base(), { type: 'mode/set', mode: 'L16' })
    s = appReducer(s, { type: 'vout-mode/set-byte', hex: '14' })
    const lower = typeHex(s, 'BFFF')
    expect(lower.raw).toBe(0xbfff)
    const vm = toCalculatorViewModel(lower)
    // Exact physical value (task golden): 40959 × 2^-12 = 11.999755859375.
    expect(PMBusMath.decodeUlinear16(0xbfff, -12).value).toBe(11.999755859375)
    // The result card renders 12 significant digits.
    expect(vm.valueText).toBe('11.9997558594')
    expect(vm.wireBytes).toBe('0x FF BF')
    // Numeric adjacency: BFFF and C000 are consecutive words.
    expect(vm.msbFirstBytes).toBe('0x BF FF')
    const upper = typeHex(s, 'C000')
    expect(upper.raw).toBe(0xbfff + 1)
  })
})

describe('golden vectors — L11 (raw C100)', () => {
  it('C100 keeps the canonical word with wire bytes 00 C1', () => {
    let s = appReducer(base(), { type: 'mode/set', mode: 'L11' })
    s = typeHex(s, 'C100')
    expect(s.raw).toBe(0xc100)
    const vm = toCalculatorViewModel(s)
    expect(vm.rawHex).toBe('0xC100')
    expect(vm.wireBytes).toBe('0x 00 C1')
    expect(vm.msbFirstBytes).toBe('0x C1 00')
    // Existing decode contract for 0xC100: N=-8 (bits 15:11), Y=256 → 1.0.
    const decoded = PMBusMath.decodeLinear11(0xc100)
    expect(decoded.y).toBe(256)
    expect(decoded.n).toBe(-8)
    expect(decoded.value).toBe(1)
  })
})

describe('golden vectors — DIRECT (m=1, b=0, R=0, raw 1234)', () => {
  it('1234 keeps the canonical word with wire bytes 34 12', () => {
    let s = appReducer(base(), { type: 'mode/set', mode: 'DIRECT' })
    s = typeHex(s, '1234')
    expect(s.raw).toBe(0x1234)
    const vm = toCalculatorViewModel(s)
    expect(vm.rawHex).toBe('0x1234')
    expect(vm.wireBytes).toBe('0x 34 12')
    expect(vm.msbFirstBytes).toBe('0x 12 34')
    // Generic signed Y contract unchanged: 0x1234 → +4660.
    expect(vm.valueText).toBe('4660')
  })
})

describe('golden vectors — IEEE HALF (raw 3C00)', () => {
  it('3C00 decodes 1 with wire bytes 00 3C', () => {
    let s = appReducer(base(), { type: 'mode/set', mode: 'HALF' })
    s = typeHex(s, '3C00')
    expect(s.raw).toBe(0x3c00)
    const vm = toCalculatorViewModel(s)
    expect(vm.valueText).toBe('1')
    expect(vm.rawHex).toBe('0x3C00')
    expect(vm.wireBytes).toBe('0x 00 3C')
    expect(vm.msbFirstBytes).toBe('0x 3C 00')
  })
})
