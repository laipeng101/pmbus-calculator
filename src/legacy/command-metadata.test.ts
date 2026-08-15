import { describe, it, expect } from 'vitest'
import { COMMAND_METADATA, describeEncodingRule, getCommandConfig } from './command-metadata'

describe('command metadata — standard definitions vs presets', () => {
  const all = Object.values(COMMAND_METADATA)

  it('defines every command with code, transaction, value type, units, spec, and encoding rule', () => {
    for (const cmd of all) {
      expect(cmd.cmd).toBeGreaterThanOrEqual(0)
      expect(cmd.cmd).toBeLessThanOrEqual(0xff)
      expect(cmd.transactionType).toBeTruthy()
      expect(cmd.valueType).toBeTruthy()
      expect(cmd.units).toBeTruthy()
      expect(cmd.spec).toBeTruthy()
      expect(cmd.encodingRule).toBeTruthy()
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

  it('marks STATUS_WORD as status and READ_EIN as block, without numeric presets', () => {
    expect(COMMAND_METADATA.STATUS_WORD.encodingRule).toBe('status')
    expect(COMMAND_METADATA.STATUS_WORD.preset).toBeUndefined()
    expect(COMMAND_METADATA.READ_EIN.encodingRule).toBe('block')
    expect(COMMAND_METADATA.READ_EIN.preset).toBeUndefined()
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

  it('describeEncodingRule returns a human-readable label for every rule', () => {
    expect(describeEncodingRule('follows_vout_mode')).toBe('跟随 VOUT_MODE')
    expect(describeEncodingRule('device_defined')).toBe('由器件资料决定')
    expect(describeEncodingRule('status')).toBe('STATUS 位')
    expect(describeEncodingRule('block')).toBe('BLOCK 块')
  })

  it('getCommandConfig returns null for missing keys', () => {
    expect(getCommandConfig(null)).toBeNull()
    expect(getCommandConfig('NOPE')).toBeNull()
    expect(getCommandConfig('VOUT_COMMAND')?.cmd).toBe(0x21)
  })
})
