import { describe, expect, it } from 'vitest'
import { CANONICAL_TOKENS, GLOSSARY, GLOSSARY_TERM_IDS, getGlossaryTerm } from './terminology'
import { CONTROL_HELP, CONTROL_HELP_IDS, controlHelpText } from './control-help'
import { VOUT_MODE_FORMATS, voutModeFormatLabel, voutModeFormatTerm } from './vout-mode-formats'

describe('M39 terminology glossary (single source of truth)', () => {
  it('has unique ids with all required fields present and non-empty', () => {
    const seen = new Set<string>()
    for (const term of GLOSSARY_TERM_IDS) {
      expect(seen.has(term), term + ' duplicated').toBe(false)
      seen.add(term)
      const g = GLOSSARY[term]
      expect(g.id).toBe(term)
      expect(g.token.trim().length, term + '.token').toBeGreaterThan(0)
      expect(g.name.trim().length, term + '.name').toBeGreaterThan(0)
      expect(g.detail.trim().length, term + '.detail').toBeGreaterThan(0)
      expect(['pmbus-spec', 'smbus', 'project', 'generic']).toContain(g.source)
      expect(g.scope.trim().length, term + '.scope').toBeGreaterThan(0)
    }
  })

  it('requires an exact spec reference on every normative PMBus entry', () => {
    for (const id of GLOSSARY_TERM_IDS) {
      const g = GLOSSARY[id]
      // 'pmbus' describes the specification itself; there is no deeper section.
      if (g.source === 'pmbus-spec' && id !== 'pmbus') {
        expect(g.specRef, id + ' normative entry needs specRef').toBeDefined()
        expect(g.specRef, id + ' specRef anchor').toMatch(/^Part II §/)
      }
    }
    // SMBus-sourced entries without a verifiable in-repo PDF carry no anchor.
    expect(GLOSSARY.smbus.source).toBe('smbus')
  })

  it('presents the LINEAR16 family as PMBus 1.3.1 normative naming', () => {
    // PMBus 1.3.1 Part II names all three linear formats: §8.4.1 LINEAR16
    // Formats, §8.4.1.1 ULINEAR16 Format (unsigned, direct output voltage),
    // §8.4.1.2 SLINEAR16 Format (two's-complement offset).
    expect(GLOSSARY.linear16.source).toBe('pmbus-spec')
    expect(GLOSSARY.linear16.specRef).toBe('Part II §8.4.1')
    for (const id of ['ulinear16', 'slinear16'] as const) {
      expect(GLOSSARY[id].source, id).toBe('pmbus-spec')
      expect(GLOSSARY[id].detail, id).not.toContain('非 PMBus 规范命名')
      expect(GLOSSARY[id].detail, id).toContain('1.3.1 正式格式名')
      expect(GLOSSARY[id].detail, id).toContain('1.3 旧文统称 Linear Mode')
    }
    expect(GLOSSARY.ulinear16.specRef).toBe('Part II §8.4.1.1')
    expect(GLOSSARY.ulinear16.detail).toContain('16 位无符号整数')
    expect(GLOSSARY.ulinear16.detail).toContain('VOUT_COMMAND')
    expect(GLOSSARY.slinear16.specRef).toBe('Part II §8.4.1.2')
    expect(GLOSSARY.slinear16.detail).toContain('16 位二补码')
    expect(GLOSSARY.slinear16.detail).toContain('VOUT_TRIM')
    // Project copy/display behaviour states its own scope instead of a rule.
    expect(GLOSSARY.be.source).toBe('project')
    expect('c-macro' in GLOSSARY).toBe(false)
  })

  it('keeps the N token split by explicit concept scope (LINEAR11 vs VOUT_MODE)', () => {
    const nEntries = GLOSSARY_TERM_IDS.map((id) => GLOSSARY[id]).filter((g) => g.token === 'N')
    expect(nEntries.map((g) => g.id).sort()).toEqual(['exponent', 'linear11-exponent'])
    const scopes = new Set(nEntries.map((g) => g.scope))
    expect(scopes.size).toBe(nEntries.length)
    // Each entry's PRIMARY claim names its own position; the disambiguation
    // sentence may reference the other position by name.
    expect(GLOSSARY['linear11-exponent'].detail).toContain('bits[15:11]')
    expect(GLOSSARY['linear11-exponent'].detail).toContain('§7.3')
    expect(GLOSSARY.exponent.detail).toContain('VOUT_MODE bits[4:0] 的 5 位二补码值')
  })

  it('derives the canonical token allowlist from the glossary without drift', () => {
    expect(CANONICAL_TOKENS).toEqual(glossaryTokens())
    expect(CANONICAL_TOKENS).toContain('PMBus')
    expect(CANONICAL_TOKENS).toContain('VOUT_MODE')
    expect(CANONICAL_TOKENS).toContain('LINEAR')
    expect(CANONICAL_TOKENS).toContain('IEEE 754 binary16')
  })

  it('resolves known ids and rejects unknown ids', () => {
    expect(getGlossaryTerm('vout-mode')?.name).toBe('输出电压格式配置字节')
    expect(getGlossaryTerm('linear')?.detail).toContain('X = V × 2^N')
    expect(getGlossaryTerm('nope')).toBeUndefined()
  })

  it('keeps canonical tokens verbatim (no accidental translation)', () => {
    expect(GLOSSARY['vout-mode'].token).toBe('VOUT_MODE')
    expect(GLOSSARY.vid.token).toBe('VID')
    expect(GLOSSARY.direct.token).toBe('DIRECT')
    expect(GLOSSARY['binary16'].token).toBe('IEEE 754 binary16')
    expect(GLOSSARY.le.token).toBe('LE')
    expect(GLOSSARY.be.token).toBe('BE')
  })

  it('keeps the §8.5 relative-value contract scoped to the listed commands', () => {
    expect(GLOSSARY['vout-command'].detail).toContain('8 个输出电压命令')
    expect(GLOSSARY['abs-rel'].detail).toContain('VOUT_MARGIN_HIGH')
    expect(GLOSSARY['abs-rel'].detail).toContain('POWER_GOOD_ON/OFF')
    expect(GLOSSARY['abs-rel'].detail).toContain('§8.5.3')
    expect(GLOSSARY.vid.detail).toContain('不支持 Relative')
  })

  it('states that Half conversion needs no device data and VID codes are not banned', () => {
    expect(GLOSSARY.binary16.detail).toContain('不依赖器件')
    expect(GLOSSARY['vid-code-type'].detail).toContain('1Eh–1Fh')
    expect(GLOSSARY['vid-code-type'].detail).toContain('制造商自定义')
    expect(GLOSSARY['vid-code-type'].detail).not.toContain('非法')
  })
})

describe('v2.6.0 control help registry (single source of truth)', () => {
  it('has a complete id set with non-empty Chinese help for every control', () => {
    expect(CONTROL_HELP_IDS.length).toBeGreaterThan(0)
    const seen = new Set<string>()
    for (const id of CONTROL_HELP_IDS) {
      expect(seen.has(id), id + ' duplicated').toBe(false)
      seen.add(id)
      expect(CONTROL_HELP[id].name.trim().length, id + '.name').toBeGreaterThan(0)
    }
    expect(seen.size).toBe(CONTROL_HELP_IDS.length)
  })

  it('generates dynamic help from stable templates and state params', () => {
    // L11 N lock: both states describe their own semantics.
    expect(controlHelpText('l11-n-lock', { locked: true })).toContain('自动')
    expect(controlHelpText('l11-n-lock', { locked: false })).toContain('手动')
    // Bit toggle: enabled describes the flip; disabled surfaces the reason.
    const enabled = controlHelpText('bit-toggle', {
      bitNumber: 7,
      region: '绝对值/相对值',
      value: 0,
    })
    expect(enabled).toContain('第 7 位')
    expect(enabled).toContain('翻转为 1')
    const disabled = controlHelpText('bit-toggle', {
      bitNumber: 6,
      region: '格式',
      value: 0,
      disabledReason: '格式位固定为 LINEAR',
    })
    expect(disabled).toContain('不可编辑')
    expect(disabled).toContain('格式位固定为 LINEAR')
    // Theme toggle carries the current theme label.
    expect(controlHelpText('theme-toggle', { themeLabel: '暗色' })).toContain('暗色')
  })

  it('keeps the calculator-example disclaimer in the apply-example help', () => {
    const text = controlHelpText('vout-apply-example', undefined)
    expect(text).toContain('0x18')
    expect(text).toContain('不是 PMBus 规范默认值')
  })

  it('surfaces the physical-value copy contract including the disabled reason', () => {
    expect(controlHelpText('copy-physical', { available: true, usesOverride: false })).toContain(
      '安全重编码',
    )
    expect(controlHelpText('copy-physical', { available: true, usesOverride: true })).toContain(
      '经验证的精确回录文本',
    )
    const unavailable = controlHelpText('copy-physical', {
      available: false,
      usesOverride: false,
      unavailableReason: '相对派生范围错误',
    })
    expect(unavailable).toContain('不可用')
    expect(unavailable).toContain('相对派生范围错误')
  })

  it('states preference toggle effects in both states', () => {
    expect(controlHelpText('copy-pref-prefix', { pressed: true })).toContain('点击关闭')
    expect(controlHelpText('copy-pref-prefix', { pressed: false })).toContain('点击开启')
    expect(controlHelpText('copy-pref-space', { pressed: true })).toContain('空格')
    expect(controlHelpText('copy-pref-endian-be', { pressed: false })).toContain('BE')
  })

  it('composes format help from the glossary instead of copying definitions', () => {
    const linearHelp = controlHelpText('vout-format-linear', undefined)
    expect(linearHelp).toContain('00b')
    expect(linearHelp).toContain('LINEAR')
    // The format help composes the glossary detail text (single source).
    expect(linearHelp).toContain(GLOSSARY.linear.name)
    expect(controlHelpText('vout-format-half', undefined)).toContain(GLOSSARY.binary16.token)
  })

  it('keeps the C-macro help a project-output statement, not protocol content', () => {
    const text = controlHelpText('copy-c-macro', undefined)
    expect(text).toContain('本计算器的输出格式')
    expect(text).toContain('不是 PMBus 协议内容')
  })
})

describe('VOUT_MODE format mapping (unified single source)', () => {
  it('maps every format value to a stable label and glossary term', () => {
    expect(VOUT_MODE_FORMATS.map((f) => f.value)).toEqual([0, 1, 2, 3])
    expect(VOUT_MODE_FORMATS.map((f) => f.label)).toEqual(['LINEAR', 'VID', 'DIRECT', 'IEEE Half'])
    expect(VOUT_MODE_FORMATS.map((f) => f.termId)).toEqual(['linear', 'vid', 'direct', 'binary16'])
  })

  it('resolves term/label helpers for arbitrary values without throwing', () => {
    for (const value of [0, 1, 2, 3]) {
      expect(voutModeFormatTerm(value)).toBe(VOUT_MODE_FORMATS[value].termId)
      expect(voutModeFormatLabel(value)).toBe(VOUT_MODE_FORMATS[value].label)
    }
  })
})

function glossaryTokens(): string[] {
  return GLOSSARY_TERM_IDS.map((id) => GLOSSARY[id].token)
}
