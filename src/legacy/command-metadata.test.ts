import { describe, it, expect } from 'vitest'
import { COMMAND_METADATA, describeTransactionType, describeTransactions } from './command-metadata'

interface ExpectedCommand {
  cmd: number
  write?: { type: string; dataBytes?: number }
  read?: { type: string; dataBytes?: number }
  units: string
  spec: string
  encodingRule: string
}

/**
 * Golden table derived from PMBus 1.3.1 Part II Appendix I Table 31 and the
 * command sections referenced by each row.  Standard definitions are
 * read-only reference data: they carry no presets and never drive mode,
 * parameters or raw.
 */
const GOLDEN: Record<string, ExpectedCommand> = {
  VOUT_COMMAND: {
    cmd: 0x21,
    write: { type: 'write_word', dataBytes: 2 },
    read: { type: 'read_word', dataBytes: 2 },
    units: 'V',
    spec: 'PMBus Part II §13.2, Appendix I Table 31',
    encodingRule: 'follows_vout_mode',
  },
  VOUT_OV_FAULT_LIMIT: {
    cmd: 0x40,
    write: { type: 'write_word', dataBytes: 2 },
    read: { type: 'read_word', dataBytes: 2 },
    units: 'V',
    spec: 'PMBus Part II §15.2, Appendix I Table 31',
    encodingRule: 'follows_vout_mode',
  },
  READ_VOUT: {
    cmd: 0x8b,
    read: { type: 'read_word', dataBytes: 2 },
    units: 'V',
    spec: 'PMBus Part II §18.4, Appendix I Table 31',
    encodingRule: 'follows_vout_mode',
  },
  READ_VIN: {
    cmd: 0x88,
    read: { type: 'read_word', dataBytes: 2 },
    units: 'V',
    spec: 'PMBus Part II §18.1, Appendix I Table 31',
    encodingRule: 'device_defined',
  },
  READ_IOUT: {
    cmd: 0x8c,
    read: { type: 'read_word', dataBytes: 2 },
    units: 'A',
    spec: 'PMBus Part II §18.5, Appendix I Table 31',
    encodingRule: 'device_defined',
  },
  READ_TEMPERATURE_1: {
    cmd: 0x8d,
    read: { type: 'read_word', dataBytes: 2 },
    units: '°C',
    spec: 'PMBus Part II §18.6, Appendix I Table 31',
    encodingRule: 'device_defined',
  },
  VIN_OV_FAULT_LIMIT: {
    cmd: 0x55,
    write: { type: 'write_word', dataBytes: 2 },
    read: { type: 'read_word', dataBytes: 2 },
    units: 'V',
    spec: 'PMBus Part II §15.23, Appendix I Table 31',
    encodingRule: 'device_defined',
  },
  OT_FAULT_LIMIT: {
    cmd: 0x4f,
    write: { type: 'write_word', dataBytes: 2 },
    read: { type: 'read_word', dataBytes: 2 },
    units: '°C',
    spec: 'PMBus Part II §15.17, Appendix I Table 31',
    encodingRule: 'device_defined',
  },
  FAN_COMMAND_1: {
    cmd: 0x3b,
    write: { type: 'write_word', dataBytes: 2 },
    read: { type: 'read_word', dataBytes: 2 },
    units: 'RPM 或占空比（见 FAN_CONFIG_1_2）',
    spec: 'PMBus Part II §14.12, Appendix I Table 31',
    encodingRule: 'device_defined',
  },
  READ_POUT: {
    cmd: 0x96,
    read: { type: 'read_word', dataBytes: 2 },
    units: 'W',
    spec: 'PMBus Part II §18.11, Appendix I Table 31',
    encodingRule: 'device_defined',
  },
  READ_FAN_SPEED_1: {
    cmd: 0x90,
    read: { type: 'read_word', dataBytes: 2 },
    units: 'RPM',
    spec: 'PMBus Part II §18.7, Appendix I Table 31',
    encodingRule: 'device_defined',
  },
  STATUS_WORD: {
    cmd: 0x79,
    write: { type: 'write_word', dataBytes: 2 },
    read: { type: 'read_word', dataBytes: 2 },
    units: '位',
    spec: 'PMBus Part II §17.2 Table 16, §10.2.5, Appendix I Table 31',
    encodingRule: 'status',
  },
  READ_EIN: {
    cmd: 0x86,
    read: { type: 'block_read' },
    units: '—',
    spec: 'PMBus Part II §18.13, Appendix I Table 31',
    encodingRule: 'block',
  },
}

describe('PMBus command reference', () => {
  it('matches the golden table for code, write transaction, read transaction, data width, units, spec, and encoding rule', () => {
    expect(Object.keys(COMMAND_METADATA).sort()).toEqual(Object.keys(GOLDEN).sort())
    for (const [key, expected] of Object.entries(GOLDEN)) {
      const cmd = COMMAND_METADATA[key]
      expect(cmd.cmd, key).toBe(expected.cmd)
      expect(cmd.transactions.write?.type ?? null, key).toBe(expected.write?.type ?? null)
      expect(cmd.transactions.write?.dataBytes ?? null, key).toBe(expected.write?.dataBytes ?? null)
      expect(cmd.transactions.read?.type ?? null, key).toBe(expected.read?.type ?? null)
      expect(cmd.transactions.read?.dataBytes ?? null, key).toBe(expected.read?.dataBytes ?? null)
      expect(cmd.units, key).toBe(expected.units)
      expect(cmd.spec, key).toBe(expected.spec)
      expect(cmd.encodingRule, key).toBe(expected.encodingRule)
    }
  })

  it('documents STATUS_WORD as a read word whose special write only clears UNKNOWN bits', () => {
    expect(COMMAND_METADATA.STATUS_WORD.note).toContain('写入 0x0100 只清除 UNKNOWN 位')
    expect(COMMAND_METADATA.STATUS_WORD.note).toContain('CLEAR_FAULTS')
  })

  it('records both READ_EIN data-byte sources in the explicit conflict model', () => {
    const conflict = COMMAND_METADATA.READ_EIN.dataBytesConflict
    expect(conflict).toEqual({
      detailedSection: {
        value: 6,
        source: 'PMBus Part II §18.13',
      },
      appendixTable: {
        value: 5,
        source: 'PMBus Part II Appendix I Table 31',
      },
    })
    expect(COMMAND_METADATA.READ_EIN.note).toContain('§18.13 写为 6 个数据字节')
    expect(COMMAND_METADATA.READ_EIN.note).toContain('Appendix I Table 31 列为 5 个')
  })

  it('describeTransactions renders both read and write sides', () => {
    expect(describeTransactions(COMMAND_METADATA.VOUT_COMMAND.transactions)).toBe(
      '写 Write Word · 读 Read Word',
    )
    expect(describeTransactions(COMMAND_METADATA.READ_VIN.transactions)).toBe('读 Read Word')
    expect(describeTransactions(COMMAND_METADATA.READ_EIN.transactions)).toBe('读 Block Read')
  })
  it('describeTransactionType covers every PMBus/SMBus transaction label', () => {
    expect(describeTransactionType('send_byte')).toBe('Send Byte')
    expect(describeTransactionType('write_byte')).toBe('Write Byte')
    expect(describeTransactionType('write_word')).toBe('Write Word')
    expect(describeTransactionType('block_write')).toBe('Block Write')
    expect(describeTransactionType('read_byte')).toBe('Read Byte')
    expect(describeTransactionType('read_word')).toBe('Read Word')
    expect(describeTransactionType('block_read')).toBe('Block Read')
  })
})
