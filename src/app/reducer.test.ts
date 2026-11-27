import { describe, it, expect } from 'vitest'
import type { AppAction } from './actions'
import { appReducer } from './reducer'
import { INITIAL_STATE, type AppState } from './state'
import { toCalculatorViewModel } from './view-model'
import { DIRECT_EXACT_MAX_LEXEME_LENGTH } from './direct-exact'
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

  describe('raw/set-from-hex', () => {
    const start = { ...base, raw: 0x4321 }

    it('clears the word on an empty input', () => {
      expect(appReducer(start, { type: 'raw/set-from-hex', hex: '' }).raw).toBe(0)
    })

    it.each(['E0 C0', '0x12345', '1G', '0x12ZZ', '0x', 'zzzz'])(
      'keeps state for invalid hex %j',
      (hex) => {
        expect(appReducer(start, { type: 'raw/set-from-hex', hex })).toBe(start)
      },
    )
  })

  describe('raw/set', () => {
    it('sets raw value', () => {
      const s = appReducer(base, { type: 'raw/set', raw: '43981' })
      expect(s.raw).toBe(0xabcd)
    })

    it.each(['L11', 'L16', 'DIRECT'] as const)('clamps %s raw word to 0..65535', (mode) => {
      const start = appReducer(base, { type: 'mode/set', mode })
      expect(appReducer(start, { type: 'raw/set', raw: '127216' }).raw).toBe(0xffff)
      expect(appReducer(start, { type: 'raw/set', raw: '-1' }).raw).toBe(0)
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

    it('ignores invalid drafts even when blur-style repair could make them valid', () => {
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

  describe('LINEAR11 strictly-nearest encoding', () => {
    it('commits the strictly nearest code with consistent N/Y/provenance', () => {
      const vectors = [
        { text: '0.0000076293945313', raw: 0x8001, n: -16, y: 1 },
        { text: '-0.0000076293945313', raw: 0x87ff, n: -16, y: -1 },
        { text: '0.0000076293945312', raw: 0x0000, n: 0, y: 0 },
        { text: '0.00000762939453125', raw: 0x0000, n: 0, y: 0 },
      ]
      for (const v of vectors) {
        const s = appReducer(base, { type: 'value/set', value: v.text })
        expect(s.raw, v.text).toBe(v.raw)
        expect(s.l11.n, v.text).toBe(v.n)
        expect(s.l11.y, v.text).toBe(v.y)
        expect(s.l11.valueInput, v.text).toBe(Number(v.text))
      }
    })

    it('keeps locked-N encoding untouched by the auto-N search', () => {
      const manual: AppState = { ...base, l11: { ...base.l11, autoN: false, n: -16 } }
      // Below the 2^-17 midpoint the locked-N path rounds Y to 0 (0x8000),
      // while the auto-N search picks the strictly nearer zero code 0x0000 —
      // the two paths must stay independent.
      const s = appReducer(manual, { type: 'value/set', value: '0.0000076293945312' })
      expect(s.l11.autoN).toBe(false)
      expect(s.l11.n).toBe(-16)
      expect(s.raw).toBe(0x8000)
      expect(s.l11.y).toBe(0)
    })

    it('surfaces the committed delta through the view-model readout', () => {
      const s = appReducer(base, { type: 'value/set', value: '0.0000076293945313' })
      const vm = toCalculatorViewModel(s)
      // Result is decoded from the raw word, not echoed from the request.
      expect(vm.valueText).toBe('0.0000152587890625')
      // requested − represented = 0.0000076293945313 − 2^-16 < 0; magnitude
      // ≥ 1e-6 uses the fixed 6-decimal format, relative error ≈ −100%.
      expect(vm.deltaKind).toBe('warn')
      expect(vm.deltaText).toBe('-0.000008 (-100.0000%)')
    })
  })

  describe('input-underflow fail-closed', () => {
    it('ignores underflow value/set in every mode, keeping raw and provenance', () => {
      const modes = ['L11', 'L16', 'DIRECT', 'HALF'] as const
      for (const mode of modes) {
        const entered = appReducer(base, { type: 'mode/set', mode })
        // Establish a committed request; the underflow draft must change nothing.
        const committed = appReducer(entered, { type: 'value/set', value: '2' })
        const s = appReducer(committed, { type: 'value/set', value: '1e-400' })
        expect(s, `${mode} must stay bit-identical`).toBe(committed)
      }
    })

    it('ignores underflow nominal reference text without clearing the old nominal', () => {
      const rel = appReducer(base, { type: 'mode/set', mode: 'L16' })
      const set = appReducer(rel, { type: 'l16/set-nominal-vout', nominalVout: '5' })
      const s = appReducer(set, { type: 'l16/set-nominal-vout', nominalVout: '1e-400' })
      expect(s.l16.nominalVout).toBe(5)
    })

    it('still commits true zero texts with their sign (HALF −0 → 0x8000)', () => {
      const half = appReducer(base, { type: 'mode/set', mode: 'HALF' })
      const minusZero = appReducer(half, { type: 'value/set', value: '-0e400' })
      expect(minusZero.raw).toBe(0x8000)
      const plusZero = appReducer(half, { type: 'value/set', value: '0e-400' })
      expect(plusZero.raw).toBe(0x0000)
    })

    it('accepts 5e-324 as a finite request and quantizes to HALF zero with a real delta', () => {
      const half = appReducer(base, { type: 'mode/set', mode: 'HALF' })
      const s = appReducer(half, { type: 'value/set', value: '5e-324' })
      // Format-level quantization of a legal request — not an input error.
      expect(s.raw).toBe(0x0000)
      expect(s.valueRequest).toEqual({ mode: 'HALF', value: 5e-324 })
      const vm = toCalculatorViewModel(s)
      expect(vm.deltaKind).toBe('warn')
      expect(vm.deltaText).toBe('+5e-324 (100.0000%)')
    })
  })

  describe('编码请求的状态转换', () => {
    it.each([
      { mode: 'L16', raw: 0x0c00, request: { mode: 'L16', value: 12 } },
      { mode: 'DIRECT', raw: 12, request: { mode: 'DIRECT', value: 12, text: '12' } },
      { mode: 'HALF', raw: 0x4a00, request: { mode: 'HALF', value: 12 } },
    ] as const)(
      '$mode 重新选择当前模式时保留完整状态，修改原始字或模式时清除请求',
      ({ mode, raw, request }) => {
        const start = appReducer(base, { type: 'mode/set', mode })
        const committed = appReducer(start, { type: 'value/set', value: '12' })
        expect(committed.raw).toBe(raw)
        expect(committed.valueRequest).toEqual(request)
        const before = structuredClone(committed)
        expect(appReducer(committed, { type: 'mode/set', mode })).toEqual(before)

        const changes: AppAction[] = [
          { type: 'raw/set-from-hex', hex: 'ABCD' },
          { type: 'bit/toggle', bit: 15 },
          { type: 'mode/set', mode: 'L11' },
        ]
        for (const action of changes) {
          expect(appReducer(committed, action).valueRequest, action.type).toBeNull()
        }
      },
    )

    it('retains an explicit LINEAR11 request through its dedicated channel', () => {
      const state = appReducer(base, { type: 'value/set', value: '12' })
      expect(state.l11.valueInput).toBe(12)
      expect(state.valueRequest).toBeNull()
    })

    it('invalidates a LINEAR16 request when the payload kind or configuration changes', () => {
      const l16 = appReducer(base, { type: 'mode/set', mode: 'L16' })
      const committed = appReducer(l16, { type: 'value/set', value: '12' })
      expect(committed.valueRequest).toEqual({ mode: 'L16', value: 12 })
      const changes: AppAction[] = [
        { type: 'l16/set-payload-kind', payloadKind: 'slinear16-offset' },
        { type: 'vout-mode/set-linear-n', n: '-9' },
      ]
      for (const action of changes) {
        expect(appReducer(committed, action).valueRequest, action.type).toBeNull()
      }
    })

    it('invalidates a DIRECT request when Y or any coefficient changes', () => {
      const direct = appReducer(base, { type: 'mode/set', mode: 'DIRECT' })
      const committed = appReducer(direct, { type: 'value/set', value: '12' })
      const changes: AppAction[] = [
        { type: 'direct/set-y', y: '-5' },
        { type: 'direct/set-coeff', name: 'm', value: '2' },
        { type: 'direct/set-coeff', name: 'b', value: '1' },
        { type: 'direct/set-coeff', name: 'r', value: '1' },
        { type: 'direct/set-coeff', name: 'm', value: '0' },
      ]
      expect(committed.valueRequest).toEqual({ mode: 'DIRECT', value: 12, text: '12' })
      for (const action of changes) {
        expect(appReducer(committed, action).valueRequest, JSON.stringify(action)).toBeNull()
      }
    })

    it('re-establishes the DIRECT request after explicit re-entry of the same value', () => {
      const direct = appReducer(base, { type: 'mode/set', mode: 'DIRECT' })
      const encoded = appReducer(direct, { type: 'value/set', value: '5' })
      const decoded = appReducer(encoded, { type: 'raw/set-from-hex', hex: '0005' })
      expect(decoded.raw).toBe(5)
      expect(decoded.valueRequest).toBeNull()
      const reentered = appReducer(decoded, { type: 'value/set', value: '5' })
      expect(reentered.raw).toBe(5)
      expect(reentered.valueRequest).toEqual({ mode: 'DIRECT', value: 5, text: '5' })
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

  describe('SLINEAR16 offset bit7 semantics', () => {
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

    it('标称参考值拒绝无法提交的草稿', () => {
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

    it('keeps raw-only provenance unknown through both toggle directions', () => {
      const rawOnly = appReducer(base, { type: 'raw/set-from-hex', hex: 'F123' })
      const manual = appReducer(rawOnly, { type: 'l11/toggle-auto-n' })
      const automatic = appReducer(manual, { type: 'l11/toggle-auto-n' })
      for (const state of [manual, automatic]) {
        expect(state.raw).toBe(0xf123)
        expect(state.l11.valueInput).toBeNull()
        expect(toCalculatorViewModel(state).deltaText).toBeUndefined()
      }
    })

    it('retains auto-N canonicalization without inventing a request', () => {
      const rawOnly = appReducer(base, { type: 'raw/set-from-hex', hex: '0801' })
      const manual = appReducer(rawOnly, { type: 'l11/toggle-auto-n' })
      expect(manual.raw).toBe(0x0801)
      const automatic = appReducer(manual, { type: 'l11/toggle-auto-n' })
      expect(automatic.raw).toBe(0x0002)
      expect(automatic.l11.valueInput).toBeNull()
    })

    it('re-encodes a real request instead of replacing it with the represented value', () => {
      const rawOnly = appReducer(base, { type: 'raw/set-from-hex', hex: '0801' })
      const manual = appReducer(rawOnly, { type: 'l11/toggle-auto-n' })
      const requested = appReducer(manual, { type: 'value/set', value: '1.25' })
      expect(requested.raw).toBe(0x0801)
      expect(requested.l11.valueInput).toBe(1.25)
      const automatic = appReducer(requested, { type: 'l11/toggle-auto-n' })
      expect(automatic.raw).toBe(0xf005)
      expect(automatic.l11.valueInput).toBe(1.25)
      expect(toCalculatorViewModel(automatic).deltaKind).toBe('ok')
      const locked = appReducer(automatic, { type: 'l11/toggle-auto-n' })
      expect(locked.l11.valueInput).toBe(1.25)
      expect(locked.raw).toBe(0xf005)
    })

    it('preserves an explicit zero request', () => {
      const requested = appReducer(base, { type: 'value/set', value: '0' })
      const toggled = appReducer(requested, { type: 'l11/toggle-auto-n' })
      expect(toggled.l11.valueInput).toBe(0)
      expect(toCalculatorViewModel(toggled).deltaText).toBe('+0.000000 (—)')
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

  describe('structured VOUT_MODE actions', () => {
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

    it.each([
      { hex: '98', format: 2, name: 'DIRECT', expected: 0xc0 },
      { hex: '98', format: 3, name: 'IEEE Half', expected: 0xe0 },
      { hex: '98', format: 1, name: 'VID', expected: 0x38 },
      { hex: 'E1', format: 0, name: 'LINEAR', expected: 0x81 },
    ] as const)('从 0x$hex 切换到 $name 时按目标格式更新配置字节', ({ hex, format, expected }) => {
      const start = appReducer(
        { ...base, mode: 'VOUT_MODE', raw: 0x3412 },
        {
          type: 'vout-mode/set-byte',
          hex,
        },
      )
      const state = appReducer(start, { type: 'vout-mode/set-format', format })
      expect(state).toMatchObject({ mode: 'VOUT_MODE', raw: 0x3412, voutMode: { byte: expected } })
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
      const s0 = appReducer({ ...base, raw: 0x3412 }, { type: 'mode/set', mode: 'L16' })
      const s1 = appReducer(s0, { type: 'vout-mode/set-relative', relative: true })
      expect(s1.raw).toBe(s0.raw)
      expect(s1.mode).toBe('L16')
      const s2 = appReducer(s1, { type: 'vout-mode/set-linear-n', n: '-16' })
      expect(s2.raw).toBe(s0.raw)
      expect(s2.mode).toBe('L16')
    })
  })

  describe('重复设置同一个 VOUT_MODE 字节', () => {
    const l16 = appReducer(base, { type: 'mode/set', mode: 'L16' })
    const withRequest = appReducer(l16, { type: 'value/set', value: '1' })

    it.each([
      { label: '绝对值', action: { type: 'vout-mode/set-relative', relative: false } },
      { label: 'LINEAR 格式', action: { type: 'vout-mode/set-format', format: 0 } },
      { label: '指数 N', action: { type: 'vout-mode/set-linear-n', n: '-8' } },
      { label: '参数位', action: { type: 'vout-mode/set-parameter', parameter: 0x18 } },
      { label: '十六进制字节', action: { type: 'vout-mode/set-byte', hex: '18' } },
    ] satisfies { label: string; action: AppAction }[])(
      '重选$label保留完整状态和编码请求',
      ({ action }) => {
        expect(withRequest).toMatchObject({ raw: 0x0100, valueRequest: { mode: 'L16', value: 1 } })
        const before = structuredClone(withRequest)
        expect(appReducer(withRequest, action)).toEqual(before)
      },
    )

    it('有符号偏移也可在重复选择相对值时保留请求', () => {
      const offset = appReducer(l16, {
        type: 'l16/set-payload-kind',
        payloadKind: 'slinear16-offset',
      })
      const relative = appReducer(offset, { type: 'vout-mode/set-relative', relative: true })
      const encoded = appReducer(relative, { type: 'value/set', value: '1' })
      expect(encoded).toMatchObject({
        raw: 0x0100,
        voutMode: { byte: 0x98 },
        valueRequest: { mode: 'L16', value: 1 },
      })
      const before = structuredClone(encoded)
      expect(appReducer(encoded, { type: 'vout-mode/set-relative', relative: true })).toEqual(
        before,
      )
    })

    it('实际字节改变时清除原请求', () => {
      const next = appReducer(withRequest, { type: 'vout-mode/set-relative', relative: true })
      expect(next).toMatchObject({ raw: 0x0100, voutMode: { byte: 0x98 }, valueRequest: null })
    })
  })

  describe('direct/set-y', () => {
    const directMode = appReducer(base, { type: 'mode/set', mode: 'DIRECT' })

    it.each([
      { y: '100', raw: 100 },
      { y: '32767', raw: 0x7fff },
      { y: '-32768', raw: 0x8000 },
      { y: '40000', raw: 0x7fff },
      { y: '-40000', raw: 0x8000 },
    ])('encodes and clamps signed Y=$y', ({ y, raw }) => {
      const state = appReducer(directMode, { type: 'direct/set-y', y })
      expect(state.raw).toBe(raw)
      expect(state.direct).toEqual(directMode.direct)
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
    it.each([
      { name: 'm', min: -32768, max: 32767 },
      { name: 'b', min: -32768, max: 32767 },
      { name: 'r', min: -128, max: 127 },
    ] as const)(
      'accepts both boundaries and sets a field error outside $name range',
      ({ name, min, max }) => {
        const direct = { ...base, mode: 'DIRECT' as const, raw: 0x1234 }
        for (const value of [min, max]) {
          const state = appReducer(direct, { type: 'direct/set-coeff', name, value: String(value) })
          expect(state.direct[name]).toBe(value)
          expect(state.direct.errors[name]).toBeNull()
          expect(state.raw).toBe(0x1234)
        }
        for (const value of [String(min - 1), String(max + 1), '2.5', 'x']) {
          const rejected = appReducer(direct, { type: 'direct/set-coeff', name, value })
          expect(rejected.direct[name]).toBe(direct.direct[name])
          expect(rejected.direct.errors[name]).toContain(`${name.toUpperCase()} 必须是`)
          expect(rejected.raw).toBe(0x1234)
        }
      },
    )
  })

  describe('large finite requests without parse-layer clipping', () => {
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
      expect(s.valueRequest).toEqual({ mode: 'DIRECT', value: 1e21, text: '1e21' })
      // raw 0x0001 decodes back to exactly the committed double 1e21.
      expect(PMBusMath.decodeDirect(1, 1, 0, -21).value).toBe(1e21)
    })

    it('DIRECT m=1,b=0,R=-21: -1e21 encodes 0xFFFF', () => {
      const s = appReducer(directWith(1, 0, -21), { type: 'value/set', value: '-1e21' })
      expect(s.raw).toBe(0xffff)
      expect(s.valueRequest).toEqual({ mode: 'DIRECT', value: -1e21, text: '-1e21' })
    })

    it('DIRECT m=-1 keeps the sign contrast (1e21 -> y=-1 -> 0xFFFF)', () => {
      const s = appReducer(directWith(-1, 0, -21), { type: 'value/set', value: '1e21' })
      expect(s.raw).toBe(0xffff)
      expect(s.valueRequest).toEqual({ mode: 'DIRECT', value: 1e21, text: '1e21' })
    })

    it('R=-128 and R=127 boundary exponents round-trip representable vectors', () => {
      // R=-128: y = round(1e128 × 10^-128) = 1
      const lo = appReducer(directWith(1, 0, -128), { type: 'value/set', value: '1e128' })
      expect(lo.raw).toBe(0x0001)
      expect(lo.valueRequest).toEqual({ mode: 'DIRECT', value: 1e128, text: '1e128' })
      // R=127: y = round(1e-127 × 10^127) = 1
      const hi = appReducer(directWith(1, 0, 127), { type: 'value/set', value: '1e-127' })
      expect(hi.raw).toBe(0x0001)
      expect(hi.valueRequest).toEqual({ mode: 'DIRECT', value: 1e-127, text: '1e-127' })
      expect(PMBusMath.decodeDirect(1, 1, 0, 127).value).toBe(1e-127)
    })

    it('1e20 boundary stays finite and quantizes without parse clipping', () => {
      const s = appReducer(directWith(1, 0, -21), { type: 'value/set', value: '1e20' })
      // y = round(1e20 × 1e-21) = round(0.1) = 0 → 0x0000 (quantized step,
      // not saturation: 1e20 lies inside the ±32767×10^21 encodable range).
      expect(s.raw).toBe(0x0000)
      expect(s.valueRequest).toEqual({ mode: 'DIRECT', value: 1e20, text: '1e20' })
    })

    it('DIRECT saturation keeps the original request as the error baseline', () => {
      const s = appReducer(directWith(1, 0, -21), { type: 'value/set', value: '1e30' })
      // y = round(1e30 × 1e-21) = 1e9 → clamp 32767 → 0x7FFF saturated; the
      // provenance must keep the committed 1e30, never a clamped 1e20.
      expect(s.raw).toBe(0x7fff)
      expect(s.valueRequest).toEqual({ mode: 'DIRECT', value: 1e30, text: '1e30' })
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
        expect(s.valueRequest, text).toEqual({ mode: 'DIRECT', value: 1e21, text: '1e21' })
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

    it.each([
      { text: '1', value: 1, raw: 0x3c00 },
      { text: 'NaN', value: NaN, raw: 0x7e00 },
      { text: 'Infinity', value: Infinity, raw: 0x7c00 },
      { text: '+Infinity', value: Infinity, raw: 0x7c00 },
      { text: '-Infinity', value: -Infinity, raw: 0xfc00 },
      { text: '-0', value: -0, raw: 0x8000 },
      { text: '-.0', value: -0, raw: 0x8000 },
      { text: '0e3', value: 0, raw: 0x0000 },
    ])('retains the request and canonical encoded bits for $text', ({ text, value, raw }) => {
      const committed = appReducer(halfMode, { type: 'raw/set-from-hex', hex: '3555' })
      const result = appReducer(committed, { type: 'value/set', value: text })
      expect(result.raw).toBe(raw)
      expect(result.valueRequest?.mode).toBe('HALF')
      expect(result.valueRequest?.value).toBe(value)
    })

    it('bare dot drafts never reach the HALF encoder (transitional)', () => {
      for (const text of ['.', '+.', '-.']) {
        const s = appReducer(halfMode, { type: 'value/set', value: text })
        expect(s.raw, text).toBe(halfMode.raw)
        expect(s.valueRequest, text).toBe(halfMode.valueRequest)
      }
    })
  })

  describe('统一整数语法（可选正负号 + 十进制数字）', () => {
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

  describe('ui/set-bit-mapping-open', () => {
    it.each(['rawWord', 'voutMode'] as const)(
      '%s visibility changes preserve the complete calculation state and the other panel',
      (panel) => {
        const requested = appReducer(base, { type: 'value/set', value: '12.5' })
        const closed = appReducer(requested, {
          type: 'ui/set-bit-mapping-open',
          panel,
          open: false,
        })
        expect(closed).toEqual({
          ...requested,
          ui: {
            ...requested.ui,
            bitMappingOpen: { ...requested.ui.bitMappingOpen, [panel]: false },
          },
        })
        expect(requested.ui.bitMappingOpen[panel]).toBe(true)
        expect(
          appReducer(closed, {
            type: 'ui/set-bit-mapping-open',
            panel,
            open: false,
          }),
        ).toBe(closed)
        expect(
          appReducer(closed, {
            type: 'ui/set-bit-mapping-open',
            panel,
            open: true,
          }),
        ).toEqual(requested)
      },
    )
  })

  describe('共享 VOUT_MODE 字节和 LINEAR16 数据格式', () => {
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

    it('清除标称参考值后回到缺参考状态', () => {
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

    it('标称参考值越界时保留已提交的值', () => {
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

  describe('DIRECT exact typed-value encoding', () => {
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

    it('encodes two exact lexemes with the same binary64 value to different words', () => {
      const start = directWith(1, 1, 17)
      const exact = '-1.00000000000000001'
      const first = appReducer(start, { type: 'value/set', value: exact })
      expect(first.raw).toBe(0xffff)
      expect(first.valueRequest).toEqual({ mode: 'DIRECT', value: -1, text: exact })
      const rounded = appReducer(first, { type: 'value/set', value: '-1' })
      expect(rounded.raw).toBe(0)
      expect(rounded.valueRequest).toEqual({ mode: 'DIRECT', value: -1, text: '-1' })
      expect(appReducer(rounded, { type: 'value/set', value: exact })).toEqual(first)
    })

    it('keeps the legacy Math.round half-up tie on exact arithmetic', () => {
      // round(12.5) = 13 (half toward +∞) must survive the exact path.
      const s = appReducer(directWith(1, 0, 0), { type: 'value/set', value: '12.5' })
      expect(s.raw).toBe(13)
      const neg = appReducer(directWith(1, 0, 0), { type: 'value/set', value: '-12.5' })
      expect(neg.raw).toBe(0xfff4) // Math.round(-12.5) = -12
    })

    it('is a no-op when m=0 (no fabricated encode)', () => {
      const zeroM = appReducer(base, { type: 'direct/set-coeff', name: 'm', value: '0' })
      const directZero = appReducer(zeroM, { type: 'mode/set', mode: 'DIRECT' })
      const s = appReducer(directZero, { type: 'value/set', value: '-1' })
      expect(s.raw).toBe(directZero.raw)
      expect(s.valueRequest).toBeNull()
    })

    it('rejects a complete finite lexeme over the DIRECT length budget', () => {
      // Compensation keeps the value finite, so the length guard must reject the input.
      const s = directWith(1, 0, 0)
      const committed = appReducer(s, { type: 'value/set', value: '7' })
      const overlong = `1${'0'.repeat(DIRECT_EXACT_MAX_LEXEME_LENGTH)}e-${DIRECT_EXACT_MAX_LEXEME_LENGTH}`
      expect(appReducer(committed, { type: 'value/set', value: overlong })).toBe(committed)
    })

    it('fails closed on a whitespace-padded dispatch payload: trim buys no budget', () => {
      // The raw caller string is measured BEFORE any trim, so whitespace
      // padding cannot smuggle a short lexeme past the shared boundary.
      const s = directWith(1, 0, 0)
      const committed = appReducer(s, { type: 'value/set', value: '7' })
      const padded = `${' '.repeat(DIRECT_EXACT_MAX_LEXEME_LENGTH)}1`
      expect(appReducer(committed, { type: 'value/set', value: padded })).toBe(committed)
      // Megabyte payload: still a strict no-op (same state reference).
      const megabyte = `${' '.repeat(1_000_000)}1`
      expect(appReducer(committed, { type: 'value/set', value: megabyte })).toBe(committed)
      // All-whitespace payload: not an exact lexeme at all — strict no-op
      // (the UI classifies it as empty/transitional before any dispatch).
      expect(appReducer(committed, { type: 'value/set', value: '   ' })).toBe(committed)
    })

    it('keeps accepted provenance text bounded by the raw lexeme cap', () => {
      const s = directWith(1, 0, 0)
      const padded = `${' '.repeat(DIRECT_EXACT_MAX_LEXEME_LENGTH - 1)}1`
      const next = appReducer(s, { type: 'value/set', value: padded })
      expect(next.raw).toBe(1)
      expect(next.valueRequest?.mode).toBe('DIRECT')
      if (next.valueRequest?.mode === 'DIRECT') {
        expect(next.valueRequest.text).toBe(padded)
        expect(next.valueRequest.text.length).toBeLessThanOrEqual(DIRECT_EXACT_MAX_LEXEME_LENGTH)
      }
    })

    it('精确提交有效数字带长尾零和负指数的科学计数法', () => {
      // The audit vector: binary64 value exactly 1, Y=1 under m=1,b=0,R=0.
      // 尾零抵消负指数，精确的值仍为 1。
      const s = directWith(1, 0, 0)
      const committed = appReducer(s, { type: 'value/set', value: '7' })
      expect(committed.raw).toBe(0x0007)
      const text = `1${'0'.repeat(501)}e-501`
      const next = appReducer(committed, { type: 'value/set', value: text })
      expect(next).not.toBe(committed)
      expect(next.raw).toBe(0x0001)
      expect(next.valueRequest).toEqual({ mode: 'DIRECT', value: 1, text })
    })

    it('rejects out-of-range decimals and HALF literals without altering the request', () => {
      const direct = directWith(1, 0, 0)
      const committed = appReducer(direct, { type: 'value/set', value: '7' })
      for (const value of ['1e400', '1e-400', 'NaN', 'Infinity']) {
        expect(appReducer(committed, { type: 'value/set', value }), value).toBe(committed)
      }
    })
  })
})
