/**
 * Command Metadata — migrated from pmbus-calculator.html
 *
 * Data source of truth for all PMBus commands.
 * UI components must read from here; never hardcode command lists in JSX.
 */

export type AppMode = 'L11' | 'L16' | 'DIRECT' | 'HALF'

export interface CommandMeta {
  key: string
  label: string
  cmd: number
  mode: AppMode
  type: string
  spec?: string
  note?: string

  // L11 / L16 default values
  val?: number
  n?: number

  // L16 VOUT_MODE
  voutMode?: string

  // DIRECT coefficients
  m?: number
  b?: number
  R?: number
}

export const COMMAND_METADATA: Record<string, CommandMeta> = {
  VOUT_COMMAND: {
    key: 'VOUT_COMMAND',
    mode: 'L16',
    val: 12,
    n: -8,
    voutMode: '18',
    label: 'VOUT_COMMAND',
    cmd: 0x21,
    type: 'scalar16',
    spec: 'PMBus Part II 13.2 / Part I 8.4.1',
  },
  VOUT_OV_FAULT_LIMIT: {
    key: 'VOUT_OV_FAULT_LIMIT',
    mode: 'L16',
    val: 13.2,
    n: -8,
    voutMode: '18',
    label: 'VOUT_OV_FAULT_LIMIT',
    cmd: 0x40,
    type: 'scalar16',
    spec: 'PMBus Part II 15.x / follows VOUT_MODE',
  },
  READ_VOUT: {
    key: 'READ_VOUT',
    mode: 'L16',
    val: 12,
    n: -8,
    voutMode: '18',
    label: 'READ_VOUT',
    cmd: 0x8b,
    type: 'scalar16',
    spec: 'PMBus Part II 18.4; format follows VOUT_MODE',
  },
  READ_VIN: {
    key: 'READ_VIN',
    mode: 'DIRECT',
    val: 48,
    m: 1,
    b: 0,
    R: -2,
    label: 'READ_VIN',
    cmd: 0x88,
    type: 'scalar16',
    spec: 'PMBus Part II 18.1; two data bytes in Section 7 format',
  },
  READ_IOUT: {
    key: 'READ_IOUT',
    mode: 'DIRECT',
    val: 20,
    m: 100,
    b: 0,
    R: -2,
    label: 'READ_IOUT',
    cmd: 0x8c,
    type: 'scalar16',
    spec: 'PMBus Part II 18.5; two data bytes in Section 7 format',
  },
  READ_TEMPERATURE_1: {
    key: 'READ_TEMPERATURE_1',
    mode: 'DIRECT',
    val: 45,
    m: 1,
    b: 0,
    R: 0,
    label: 'READ_TEMPERATURE_1',
    cmd: 0x8d,
    type: 'scalar16',
    spec: 'PMBus Part II 18.6; two data bytes in Section 7 format',
  },
  VIN_OV_FAULT_LIMIT: {
    key: 'VIN_OV_FAULT_LIMIT',
    mode: 'DIRECT',
    val: 60,
    m: 1,
    b: 0,
    R: -1,
    label: 'VIN_OV_FAULT_LIMIT',
    cmd: 0x55,
    type: 'scalar16',
    spec: 'PMBus Part II 15.23; two data bytes in Section 7 format',
  },
  OT_FAULT_LIMIT: {
    key: 'OT_FAULT_LIMIT',
    mode: 'DIRECT',
    val: 125,
    m: 1,
    b: 0,
    R: 0,
    label: 'OT_FAULT_LIMIT',
    cmd: 0x4f,
    type: 'scalar16',
    spec: 'PMBus Part II 15.17; two data bytes in Section 7 format',
  },
  FAN_COMMAND: {
    key: 'FAN_COMMAND',
    mode: 'L11',
    val: 5000,
    n: 3,
    label: 'FAN_COMMAND',
    cmd: 0x3b,
    type: 'scalar16',
    spec: 'PMBus Part II 14.12; two data bytes in Section 7 format',
  },
  READ_POUT: {
    key: 'READ_POUT',
    mode: 'DIRECT',
    val: 120,
    m: 1,
    b: 0,
    R: -1,
    label: 'READ_POUT',
    cmd: 0x96,
    type: 'scalar16',
    spec: 'PMBus Part II 18.11; two data bytes in Section 7 format',
  },
  READ_FAN_SPEED_1: {
    key: 'READ_FAN_SPEED_1',
    mode: 'L11',
    val: 3200,
    n: 2,
    label: 'READ_FAN_SPEED_1',
    cmd: 0x90,
    type: 'scalar16',
    spec: 'PMBus Part II 18.7; returns RPM in Section 7 format',
  },
  STATUS_WORD: {
    key: 'STATUS_WORD',
    mode: 'L11',
    val: 0,
    n: 0,
    label: 'STATUS_WORD',
    cmd: 0x79,
    type: 'statusWord',
    spec: 'PMBus Part II 17.2 Table 16',
    note: 'STATUS_WORD 是 16 位状态位摘要，不是物理量编码；低字节等同 STATUS_BYTE，高字节为摘要故障位。',
  },
  READ_EIN: {
    key: 'READ_EIN',
    mode: 'DIRECT',
    val: 100,
    m: 1,
    b: 0,
    R: 0,
    label: 'READ_EIN',
    cmd: 0x86,
    type: 'blockRead',
    spec: 'PMBus Part II 18.13 / command table',
    note: 'READ_EIN 属于 Block Read，多于 16 位；当前页面仅能辅助理解其累加器前 2 字节的编码方式，不能代表完整 6 字节报文。',
  },
} as const

export const COMMAND_KEYS = Object.keys(COMMAND_METADATA) as string[]

export function getCommandConfig(key: string | null): CommandMeta | null {
  if (!key) return null
  return COMMAND_METADATA[key] ?? null
}

export function getCommandsByMode(mode: AppMode): CommandMeta[] {
  return Object.values(COMMAND_METADATA).filter((c) => c.mode === mode)
}
