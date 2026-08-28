import { describe, it, expect } from 'vitest'
import { appReducer } from './reducer'
import { INITIAL_STATE, type AppState } from './state'
import { PMBusMath } from '../legacy/pmbus-math'
import { analyzeVoutMode } from '../legacy/vout-mode'

describe('appReducer — state transitions', () => {
  const base: AppState = { ...INITIAL_STATE }

  describe('mode/set', () => {
    it('changes the mode', () => {
      const s = appReducer(base, { type: 'mode/set', mode: 'L16' })
      expect(s.mode).toBe('L16')
    })
  })

  describe('command/set', () => {
    it('sets commandKey only, without switching mode or rewriting raw', () => {
      const l16 = appReducer(base, { type: 'mode/set', mode: 'L16' })
      const withRaw = appReducer(l16, { type: 'raw/set', raw: '4660' })
      const s = appReducer(withRaw, { type: 'command/set', commandKey: 'VOUT_COMMAND' })
      expect(s.commandKey).toBe('VOUT_COMMAND')
      expect(s.mode).toBe('L16')
      expect(s.raw).toBe(0x1234)
      expect(s.voutMode.byte).toBe(withRaw.voutMode.byte)
    })

    it('does not auto-apply device_defined presets', () => {
      const l16 = appReducer(base, { type: 'mode/set', mode: 'L16' })
      const s = appReducer(l16, { type: 'command/set', commandKey: 'READ_VIN' })
      expect(s.commandKey).toBe('READ_VIN')
      expect(s.mode).toBe('L16')
      expect(s.raw).toBe(l16.raw)
    })

    it('clears commandKey with null', () => {
      const withCmd = appReducer(base, { type: 'command/set', commandKey: 'VOUT_COMMAND' })
      const s = appReducer(withCmd, { type: 'command/set', commandKey: null })
      expect(s.commandKey).toBeNull()
    })

    it('ignores an unknown command key', () => {
      const s = appReducer(base, { type: 'command/set', commandKey: 'NOT_A_COMMAND' })
      expect(s.commandKey).toBeNull()
    })

    it('does not force a numeric mode for STATUS_WORD', () => {
      const l16 = appReducer(base, { type: 'mode/set', mode: 'L16' })
      const s = appReducer(l16, { type: 'command/set', commandKey: 'STATUS_WORD' })
      expect(s.commandKey).toBe('STATUS_WORD')
      expect(s.mode).toBe('L16')
    })

    it('does not force a numeric mode for READ_EIN', () => {
      const s = appReducer(base, { type: 'command/set', commandKey: 'READ_EIN' })
      expect(s.commandKey).toBe('READ_EIN')
      expect(s.mode).toBe('L11')
    })
  })

  describe('raw/set-from-hex', () => {
    it('parses plain hex', () => {
      const s = appReducer(base, { type: 'raw/set-from-hex', hex: 'e0c0' })
      expect(s.raw).toBe(0xe0c0)
    })

    it('parses 0x-prefixed hex', () => {
      const s = appReducer(base, { type: 'raw/set-from-hex', hex: '0x1A2B' })
      expect(s.raw).toBe(0x1a2b)
    })

    it('allows leading and trailing whitespace only', () => {
      const s = appReducer(base, { type: 'raw/set-from-hex', hex: '  1A2B  ' })
      expect(s.raw).toBe(0x1a2b)
    })

    it('rejects internal whitespace (full string must match)', () => {
      const s = appReducer(base, { type: 'raw/set-from-hex', hex: 'E0 C0' })
      expect(s.raw).toBe(base.raw)
    })

    it('falls back on empty string (explicit reset-to-zero)', () => {
      const s = appReducer(base, { type: 'raw/set-from-hex', hex: '' })
      expect(s.raw).toBe(0)
    })

    it('rejects over-long hex instead of silently truncating', () => {
      const s = appReducer(base, { type: 'raw/set-from-hex', hex: '0x12345' })
      expect(s.raw).toBe(base.raw)
    })

    it('rejects partial parses such as 1G and 0x12ZZ', () => {
      for (const hex of ['1G', '0x12ZZ']) {
        const s = appReducer(base, { type: 'raw/set-from-hex', hex })
        expect(s.raw, hex).toBe(base.raw)
      }
    })

    it('rejects a bare 0x prefix', () => {
      const s = appReducer(base, { type: 'raw/set-from-hex', hex: '0x' })
      expect(s.raw).toBe(base.raw)
    })

    it('rejects invalid hex without modifying global state', () => {
      const s = appReducer(base, { type: 'raw/set-from-hex', hex: 'zzzz' })
      expect(s.raw).toBe(base.raw)
    })
  })

  describe('raw/set', () => {
    it('sets raw value', () => {
      const s = appReducer(base, { type: 'raw/set', raw: '43981' })
      expect(s.raw).toBe(0xabcd)
    })

    it('clamps to 0..65535 instead of wrapping', () => {
      const hi = appReducer(base, { type: 'raw/set', raw: '127216' })
      expect(hi.raw).toBe(65535)
      const lo = appReducer(base, { type: 'raw/set', raw: '-1' })
      expect(lo.raw).toBe(0)
    })

    it('clamps L16 manual V input to 0..65535', () => {
      const l16 = appReducer(base, { type: 'mode/set', mode: 'L16' })
      const hi = appReducer(l16, { type: 'raw/set', raw: '70000' })
      expect(hi.raw).toBe(65535)
      const lo = appReducer(l16, { type: 'raw/set', raw: '-1' })
      expect(lo.raw).toBe(0)
    })

    it('rejects decimal partial parses, scientific notation, and floats', () => {
      const l16 = appReducer(base, { type: 'mode/set', mode: 'L16' })
      for (const raw of ['12abc', '1e2', '1.5', '+', '-']) {
        const s = appReducer(l16, { type: 'raw/set', raw })
        expect(s.raw, raw).toBe(l16.raw)
      }
    })

    it('accepts decimal strings with surrounding whitespace and explicit sign', () => {
      const l16 = appReducer(base, { type: 'mode/set', mode: 'L16' })
      expect(appReducer(l16, { type: 'raw/set', raw: '  12  ' }).raw).toBe(12)
      expect(appReducer(l16, { type: 'raw/set', raw: '+12' }).raw).toBe(12)
    })
  })

  describe('bit/toggle', () => {
    it('toggles MSB (bit 0)', () => {
      const s = appReducer(base, { type: 'bit/toggle', bit: 0 })
      expect(s.raw).toBe(0x8000)
    })

    it('toggles LSB (bit 15)', () => {
      const s = appReducer(base, { type: 'bit/toggle', bit: 15 })
      expect(s.raw).toBe(0x0001)
    })

    it('toggles twice restores original', () => {
      const s1 = appReducer(base, { type: 'bit/toggle', bit: 5 })
      const s2 = appReducer(s1, { type: 'bit/toggle', bit: 5 })
      expect(s2.raw).toBe(base.raw)
    })
  })

  describe('L11 raw -> N/Y sync', () => {
    it('raw/set-from-hex decodes N and Y in L11 mode', () => {
      const s = appReducer(base, { type: 'raw/set-from-hex', hex: 'F819' })
      expect(s.l11.n).toBe(-1)
      expect(s.l11.y).toBe(25)
      expect(s.l11.valueInput).toBeNull()
    })

    it('bit/toggle decodes N and Y in L11 mode', () => {
      const s1 = appReducer(base, { type: 'raw/set-from-hex', hex: '0801' })
      expect(s1.l11.n).toBe(1)
      expect(s1.l11.y).toBe(1)
    })

    it('mode/set entering L11 syncs N and Y from current raw', () => {
      const l16 = appReducer(base, { type: 'mode/set', mode: 'L16' })
      const withRaw = appReducer(l16, { type: 'raw/set', raw: '2049' })
      expect(withRaw.l11.n).toBe(0) // not yet synced in L16
      const s = appReducer(withRaw, { type: 'mode/set', mode: 'L11' })
      expect(s.l11.n).toBe(1)
      expect(s.l11.y).toBe(1)
      expect(s.l11.valueInput).toBeNull()
    })
  })

  describe('value/set', () => {
    it('encodes an integer with auto-N (best N/Y)', () => {
      const s = appReducer(base, { type: 'value/set', value: '12' })
      // 12 = 12 × 2^0
      expect(s.raw).toBe(0x000c)
      expect(s.l11.n).toBe(0)
      expect(s.l11.y).toBe(12)
      expect(s.l11.valueInput).toBe(12)
    })

    it('encodes a fraction with auto-N', () => {
      const s = appReducer(base, { type: 'value/set', value: '12.5' })
      // 12.5 = 25 × 2^-1
      expect(s.raw).toBe(0xf819)
      expect(s.l11.n).toBe(-1)
      expect(s.l11.y).toBe(25)
    })

    it('encodes with manual N when autoN is off', () => {
      const manual: AppState = {
        ...base,
        l11: { ...base.l11, autoN: false, n: -1 },
      }
      const s = appReducer(manual, { type: 'value/set', value: '12.5' })
      expect(s.l11.autoN).toBe(false)
      expect(s.raw).toBe(0xf819)
      expect(s.l11.n).toBe(-1)
      expect(s.l11.y).toBe(25)
    })

    it('ignores invalid strings', () => {
      const s = appReducer(base, { type: 'value/set', value: 'abc' })
      expect(s.raw).toBe(base.raw)
      expect(s.l11.valueInput).toBeNull()
    })

    it('ignores invalid drafts even when blur-style repair could make them valid (v2.5.9)', () => {
      // Regression for the invalid-blur defect: the reducer is not the repair
      // layer — text like `NaN.` / `2..` / `NaNe` must never become a commit,
      // no matter which component produced the action string.
      for (const text of ['NaN.', 'NaNe', 'Infinitye', '2..', '12..', '1ee', '1e400']) {
        const s = appReducer(base, { type: 'value/set', value: text })
        expect(s.raw, text).toBe(base.raw)
        expect(s.l11.valueInput, text).toBeNull()
      }
    })

    it('ignores non-finite values', () => {
      const s = appReducer(base, { type: 'value/set', value: 'Infinity' })
      expect(s.raw).toBe(base.raw)
    })

    it('encodes in HALF mode', () => {
      const half = appReducer(base, { type: 'mode/set', mode: 'HALF' })
      const s = appReducer(half, { type: 'value/set', value: '12' })
      expect(s.raw).toBe(0x4a00)
    })
  })

  describe('valueRequest lifecycle (L16/DIRECT/HALF quantization-error parity)', () => {
    const enterMode = (mode: AppState['mode']) => appReducer(base, { type: 'mode/set', mode })

    it('records the committed request on value/set for L16, DIRECT and HALF', () => {
      for (const [mode, raw] of [
        ['L16', 0x0c00],
        ['DIRECT', 12],
        ['HALF', 0x4a00],
      ] as const) {
        const s = appReducer(enterMode(mode), { type: 'value/set', value: '12' })
        expect(s.valueRequest, mode).toEqual({ mode, value: 12 })
        expect(s.raw, mode).toBe(raw)
      }
    })

    it('keeps L11 on its historical l11.valueInput channel only', () => {
      const s = appReducer(base, { type: 'value/set', value: '12' })
      expect(s.l11.valueInput).toBe(12)
      expect(s.valueRequest).toBeNull()
    })

    it('re-selecting the active mode keeps the provenance (same-mode idempotence)', () => {
      // Same-tab click / Ctrl+ shortcut on the current mode must not wipe a
      // still-valid request: neither raw bits nor semantics changed.
      const l16 = appReducer(enterMode('L16'), { type: 'value/set', value: '12' })
      expect(appReducer(l16, { type: 'mode/set', mode: 'L16' })).toBe(l16)

      const direct = appReducer(enterMode('DIRECT'), { type: 'value/set', value: '12' })
      expect(appReducer(direct, { type: 'mode/set', mode: 'DIRECT' })).toBe(direct)

      const half = appReducer(enterMode('HALF'), { type: 'value/set', value: '12' })
      expect(appReducer(half, { type: 'mode/set', mode: 'HALF' })).toBe(half)
    })

    it('clears a stale request when raw is edited through hex or bit toggles', () => {
      for (const mode of ['L16', 'DIRECT', 'HALF'] as const) {
        const withRequest = appReducer(enterMode(mode), { type: 'value/set', value: '12' })
        expect(withRequest.valueRequest).not.toBeNull()
        const viaHex = appReducer(withRequest, { type: 'raw/set-from-hex', hex: 'ABCD' })
        expect(viaHex.valueRequest, `${mode} hex`).toBeNull()
        const restored = appReducer(viaHex, {
          type: 'value/set',
          value: '12',
        })
        const viaBit = appReducer(restored, { type: 'bit/toggle', bit: 15 })
        expect(viaBit.valueRequest, `${mode} bit`).toBeNull()
      }
    })

    it('clears the request when DIRECT Y or coefficients change', () => {
      const direct = appReducer(enterMode('DIRECT'), { type: 'value/set', value: '12' })
      const viaY = appReducer(direct, { type: 'direct/set-y', y: '-5' })
      expect(viaY.valueRequest).toBeNull()
      const withNewRequest = appReducer(viaY, { type: 'value/set', value: '12' })
      const viaCoeff = appReducer(withNewRequest, {
        type: 'direct/set-coeff',
        name: 'm',
        value: '2',
      })
      expect(viaCoeff.valueRequest).toBeNull()
      // m=0 stores the explicit error state but still invalidates the request.
      const mZero = appReducer(withNewRequest, {
        type: 'direct/set-coeff',
        name: 'm',
        value: '0',
      })
      expect(mZero.valueRequest).toBeNull()
    })

    it('clears the request on payload-kind switch, VOUT_MODE edits and mode switches', () => {
      const l16 = appReducer(enterMode('L16'), { type: 'value/set', value: '12' })
      expect(l16.valueRequest).toEqual({ mode: 'L16', value: 12 })

      const switched = appReducer(l16, {
        type: 'l16/set-payload-kind',
        payloadKind: 'slinear16-offset',
      })
      expect(switched.valueRequest).toBeNull()

      const again = appReducer(switched, { type: 'value/set', value: '12' })
      const byteEdit = appReducer(again, { type: 'vout-mode/set-linear-n', n: '-9' })
      expect(byteEdit.valueRequest).toBeNull()

      const toHalf = appReducer(byteEdit, { type: 'mode/set', mode: 'HALF' })
      expect(toHalf.valueRequest).toBeNull()
    })
  })

  describe('L16 value -> raw encode', () => {
    it('encodes with VOUT_MODE-derived N=-8', () => {
      const l16 = appReducer(base, { type: 'mode/set', mode: 'L16' })
      const s = appReducer(l16, { type: 'value/set', value: '12' })
      // 12 / 2^-8 = 3072 = 0x0C00
      expect(s.raw).toBe(0x0c00)
    })

    it('encodes a fractional value with N=-8', () => {
      const l16 = appReducer(base, { type: 'mode/set', mode: 'L16' })
      const s = appReducer(l16, { type: 'value/set', value: '12.5' })
      // 12.5 / 2^-8 = 3200 = 0x0C80
      expect(s.raw).toBe(0x0c80)
    })

    it('clamps to 0..65535', () => {
      const l16 = appReducer(base, { type: 'mode/set', mode: 'L16' })
      const hi = appReducer(l16, { type: 'value/set', value: '999999' })
      expect(hi.raw).toBe(0xffff)
      const lo = appReducer(l16, { type: 'value/set', value: '-1' })
      expect(lo.raw).toBe(0)
    })
  })

  describe('SLINEAR16 offset bit7 semantics (v2.5.1 P1-A/P1-B)', () => {
    const enterRelativeSlinear = () => {
      const l16 = appReducer(base, { type: 'mode/set', mode: 'L16' })
      const withMode = appReducer(l16, { type: 'vout-mode/set-byte', hex: '98' })
      return appReducer(withMode, {
        type: 'l16/set-payload-kind',
        payloadKind: 'slinear16-offset',
      })
    }

    it('ULINEAR16 + 0x98 still refuses value/set and keeps no provenance', () => {
      const l16 = appReducer(base, { type: 'mode/set', mode: 'L16' })
      const withMode = appReducer(l16, { type: 'vout-mode/set-byte', hex: '98' })
      const before = withMode.raw
      const s = appReducer(withMode, { type: 'value/set', value: '3.3' })
      expect(s.raw).toBe(before)
      expect(s.valueRequest).toBeNull()
      // Nominal reference channel stays available for the ratio semantics.
      const withNominal = appReducer(s, { type: 'l16/set-nominal-vout', nominalVout: '3.3' })
      expect(withNominal.l16.nominalVout).toBe(3.3)
    })

    it('l16/set-nominal-vout rejects invalid drafts the blur path used to repair (v2.5.9)', () => {
      // The invalid-blur defect turned a pasted `12..` into nominal 12 on
      // blur. The reducer never accepted such text; pin it against the exact
      // counterexample so no future layer can reintroduce the commit.
      const l16 = appReducer(base, { type: 'mode/set', mode: 'L16' })
      const withMode = appReducer(l16, { type: 'vout-mode/set-byte', hex: '98' })
      const withNominal = appReducer(withMode, {
        type: 'l16/set-nominal-vout',
        nominalVout: '5',
      })
      expect(withNominal.l16.nominalVout).toBe(5)
      for (const text of ['12..', 'NaN.', 'NaNe', '2..', '1ee']) {
        const s = appReducer(withNominal, { type: 'l16/set-nominal-vout', nominalVout: text })
        expect(s.l16.nominalVout, text).toBe(5)
      }
    })

    it('SLINEAR16 offset + 0x98 encodes 3.3 as signed 0x034D and records provenance', () => {
      const s0 = enterRelativeSlinear()
      const s = appReducer(s0, { type: 'value/set', value: '3.3' })
      // Y_s = round(3.3 / 2^-8) = 845 = 0x034D; shared VOUT_MODE stays 0x98.
      expect(s.raw).toBe(0x034d)
      expect(s.voutMode.byte).toBe(0x98)
      expect(s.valueRequest).toEqual({ mode: 'L16', value: 3.3 })
    })

    it('manual Y_s edit clears the still-valid value request (P1-B)', () => {
      const withRequest = appReducer(enterRelativeSlinear(), {
        type: 'value/set',
        value: '3.3',
      })
      expect(withRequest.valueRequest).toEqual({ mode: 'L16', value: 3.3 })
      const edited = appReducer(withRequest, { type: 'l16/set-slinear-y', y: '1' })
      expect(edited.raw).toBe(0x0001)
      expect(edited.valueRequest).toBeNull()
    })

    it('invalid Y_s input changes nothing and keeps a valid request', () => {
      const withRequest = appReducer(enterRelativeSlinear(), {
        type: 'value/set',
        value: '3.3',
      })
      const edited = appReducer(withRequest, { type: 'l16/set-slinear-y', y: 'abc' })
      expect(edited.raw).toBe(withRequest.raw)
      expect(edited.valueRequest).toEqual({ mode: 'L16', value: 3.3 })
    })

    it('SLINEAR16 offset + 0x98 clamps 200 to 0x7FFF (saturation territory)', () => {
      const s0 = enterRelativeSlinear()
      const s = appReducer(s0, { type: 'value/set', value: '200' })
      // Y_s = round(200 × 256) clamps to 32767 = 0x7FFF.
      expect(s.raw).toBe(0x7fff)
      expect(s.valueRequest).toEqual({ mode: 'L16', value: 200 })
    })
  })

  describe('L16 value/set semantics with shared VOUT_MODE', () => {
    it('relative LINEAR 0x98 拒绝 value/set，raw 不变', () => {
      const l16 = appReducer(base, { type: 'mode/set', mode: 'L16' })
      const withMode = appReducer(l16, { type: 'vout-mode/set-byte', hex: '98' })
      const before = withMode.raw
      const s = appReducer(withMode, { type: 'value/set', value: '12' })
      expect(s.raw).toBe(before)
      expect(s.voutMode.byte).toBe(withMode.voutMode.byte)
    })

    it('非 LINEAR 共享字节 fail-closed：value/set 不编码、不伪造 provenance', () => {
      for (const hex of ['20', '40', '60', 'e0', '41', '61']) {
        for (const payloadKind of ['ulinear16', 'slinear16-offset'] as const) {
          const l16 = appReducer(base, { type: 'mode/set', mode: 'L16' })
          const withKind = appReducer(l16, { type: 'l16/set-payload-kind', payloadKind })
          const withMode = appReducer(withKind, { type: 'vout-mode/set-byte', hex })
          const before = withMode.raw
          const s = appReducer(withMode, { type: 'value/set', value: '12' })
          expect(s.raw, `0x${hex}/${payloadKind}`).toBe(before)
          expect(s.voutMode.byte, `0x${hex}/${payloadKind}`).toBe(withMode.voutMode.byte)
          expect(s.valueRequest, `0x${hex}/${payloadKind}`).toBeNull()
        }
      }
    })

    it('显式应用计算器 LINEAR 示例 0x18 后 value/set 恢复编码且 provenance 走显式路径', () => {
      const l16 = appReducer(base, { type: 'mode/set', mode: 'L16' })
      const withMode = appReducer(l16, { type: 'vout-mode/set-byte', hex: '20' })
      const applied = appReducer(withMode, { type: 'l16/apply-calculator-linear-example' })
      expect(applied.voutMode.byte).toBe(0x18)
      expect(applied.valueRequest).toBeNull()
      const s = appReducer(applied, { type: 'value/set', value: '12' })
      expect(s.raw).toBe(0x0c00)
      expect(s.valueRequest).toEqual({ mode: 'L16', value: 12 })
    })

    it('absolute LINEAR (0x18) 仍然编码', () => {
      const l16 = appReducer(base, { type: 'mode/set', mode: 'L16' })
      const s = appReducer(l16, { type: 'value/set', value: '12' })
      expect(s.raw).toBe(0x0c00)
    })
  })

  describe('L11 手动 N（autoN=false）饱和语义', () => {
    it('N=0 时正上界 1023 与负下界 -1024 是合法边界编码，不触发 clamp', () => {
      const manual: AppState = {
        ...base,
        l11: { ...base.l11, autoN: false, n: 0 },
      }
      const hi = appReducer(manual, { type: 'value/set', value: '1023' })
      expect(hi.raw).toBe(0x03ff) // N=0, Y=1023
      expect(hi.l11.y).toBe(1023)
      const lo = appReducer(manual, { type: 'value/set', value: '-1024' })
      expect(lo.raw).toBe(0x0400) // N=0, Y=-1024
      expect(lo.l11.y).toBe(-1024)
    })

    it('N=0 时超出 Y=-1024..1023 的值被 clamp 到边界并保持锁定 N', () => {
      const manual: AppState = {
        ...base,
        l11: { ...base.l11, autoN: false, n: 0 },
      }
      const hi = appReducer(manual, { type: 'value/set', value: '2000' })
      expect(hi.raw).toBe(0x03ff)
      expect(hi.l11.n).toBe(0)
      expect(hi.l11.y).toBe(1023)
      const lo = appReducer(manual, { type: 'value/set', value: '-2000' })
      expect(lo.raw).toBe(0x0400)
      expect(lo.l11.n).toBe(0)
      expect(lo.l11.y).toBe(-1024)
    })

    it('N=-4 时按该 N 的 Y 范围饱和（-64 ~ 63.9375）', () => {
      const manual: AppState = {
        ...base,
        l11: { ...base.l11, autoN: false, n: -4 },
      }
      const hi = appReducer(manual, { type: 'value/set', value: '100' })
      // 100 / 2^-4 = 1600 → clamp 1023 → 63.9375（raw = 0xF3FF? N=-4 编码）
      expect(hi.l11.n).toBe(-4)
      expect(hi.l11.y).toBe(1023)
      expect(PMBusMath.decodeLinear11(hi.raw).value).toBe(1023 * Math.pow(2, -4))
    })
  })

  describe('l11/set-n', () => {
    it('sets N', () => {
      const s = appReducer(base, { type: 'l11/set-n', n: '-4' })
      expect(s.l11.n).toBe(-4)
    })

    it('writes raw back from N and current Y', () => {
      const s = appReducer(base, { type: 'l11/set-n', n: '-4' })
      // Y=0, N=-4 => raw = N-bits(28)<<11 = 0xE000
      expect(s.raw).toBe(0xe000)
    })

    it('ignores invalid string', () => {
      const s = appReducer(base, { type: 'l11/set-n', n: 'abc' })
      expect(s.l11.n).toBe(base.l11.n)
      expect(s.raw).toBe(base.raw)
    })
  })

  describe('l11/set-y', () => {
    it('sets Y', () => {
      const s = appReducer(base, { type: 'l11/set-y', y: '192' })
      expect(s.l11.y).toBe(192)
    })

    it('writes raw back from Y and current N', () => {
      const s = appReducer(base, { type: 'l11/set-y', y: '192' })
      expect(s.raw).toBe(0x00c0)
    })

    it('ignores invalid string', () => {
      const s = appReducer(base, { type: 'l11/set-y', y: 'xyz' })
      expect(s.l11.y).toBe(base.l11.y)
      expect(s.raw).toBe(base.raw)
    })
  })

  describe('l11/toggle-auto-n', () => {
    it('toggles autoN', () => {
      const s = appReducer(base, { type: 'l11/toggle-auto-n' })
      expect(s.l11.autoN).toBe(!base.l11.autoN)
    })
  })

  describe('vout-mode/set-byte', () => {
    it('parses hex vout mode', () => {
      const s = appReducer(base, { type: 'vout-mode/set-byte', hex: '0x18' })
      expect(s.voutMode.byte).toBe(0x18)
    })

    it('derives N for LINEAR VOUT_MODE (0x18 -> N=-8)', () => {
      const s = appReducer(base, { type: 'vout-mode/set-byte', hex: '0x18' })
      expect(analyzeVoutMode(s.voutMode.byte).linearExponent).toBe(-8)
    })

    it('derives N for LINEAR VOUT_MODE (0x17 -> N=-9)', () => {
      const s = appReducer(base, { type: 'vout-mode/set-byte', hex: '0x17' })
      expect(analyzeVoutMode(s.voutMode.byte).linearExponent).toBe(-9)
    })

    it('non-LINEAR VOUT_MODE keeps the byte without a stored N', () => {
      const s = appReducer(base, { type: 'vout-mode/set-byte', hex: '0x20' })
      expect(s.voutMode.byte).toBe(0x20)
      expect(analyzeVoutMode(s.voutMode.byte).linearExponent).toBeNull()
    })

    it('rejects over-long VOUT_MODE instead of masking', () => {
      const s = appReducer(base, { type: 'vout-mode/set-byte', hex: '0x1ff' })
      expect(s.voutMode.byte).toBe(base.voutMode.byte)
    })

    it('falls back on empty string (explicit reset-to-zero)', () => {
      const s = appReducer(base, { type: 'vout-mode/set-byte', hex: '' })
      expect(s.voutMode.byte).toBe(0)
    })

    it('ignores invalid hex', () => {
      const s = appReducer(base, { type: 'vout-mode/set-byte', hex: 'gg' })
      expect(s.voutMode.byte).toBe(base.voutMode.byte)
    })
  })

  describe('structured VOUT_MODE actions (M37)', () => {
    it('set-vout-relative only flips bit7 for non-VID formats and keeps raw', () => {
      const s = appReducer(base, { type: 'vout-mode/set-byte', hex: '0x18' })
      const rel = appReducer(s, { type: 'vout-mode/set-relative', relative: true })
      expect(rel.voutMode.byte).toBe(0x98)
      expect(analyzeVoutMode(rel.voutMode.byte).linearExponent).toBe(-8)
      expect(rel.raw).toBe(s.raw)
    })

    it('set-vout-relative refuses relative VID', () => {
      const vid = appReducer(base, { type: 'vout-mode/set-byte', hex: '0x20' })
      const s = appReducer(vid, { type: 'vout-mode/set-relative', relative: true })
      expect(s.voutMode.byte).toBe(0x20)
    })

    it('set-vout-relative clears an invalid relative-VID byte back to absolute', () => {
      const relVid = appReducer(base, { type: 'vout-mode/set-byte', hex: '0xa0' })
      const s = appReducer(relVid, { type: 'vout-mode/set-relative', relative: false })
      expect(s.voutMode.byte).toBe(0x20)
      expect(analyzeVoutMode(s.voutMode.byte).status).toBe('not-used')
    })

    it('set-vout-relative only flips bit7 and preserves parameter bits', () => {
      const direct = appReducer(base, { type: 'vout-mode/set-byte', hex: '0x41' })
      const s = appReducer(direct, { type: 'vout-mode/set-relative', relative: true })
      expect(s.voutMode.byte).toBe(0xc1) // relative DIRECT, parameter still 1 (invalid-parameter)
      expect(analyzeVoutMode(s.voutMode.byte).status).toBe('invalid-parameter')
    })

    it('set-vout-format canonicalizes DIRECT/Half parameter and VID bit7', () => {
      const relLinear = appReducer(base, { type: 'vout-mode/set-byte', hex: '0x98' })
      const direct = appReducer(relLinear, { type: 'vout-mode/set-format', format: 2 })
      expect(direct.voutMode.byte).toBe(0xc0) // relative DIRECT, param forced 0
      const vid = appReducer(relLinear, { type: 'vout-mode/set-format', format: 1 })
      expect(vid.voutMode.byte).toBe(0x38) // absolute VID code 24, bit7 cleared
    })

    it('set-vout-format to LINEAR preserves the parameter bits', () => {
      const half = appReducer(base, { type: 'vout-mode/set-byte', hex: '0x60' })
      const linear = appReducer(half, { type: 'vout-mode/set-format', format: 0 })
      expect(linear.voutMode.byte).toBe(0x00)
    })

    it('set-vout-linear-n edits only bits[4:0] and clamps to -16..15', () => {
      const rel = appReducer(base, { type: 'vout-mode/set-byte', hex: '0x98' })
      const hi = appReducer(rel, { type: 'vout-mode/set-linear-n', n: '15' })
      expect(hi.voutMode.byte).toBe(0x8f) // relative LINEAR, N=15
      const clamped = appReducer(rel, { type: 'vout-mode/set-linear-n', n: '99' })
      expect(clamped.voutMode.byte).toBe(0x8f) // clamped to 15
      const lo = appReducer(rel, { type: 'vout-mode/set-linear-n', n: '-17' })
      expect(lo.voutMode.byte).toBe(0x90) // clamped to -16
    })

    it('set-vout-linear-n is a no-op for non-LINEAR', () => {
      const vid = appReducer(base, { type: 'vout-mode/set-byte', hex: '0x20' })
      const s = appReducer(vid, { type: 'vout-mode/set-linear-n', n: '5' })
      expect(s.voutMode.byte).toBe(0x20)
    })

    it('vout-mode/set-parameter edits LINEAR exponent and VID code', () => {
      const vid = appReducer(base, { type: 'vout-mode/set-byte', hex: '0x20' })
      const s = appReducer(vid, { type: 'vout-mode/set-parameter', parameter: 0x1e })
      expect(s.voutMode.byte).toBe(0x3e)
      expect(analyzeVoutMode(s.voutMode.byte).status).toBe('profile-required')

      const linear = appReducer(base, { type: 'vout-mode/set-byte', hex: '0x18' })
      // LINEAR parameter is a signed 5-bit exponent: 1 -> N=1 -> byte 0x01.
      expect(
        appReducer(linear, { type: 'vout-mode/set-parameter', parameter: 1 }).voutMode.byte,
      ).toBe(0x01)
    })

    it('structured actions never touch raw or top-level mode', () => {
      const s0 = appReducer(base, { type: 'mode/set', mode: 'L16' })
      const s1 = appReducer(s0, { type: 'vout-mode/set-relative', relative: true })
      expect(s1.raw).toBe(s0.raw)
      expect(s1.mode).toBe('L16')
      const s2 = appReducer(s1, { type: 'vout-mode/set-linear-n', n: '-16' })
      expect(s2.raw).toBe(s0.raw)
      expect(s2.mode).toBe('L16')
    })
  })

  describe('idempotent VOUT_MODE semantic writes preserve provenance (v2.5.7)', () => {
    // L16 default byte 0x18: value 1 encodes raw 0x0100 with an explicit
    // valueRequest provenance.
    const l16 = appReducer(base, { type: 'mode/set', mode: 'L16' })
    const withRequest = appReducer(l16, { type: 'value/set', value: '1' })
    expect(withRequest.raw).toBe(0x0100)
    expect(withRequest.valueRequest).not.toBeNull()

    it('re-selecting absolute (already absolute) keeps the state and provenance', () => {
      const s = appReducer(withRequest, { type: 'vout-mode/set-relative', relative: false })
      expect(s).toBe(withRequest)
    })

    it('re-selecting relative (already relative) keeps the state and provenance', () => {
      // SLINEAR16 offset encodes for any LINEAR byte (§13.3/§13.4), including
      // relative 0x98 — the only way to hold provenance on a relative byte.
      const relativeByte = appReducer(
        appReducer(l16, { type: 'l16/set-payload-kind', payloadKind: 'slinear16-offset' }),
        { type: 'vout-mode/set-relative', relative: true },
      )
      const withRelativeRequest = appReducer(relativeByte, { type: 'value/set', value: '1' })
      expect(withRelativeRequest.raw).toBe(0x0100)
      expect(withRelativeRequest.valueRequest).not.toBeNull()

      const s = appReducer(withRelativeRequest, { type: 'vout-mode/set-relative', relative: true })
      expect(s).toBe(withRelativeRequest)
    })

    it('re-selecting the same format keeps the state and provenance', () => {
      const s = appReducer(withRequest, { type: 'vout-mode/set-format', format: 0 })
      expect(s).toBe(withRequest)
    })

    it('re-entering the same LINEAR N keeps the state and provenance', () => {
      const s = appReducer(withRequest, { type: 'vout-mode/set-linear-n', n: '-8' })
      expect(s).toBe(withRequest)
    })

    it('re-selecting the same parameter keeps the state and provenance', () => {
      const s = appReducer(withRequest, { type: 'vout-mode/set-parameter', parameter: 0x18 })
      expect(s).toBe(withRequest)
    })

    it('expert hex edit with the same byte keeps the state and provenance', () => {
      const s = appReducer(withRequest, { type: 'vout-mode/set-byte', hex: '18' })
      expect(s).toBe(withRequest)
    })

    it('a real byte change still invalidates provenance (opposite path)', () => {
      const s = appReducer(withRequest, { type: 'vout-mode/set-relative', relative: true })
      expect(s.voutMode.byte).toBe(0x98)
      expect(s.valueRequest).toBeNull()
    })
  })

  describe('byte-order/set', () => {
    it('sets byteOrder', () => {
      const s = appReducer(base, { type: 'byte-order/set', endian: 'be' })
      expect(s.byteOrder).toBe('be')
    })
  })

  describe('raw/set-from-hex with L16 byte order', () => {
    it('swaps bytes in BE mode', () => {
      const be: AppState = {
        ...base,
        mode: 'L16',
        byteOrder: 'be',
      }
      const s = appReducer(be, { type: 'raw/set-from-hex', hex: '1234' })
      expect(s.raw).toBe(0x3412)
    })

    it('does not swap in LE mode', () => {
      const le: AppState = {
        ...base,
        mode: 'L16',
        byteOrder: 'le',
      }
      const s = appReducer(le, { type: 'raw/set-from-hex', hex: '1234' })
      expect(s.raw).toBe(0x1234)
    })
  })

  describe('direct/set-y', () => {
    const directMode = appReducer(base, { type: 'mode/set', mode: 'DIRECT' })

    it('encodes signed Y into raw (single source of truth)', () => {
      const s = appReducer(directMode, { type: 'direct/set-y', y: '100' })
      expect(s.raw).toBe(100)
      expect(s.direct).toEqual(directMode.direct)
    })

    it('clamps Y to -32768..32767', () => {
      const hi = appReducer(directMode, { type: 'direct/set-y', y: '40000' })
      expect(hi.raw).toBe(0x7fff)
      const lo = appReducer(directMode, { type: 'direct/set-y', y: '-40000' })
      expect(lo.raw).toBe(0x8000)
    })

    it('ignores invalid string', () => {
      const s = appReducer(directMode, { type: 'direct/set-y', y: 'abc' })
      expect(s.raw).toBe(directMode.raw)
    })

    it('is a no-op outside DIRECT mode', () => {
      const s = appReducer(base, { type: 'direct/set-y', y: '100' })
      expect(s.raw).toBe(base.raw)
    })
  })

  describe('direct/set-coeff', () => {
    it('sets m as a signed 16-bit integer', () => {
      const s = appReducer(base, { type: 'direct/set-coeff', name: 'm', value: '-10' })
      expect(s.direct.m).toBe(-10)
      expect(s.direct.errors.m).toBeNull()
    })

    it('sets b as a signed 16-bit integer', () => {
      const s = appReducer(base, { type: 'direct/set-coeff', name: 'b', value: '-32768' })
      expect(s.direct.b).toBe(-32768)
    })

    it('sets r as a signed 8-bit integer', () => {
      const s = appReducer(base, { type: 'direct/set-coeff', name: 'r', value: '3' })
      expect(s.direct.r).toBe(3)
    })

    it('rejects float coefficients with an explicit error', () => {
      const s = appReducer(base, { type: 'direct/set-coeff', name: 'm', value: '2.5' })
      expect(s.direct.m).toBe(base.direct.m)
      expect(s.direct.errors.m).toContain('M 必须是')
    })

    it('rejects out-of-range m', () => {
      const s = appReducer(base, { type: 'direct/set-coeff', name: 'm', value: '40000' })
      expect(s.direct.m).toBe(base.direct.m)
      expect(s.direct.errors.m).toContain('M 必须是')
    })

    it('accepts m/b boundaries', () => {
      const hi = appReducer(base, { type: 'direct/set-coeff', name: 'm', value: '32767' })
      expect(hi.direct.m).toBe(32767)
      const lo = appReducer(base, { type: 'direct/set-coeff', name: 'm', value: '-32768' })
      expect(lo.direct.m).toBe(-32768)
    })

    it('accepts r boundaries and rejects out-of-range r', () => {
      const hi = appReducer(base, { type: 'direct/set-coeff', name: 'r', value: '127' })
      expect(hi.direct.r).toBe(127)
      const lo = appReducer(base, { type: 'direct/set-coeff', name: 'r', value: '-128' })
      expect(lo.direct.r).toBe(-128)
      const bad = appReducer(base, { type: 'direct/set-coeff', name: 'r', value: '128' })
      expect(bad.direct.r).toBe(base.direct.r)
      expect(bad.direct.errors.r).toContain('R 必须是')
    })

    it('stores m=0 with an explicit error (never silent)', () => {
      const s = appReducer(base, { type: 'direct/set-coeff', name: 'm', value: '0' })
      expect(s.direct.m).toBe(0)
      expect(s.direct.errors.m).toContain('m 不能为 0')
    })

    it('clears error after a valid coefficient is entered', () => {
      const bad = appReducer(base, { type: 'direct/set-coeff', name: 'm', value: '2.5' })
      expect(bad.direct.errors.m).toBeTruthy()
      const good = appReducer(bad, { type: 'direct/set-coeff', name: 'm', value: '2' })
      expect(good.direct.m).toBe(2)
      expect(good.direct.errors.m).toBeNull()
    })

    it('ignores invalid string', () => {
      const s = appReducer(base, { type: 'direct/set-coeff', name: 'm', value: 'x' })
      expect(s.direct.m).toBe(base.direct.m)
      expect(s.direct.errors.m).toContain('M 必须是')
    })
  })

  describe('DIRECT value -> raw encode', () => {
    const directMode = appReducer(base, { type: 'mode/set', mode: 'DIRECT' })

    it('Value 12 with m=1,b=0,R=0 -> raw 12 -> Value 12', () => {
      const s = appReducer(directMode, { type: 'value/set', value: '12' })
      expect(s.raw).toBe(12)
    })

    it('Value -> raw -> Value round-trips with legacy rounding', () => {
      const s = appReducer(directMode, { type: 'value/set', value: '12.5' })
      expect(s.raw).toBe(13) // legacy round(12.5) = 13
      const s2 = appReducer(s, { type: 'value/set', value: '13' })
      expect(s2.raw).toBe(13)
    })

    it('encodes negative physical values to signed Y raw', () => {
      const s = appReducer(directMode, { type: 'value/set', value: '-5' })
      // y = round(-5) = -5 -> fromSigned(-5,16) = 0xFFFB
      expect(s.raw).toBe(0xfffb)
    })

    it('is a no-op when m=0', () => {
      const zeroM = appReducer(base, { type: 'direct/set-coeff', name: 'm', value: '0' })
      const directZero = appReducer(zeroM, { type: 'mode/set', mode: 'DIRECT' })
      const s = appReducer(directZero, { type: 'value/set', value: '12' })
      expect(s.raw).toBe(directZero.raw)
    })
  })

  describe('large finite requests without parse-layer clipping (v2.5.8)', () => {
    const directWith = (m: number, b: number, r: number) => {
      let s = appReducer(base, { type: 'mode/set', mode: 'DIRECT' })
      for (const [name, v] of [
        ['m', m],
        ['b', b],
        ['r', r],
      ] as const) {
        s = appReducer(s, { type: 'direct/set-coeff', name, value: String(v) })
      }
      return s
    }

    it('DIRECT m=1,b=0,R=-21: 1e21 encodes 0x0001 with the true request', () => {
      const s = appReducer(directWith(1, 0, -21), { type: 'value/set', value: '1e21' })
      // y = round(1e21 × 10^-21) = 1 → raw 0x0001 (was 0x0000 under the
      // removed ±1e20 parse clamp).
      expect(s.raw).toBe(0x0001)
      expect(s.valueRequest).toEqual({ mode: 'DIRECT', value: 1e21 })
      // raw 0x0001 decodes back to exactly the committed double 1e21.
      expect(PMBusMath.decodeDirect(1, 1, 0, -21).value).toBe(1e21)
    })

    it('DIRECT m=1,b=0,R=-21: -1e21 encodes 0xFFFF', () => {
      const s = appReducer(directWith(1, 0, -21), { type: 'value/set', value: '-1e21' })
      expect(s.raw).toBe(0xffff)
      expect(s.valueRequest).toEqual({ mode: 'DIRECT', value: -1e21 })
    })

    it('DIRECT m=-1 keeps the sign contrast (1e21 -> y=-1 -> 0xFFFF)', () => {
      const s = appReducer(directWith(-1, 0, -21), { type: 'value/set', value: '1e21' })
      expect(s.raw).toBe(0xffff)
      expect(s.valueRequest).toEqual({ mode: 'DIRECT', value: 1e21 })
    })

    it('R=-128 and R=127 boundary exponents round-trip representable vectors', () => {
      // R=-128: y = round(1e128 × 10^-128) = 1
      const lo = appReducer(directWith(1, 0, -128), { type: 'value/set', value: '1e128' })
      expect(lo.raw).toBe(0x0001)
      expect(lo.valueRequest).toEqual({ mode: 'DIRECT', value: 1e128 })
      // R=127: y = round(1e-127 × 10^127) = 1
      const hi = appReducer(directWith(1, 0, 127), { type: 'value/set', value: '1e-127' })
      expect(hi.raw).toBe(0x0001)
      expect(hi.valueRequest).toEqual({ mode: 'DIRECT', value: 1e-127 })
      expect(PMBusMath.decodeDirect(1, 1, 0, 127).value).toBe(1e-127)
    })

    it('1e20 boundary stays finite and quantizes without parse clipping', () => {
      const s = appReducer(directWith(1, 0, -21), { type: 'value/set', value: '1e20' })
      // y = round(1e20 × 1e-21) = round(0.1) = 0 → 0x0000 (quantized step,
      // not saturation: 1e20 lies inside the ±32767×10^21 encodable range).
      expect(s.raw).toBe(0x0000)
      expect(s.valueRequest).toEqual({ mode: 'DIRECT', value: 1e20 })
    })

    it('DIRECT saturation keeps the original request as the error baseline', () => {
      const s = appReducer(directWith(1, 0, -21), { type: 'value/set', value: '1e30' })
      // y = round(1e30 × 1e-21) = 1e9 → clamp 32767 → 0x7FFF saturated; the
      // provenance must keep the committed 1e30, never a clamped 1e20.
      expect(s.raw).toBe(0x7fff)
      expect(s.valueRequest).toEqual({ mode: 'DIRECT', value: 1e30 })
    })

    it('L11 saturation uses the original unclamped request', () => {
      const s = appReducer(base, { type: 'value/set', value: '1e9' })
      // 1e9 exceeds the N=15 format maximum → N=15, Y=1023 saturated.
      expect(s.l11.n).toBe(15)
      expect(s.l11.y).toBe(1023)
      expect(s.l11.valueInput).toBe(1e9)
    })

    it('L16 saturation uses the original unclamped request', () => {
      const l16 = appReducer(base, { type: 'mode/set', mode: 'L16' })
      const s = appReducer(l16, { type: 'value/set', value: '1e9' })
      // V = round(1e9 × 2^8) = 2.56e11 → clamp 65535 → 0xFFFF.
      expect(s.raw).toBe(0xffff)
      expect(s.valueRequest).toEqual({ mode: 'L16', value: 1e9 })
    })

    it('±1e400 is out of range: no commit, old raw and request preserved', () => {
      const committed = appReducer(directWith(1, 0, -21), { type: 'value/set', value: '1e21' })
      expect(committed.raw).toBe(0x0001)
      for (const text of ['1e400', '-1e400']) {
        const s = appReducer(committed, { type: 'value/set', value: text })
        expect(s.raw, text).toBe(0x0001)
        expect(s.valueRequest, text).toEqual({ mode: 'DIRECT', value: 1e21 })
      }
    })

    it('HALF treats decimal overflow as out of range but keeps ±Infinity literals', () => {
      const half = appReducer(base, { type: 'mode/set', mode: 'HALF' })
      const committed = appReducer(half, { type: 'value/set', value: '1' })
      expect(committed.raw).toBe(0x3c00)
      // 1e400 is not an HALF literal — it must not become an Infinity request.
      const overflow = appReducer(committed, { type: 'value/set', value: '1e400' })
      expect(overflow.raw).toBe(0x3c00)
      expect(overflow.valueRequest).toEqual({ mode: 'HALF', value: 1 })
      // The explicit literal stays a first-class value.
      const inf = appReducer(committed, { type: 'value/set', value: 'Infinity' })
      expect(inf.raw).toBe(0x7c00)
      expect(inf.valueRequest).toEqual({ mode: 'HALF', value: Infinity })
    })
  })

  describe('HALF value -> raw encode', () => {
    const halfMode = appReducer(base, { type: 'mode/set', mode: 'HALF' })

    it('Value 1 -> raw 0x3C00', () => {
      const s = appReducer(halfMode, { type: 'value/set', value: '1' })
      expect(s.raw).toBe(0x3c00)
    })

    it('Value NaN -> raw 0x7E00', () => {
      const s = appReducer(halfMode, { type: 'value/set', value: 'NaN' })
      expect(s.raw).toBe(0x7e00)
    })

    it('Value +Infinity -> raw 0x7C00 and -Infinity -> 0xFC00', () => {
      expect(appReducer(halfMode, { type: 'value/set', value: 'Infinity' }).raw).toBe(0x7c00)
      expect(appReducer(halfMode, { type: 'value/set', value: '-Infinity' }).raw).toBe(0xfc00)
    })

    it('Value -0 -> raw 0x8000 (preserves negative zero)', () => {
      const s = appReducer(halfMode, { type: 'value/set', value: '-0' })
      expect(s.raw).toBe(0x8000)
    })

    it('signed-zero decimal shorthand all encode 0x8000 (v2.5.7)', () => {
      // IEEE 754 binary16 keeps -0 (0x8000) distinct from +0 (0x0000);
      // Number('-.0') is -0 and the parser must preserve it (Part II §7.6).
      for (const text of ['-0', '-0.0', '-.0', '-.00', '-0e3']) {
        const s = appReducer(halfMode, { type: 'value/set', value: text })
        expect(s.raw, text).toBe(0x8000)
        expect(s.valueRequest?.mode, text).toBe('HALF')
        expect(Object.is(s.valueRequest?.value, -0), text).toBe(true)
      }
    })

    it('positive-zero shorthand variants all encode 0x0000', () => {
      for (const text of ['0', '+0', '0.0', '.0', '+.0', '0e3']) {
        expect(appReducer(halfMode, { type: 'value/set', value: text }).raw, text).toBe(0x0000)
      }
    })

    it('bare dot drafts never reach the HALF encoder (transitional)', () => {
      for (const text of ['.', '+.', '-.']) {
        const s = appReducer(halfMode, { type: 'value/set', value: text })
        expect(s.raw, text).toBe(halfMode.raw)
        expect(s.valueRequest, text).toBe(halfMode.valueRequest)
      }
    })
  })

  describe('DIRECT raw -> signed Y / Value sync', () => {
    const directMode = appReducer(base, { type: 'mode/set', mode: 'DIRECT' })

    it('raw/set-from-hex updates raw for DIRECT (Y derived by view-model)', () => {
      const s = appReducer(directMode, { type: 'raw/set-from-hex', hex: '8000' })
      expect(s.raw).toBe(0x8000)
    })

    it('raw/set clamps and stores 16-bit raw in DIRECT', () => {
      const hi = appReducer(directMode, { type: 'raw/set', raw: '131071' })
      expect(hi.raw).toBe(65535)
      const lo = appReducer(directMode, { type: 'raw/set', raw: '-1' })
      expect(lo.raw).toBe(0)
    })

    it('bit/toggle toggles raw in DIRECT', () => {
      const s = appReducer(directMode, { type: 'bit/toggle', bit: 0 })
      expect(s.raw).toBe(0x8000)
    })
  })

  describe('DIRECT error isolation', () => {
    it('keeps invalid coefficient error in state.direct.errors for DIRECT display', () => {
      const bad = appReducer(base, { type: 'direct/set-coeff', name: 'm', value: '2.5' })
      expect(bad.direct.errors.m).toBeTruthy()
      expect(bad.raw).toBe(base.raw)
    })

    it('does not corrupt an existing valid raw value on invalid coefficient input', () => {
      const directMode = appReducer(base, { type: 'mode/set', mode: 'DIRECT' })
      const withRaw = appReducer(directMode, { type: 'raw/set-from-hex', hex: '1234' })
      const bad = appReducer(withRaw, { type: 'direct/set-coeff', name: 'm', value: '2.5' })
      expect(bad.raw).toBe(0x1234)
      expect(bad.direct.m).toBe(withRaw.direct.m)
      expect(bad.direct.errors.m).toBeTruthy()
    })

    it('keeps the error stored after switching away and back (mode-scoped display, not state reset)', () => {
      const bad = appReducer(base, { type: 'direct/set-coeff', name: 'm', value: '2.5' })
      const away = appReducer(bad, { type: 'mode/set', mode: 'L11' })
      expect(away.direct.errors.m).toBeTruthy()
      const back = appReducer(away, { type: 'mode/set', mode: 'DIRECT' })
      expect(back.direct.errors.m).toBeTruthy()
    })
  })

  describe('M21 统一整数语法（可选正负号 + 十进制数字）', () => {
    it('l11/set-n rejects 1e2 instead of clamping 100 to 15', () => {
      const s = appReducer(base, { type: 'l11/set-n', n: '1e2' })
      expect(s.l11.n).toBe(base.l11.n)
      expect(s.raw).toBe(base.raw)
    })

    it('l11/set-n rejects 0x10 instead of accepting hex 16', () => {
      const s = appReducer(base, { type: 'l11/set-n', n: '0x10' })
      expect(s.l11.n).toBe(base.l11.n)
      expect(s.raw).toBe(base.raw)
    })

    it('l11/set-y rejects 1e2 and 0x10', () => {
      for (const y of ['1e2', '0x10']) {
        const s = appReducer(base, { type: 'l11/set-y', y })
        expect(s.l11.y, y).toBe(base.l11.y)
        expect(s.raw, y).toBe(base.raw)
      }
    })

    it('direct/set-y rejects 1e2 and 0x10', () => {
      const directMode = appReducer(base, { type: 'mode/set', mode: 'DIRECT' })
      for (const y of ['1e2', '0x10']) {
        const s = appReducer(directMode, { type: 'direct/set-y', y })
        expect(s.raw, y).toBe(directMode.raw)
      }
    })

    it('direct/set-coeff rejects 1e2 and 0x10 with a per-field error', () => {
      for (const value of ['1e2', '0x10']) {
        const s = appReducer(base, { type: 'direct/set-coeff', name: 'm', value })
        expect(s.direct.m, value).toBe(base.direct.m)
        expect(s.direct.errors.m, value).toContain('M 必须是')
      }
    })

    it('keeps clamping semantics for safe out-of-range integers in clamp fields', () => {
      const n = appReducer(base, { type: 'l11/set-n', n: '500' })
      expect(n.l11.n).toBe(15)
      const y = appReducer(base, { type: 'l11/set-y', y: '5000' })
      expect(y.l11.y).toBe(1023)
    })
  })

  describe('DIRECT per-field coefficient errors', () => {
    it('keeps the m error when b is edited invalid (no overwrite, no clear)', () => {
      const badM = appReducer(base, { type: 'direct/set-coeff', name: 'm', value: '2.5' })
      const badB = appReducer(badM, { type: 'direct/set-coeff', name: 'b', value: '1.5' })
      expect(badB.direct.errors.m).toContain('M 必须是')
      expect(badB.direct.errors.b).toContain('B 必须是')
    })

    it('clears only the edited field error on valid input', () => {
      const badM = appReducer(base, { type: 'direct/set-coeff', name: 'm', value: '2.5' })
      const badB = appReducer(badM, { type: 'direct/set-coeff', name: 'b', value: '1.5' })
      const fixedB = appReducer(badB, { type: 'direct/set-coeff', name: 'b', value: '3' })
      expect(fixedB.direct.b).toBe(3)
      expect(fixedB.direct.errors.b).toBeNull()
      expect(fixedB.direct.errors.m).toContain('M 必须是')
    })

    it('stores m=0 error on the m field only and clears it when m becomes non-zero', () => {
      const zeroM = appReducer(base, { type: 'direct/set-coeff', name: 'm', value: '0' })
      expect(zeroM.direct.m).toBe(0)
      expect(zeroM.direct.errors.m).toContain('m 不能为 0')
      expect(zeroM.direct.errors.b).toBeNull()
      const fixed = appReducer(zeroM, { type: 'direct/set-coeff', name: 'm', value: '2' })
      expect(fixed.direct.m).toBe(2)
      expect(fixed.direct.errors.m).toBeNull()
    })

    it('preserves per-field errors across mode switches', () => {
      const badM = appReducer(base, { type: 'direct/set-coeff', name: 'm', value: '2.5' })
      const away = appReducer(badM, { type: 'mode/set', mode: 'L11' })
      expect(away.direct.errors.m).toContain('M 必须是')
      const back = appReducer(away, { type: 'mode/set', mode: 'DIRECT' })
      expect(back.direct.errors.m).toContain('M 必须是')
    })
  })

  describe('copy/toggle-prefix', () => {
    it('toggles prefix0x', () => {
      const s = appReducer(base, { type: 'copy/toggle-prefix' })
      expect(s.copy.prefix0x).toBe(!base.copy.prefix0x)
    })
  })

  describe('copy/toggle-space', () => {
    it('toggles spaceBetweenBytes', () => {
      const s = appReducer(base, { type: 'copy/toggle-space' })
      expect(s.copy.spaceBetweenBytes).toBe(!base.copy.spaceBetweenBytes)
    })
  })

  describe('copy/set-endian', () => {
    it('sets endian', () => {
      const s = appReducer(base, { type: 'copy/set-endian', endian: 'be' })
      expect(s.copy.endian).toBe('be')
    })
  })

  describe('ui/set-theme', () => {
    it('sets theme', () => {
      const s = appReducer(base, { type: 'ui/set-theme', theme: 'dark' })
      expect(s.ui.theme).toBe('dark')
    })
  })

  describe('ui/toggle-debug', () => {
    it('toggles debugOpen', () => {
      const s = appReducer(base, { type: 'ui/toggle-debug' })
      expect(s.ui.debugOpen).toBe(!base.ui.debugOpen)
    })
  })

  describe('M38 shared VOUT_MODE byte + L16 payload actions', () => {
    it('vout-mode/set-byte is lossless for any 0x00..0xFF including non-canonical bytes', () => {
      for (const byte of [0x00, 0x18, 0x20, 0x40, 0xa0, 0x41, 0xc1, 0xe1, 0xff]) {
        const s = appReducer(base, { type: 'vout-mode/set-byte', hex: byte.toString(16) })
        expect(s.voutMode.byte, `0x${byte.toString(16)}`).toBe(byte)
      }
    })

    it('vout-mode/toggle-bit locks bits[6:5] only on the L16 page', () => {
      const l16 = appReducer(base, { type: 'mode/set', mode: 'L16' })
      expect(appReducer(l16, { type: 'vout-mode/toggle-bit', bit: 5 }).voutMode.byte).toBe(0x18)
      expect(appReducer(l16, { type: 'vout-mode/toggle-bit', bit: 6 }).voutMode.byte).toBe(0x18)
      expect(appReducer(l16, { type: 'vout-mode/toggle-bit', bit: 7 }).voutMode.byte).toBe(0x98)
      expect(appReducer(l16, { type: 'vout-mode/toggle-bit', bit: 0 }).voutMode.byte).toBe(0x19)

      const standalone = appReducer(base, { type: 'mode/set', mode: 'VOUT_MODE' })
      expect(appReducer(standalone, { type: 'vout-mode/toggle-bit', bit: 5 }).voutMode.byte).toBe(
        0x38,
      )
      expect(appReducer(standalone, { type: 'vout-mode/toggle-bit', bit: 6 }).voutMode.byte).toBe(
        0x58,
      )
    })

    it('l16/set-payload-kind switches ULINEAR16 / SLINEAR16 offset', () => {
      const l16 = appReducer(base, { type: 'mode/set', mode: 'L16' })
      const s = appReducer(l16, { type: 'l16/set-payload-kind', payloadKind: 'slinear16-offset' })
      expect(s.l16.payloadKind).toBe('slinear16-offset')
    })

    it("l16/set-slinear-y encodes two's complement into raw", () => {
      const l16 = appReducer(base, { type: 'mode/set', mode: 'L16' })
      const kind = appReducer(l16, {
        type: 'l16/set-payload-kind',
        payloadKind: 'slinear16-offset',
      })
      expect(appReducer(kind, { type: 'l16/set-slinear-y', y: '-1' }).raw).toBe(0xffff)
      expect(appReducer(kind, { type: 'l16/set-slinear-y', y: '-32768' }).raw).toBe(0x8000)
      expect(appReducer(kind, { type: 'l16/set-slinear-y', y: '32767' }).raw).toBe(0x7fff)
    })

    it('l16/set-nominal-vout accepts finite non-negative decimals only', () => {
      const l16 = appReducer(base, { type: 'mode/set', mode: 'L16' })
      expect(
        appReducer(l16, { type: 'l16/set-nominal-vout', nominalVout: '3.3' }).l16.nominalVout,
      ).toBe(3.3)
      expect(
        appReducer(l16, { type: 'l16/set-nominal-vout', nominalVout: '-1' }).l16.nominalVout,
      ).toBeNull()
      expect(
        appReducer(l16, { type: 'l16/set-nominal-vout', nominalVout: 'abc' }).l16.nominalVout,
      ).toBeNull()
    })

    it('l16/clear-nominal-vout resets the reference to null (v2.5.8)', () => {
      const l16 = appReducer(base, { type: 'mode/set', mode: 'L16' })
      const relative = appReducer(l16, { type: 'vout-mode/set-relative', relative: true })
      const withNominal = appReducer(relative, {
        type: 'l16/set-nominal-vout',
        nominalVout: '12',
      })
      expect(withNominal.l16.nominalVout).toBe(12)
      const cleared = appReducer(withNominal, { type: 'l16/clear-nominal-vout' })
      expect(cleared.l16.nominalVout).toBeNull()
      // Re-entering a legal value restores the reference.
      const restored = appReducer(cleared, { type: 'l16/set-nominal-vout', nominalVout: '5' })
      expect(restored.l16.nominalVout).toBe(5)
    })

    it('l16/clear-nominal-vout touches only the nominal channel', () => {
      const l16 = appReducer(base, { type: 'mode/set', mode: 'L16' })
      const relative = appReducer(l16, { type: 'vout-mode/set-relative', relative: true })
      const withNominal = appReducer(relative, {
        type: 'l16/set-nominal-vout',
        nominalVout: '12',
      })
      const cleared = appReducer(withNominal, { type: 'l16/clear-nominal-vout' })
      expect(cleared.raw).toBe(withNominal.raw)
      expect(cleared.voutMode.byte).toBe(withNominal.voutMode.byte)
      expect(cleared.l16.payloadKind).toBe(withNominal.l16.payloadKind)
      expect(cleared.byteOrder).toBe(withNominal.byteOrder)
      expect(cleared.mode).toBe(withNominal.mode)
    })

    it('l16/clear-nominal-vout is idempotent and null stays distinct from 0', () => {
      const l16 = appReducer(base, { type: 'mode/set', mode: 'L16' })
      const alreadyNull = appReducer(l16, { type: 'l16/clear-nominal-vout' })
      expect(alreadyNull).toBe(l16)
      const zero = appReducer(l16, { type: 'l16/set-nominal-vout', nominalVout: '0' })
      expect(zero.l16.nominalVout).toBe(0)
      expect(appReducer(zero, { type: 'l16/clear-nominal-vout' }).l16.nominalVout).toBeNull()
      // 0 keeps the decode-only contract: a 0 reference is a value, not "no
      // reference" — the two states are observably different.
      expect(zero.l16.nominalVout).not.toBeNull()
    })

    it('l16/set-nominal-vout rejects out-of-range decimal text (v2.5.8)', () => {
      const l16 = appReducer(base, { type: 'mode/set', mode: 'L16' })
      const committed = appReducer(l16, { type: 'l16/set-nominal-vout', nominalVout: '12' })
      const rejected = appReducer(committed, { type: 'l16/set-nominal-vout', nominalVout: '1e400' })
      expect(rejected.l16.nominalVout).toBe(12)
    })

    it('l16/apply-calculator-linear-example writes 0x18 to the shared byte', () => {
      const s = appReducer(base, { type: 'vout-mode/set-byte', hex: '40' })
      expect(appReducer(s, { type: 'l16/apply-calculator-linear-example' }).voutMode.byte).toBe(
        0x18,
      )
    })
  })

  describe('immutability', () => {
    it('never mutates original state', () => {
      const original = {
        ...base,
        l11: { ...base.l11 },
        l16: { ...base.l16 },
        direct: { ...base.direct },
        copy: { ...base.copy },
        ui: { ...base.ui },
      }
      const s = appReducer(original, { type: 'mode/set', mode: 'L16' })
      expect(original.mode).toBe(base.mode)
      expect(s).not.toBe(original)
    })
  })
})
