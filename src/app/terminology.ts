/**
 * Single source of truth for the canonical technical terms shown in the
 * product UI (M39 glossary).
 *
 * The UI is Chinese-primary: English is kept only for industry-irreplaceable
 * canonical identifiers (PMBus, LINEAR, VID, DIRECT, IEEE 754 binary16, …).
 * Every retained token must have a discoverable Chinese explanation, provided
 * by the clickable `TechnicalTerm` component rather than an inline English
 * translation. This module is the only place those Chinese definitions live —
 * components must not duplicate them.
 */

export type TermId =
  | 'pmbus'
  | 'smbus'
  | 'vout-mode'
  | 'vout-command'
  | 'linear'
  | 'linear11'
  | 'linear16'
  | 'ulinear16'
  | 'slinear16'
  | 'vid'
  | 'direct'
  | 'binary16'
  | 'hex'
  | 'le'
  | 'be'
  | 'exponent'

export interface GlossaryTerm {
  /** Stable machine id (also the E2E `data-testid` key). */
  id: TermId
  /** Canonical token rendered verbatim; never translated. */
  token: string
  /** Chinese display name. */
  name: string
  /** Concise Chinese explanation (non-interactive glossary copy). */
  detail: string
}

export const GLOSSARY: Record<TermId, GlossaryTerm> = {
  pmbus: {
    id: 'pmbus',
    token: 'PMBus',
    name: '电源管理总线',
    detail: '基于 SMBus 的电源管理通信与命令规范；本项目只做数值格式换算。',
  },
  smbus: {
    id: 'smbus',
    token: 'SMBus',
    name: '系统管理总线',
    detail: 'PMBus 所基于的串行管理总线；word 在线传输默认低字节在前。',
  },
  'vout-mode': {
    id: 'vout-mode',
    token: 'VOUT_MODE',
    name: '输出电压格式配置字节',
    detail:
      '1 字节配置：bit7 选择绝对/相对语义，bits[6:5] 选择格式，bits[4:0] 是格式参数（Part II §8.3）。',
  },
  'vout-command': {
    id: 'vout-command',
    token: 'VOUT_COMMAND',
    name: '标称输出电压命令',
    detail: 'Relative 模式的最终电压以它设置的标称值为参考：X = V_NOM × R。',
  },
  linear: {
    id: 'linear',
    token: 'LINEAR',
    name: '线性格式',
    detail: '使用二补码指数 N 对数据缩放；16 位无符号值按 X = V × 2^N 解码。',
  },
  linear11: {
    id: 'linear11',
    token: 'LINEAR11',
    name: '11 位线性格式',
    detail: 'X = Y × 2^N；N 为 5 位二补码（−16～15），Y 为 11 位二补码（−1024～1023）。',
  },
  linear16: {
    id: 'linear16',
    token: 'LINEAR16',
    name: '16 位线性格式',
    detail: 'X = V × 2^N；V 为 16 位无符号整数（0～65535），N 来自 VOUT_MODE 参数位。',
  },
  ulinear16: {
    id: 'ulinear16',
    token: 'ULINEAR16',
    name: '16 位无符号线性数',
    detail: 'Y_u 为 0～65535，按 X = Y_u × 2^N 解码。',
  },
  slinear16: {
    id: 'slinear16',
    token: 'SLINEAR16',
    name: '16 位有符号线性偏移量',
    detail:
      'Y_s 为二补码有符号数，用于 VOUT_TRIM / VOUT_CAL_OFFSET 等偏移语义，按 X_offset = Y_s × 2^N 解码。',
  },
  vid: {
    id: 'vid',
    token: 'VID',
    name: '电压识别码',
    detail: '映射依赖指定处理器/制造商定义；不能凭 PMBus 通用规范推导具体电压。',
  },
  direct: {
    id: 'direct',
    token: 'DIRECT',
    name: '直接格式',
    detail: '需要器件提供 m、b、R 系数才能换算：X = (1/m)(Y × 10^(−R) − b)。',
  },
  binary16: {
    id: 'binary16',
    token: 'IEEE 754 binary16',
    name: 'IEEE 754 半精度浮点数',
    detail: '1 位符号、5 位指数、10 位尾数。',
  },
  hex: {
    id: 'hex',
    token: 'Hex',
    name: '十六进制',
    detail: '用 0–9、A–F 表示原始字节/字。',
  },
  le: {
    id: 'le',
    token: 'LE',
    name: '小端序',
    detail: 'PMBus/SMBus word 传输默认低字节在前。',
  },
  be: {
    id: 'be',
    token: 'BE',
    name: '大端显示',
    detail: '仅用于寄存器显示或复制，不改变 PMBus 线上的默认低字节优先顺序。',
  },
  exponent: {
    id: 'exponent',
    token: 'N',
    name: '指数',
    detail: 'LINEAR 格式的缩放指数；VOUT_MODE bits[4:0] 的 5 位二补码值（−16～15）。',
  },
}

/** Stable id list (iteration order = declaration order). */
export const GLOSSARY_TERM_IDS: readonly TermId[] = Object.keys(GLOSSARY) as TermId[]

/** Canonical token allowlist derived from the glossary (never hand-duplicated). */
export const CANONICAL_TOKENS: readonly string[] = GLOSSARY_TERM_IDS.map((id) => GLOSSARY[id].token)

export function getGlossaryTerm(id: string): GlossaryTerm | undefined {
  return GLOSSARY[id as TermId]
}
