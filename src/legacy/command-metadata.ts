/** Standard PMBus definitions used by the read-only command reference. */
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

function describeDataBytesConflict(conflict: CommandDataBytesConflict): string {
  return `规范给出的字节数不同。${conflict.detailedSection.source} 写为 ${conflict.detailedSection.value} 个数据字节，${conflict.appendixTable.source} 列为 ${conflict.appendixTable.value} 个。请按目标器件的数据手册和适用的规范版本核对。`
}

export type CommandValueType = 'scalar' | 'status' | 'block'

/** How the PMBus specification tells an implementer to resolve the payload format. */
export type CommandEncodingRule = 'follows_vout_mode' | 'device_defined' | 'status' | 'block'

export interface CommandMeta {
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

const WORD_WRITE: CommandTransaction = { type: 'write_word', dataBytes: 2 }
const WORD_READ: CommandTransaction = { type: 'read_word', dataBytes: 2 }

export const COMMAND_METADATA: Record<string, CommandMeta> = {
  VOUT_COMMAND: {
    cmd: 0x21,
    transactions: { write: WORD_WRITE, read: WORD_READ },
    valueType: 'scalar',
    units: 'V',
    spec: 'PMBus Part II §13.2, Appendix I Table 31',
    encodingRule: 'follows_vout_mode',
  },
  VOUT_OV_FAULT_LIMIT: {
    cmd: 0x40,
    transactions: { write: WORD_WRITE, read: WORD_READ },
    valueType: 'scalar',
    units: 'V',
    spec: 'PMBus Part II §15.2, Appendix I Table 31',
    encodingRule: 'follows_vout_mode',
  },
  READ_VOUT: {
    cmd: 0x8b,
    transactions: { read: WORD_READ },
    valueType: 'scalar',
    units: 'V',
    spec: 'PMBus Part II §18.4, Appendix I Table 31',
    encodingRule: 'follows_vout_mode',
  },
  READ_VIN: {
    cmd: 0x88,
    transactions: { read: WORD_READ },
    valueType: 'scalar',
    units: 'V',
    spec: 'PMBus Part II §18.1, Appendix I Table 31',
    encodingRule: 'device_defined',
  },
  READ_IOUT: {
    cmd: 0x8c,
    transactions: { read: WORD_READ },
    valueType: 'scalar',
    units: 'A',
    spec: 'PMBus Part II §18.5, Appendix I Table 31',
    encodingRule: 'device_defined',
  },
  READ_TEMPERATURE_1: {
    cmd: 0x8d,
    transactions: { read: WORD_READ },
    valueType: 'scalar',
    units: '°C',
    spec: 'PMBus Part II §18.6, Appendix I Table 31',
    encodingRule: 'device_defined',
  },
  VIN_OV_FAULT_LIMIT: {
    cmd: 0x55,
    transactions: { write: WORD_WRITE, read: WORD_READ },
    valueType: 'scalar',
    units: 'V',
    spec: 'PMBus Part II §15.23, Appendix I Table 31',
    encodingRule: 'device_defined',
  },
  OT_FAULT_LIMIT: {
    cmd: 0x4f,
    transactions: { write: WORD_WRITE, read: WORD_READ },
    valueType: 'scalar',
    units: '°C',
    spec: 'PMBus Part II §15.17, Appendix I Table 31',
    encodingRule: 'device_defined',
  },
  FAN_COMMAND_1: {
    cmd: 0x3b,
    transactions: { write: WORD_WRITE, read: WORD_READ },
    valueType: 'scalar',
    units: 'RPM 或占空比（见 FAN_CONFIG_1_2）',
    spec: 'PMBus Part II §14.12, Appendix I Table 31',
    encodingRule: 'device_defined',
  },
  READ_POUT: {
    cmd: 0x96,
    transactions: { read: WORD_READ },
    valueType: 'scalar',
    units: 'W',
    spec: 'PMBus Part II §18.11, Appendix I Table 31',
    encodingRule: 'device_defined',
  },
  READ_FAN_SPEED_1: {
    cmd: 0x90,
    transactions: { read: WORD_READ },
    valueType: 'scalar',
    units: 'RPM',
    spec: 'PMBus Part II §18.7, Appendix I Table 31',
    encodingRule: 'device_defined',
  },
  STATUS_WORD: {
    cmd: 0x79,
    transactions: { write: WORD_WRITE, read: WORD_READ },
    valueType: 'status',
    units: '位',
    spec: 'PMBus Part II §17.2 Table 16, §10.2.5, Appendix I Table 31',
    encodingRule: 'status',
    note: '低字节与 STATUS_BYTE 相同。高字节汇总故障和警告，并含 PG_STATUS# 等状态。通常用 Read Word 读取。写入 0x0100 只清除 UNKNOWN 位。其他状态位按对应状态寄存器或 CLEAR_FAULTS 的规则处理。',
  },
  READ_EIN: {
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

export function describeEncodingRule(rule: CommandEncodingRule): string {
  switch (rule) {
    case 'follows_vout_mode':
      return '跟随 VOUT_MODE'
    case 'device_defined':
      return '器件数据手册'
    case 'status':
      return '状态位'
    case 'block':
      return '数据块'
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
