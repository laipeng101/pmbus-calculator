import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// vitest 的 jsdom 环境不保证 import.meta.url 是 file:// scheme，统一用 cwd 解析。
const html = readFileSync(path.resolve(process.cwd(), 'pmbus-calculator.html'), 'utf8')

/**
 * Contract test for the legacy offline archive (pmbus-calculator.html).
 *
 * The file is deliberately retained as a repository-internal offline
 * compatibility file, so its algorithms and command notes must stay aligned
 * with the current domain model (docs/DOMAIN_MODEL.md).  These assertions
 * guard the v2.0.1 corrections against regression; the file's own built-in
 * self-test suite additionally covers the runtime behavior.
 */
describe('legacy HTML offline archive — domain consistency (v2.0.1)', () => {
  it('uses the corrected two-bit VOUT_MODE mask with bit7 relative flag (Part II §8.3)', () => {
    expect(html).toContain('(byte >> 5) & 0x03')
    expect(html).not.toContain('(byte >> 5) & 0x07')
    expect(html).toContain('const isRelative = (byte & 0x80) !== 0')
  })

  it('no longer flags Y=1023 / Y=-1024 as overflow boundaries', () => {
    expect(html).not.toContain('Y 接近极值')
  })

  it('keeps the 0x0100 STATUS_WORD special-write semantics in the command note', () => {
    expect(html).toContain('特殊写入 0x0100 仅用于清除 UNKNOWN 位')
  })

  it('shows the READ_EIN 6/5 byte-count conflict and the §18.13 reference', () => {
    expect(html).toContain('规范内部存在字节数冲突')
    expect(html).toContain('PMBus Part II §18.13 描述 6 个数据字节')
    expect(html).toContain('Appendix I Table 31 列为 5')
    expect(html).not.toContain('Part II 18.14')
  })

  it('repositions the product name in the title and h1', () => {
    expect(html).toContain('<title>PMBus 数值格式计算器')
    expect(html).toContain('<h1>PMBus 数值格式计算器')
    expect(html).not.toContain('PMBus 协议计算器')
  })
})
