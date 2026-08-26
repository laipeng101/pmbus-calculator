import { describe, expect, it } from 'vitest'
import { CANONICAL_TOKENS, GLOSSARY, GLOSSARY_TERM_IDS, getGlossaryTerm } from './terminology'

describe('M39 terminology glossary (single source of truth)', () => {
  it('has unique ids with all required fields present and non-empty', () => {
    const seen = new Set<string>()
    for (const term of GLOSSARY_TERM_IDS) {
      expect(seen.has(term), term + ' duplicated').toBe(false)
      seen.add(term)
      const g = GLOSSARY[term]
      expect(g).toBeDefined()
      expect(g.id).toBe(term)
      expect(g.token.trim().length, term + '.token').toBeGreaterThan(0)
      expect(g.name.trim().length, term + '.name').toBeGreaterThan(0)
      expect(g.detail.trim().length, term + '.detail').toBeGreaterThan(0)
    }
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
})

function glossaryTokens(): string[] {
  return GLOSSARY_TERM_IDS.map((id) => GLOSSARY[id].token)
}
