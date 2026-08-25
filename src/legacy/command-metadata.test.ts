import { describe, it, expect } from 'vitest'
import {
  COMMAND_METADATA,
  describeDataBytesConflict,
  describeEncodingRule,
  describeTransactions,
  getCommandConfig,
} from './command-metadata'

interface ExpectedCommand {
  cmd: number
  write?: { type: string; dataBytes?: number }
  read?: { type: string; dataBytes?: number }
  units: string
  spec: string
  encodingRule: string
}

/**
 * Golden table derived from PMBus 1.3 Part II Appendix I Table 31 and the
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
    units: 'RPM or duty cycle (FAN_CONFIG_1_2)',
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
    units: 'bit field',
    spec: 'PMBus Part II §17.2 Table 16, Appendix I Table 31',
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

describe('command metadata — read-only standard definitions (no presets)', () => {
  const all = Object.values(COMMAND_METADATA)

  it('defines every command with code, transactions, value type, units, spec, and encoding rule', () => {
    for (const cmd of all) {
      expect(cmd.cmd).toBeGreaterThanOrEqual(0)
      expect(cmd.cmd).toBeLessThanOrEqual(0xff)
      expect(cmd.transactions.write || cmd.transactions.read).toBeTruthy()
      expect(cmd.valueType).toBeTruthy()
      expect(cmd.units).toBeTruthy()
      expect(cmd.spec).toBeTruthy()
      expect(cmd.encodingRule).toBeTruthy()
    }
  })

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

  it('renames FAN_COMMAND to FAN_COMMAND_1 (0x3B)', () => {
    expect(COMMAND_METADATA.FAN_COMMAND_1).toBeDefined()
    expect(COMMAND_METADATA.FAN_COMMAND_1.cmd).toBe(0x3b)
    expect('FAN_COMMAND' in COMMAND_METADATA).toBe(false)
  })

  it('marks VOUT_COMMAND / VOUT_OV_FAULT_LIMIT / READ_VOUT as follows_vout_mode', () => {
    expect(COMMAND_METADATA.VOUT_COMMAND.encodingRule).toBe('follows_vout_mode')
    expect(COMMAND_METADATA.VOUT_OV_FAULT_LIMIT.encodingRule).toBe('follows_vout_mode')
    expect(COMMAND_METADATA.READ_VOUT.encodingRule).toBe('follows_vout_mode')
  })

  it('marks device-defined commands as device_defined, never as generic L11/L16', () => {
    const deviceDefined = [
      'READ_VIN',
      'READ_IOUT',
      'READ_TEMPERATURE_1',
      'READ_POUT',
      'READ_FAN_SPEED_1',
      'FAN_COMMAND_1',
      'OT_FAULT_LIMIT',
      'VIN_OV_FAULT_LIMIT',
    ] as const
    for (const key of deviceDefined) {
      expect(COMMAND_METADATA[key].encodingRule).toBe('device_defined')
    }
  })

  it('does not pin FAN_COMMAND_1 standard units to RPM', () => {
    expect(COMMAND_METADATA.FAN_COMMAND_1.units).not.toBe('RPM')
    expect(COMMAND_METADATA.FAN_COMMAND_1.units).toContain('FAN_CONFIG_1_2')
  })

  it('gives telemetry commands read transactions only', () => {
    const telemetry = [
      'READ_VOUT',
      'READ_VIN',
      'READ_IOUT',
      'READ_TEMPERATURE_1',
      'READ_POUT',
      'READ_FAN_SPEED_1',
    ]
    for (const key of telemetry) {
      expect(COMMAND_METADATA[key].transactions.read, key).toBeTruthy()
      expect(COMMAND_METADATA[key].transactions.write, key).toBeUndefined()
    }
  })

  it('gives R/W word commands both write_word and read_word with 2 data bytes', () => {
    const rwWords = [
      'VOUT_COMMAND',
      'VOUT_OV_FAULT_LIMIT',
      'VIN_OV_FAULT_LIMIT',
      'OT_FAULT_LIMIT',
      'FAN_COMMAND_1',
      'STATUS_WORD',
    ]
    for (const key of rwWords) {
      expect(COMMAND_METADATA[key].transactions.write, key).toEqual({
        type: 'write_word',
        dataBytes: 2,
      })
      expect(COMMAND_METADATA[key].transactions.read, key).toEqual({
        type: 'read_word',
        dataBytes: 2,
      })
    }
  })

  it('documents STATUS_WORD as a read word whose special write only clears UNKNOWN bits', () => {
    expect(COMMAND_METADATA.STATUS_WORD.transactions.write).toEqual({
      type: 'write_word',
      dataBytes: 2,
    })
    expect(COMMAND_METADATA.STATUS_WORD.note).toContain('通常为 Read Word')
    expect(COMMAND_METADATA.STATUS_WORD.note).toContain('特殊写入仅用于清除 UNKNOWN 位')
    expect(COMMAND_METADATA.STATUS_WORD.note).toContain('CLEAR_FAULTS')
    // 不得写成“写入可清除所有状态位”
    expect(COMMAND_METADATA.STATUS_WORD.note).not.toContain(
      '写入 STATUS_WORD 用于清除可清除的状态位',
    )
  })

  it('marks READ_EIN as block read with no single authoritative dataBytes', () => {
    expect(COMMAND_METADATA.READ_EIN.encodingRule).toBe('block')
    expect(COMMAND_METADATA.READ_EIN.transactions).toEqual({
      read: { type: 'block_read' },
    })
    expect(COMMAND_METADATA.READ_EIN.transactions.read?.dataBytes).toBeUndefined()
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
    expect(COMMAND_METADATA.READ_EIN.note).toContain('规范内部冲突')
    expect(COMMAND_METADATA.READ_EIN.note).toContain('§18.13 描述 6 个数据字节')
    expect(COMMAND_METADATA.READ_EIN.note).toContain('Appendix I Table 31 列为 5')
    expect(COMMAND_METADATA.READ_EIN.note).toContain('计算器不是 READ_EIN packet-length authority')
  })

  it('describeDataBytesConflict renders the default READ_EIN conflict from metadata', () => {
    const text = describeDataBytesConflict(COMMAND_METADATA.READ_EIN.dataBytesConflict!)
    expect(text).toContain('PMBus Part II §18.13')
    expect(text).toContain('6')
    expect(text).toContain('PMBus Part II Appendix I Table 31')
    expect(text).toContain('5')
  })

  it('describeDataBytesConflict reads values and sources from the argument, not from hardcoded READ_EIN values', () => {
    const text = describeDataBytesConflict({
      detailedSection: { value: 7, source: 'Fixture section A' },
      appendixTable: { value: 8, source: 'Fixture table B' },
    })
    expect(text).toContain('Fixture section A 描述 7 个数据字节')
    expect(text).toContain('Fixture table B 列为 8')
    expect(text).not.toContain('§18.13')
    expect(text).not.toContain('Appendix I Table 31')
  })

  it('marks STATUS_WORD as status without any numeric conversion preset', () => {
    expect(COMMAND_METADATA.STATUS_WORD.encodingRule).toBe('status')
    expect('preset' in COMMAND_METADATA.STATUS_WORD).toBe(false)
  })

  it('ships no presets at all: metadata is read-only reference data', () => {
    for (const cmd of all) {
      expect('preset' in cmd, cmd.key).toBe(false)
    }
  })

  it('does not keep project-demo or typical-example source strings', () => {
    const text = JSON.stringify(all)
    expect(text).not.toContain('project-demo')
    expect(text).not.toContain('PMBus Part II typical example')
    expect(text).not.toContain('PMBus Part II 18.1 typical example')
  })

  it('does not use vague §15.x references', () => {
    for (const cmd of all) {
      expect(cmd.spec).not.toContain('§15.x')
    }
  })

  it('describeEncodingRule returns a human-readable label for every rule', () => {
    expect(describeEncodingRule('follows_vout_mode')).toBe('跟随 VOUT_MODE')
    expect(describeEncodingRule('device_defined')).toBe('由器件资料决定')
    expect(describeEncodingRule('status')).toBe('STATUS 位')
    expect(describeEncodingRule('block')).toBe('BLOCK 块')
  })

  it('describeTransactions renders both read and write sides', () => {
    expect(describeTransactions(COMMAND_METADATA.VOUT_COMMAND.transactions)).toBe(
      '写 Write Word · 读 Read Word',
    )
    expect(describeTransactions(COMMAND_METADATA.READ_VIN.transactions)).toBe('读 Read Word')
    expect(describeTransactions(COMMAND_METADATA.READ_EIN.transactions)).toBe('读 Block Read')
  })

  it('getCommandConfig returns null for missing keys', () => {
    expect(getCommandConfig(null)).toBeNull()
    expect(getCommandConfig('NOPE')).toBeNull()
    expect(getCommandConfig('VOUT_COMMAND')?.cmd).toBe(0x21)
  })
})
