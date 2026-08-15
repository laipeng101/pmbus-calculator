import { describe, it, expect } from 'vitest'
import {
  COMMAND_METADATA,
  describeEncodingRule,
  describeTransactions,
  getCommandConfig,
} from './command-metadata'

interface ExpectedCommand {
  cmd: number
  write?: { type: string; dataBytes: number }
  read?: { type: string; dataBytes: number }
  units: string
  spec: string
  encodingRule: string
  hasPreset: boolean
}

/**
 * Golden table derived from PMBus 1.3 Part II Appendix I Table 31 and the
 * command sections referenced by each row.  Standard definitions and
 * project-demo presets must stay separated: presets are never part of the
 * standard definition asserted here.
 */
const GOLDEN: Record<string, ExpectedCommand> = {
  VOUT_COMMAND: {
    cmd: 0x21,
    write: { type: 'write_word', dataBytes: 2 },
    read: { type: 'read_word', dataBytes: 2 },
    units: 'V',
    spec: 'PMBus Part II §13.2, Appendix I Table 31',
    encodingRule: 'follows_vout_mode',
    hasPreset: true,
  },
  VOUT_OV_FAULT_LIMIT: {
    cmd: 0x40,
    write: { type: 'write_word', dataBytes: 2 },
    read: { type: 'read_word', dataBytes: 2 },
    units: 'V',
    spec: 'PMBus Part II §15.2, Appendix I Table 31',
    encodingRule: 'follows_vout_mode',
    hasPreset: true,
  },
  READ_VOUT: {
    cmd: 0x8b,
    read: { type: 'read_word', dataBytes: 2 },
    units: 'V',
    spec: 'PMBus Part II §18.4, Appendix I Table 31',
    encodingRule: 'follows_vout_mode',
    hasPreset: true,
  },
  READ_VIN: {
    cmd: 0x88,
    read: { type: 'read_word', dataBytes: 2 },
    units: 'V',
    spec: 'PMBus Part II §18.1, Appendix I Table 31',
    encodingRule: 'device_defined',
    hasPreset: true,
  },
  READ_IOUT: {
    cmd: 0x8c,
    read: { type: 'read_word', dataBytes: 2 },
    units: 'A',
    spec: 'PMBus Part II §18.5, Appendix I Table 31',
    encodingRule: 'device_defined',
    hasPreset: true,
  },
  READ_TEMPERATURE_1: {
    cmd: 0x8d,
    read: { type: 'read_word', dataBytes: 2 },
    units: '°C',
    spec: 'PMBus Part II §18.6, Appendix I Table 31',
    encodingRule: 'device_defined',
    hasPreset: true,
  },
  VIN_OV_FAULT_LIMIT: {
    cmd: 0x55,
    write: { type: 'write_word', dataBytes: 2 },
    read: { type: 'read_word', dataBytes: 2 },
    units: 'V',
    spec: 'PMBus Part II §15.23, Appendix I Table 31',
    encodingRule: 'device_defined',
    hasPreset: true,
  },
  OT_FAULT_LIMIT: {
    cmd: 0x4f,
    write: { type: 'write_word', dataBytes: 2 },
    read: { type: 'read_word', dataBytes: 2 },
    units: '°C',
    spec: 'PMBus Part II §15.17, Appendix I Table 31',
    encodingRule: 'device_defined',
    hasPreset: true,
  },
  FAN_COMMAND_1: {
    cmd: 0x3b,
    write: { type: 'write_word', dataBytes: 2 },
    read: { type: 'read_word', dataBytes: 2 },
    units: 'RPM or duty cycle (FAN_CONFIG_1_2)',
    spec: 'PMBus Part II §14.12, Appendix I Table 31',
    encodingRule: 'device_defined',
    hasPreset: true,
  },
  READ_POUT: {
    cmd: 0x96,
    read: { type: 'read_word', dataBytes: 2 },
    units: 'W',
    spec: 'PMBus Part II §18.11, Appendix I Table 31',
    encodingRule: 'device_defined',
    hasPreset: true,
  },
  READ_FAN_SPEED_1: {
    cmd: 0x90,
    read: { type: 'read_word', dataBytes: 2 },
    units: 'RPM',
    spec: 'PMBus Part II §18.7, Appendix I Table 31',
    encodingRule: 'device_defined',
    hasPreset: true,
  },
  STATUS_WORD: {
    cmd: 0x79,
    write: { type: 'write_word', dataBytes: 2 },
    read: { type: 'read_word', dataBytes: 2 },
    units: 'bit field',
    spec: 'PMBus Part II §17.2 Table 16, Appendix I Table 31',
    encodingRule: 'status',
    hasPreset: false,
  },
  READ_EIN: {
    cmd: 0x86,
    read: { type: 'block_read', dataBytes: 5 },
    units: '—',
    spec: 'PMBus Part II §18.13, Appendix I Table 31',
    encodingRule: 'block',
    hasPreset: false,
  },
}

describe('command metadata — standard definitions vs presets', () => {
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
      expect(cmd.preset !== undefined, key).toBe(expected.hasPreset)
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

  it('does not pin FAN_COMMAND_1 standard units to RPM; project-demo preset may say RPM', () => {
    expect(COMMAND_METADATA.FAN_COMMAND_1.units).not.toBe('RPM')
    expect(COMMAND_METADATA.FAN_COMMAND_1.units).toContain('FAN_CONFIG_1_2')
    expect(COMMAND_METADATA.FAN_COMMAND_1.preset?.units).toBe('RPM')
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

  it('documents STATUS_WORD write behavior as clearing status bits', () => {
    expect(COMMAND_METADATA.STATUS_WORD.transactions.write).toEqual({
      type: 'write_word',
      dataBytes: 2,
    })
    expect(COMMAND_METADATA.STATUS_WORD.note).toContain('写入 STATUS_WORD')
    expect(COMMAND_METADATA.STATUS_WORD.note).toContain('清除')
  })

  it('marks READ_EIN as block read with 5 data bytes and no numeric preset', () => {
    expect(COMMAND_METADATA.READ_EIN.encodingRule).toBe('block')
    expect(COMMAND_METADATA.READ_EIN.transactions).toEqual({
      read: { type: 'block_read', dataBytes: 5 },
    })
    expect(COMMAND_METADATA.READ_EIN.preset).toBeUndefined()
  })

  it('marks STATUS_WORD as status without a numeric preset', () => {
    expect(COMMAND_METADATA.STATUS_WORD.encodingRule).toBe('status')
    expect(COMMAND_METADATA.STATUS_WORD.preset).toBeUndefined()
  })

  it('only ships project-demo presets; none claim to be spec-example or datasheet defaults', () => {
    for (const cmd of all) {
      if (cmd.preset) {
        expect(cmd.preset.sourceKind).toBe('project-demo')
        expect(cmd.preset.direction).toMatch(/^(read|write)$/)
      }
    }
  })

  it('does not keep the removed PMBus Part II typical-example source strings', () => {
    const text = JSON.stringify(all)
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
