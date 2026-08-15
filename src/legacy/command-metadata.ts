/**
 * Command Metadata — data source of truth for all PMBus commands.
 *
 * UI components must read from here; never hardcode command lists in JSX.
 *
 * Domain model notes:
 * - `dataFormat` describes how the payload is encoded on the bus.
 * - `transactionType` describes the SMBus/PMBus transaction shape.
 * - `valueType` distinguishes numeric scalar values from status/block payloads.
 * - `mode` is only set when a numeric data format maps onto the calculator's
 *   four conversion tabs. STATUS and BLOCK payloads intentionally have no mode.
 * - `profileSource` / `profileAppliesTo` separate "typical example values"
 *   from values that are standardized by PMBus. Device-specific DIRECT
 *   coefficients must always come from the device datasheet and are not
 *   shipped as if they were standard defaults.
 */

export type AppMode = 'L11' | 'L16' | 'DIRECT' | 'HALF'
export type CommandDataFormat = 'LINEAR11' | 'LINEAR16' | 'DIRECT' | 'STATUS' | 'BLOCK'
export type CommandTransactionType =
  | 'write_word'
  | 'read_word'
  | 'read_block'
  | 'write_byte'
  | 'read_byte'
export type CommandValueType = 'scalar' | 'status' | 'block'

export interface CommandMeta {
  key: string
  label: string
  cmd: number

  dataFormat: CommandDataFormat
  transactionType: CommandTransactionType
  valueType: CommandValueType

  /** Conversion tab, only for numeric scalar payloads. */
  mode?: AppMode

  spec?: string
  note?: string

  /**
   * Where the pre-filled value comes from. Use "device datasheet required"
   * whenever PMBus does not standardise the coefficients.
   */
  profileSource?: string
  profileAppliesTo?: string

  // L11 / L16 typical scalar defaults (example values, not always normative)
  val?: number
  n?: number

  // L16 VOUT_MODE byte
  voutMode?: number

  // DIRECT coefficients — only present when a concrete device profile is known.
  m?: number
  b?: number
  R?: number
}

export const COMMAND_METADATA: Record<string, CommandMeta> = {
  VOUT_COMMAND: {
    key: 'VOUT_COMMAND',
    label: 'VOUT_COMMAND',
    cmd: 0x21,
    mode: 'L16',
    dataFormat: 'LINEAR16',
    transactionType: 'write_word',
    valueType: 'scalar',
    val: 12,
    n: -8,
    voutMode: 0x18,
    spec: 'PMBus Part II 13.2 / Part I 8.4.1',
    profileSource: 'PMBus Part II 13.2 typical example',
    profileAppliesTo: 'General PMBus 1.3 devices with LINEAR16 VOUT',
  },
  VOUT_OV_FAULT_LIMIT: {
    key: 'VOUT_OV_FAULT_LIMIT',
    label: 'VOUT_OV_FAULT_LIMIT',
    cmd: 0x40,
    mode: 'L16',
    dataFormat: 'LINEAR16',
    transactionType: 'write_word',
    valueType: 'scalar',
    val: 13.2,
    n: -8,
    voutMode: 0x18,
    spec: 'PMBus Part II 15.x / follows VOUT_MODE',
    profileSource: 'PMBus Part II typical example',
    profileAppliesTo: 'General PMBus 1.3 devices; format follows VOUT_MODE',
  },
  READ_VOUT: {
    key: 'READ_VOUT',
    label: 'READ_VOUT',
    cmd: 0x8b,
    mode: 'L16',
    dataFormat: 'LINEAR16',
    transactionType: 'read_word',
    valueType: 'scalar',
    val: 12,
    n: -8,
    voutMode: 0x18,
    spec: 'PMBus Part II 18.4; format follows VOUT_MODE',
    profileSource: 'PMBus Part II 18.4 typical example',
    profileAppliesTo: 'General PMBus 1.3 devices; format follows VOUT_MODE',
  },
  READ_VIN: {
    key: 'READ_VIN',
    label: 'READ_VIN',
    cmd: 0x88,
    mode: 'L11',
    dataFormat: 'LINEAR11',
    transactionType: 'read_word',
    valueType: 'scalar',
    val: 48,
    spec: 'PMBus Part II 18.1; LINEAR11 is the preferred non-output-voltage format',
    profileSource: 'PMBus Part II 18.1 typical example',
    profileAppliesTo: 'General PMBus 1.3 devices; LINEAR11 unless device datasheet says otherwise',
  },
  READ_IOUT: {
    key: 'READ_IOUT',
    label: 'READ_IOUT',
    cmd: 0x8c,
    mode: 'L11',
    dataFormat: 'LINEAR11',
    transactionType: 'read_word',
    valueType: 'scalar',
    val: 20,
    spec: 'PMBus Part II 18.5; LINEAR11 is the preferred non-output-voltage format',
    profileSource: 'PMBus Part II 18.5 typical example',
    profileAppliesTo: 'General PMBus 1.3 devices; LINEAR11 unless device datasheet says otherwise',
  },
  READ_TEMPERATURE_1: {
    key: 'READ_TEMPERATURE_1',
    label: 'READ_TEMPERATURE_1',
    cmd: 0x8d,
    mode: 'L11',
    dataFormat: 'LINEAR11',
    transactionType: 'read_word',
    valueType: 'scalar',
    val: 45,
    spec: 'PMBus Part II 18.6; LINEAR11 is the preferred non-output-voltage format',
    profileSource: 'PMBus Part II 18.6 typical example',
    profileAppliesTo: 'General PMBus 1.3 devices; LINEAR11 unless device datasheet says otherwise',
  },
  VIN_OV_FAULT_LIMIT: {
    key: 'VIN_OV_FAULT_LIMIT',
    label: 'VIN_OV_FAULT_LIMIT',
    cmd: 0x55,
    mode: 'L11',
    dataFormat: 'LINEAR11',
    transactionType: 'write_word',
    valueType: 'scalar',
    val: 60,
    spec: 'PMBus Part II 15.23; LINEAR11 is the preferred non-output-voltage format',
    profileSource: 'PMBus Part II 15.23 typical example',
    profileAppliesTo: 'General PMBus 1.3 devices; LINEAR11 unless device datasheet says otherwise',
  },
  OT_FAULT_LIMIT: {
    key: 'OT_FAULT_LIMIT',
    label: 'OT_FAULT_LIMIT',
    cmd: 0x4f,
    mode: 'L11',
    dataFormat: 'LINEAR11',
    transactionType: 'write_word',
    valueType: 'scalar',
    val: 125,
    spec: 'PMBus Part II 15.17; LINEAR11 is the preferred non-output-voltage format',
    profileSource: 'PMBus Part II 15.17 typical example',
    profileAppliesTo: 'General PMBus 1.3 devices; LINEAR11 unless device datasheet says otherwise',
  },
  FAN_COMMAND: {
    key: 'FAN_COMMAND',
    label: 'FAN_COMMAND',
    cmd: 0x3b,
    mode: 'L11',
    dataFormat: 'LINEAR11',
    transactionType: 'write_word',
    valueType: 'scalar',
    val: 5000,
    n: 3,
    spec: 'PMBus Part II 14.12',
    profileSource: 'PMBus Part II 14.12 typical example',
    profileAppliesTo: 'General PMBus 1.3 devices',
  },
  READ_POUT: {
    key: 'READ_POUT',
    label: 'READ_POUT',
    cmd: 0x96,
    mode: 'L11',
    dataFormat: 'LINEAR11',
    transactionType: 'read_word',
    valueType: 'scalar',
    val: 120,
    spec: 'PMBus Part II 18.11; LINEAR11 is the preferred non-output-voltage format',
    profileSource: 'PMBus Part II 18.11 typical example',
    profileAppliesTo: 'General PMBus 1.3 devices; LINEAR11 unless device datasheet says otherwise',
  },
  READ_FAN_SPEED_1: {
    key: 'READ_FAN_SPEED_1',
    label: 'READ_FAN_SPEED_1',
    cmd: 0x90,
    mode: 'L11',
    dataFormat: 'LINEAR11',
    transactionType: 'read_word',
    valueType: 'scalar',
    val: 3200,
    n: 2,
    spec: 'PMBus Part II 18.7; returns RPM in LINEAR11',
    profileSource: 'PMBus Part II 18.7 typical example',
    profileAppliesTo: 'General PMBus 1.3 devices',
  },
  STATUS_WORD: {
    key: 'STATUS_WORD',
    label: 'STATUS_WORD',
    cmd: 0x79,
    dataFormat: 'STATUS',
    transactionType: 'read_word',
    valueType: 'status',
    spec: 'PMBus Part II 17.2 Table 16',
    profileSource: 'PMBus 1.3 Part II — standard status bit definitions',
    profileAppliesTo: 'All PMBus 1.3 devices (manufacturer-specific bits may differ)',
    note: 'STATUS_WORD 是 16 位状态位摘要，不是物理量编码；低字节等同 STATUS_BYTE，高字节为摘要故障位。计算器不为其分配 L11/L16/DIRECT/HALF 转换模式。',
  },
  READ_EIN: {
    key: 'READ_EIN',
    label: 'READ_EIN',
    cmd: 0x86,
    dataFormat: 'BLOCK',
    transactionType: 'read_block',
    valueType: 'block',
    spec: 'PMBus Part II 18.13 / command table',
    profileSource: 'PMBus 1.3 Part II — block read payload',
    profileAppliesTo: 'Device-specific; 6-byte accumulator format',
    note: 'READ_EIN 属于 Block Read，多于 16 位；计算器不能代表完整 6 字节报文，仅作为命令信息展示。',
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
