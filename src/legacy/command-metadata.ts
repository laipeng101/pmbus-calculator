/**
 * Command Metadata — single data source of truth for all PMBus commands.
 *
 * UI components must read from here; never hardcode command lists in JSX.
 *
 * Domain model (see docs/DOMAIN_MODEL.md and docs/adr/0002):
 * - A **standard command definition** records what PMBus specifies:
 *   command code, SMBus transactions (write and/or read), data width, value type,
 *   units, spec section, and an `encodingRule` that tells the user how to
 *   resolve the payload format.
 * - A standard definition deliberately does NOT carry a calculator mode or
 *   pre-filled numeric parameters.  For commands marked `device_defined` the
 *   format is chosen by the device datasheet; for `follows_vout_mode` it is
 *   chosen by VOUT_MODE.  Claiming a fixed L11/L16 format for those commands
 *   would be a false specification.
 * - An optional `preset` may exist.  Presets are never auto-applied by
 *   `command/set`; the user must explicitly apply them via
 *   `command/apply-preset`.  Every preset declares `sourceKind`
 *   (`spec-example` | `device-datasheet` | `project-demo`), `source`,
 *   `appliesTo`, and `direction` so a demo value can never be mistaken for a
 *   standard or universal default.
 */

export type AppMode = 'L11' | 'L16' | 'DIRECT' | 'HALF'

export type CommandWriteTransactionType = 'send_byte' | 'write_byte' | 'write_word' | 'block_write'
export type CommandReadTransactionType = 'read_byte' | 'read_word' | 'block_read'
export type CommandTransactionType = CommandWriteTransactionType | CommandReadTransactionType

export interface CommandTransaction {
  type: CommandTransactionType
  /**
   * Number of PMBus data bytes for this transaction.  Not including PEC nor
   * the block byte count, matching PMBus Part II Appendix I Table 31.
   */
  dataBytes?: number
}

/**
 * A command can support a write transaction, a read transaction, or both.
 * The previous single `transactionType` field could not express that and is
 * intentionally removed.
 */
export interface CommandTransactions {
  write?: CommandTransaction
  read?: CommandTransaction
}

export interface CommandDataBytesConflict {
  detailedSection: {
    value: number
    source: string
  }
  appendixTable: {
    value: number
    source: string
  }
}

/**
 * Render a `CommandDataBytesConflict` as human-readable Chinese text.
 *
 * The numbers and sources are read from the conflict argument; nothing is
 * hardcoded here.  This keeps the metadata `note` and the CommandPicker UI
 * from drifting into two copies of the same READ_EIN explanation.
 */
export function describeDataBytesConflict(conflict: CommandDataBytesConflict): string {
  return `规范内部冲突：${conflict.detailedSection.source} 描述 ${conflict.detailedSection.value} 个数据字节；${conflict.appendixTable.source} 列为 ${conflict.appendixTable.value}。请以目标器件资料及适用规范修订为准。计算器不是 READ_EIN packet-length authority。`
}

export type CommandValueType = 'scalar' | 'status' | 'block'

/** How the PMBus specification tells an implementer to resolve the payload format. */
export type CommandEncodingRule = 'follows_vout_mode' | 'device_defined' | 'status' | 'block'

export type PresetSourceKind = 'spec-example' | 'device-datasheet' | 'project-demo'
export type PresetDirection = 'read' | 'write'

/**
 * Optional pre-filled parameters for a command.
 *
 * A preset is only applied when the user explicitly chooses
 * “应用演示预设” (command/apply-preset).  It never auto-applies on selection.
 */
export interface CommandPreset {
  /** Calculator mode/format to apply. */
  mode: AppMode

  /** Physical value used to re-encode raw when the preset is applied. */
  value: number

  /** LINEAR11 suggested exponent (when mode is L11). */
  n?: number

  /** LINEAR16 VOUT_MODE byte (when mode is L16). */
  voutMode?: number

  /** DIRECT coefficients (when mode is DIRECT). */
  m?: number
  b?: number
  R?: number

  /** Optional demo unit, e.g. FAN_COMMAND_1 project-demo uses RPM. */
  units?: string

  sourceKind: PresetSourceKind
  source: string
  appliesTo: string
  direction: PresetDirection
}

export interface CommandMeta {
  key: string
  label: string
  cmd: number

  /** Read/write SMBus transactions; both may be present for R/W commands. */
  transactions: CommandTransactions
  valueType: CommandValueType
  units: string
  spec: string
  encodingRule: CommandEncodingRule

  /**
   * Present only when the specification itself is internally inconsistent
   * about the number of data bytes.  The UI must show both sources instead
   * of picking one authoritative number.
   */
  dataBytesConflict?: CommandDataBytesConflict

  note?: string

  /** Optional demo/preset parameters.  Never applied by `command/set`. */
  preset?: CommandPreset
}

/** Single source of truth for the READ_EIN data-bytes specification conflict. */
const READ_EIN_DATA_BYTES_CONFLICT: CommandDataBytesConflict = {
  detailedSection: {
    value: 6,
    source: 'PMBus Part II §18.13',
  },
  appendixTable: {
    value: 5,
    source: 'PMBus Part II Appendix I Table 31',
  },
}

const PROJECT_DEMO = {
  sourceKind: 'project-demo',
  source: 'Project demo preset',
  appliesTo: 'Demo only — not a standard or universal PMBus default',
} as const

const WORD_WRITE: CommandTransaction = { type: 'write_word', dataBytes: 2 }
const WORD_READ: CommandTransaction = { type: 'read_word', dataBytes: 2 }

export const COMMAND_METADATA: Record<string, CommandMeta> = {
  VOUT_COMMAND: {
    key: 'VOUT_COMMAND',
    label: 'VOUT_COMMAND',
    cmd: 0x21,
    transactions: { write: WORD_WRITE, read: WORD_READ },
    valueType: 'scalar',
    units: 'V',
    spec: 'PMBus Part II §13.2, Appendix I Table 31',
    encodingRule: 'follows_vout_mode',
    note: 'VOUT_COMMAND 的数据格式跟随 VOUT_MODE；选择命令只显示命令信息，不会自动应用参数。',
    preset: {
      mode: 'L16',
      value: 12,
      voutMode: 0x18,
      direction: 'write',
      ...PROJECT_DEMO,
    },
  },
  VOUT_OV_FAULT_LIMIT: {
    key: 'VOUT_OV_FAULT_LIMIT',
    label: 'VOUT_OV_FAULT_LIMIT',
    cmd: 0x40,
    transactions: { write: WORD_WRITE, read: WORD_READ },
    valueType: 'scalar',
    units: 'V',
    spec: 'PMBus Part II §15.2, Appendix I Table 31',
    encodingRule: 'follows_vout_mode',
    note: 'VOUT_OV_FAULT_LIMIT 的数据格式跟随 VOUT_MODE；选择命令只显示命令信息，不会自动应用参数。',
    preset: {
      mode: 'L16',
      value: 13.2,
      voutMode: 0x18,
      direction: 'write',
      ...PROJECT_DEMO,
    },
  },
  READ_VOUT: {
    key: 'READ_VOUT',
    label: 'READ_VOUT',
    cmd: 0x8b,
    transactions: { read: WORD_READ },
    valueType: 'scalar',
    units: 'V',
    spec: 'PMBus Part II §18.4, Appendix I Table 31',
    encodingRule: 'follows_vout_mode',
    note: 'READ_VOUT 的数据格式跟随 VOUT_MODE；选择命令只显示命令信息，不会自动应用参数。',
    preset: {
      mode: 'L16',
      value: 12,
      voutMode: 0x18,
      direction: 'read',
      ...PROJECT_DEMO,
    },
  },
  READ_VIN: {
    key: 'READ_VIN',
    label: 'READ_VIN',
    cmd: 0x88,
    transactions: { read: WORD_READ },
    valueType: 'scalar',
    units: 'V',
    spec: 'PMBus Part II §18.1, Appendix I Table 31',
    encodingRule: 'device_defined',
    note: 'READ_VIN 的数据格式由器件资料决定；需要器件数据手册。选择命令只显示命令信息，不会自动应用参数。',
    preset: {
      mode: 'L11',
      value: 48,
      direction: 'read',
      ...PROJECT_DEMO,
    },
  },
  READ_IOUT: {
    key: 'READ_IOUT',
    label: 'READ_IOUT',
    cmd: 0x8c,
    transactions: { read: WORD_READ },
    valueType: 'scalar',
    units: 'A',
    spec: 'PMBus Part II §18.5, Appendix I Table 31',
    encodingRule: 'device_defined',
    note: 'READ_IOUT 的数据格式由器件资料决定；需要器件数据手册。选择命令只显示命令信息，不会自动应用参数。',
    preset: {
      mode: 'L11',
      value: 20,
      direction: 'read',
      ...PROJECT_DEMO,
    },
  },
  READ_TEMPERATURE_1: {
    key: 'READ_TEMPERATURE_1',
    label: 'READ_TEMPERATURE_1',
    cmd: 0x8d,
    transactions: { read: WORD_READ },
    valueType: 'scalar',
    units: '°C',
    spec: 'PMBus Part II §18.6, Appendix I Table 31',
    encodingRule: 'device_defined',
    note: 'READ_TEMPERATURE_1 的数据格式由器件资料决定；需要器件数据手册。选择命令只显示命令信息，不会自动应用参数。',
    preset: {
      mode: 'L11',
      value: 45,
      direction: 'read',
      ...PROJECT_DEMO,
    },
  },
  VIN_OV_FAULT_LIMIT: {
    key: 'VIN_OV_FAULT_LIMIT',
    label: 'VIN_OV_FAULT_LIMIT',
    cmd: 0x55,
    transactions: { write: WORD_WRITE, read: WORD_READ },
    valueType: 'scalar',
    units: 'V',
    spec: 'PMBus Part II §15.23, Appendix I Table 31',
    encodingRule: 'device_defined',
    note: 'VIN_OV_FAULT_LIMIT 的数据格式由器件资料决定；需要器件数据手册。选择命令只显示命令信息，不会自动应用参数。',
    preset: {
      mode: 'L11',
      value: 60,
      direction: 'write',
      ...PROJECT_DEMO,
    },
  },
  OT_FAULT_LIMIT: {
    key: 'OT_FAULT_LIMIT',
    label: 'OT_FAULT_LIMIT',
    cmd: 0x4f,
    transactions: { write: WORD_WRITE, read: WORD_READ },
    valueType: 'scalar',
    units: '°C',
    spec: 'PMBus Part II §15.17, Appendix I Table 31',
    encodingRule: 'device_defined',
    note: 'OT_FAULT_LIMIT 的数据格式由器件资料决定；需要器件数据手册。选择命令只显示命令信息，不会自动应用参数。',
    preset: {
      mode: 'L11',
      value: 125,
      direction: 'write',
      ...PROJECT_DEMO,
    },
  },
  FAN_COMMAND_1: {
    key: 'FAN_COMMAND_1',
    label: 'FAN_COMMAND_1',
    cmd: 0x3b,
    transactions: { write: WORD_WRITE, read: WORD_READ },
    valueType: 'scalar',
    units: 'RPM or duty cycle (FAN_CONFIG_1_2)',
    spec: 'PMBus Part II §14.12, Appendix I Table 31',
    encodingRule: 'device_defined',
    note: 'FAN_COMMAND_1 的数据格式由器件资料决定；单位依 FAN_CONFIG_1_2，可为 RPM 或 duty cycle。需要器件数据手册。选择命令只显示命令信息，不会自动应用参数。',
    preset: {
      mode: 'L11',
      value: 5000,
      n: 3,
      units: 'RPM',
      direction: 'write',
      ...PROJECT_DEMO,
    },
  },
  READ_POUT: {
    key: 'READ_POUT',
    label: 'READ_POUT',
    cmd: 0x96,
    transactions: { read: WORD_READ },
    valueType: 'scalar',
    units: 'W',
    spec: 'PMBus Part II §18.11, Appendix I Table 31',
    encodingRule: 'device_defined',
    note: 'READ_POUT 的数据格式由器件资料决定；需要器件数据手册。选择命令只显示命令信息，不会自动应用参数。',
    preset: {
      mode: 'L11',
      value: 120,
      direction: 'read',
      ...PROJECT_DEMO,
    },
  },
  READ_FAN_SPEED_1: {
    key: 'READ_FAN_SPEED_1',
    label: 'READ_FAN_SPEED_1',
    cmd: 0x90,
    transactions: { read: WORD_READ },
    valueType: 'scalar',
    units: 'RPM',
    spec: 'PMBus Part II §18.7, Appendix I Table 31',
    encodingRule: 'device_defined',
    note: 'READ_FAN_SPEED_1 的数据格式由器件资料决定；需要器件数据手册。选择命令只显示命令信息，不会自动应用参数。',
    preset: {
      mode: 'L11',
      value: 3200,
      n: 2,
      direction: 'read',
      ...PROJECT_DEMO,
    },
  },
  STATUS_WORD: {
    key: 'STATUS_WORD',
    label: 'STATUS_WORD',
    cmd: 0x79,
    transactions: { write: WORD_WRITE, read: WORD_READ },
    valueType: 'status',
    units: 'bit field',
    spec: 'PMBus Part II §17.2 Table 16, Appendix I Table 31',
    encodingRule: 'status',
    note: 'STATUS_WORD 是 16 位状态位摘要，不是物理量编码；低字节等同 STATUS_BYTE，高字节为摘要故障位。通常为 Read Word；特殊写入仅用于清除 UNKNOWN 位（写 0x0100），其他状态位通过底层状态寄存器或 CLEAR_FAULTS 处理。计算器不为其分配 L11/L16/DIRECT/HALF 转换模式。',
  },
  READ_EIN: {
    key: 'READ_EIN',
    label: 'READ_EIN',
    cmd: 0x86,
    transactions: { read: { type: 'block_read' } },
    valueType: 'block',
    units: '—',
    spec: 'PMBus Part II §18.13, Appendix I Table 31',
    encodingRule: 'block',
    dataBytesConflict: READ_EIN_DATA_BYTES_CONFLICT,
    note: describeDataBytesConflict(READ_EIN_DATA_BYTES_CONFLICT),
  },
}

export const COMMAND_KEYS = Object.keys(COMMAND_METADATA) as Array<keyof typeof COMMAND_METADATA>

export function getCommandConfig(key: string | null): CommandMeta | null {
  if (!key) return null
  const cmd = COMMAND_METADATA[key as keyof typeof COMMAND_METADATA]
  return (cmd as CommandMeta | undefined) ?? null
}

export function describeEncodingRule(rule: CommandEncodingRule): string {
  switch (rule) {
    case 'follows_vout_mode':
      return '跟随 VOUT_MODE'
    case 'device_defined':
      return '由器件资料决定'
    case 'status':
      return 'STATUS 位'
    case 'block':
      return 'BLOCK 块'
  }
}

export function describeTransactionType(type: CommandTransactionType): string {
  switch (type) {
    case 'send_byte':
      return 'Send Byte'
    case 'write_byte':
      return 'Write Byte'
    case 'write_word':
      return 'Write Word'
    case 'block_write':
      return 'Block Write'
    case 'read_byte':
      return 'Read Byte'
    case 'read_word':
      return 'Read Word'
    case 'block_read':
      return 'Block Read'
  }
}

/** Human-readable read/write transaction summary for a command. */
export function describeTransactions(transactions: CommandTransactions): string {
  const parts: string[] = []
  if (transactions.write) parts.push(`写 ${describeTransactionType(transactions.write.type)}`)
  if (transactions.read) parts.push(`读 ${describeTransactionType(transactions.read.type)}`)
  return parts.length > 0 ? parts.join(' · ') : '—'
}

export function describePresetSource(preset: CommandPreset): string {
  switch (preset.sourceKind) {
    case 'spec-example':
      return '规范示例'
    case 'device-datasheet':
      return '器件数据手册'
    case 'project-demo':
      return 'project-demo'
  }
}
