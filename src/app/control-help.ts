import { GLOSSARY } from './terminology'

/**
 * Single source for control behaviour help (v2.6.0).
 *
 * "What does this button do" is not a PMBus glossary definition, so control
 * help lives in its own typed registry instead of being scattered over JSX or
 * native `title` attributes. Dynamic help (current lock state, current bit
 * value, disabled reasons) is generated from stable templates plus explicit
 * state parameters — components never re-derive protocol conclusions, they
 * only pass state through.
 *
 * Entries may compose glossary concepts by referencing `GLOSSARY`, never by
 * copying the same Chinese definition text.
 */

export type ControlHelpId =
  | 'theme-toggle'
  | 'mode-tab-linear11'
  | 'mode-tab-linear16'
  | 'mode-tab-direct'
  | 'mode-tab-half'
  | 'mode-tab-vout-mode'
  | 'l11-n-lock'
  | 'bit-toggle'
  | 'vout-abs'
  | 'vout-rel'
  | 'vout-format-linear'
  | 'vout-format-vid'
  | 'vout-format-direct'
  | 'vout-format-half'
  | 'vout-normalize'
  | 'vout-apply-example'
  | 'vout-explanations-toggle'
  | 'copy-raw-word'
  | 'copy-wire-bytes'
  | 'copy-msb-first-bytes'
  | 'copy-physical'
  | 'copy-c-macro'
  | 'copy-pref-prefix'
  | 'copy-pref-space'
  | 'steps-toggle'
  | 'command-ref-toggle'
  | 'debug-toggle'

/** Per-id dynamic parameters. `undefined` = purely static help text. */
export interface ControlHelpParams {
  'theme-toggle': { themeLabel: string }
  'mode-tab-linear11': undefined
  'mode-tab-linear16': undefined
  'mode-tab-direct': undefined
  'mode-tab-half': undefined
  'mode-tab-vout-mode': undefined
  'l11-n-lock': { locked: boolean }
  'bit-toggle': {
    bitNumber: number
    region: string
    value: 0 | 1
    disabledReason?: string
  }
  'vout-abs': undefined
  'vout-rel': { disabledReason?: string }
  'vout-format-linear': undefined
  'vout-format-vid': undefined
  'vout-format-direct': undefined
  'vout-format-half': undefined
  'vout-normalize': undefined
  'vout-apply-example': undefined
  'vout-explanations-toggle': { count: number }
  'copy-raw-word': { prefixed: boolean }
  'copy-wire-bytes': undefined
  'copy-msb-first-bytes': undefined
  'copy-physical': { available: boolean; usesOverride: boolean; unavailableReason?: string }
  'copy-c-macro': undefined
  'copy-pref-prefix': { pressed: boolean }
  'copy-pref-space': { pressed: boolean }
  'steps-toggle': { count: number }
  'command-ref-toggle': { count: number }
  'debug-toggle': { open: boolean }
}

export interface ControlHelpEntry<P> {
  /** Stable short Chinese name of the control. */
  name: string
  /** Full Chinese tooltip text generated from a stable template. */
  render: (params: P) => string
}

export type ControlHelpRegistry = {
  [K in ControlHelpId]: ControlHelpEntry<ControlHelpParams[K]>
}

const MODE_TAB_HELP = {
  'mode-tab-linear11': {
    name: 'LINEAR11 模式标签',
    shortcutIndex: 1,
    modeName: 'LINEAR11',
  },
  'mode-tab-linear16': {
    name: 'LINEAR16 模式标签',
    shortcutIndex: 2,
    modeName: 'LINEAR16',
  },
  'mode-tab-direct': {
    name: 'DIRECT 模式标签',
    shortcutIndex: 3,
    modeName: 'DIRECT',
  },
  'mode-tab-half': {
    name: 'HALF 模式标签',
    shortcutIndex: 4,
    modeName: 'HALF',
  },
  'mode-tab-vout-mode': {
    name: 'VOUT_MODE 模式标签',
    shortcutIndex: 5,
    modeName: 'VOUT_MODE',
  },
} as const

function modeTabHelp(modeName: string, shortcutIndex: number): string {
  return `切换到 ${modeName} 换算器。可用快捷键 Ctrl+${shortcutIndex} 切换（在输入框内编辑时不生效）。`
}

const FORMAT_HELP: Record<
  'vout-format-linear' | 'vout-format-vid' | 'vout-format-direct' | 'vout-format-half',
  {
    bits: string
    glossaryId: keyof typeof GLOSSARY
  }
> = {
  'vout-format-linear': { bits: '00b', glossaryId: 'linear' },
  'vout-format-vid': { bits: '01b', glossaryId: 'vid' },
  'vout-format-direct': { bits: '10b', glossaryId: 'direct' },
  'vout-format-half': { bits: '11b', glossaryId: 'binary16' },
}

export const CONTROL_HELP: ControlHelpRegistry = {
  'theme-toggle': {
    name: '主题切换',
    render: ({ themeLabel }) =>
      `在亮色 / 暗色 / 跟随系统之间循环切换主题；当前主题：${themeLabel}。主题选择保存在本机。`,
  },
  'mode-tab-linear11': {
    name: MODE_TAB_HELP['mode-tab-linear11'].name,
    render: () =>
      modeTabHelp(
        MODE_TAB_HELP['mode-tab-linear11'].modeName,
        MODE_TAB_HELP['mode-tab-linear11'].shortcutIndex,
      ),
  },
  'mode-tab-linear16': {
    name: MODE_TAB_HELP['mode-tab-linear16'].name,
    render: () =>
      modeTabHelp(
        MODE_TAB_HELP['mode-tab-linear16'].modeName,
        MODE_TAB_HELP['mode-tab-linear16'].shortcutIndex,
      ),
  },
  'mode-tab-direct': {
    name: MODE_TAB_HELP['mode-tab-direct'].name,
    render: () =>
      modeTabHelp(
        MODE_TAB_HELP['mode-tab-direct'].modeName,
        MODE_TAB_HELP['mode-tab-direct'].shortcutIndex,
      ),
  },
  'mode-tab-half': {
    name: MODE_TAB_HELP['mode-tab-half'].name,
    render: () =>
      modeTabHelp(
        MODE_TAB_HELP['mode-tab-half'].modeName,
        MODE_TAB_HELP['mode-tab-half'].shortcutIndex,
      ),
  },
  'mode-tab-vout-mode': {
    name: MODE_TAB_HELP['mode-tab-vout-mode'].name,
    render: () =>
      modeTabHelp(
        MODE_TAB_HELP['mode-tab-vout-mode'].modeName,
        MODE_TAB_HELP['mode-tab-vout-mode'].shortcutIndex,
      ),
  },
  'l11-n-lock': {
    name: 'N 锁定切换',
    render: ({ locked }) =>
      locked
        ? 'N 当前自动选择（锁定）：编码物理值时自动选取指数 N。点击切换为手动，解锁后可直接编辑 N。'
        : 'N 当前手动（解锁）：可直接编辑指数 N。点击切换为自动，编码时自动选取最优 N。',
  },
  'bit-toggle': {
    name: '位编辑按钮',
    render: ({ bitNumber, region, value, disabledReason }) =>
      disabledReason != null
        ? `第 ${bitNumber} 位（${region}）不可编辑：${disabledReason}`
        : `第 ${bitNumber} 位（${region}），当前为 ${value}。点击翻转为 ${value === 0 ? 1 : 0}。`,
  },
  'vout-abs': {
    name: '绝对值（bit7 = 0）',
    render: () =>
      '把 bit7 设为 0（绝对值）：输出电压命令按绝对电压解释。该语义只作用于 Part II §8.5 列出的 8 个输出电压命令。',
  },
  'vout-rel': {
    name: '相对值（bit7 = 1）',
    render: ({ disabledReason }) =>
      disabledReason != null
        ? `相对值不可用：${disabledReason}`
        : '把 bit7 设为 1（相对值）：实际阈值/限值 = 相对值 × VOUT_COMMAND 标称值（Part II §8.5）。VID 格式不支持相对值。',
  },
  'vout-format-linear': {
    name: '格式 LINEAR',
    render: () => formatHelp('vout-format-linear'),
  },
  'vout-format-vid': {
    name: '格式 VID',
    render: () => formatHelp('vout-format-vid'),
  },
  'vout-format-direct': {
    name: '格式 DIRECT',
    render: () => formatHelp('vout-format-direct'),
  },
  'vout-format-half': {
    name: '格式 IEEE Half',
    render: () => formatHelp('vout-format-half'),
  },
  'vout-normalize': {
    name: '规范化',
    render: () =>
      '按当前选中的语义（bit7、格式、参数）把 VOUT_MODE 字节重写为规范形式：DIRECT/IEEE Half 的参数位清为 00000b，非法组合按位域规则修正。',
  },
  'vout-apply-example': {
    name: '应用计算器 LINEAR 示例',
    render: () =>
      '把共享 VOUT_MODE 字节恢复为计算器 LINEAR 示例 0x18（absolute、N=-8），并清除旧的编码请求。0x18 是计算器示例/恢复值，不是 PMBus 规范默认值，也不代表真实器件一定接受写入。',
  },
  'vout-explanations-toggle': {
    name: 'VOUT_MODE 说明折叠',
    render: ({ count }) =>
      `展开/收起当前字节的规范说明（共 ${count} 条）。说明为只读内容，不改变任何状态。`,
  },
  'copy-raw-word': {
    name: 'Raw Word 复制',
    render: ({ prefixed }) =>
      `复制 canonical Raw Word 的 Hex 文本（始终是未交换的 16 位数值，与 Raw Word 输入框、位网格一致）。当前${prefixed ? '带 0x 前缀' : '不带 0x 前缀'}；字节顺序偏好不影响该复制。`,
  },
  'copy-wire-bytes': {
    name: 'Wire 字节复制',
    render: () =>
      '复制 SMBus / PMBus Wire Bytes（低字节在前）：SMBus 3.0 §6.5.4/§6.5.5 规定 word 数据按低字节在前传输。这是序列化表示，不改变 Raw Word。',
  },
  'copy-msb-first-bytes': {
    name: 'MSB-first 字节复制',
    render: () =>
      '复制 MSB-first 字节（高字节在前）。这是另一种字节序列表示，仅用于显示/对照，不是 SMBus/PMBus word 的线上顺序。',
  },
  'copy-physical': {
    name: '物理值复制',
    render: ({ available, usesOverride, unavailableReason }) => {
      if (!available)
        return `物理值复制不可用：${unavailableReason ?? '当前状态没有可回录的物理值'}`
      return usesOverride
        ? '复制经验证的精确回录文本：当前显示值为近似，直接复制会编码为不同的请求；此文本经独立编码器验证可安全回录。'
        : '复制当前物理值文本；粘贴回物理值输入可安全重编码。'
    },
  },
  'copy-c-macro': {
    name: 'C 代码复制',
    render: () =>
      '复制项目生成的 C 宏定义文本（#define 形式，值为未交换的 raw word）。C 宏是本计算器的输出格式，不是 PMBus 协议内容。',
  },
  'copy-pref-prefix': {
    name: '0x 前缀偏好',
    render: ({ pressed }) =>
      pressed
        ? '0x 前缀当前开启：Hex 复制文本以 0x 开头。点击关闭。'
        : '0x 前缀当前关闭：Hex 复制文本不含 0x。点击开启。',
  },
  'copy-pref-space': {
    name: '字节空格偏好',
    render: ({ pressed }) =>
      pressed
        ? '字节空格当前开启：Hex 复制文本在字节之间插入空格。点击关闭。'
        : '字节空格当前关闭：Hex 复制文本的字节连续排列。点击开启。',
  },
  'steps-toggle': {
    name: '计算过程折叠',
    render: ({ count }) =>
      `展开/收起计算过程（共 ${count} 步）。步骤为只读推导展示，不改变任何状态。`,
  },
  'command-ref-toggle': {
    name: '命令参考折叠',
    render: ({ count }) =>
      `展开/收起只读命令参考表（${count} 条命令）。参考面板无副作用：查看命令不会改变模式、raw 或结果。`,
  },
  'debug-toggle': {
    name: '调试面板开关',
    render: ({ open }) =>
      open
        ? '收起调试面板。面板内容为状态快照，仅用于诊断。'
        : '展开调试面板（状态快照，仅诊断用途）。',
  },
}

function formatHelp(id: keyof typeof FORMAT_HELP): string {
  const entry = FORMAT_HELP[id]
  const term = GLOSSARY[entry.glossaryId]
  return `把 bits[6:5] 设为 ${entry.bits}（${term.token}）：${term.name}。${term.detail}`
}

/** Resolve the full Chinese tooltip text for a control. */
export function controlHelpText<K extends ControlHelpId>(
  id: K,
  params: ControlHelpParams[K],
): string {
  return CONTROL_HELP[id].render(params)
}

/** Stable id list (iteration order = declaration order of the registry). */
export const CONTROL_HELP_IDS = Object.keys(CONTROL_HELP) as ControlHelpId[]
