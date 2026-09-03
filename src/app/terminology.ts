/**
 * Single source of truth for the canonical technical terms shown in the
 * product UI (M39 glossary, globally rolled out in v2.6.0).
 *
 * The UI is Chinese-primary: English is kept only for industry-irreplaceable
 * canonical identifiers (PMBus, LINEAR, VID, DIRECT, IEEE 754 binary16, …).
 * Every retained token must have a discoverable Chinese explanation, provided
 * by the clickable `TechnicalTerm` component rather than an inline English
 * translation. This module is the only place those Chinese definitions live —
 * components must not duplicate them.
 *
 * Provenance contract (v2.6.0, naming aligned to PMBus 1.3.1 in v2.6.8):
 * - `source` classifies each entry; project UI labels must never masquerade
 *   as PMBus/SMBus normative naming. Conversely, LINEAR16 / ULINEAR16 /
 *   SLINEAR16 ARE PMBus 1.3.1 Part II §8.4.1 family names (§8.4.1.1 / §8.4.1.2),
 *   so they are normative entries, not project tags.
 * - Normative entries (`source: 'pmbus-spec'`) carry an exact `specRef`.
 * - The same display token may appear on several ids only when `scope`
 *   disambiguates them (the two N entries: LINEAR11 word vs VOUT_MODE).
 */

export type TermId =
  | 'pmbus'
  | 'smbus'
  | 'vout-mode'
  | 'vout-command'
  | 'abs-rel'
  | 'vid-code-type'
  | 'linear'
  | 'linear11'
  | 'linear11-exponent'
  | 'linear16'
  | 'ulinear16'
  | 'slinear16'
  | 'vid'
  | 'direct'
  | 'binary16'
  | 'fp-special'
  | 'twos-complement'
  | 'quantization'
  | 'raw-word'
  | 'hex'
  | 'le'
  | 'be'
  | 'exponent'
  | 'transaction'

/** Where a glossary entry's content comes from. */
export type TermSource = 'pmbus-spec' | 'smbus' | 'project' | 'generic'

export interface GlossaryTerm {
  /** Stable machine id (also the E2E `data-testid` key). */
  id: TermId
  /** Canonical token rendered verbatim by default; never translated. */
  token: string
  /** Chinese display name. */
  name: string
  /** Concise Chinese explanation (non-interactive glossary copy). */
  detail: string
  /** Provenance class: normative spec / SMBus / project UI term / generic. */
  source: TermSource
  /**
   * Exact normative anchor, e.g. 'Part II §7.3'. Required for 'pmbus-spec'
   * entries; omitted when the repo cannot verify the section directly.
   */
  specRef?: string
  /**
   * Concept scope. Same display tokens with different meanings (the two N
   * entries) MUST differ here.
   */
  scope: string
}

export const GLOSSARY: Record<TermId, GlossaryTerm> = {
  pmbus: {
    id: 'pmbus',
    token: 'PMBus',
    name: '电源管理总线',
    detail: '基于 SMBus 的电源管理通信与命令规范；本项目只做数值格式换算，不实现总线通信。',
    source: 'pmbus-spec',
    scope: '总线与规范',
  },
  smbus: {
    id: 'smbus',
    token: 'SMBus',
    name: '系统管理总线',
    detail:
      'PMBus 所基于的系统管理总线；PMBus word 在线上默认低字节在前、高位在前（Part II §7.6 对浮点数据明示，其余 word 类型由 SMBus/PMBus 传输规则规定）。',
    source: 'smbus',
    scope: '总线与规范',
  },
  'vout-mode': {
    id: 'vout-mode',
    token: 'VOUT_MODE',
    name: '输出电压格式配置字节',
    detail:
      '1 字节配置（Part II §8.3 Table 2）：bit7 选择绝对/相对语义，bits[6:5] 选择格式（LINEAR/VID/DIRECT/IEEE Half），bits[4:0] 是格式参数；DIRECT 与 IEEE Half 的参数必须为 00000b。设备可能固定该字节并拒绝写入，编辑字节不代表真实器件接受写入。',
    source: 'pmbus-spec',
    specRef: 'Part II §8.3 Table 2',
    scope: 'VOUT_MODE 字节',
  },
  'vout-command': {
    id: 'vout-command',
    token: 'VOUT_COMMAND',
    name: '标称输出电压命令',
    detail:
      '设置标称输出电压的命令。Relative 语义只适用于 Part II §8.5 列出的 8 个输出电压命令：实际阈值/限值 = 相对值 × VOUT_COMMAND 标称值，相对值恒为正；同一器件不得混用绝对/相对模式。',
    source: 'pmbus-spec',
    specRef: 'Part II §8.5',
    scope: '输出电压命令',
  },
  'abs-rel': {
    id: 'abs-rel',
    token: 'Absolute / Relative',
    name: '绝对值 / 相对值',
    detail:
      'VOUT_MODE bit7 的语义开关（Part II §8.5），只作用于规范列出的 8 个输出电压命令（VOUT_MARGIN_HIGH/LOW、VOUT_OV/UV_FAULT/WARN_LIMIT、POWER_GOOD_ON/OFF）。相对值按当前 VOUT_MODE 格式解释，实际阈值 = 相对值 × VOUT_COMMAND 标称值；VID 格式不支持 Relative（§8.5.3）。',
    source: 'pmbus-spec',
    specRef: 'Part II §8.5',
    scope: 'VOUT_MODE bit7 / 输出电压命令',
  },
  'vid-code-type': {
    id: 'vid-code-type',
    token: 'VID Code Type',
    name: 'VID 代码类型',
    detail:
      'VOUT_MODE bits[4:0] 在 VID 格式下的 5 位无符号代码（Part II §8.4.2 Table 3）：00h 未使用；01h–04h（未来 Intel 处理器）、10h–11h（未来 AMD 处理器）、1Ch–1Dh 为 Table 3 明列保留；1Eh–1Fh 为制造商自定义，映射必须来自产品资料；其余代码保留供未来使用。',
    source: 'pmbus-spec',
    specRef: 'Part II §8.4.2 Table 3',
    scope: 'VOUT_MODE bits[4:0]（VID 格式）',
  },
  linear: {
    id: 'linear',
    token: 'LINEAR',
    name: '输出电压线性格式',
    detail:
      'VOUT_MODE bits[6:5]=00 选择的输出电压线性格式（Part II §8.4.1）：16 位无符号值 V 按 X = V × 2^N 解码，N 来自 VOUT_MODE bits[4:0]。与两字节 LINEAR11（§7.3）的 word 结构不同。',
    source: 'pmbus-spec',
    specRef: 'Part II §8.4.1',
    scope: 'VOUT_MODE 格式 00b（输出电压）',
  },
  linear11: {
    id: 'linear11',
    token: 'LINEAR11',
    name: '11 位线性格式',
    detail:
      '两字节数值格式（Part II §7.3，规范正文称 Linear Data Format，LINEAR11 为业界通称）：X = Y × 2^N；Y 为 11 位二补码（−1024～1023），N 为 5 位二补码（−16～15），位于 word 高 5 位（bits[15:11]）。',
    source: 'pmbus-spec',
    specRef: 'Part II §7.3',
    scope: '两字节数值格式',
  },
  'linear11-exponent': {
    id: 'linear11-exponent',
    token: 'N',
    name: 'LINEAR11 指数',
    detail:
      'LINEAR11 数据字内的 5 位二补码缩放指数（Part II §7.3），位于两字节 word 的 bits[15:11]：X = Y × 2^N。它与 VOUT_MODE bits[4:0] 的输出电压指数是不同位置的 N。',
    source: 'pmbus-spec',
    specRef: 'Part II §7.3',
    scope: 'LINEAR11 word bits[15:11]',
  },
  linear16: {
    id: 'linear16',
    token: 'LINEAR16',
    name: '16 位线性格式',
    detail:
      '输出电压线性格式总类（Part II §8.4.1）：电压 = V × 2^N；V 为 16 位无符号整数（0～65535），N 来自 VOUT_MODE 参数位 bits[4:0]。1.3.1 按命令语义正式命名为 ULINEAR16（直接设置输出电压）与 SLINEAR16（加减偏移）。',
    source: 'pmbus-spec',
    specRef: 'Part II §8.4.1',
    scope: '输出电压 word',
  },
  ulinear16: {
    id: 'ulinear16',
    token: 'ULINEAR16',
    name: '16 位无符号线性格式',
    detail:
      'PMBus 1.3.1 正式格式名（Part II §8.4.1.1；1.3 旧文统称 Linear Mode）：直接设置输出电压的命令（如 VOUT_COMMAND）使用 16 位无符号整数 Y_u（0～65535），按 X = Y_u × 2^N 解码，N 来自 VOUT_MODE bits[4:0]。',
    source: 'pmbus-spec',
    specRef: 'Part II §8.4.1.1',
    scope: 'L16 payload（无符号）',
  },
  slinear16: {
    id: 'slinear16',
    token: 'SLINEAR16',
    name: '16 位有符号线性偏移格式',
    detail:
      'PMBus 1.3.1 正式格式名（Part II §8.4.1.2；1.3 旧文统称 Linear Mode）：为输出电压加减偏移的命令（如 VOUT_TRIM / VOUT_CAL_OFFSET，Part II §13.3/§13.4）使用 16 位二补码 Y_s，按 X_offset = Y_s × 2^N 解码；这两条命令在 VID 输出电压格式下不可用。',
    source: 'pmbus-spec',
    specRef: 'Part II §8.4.1.2',
    scope: 'L16 payload（偏移）',
  },
  vid: {
    id: 'vid',
    token: 'VID',
    name: '电压识别码',
    detail:
      '输出电压 VID 数据格式（Part II §8.4.2）：code ↔ 电压的映射依赖具体处理器/制造商（Table 3），不能凭通用规范推导；VID 格式不支持 Relative 值语义（§8.5.3）。',
    source: 'pmbus-spec',
    specRef: 'Part II §8.4.2',
    scope: '输出电压格式',
  },
  direct: {
    id: 'direct',
    token: 'DIRECT',
    name: '直接格式',
    detail:
      '直接格式（Part II §7.4）：X = (1/m)(Y × 10^(−R) − b)，编码侧 Y = (mX + b) × 10^R。m 是缩放斜率、b 是偏移（均为两字节二补码），R 是十进制指数（一字节二补码）；系数必须来自器件 COEFFICIENTS 或数据手册，同一参数读与写的系数可能不同。',
    source: 'pmbus-spec',
    specRef: 'Part II §7.4',
    scope: '数值格式',
  },
  binary16: {
    id: 'binary16',
    token: 'IEEE 754 binary16',
    name: 'IEEE 754 半精度浮点数',
    detail:
      'IEEE 754 半精度浮点（Part II §7.6）：1 位符号（bit15）、5 位指数（bits[14:10]）、10 位尾数（bits[9:0]）；PMBus word 传输低字节在前。标准 binary16 换算不依赖器件 m/b/R 或 VID 表。',
    source: 'pmbus-spec',
    specRef: 'Part II §7.6',
    scope: '数值格式',
  },
  'fp-special': {
    id: 'fp-special',
    token: 'NaN / ±Infinity',
    name: '浮点特殊值',
    detail:
      'IEEE 754 特殊值的 PMBus 设备操作语义（Part II §7.6.2）：设备读回主机写入的值必须返回相同编码；收到 NaN 按 invalid data 处理（§10.8），设备也可用 NaN 表示值不可用；+Inf/−Inf 分别表示正/负满量程与测量通道相应方向饱和。这是协议语义，不代表本计算器发生了通信。',
    source: 'pmbus-spec',
    specRef: 'Part II §7.6.2',
    scope: 'HALF 特殊值操作语义',
  },
  'twos-complement': {
    id: 'twos-complement',
    token: '二补码',
    name: "二补码（two's complement）",
    detail:
      '用位模式直接表示有符号整数的通用编码：最高位权重为负。LINEAR11 的 Y/N、DIRECT 的 m/b/R/Y 与 VOUT_TRIM/VOUT_CAL_OFFSET 的偏移量都是二补码整数（Part II §7.3/§7.4/§13.3）。',
    source: 'generic',
    scope: '通用编码概念',
  },
  quantization: {
    id: 'quantization',
    token: '格式编码量化误差',
    name: '格式编码量化',
    detail:
      '位宽有限的编码格式只能按台阶表示数值：请求值与可编码值之差最多约 1 个 LSB（Part II §8.5.2 示例：相对值 1.1 编码后实际为 1.0996）。本工具显示的是 requested − represented 的格式编码差距，不是器件测量/设置准确度——器件准确度与分辨率由产品资料规定（§7.8/§7.9）。',
    source: 'generic',
    specRef: 'Part II §7.8/§7.9',
    scope: '编码读数（全模式）',
  },
  'raw-word': {
    id: 'raw-word',
    token: 'Raw Word',
    name: '原始字',
    detail:
      'canonical 16 位原始字：本计算器唯一的无符号数值位型真值。Raw Word 输入/显示、位网格、公式操作数、decode/encode、Raw Word 复制与 C 宏都指向同一个 state.raw；字节顺序只存在于 Wire Bytes 显示/复制层，永远不会改写 Raw Word 的数值含义（v3.0.0 领域模型）。',
    source: 'project',
    scope: '原始字（全模式）',
  },
  hex: {
    id: 'hex',
    token: 'Hex',
    name: '十六进制',
    detail: '用 0–9、A–F 表示原始字节/字。',
    source: 'generic',
    scope: '显示与复制',
  },
  le: {
    id: 'le',
    token: 'LE',
    name: '低字节在前',
    detail:
      '低字节在前（least significant byte first）：SMBus/PMBus word 事务在线上的传输顺序——SMBus 3.0 §6.5.4 写事务明示 word 数据 low byte first，§6.5.5 读事务图中 Data Byte Low 在前，PMBus Part I §5.6.3.2.4 确认 DS=0 默认按 SMBus 标准（最低有效字节在前）。本工具的 Wire Bytes 显示/复制即该顺序；它不改变 Raw Word 的数值。',
    source: 'smbus',
    specRef: 'SMBus 3.0 §6.5.4/§6.5.5',
    scope: '字节序（线上顺序）',
  },
  be: {
    id: 'be',
    token: 'BE',
    name: 'MSB-first 表示',
    detail:
      '高字节在前（MSB-first / 大端）字节序列表示：与线上顺序相反的另一种 serialization 表示，仅用于显示与对照，不是 SMBus/PMBus word 的合法线上顺序，也不会改写 Raw Word。',
    source: 'project',
    scope: '字节序（MSB-first 表示）',
  },
  exponent: {
    id: 'exponent',
    token: 'N',
    name: 'VOUT_MODE 指数',
    detail:
      '输出电压 LINEAR16 的缩放指数（Part II §8.3/§8.4.1）：VOUT_MODE bits[4:0] 的 5 位二补码值（−16～15）。它与 LINEAR11 word 内 bits[15:11] 的指数是不同位置的 N。',
    source: 'pmbus-spec',
    specRef: 'Part II §8.3/§8.4.1',
    scope: 'VOUT_MODE bits[4:0]',
  },
  transaction: {
    id: 'transaction',
    token: '事务',
    name: '总线事务',
    detail:
      'SMBus/PMBus 的读/写事务形式（Byte/Word/Block 等），决定一条命令在线上传输的数据宽度。本工具的命令参考只静态展示事务信息，不发起任何总线通信。',
    source: 'smbus',
    scope: '命令参考',
  },
}

/** Stable id list (iteration order = declaration order). */
export const GLOSSARY_TERM_IDS: readonly TermId[] = Object.keys(GLOSSARY) as TermId[]

/** Canonical token allowlist derived from the glossary (never hand-duplicated). */
export const CANONICAL_TOKENS: readonly string[] = GLOSSARY_TERM_IDS.map((id) => GLOSSARY[id].token)

export function getGlossaryTerm(id: string): GlossaryTerm | undefined {
  return GLOSSARY[id as TermId]
}
