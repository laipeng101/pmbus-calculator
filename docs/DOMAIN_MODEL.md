# DOMAIN MODEL

> 本文件是 PMBus 数据格式、舍入、饱和、字节序与命令 profile 的领域规则。
> 算法实现位于 `src/legacy/pmbus-math.ts`；命令元数据位于 `src/legacy/command-metadata.ts`。

## 1. 数据格式

| 格式     | 公式                                               | 取值范围                                                |
| -------- | -------------------------------------------------- | ------------------------------------------------------- |
| LINEAR11 | $X = Y \times 2^N$                                 | N 5-bit signed `-16..15`，Y 11-bit signed `-1024..1023` |
| LINEAR16 | $X = V \times 2^N$                                 | V 16-bit unsigned `0..65535`，N 来自 VOUT_MODE          |
| DIRECT   | $X = \frac{1}{m}\left(Y \times 10^{-R} - b\right)$ | Y 16-bit signed `-32768..32767`，m/b/R 器件相关         |
| HALF     | IEEE 754 binary16 分段解码（见 §2.4）              | 1-bit sign，5-bit exponent，10-bit mantissa             |

## 2. 饱和与错误处理

### 2.1 LINEAR11

- `findBestLinear11(val)` 必须在 `val` 超出可表示范围时饱和：
  - $val \ge 1023 \times 2^{15}$ → `N=15, Y=1023`；
  - $val \le -1024 \times 2^{15}$ → `N=15, Y=-1024`。
- 不得返回 `N=0,Y=0` 使 `0x0000` 被错误编码。
- 饱和时 `delta` 保留原始差值，UI 必须显示误差警告。
- `Y=1023` 与 `Y=-1024` 是合法的 LINEAR11 边界编码，不是天然的溢出/饱和标记；
  仅当用户输入的物理值超出可表示范围且编码器实际饱和时才显示 saturation warning。
- 饱和判断范围：`autoN=true` 时用全格式全局可表示范围（`maxLinear11`/`minLinear11`，即
  N=15 极值）判断；`autoN=false` 时按当前锁定 N 对应的 `Y=-1024..1023` 范围
  （`linear11RangeForN(n)`）判断。边界值（Y=1023 / Y=-1024）本身不报警。

### 2.2 LINEAR16

- 手动 V 输入和 `raw/set` 必须 clamp 到 `0..65535`，不得使用 `raw & 0xffff` 回绕。
- reducer/domain 层必须拒绝在 relative LINEAR、VID、DIRECT、IEEE Half VOUT_MODE 下通过
  `value/set` 生成 LINEAR16 编码——不能只靠隐藏 UI 输入阻止错误状态。
- 只有 **absolute LINEAR** 才显示绝对电压结果、V、N、2^N 与可表示电压范围；
  relative LINEAR 可以解释 VOUT_MODE 参数位的 exponent/ratio 语义，但不得把 raw 标成
  绝对电压；VID/DIRECT/IEEE Half 不得生成虚假的 LINEAR16 V/N/range/result。
- `raw/set-from-hex` 使用严格十六进制解析：可选 `0x`/`0X` 前缀与首尾空白；必须整串匹配，最多 4 位十六进制数字；非法、只有 `0x`、超长输入均报错且不修改 `state.raw`；空输入按 0 处理。不再通过 `& 0xffff` 静默截断超长输入。

### 2.3 DIRECT

- `state.direct.error` 只在 DIRECT 模式显示；切换到其他模式后必须隐藏系数校验错误（模式作用域隔离）。
- 应用有效 DIRECT preset 必须清除旧错误；无效系数不得破坏已存在的有效 `state.raw`。
- `m === 0` 时解码返回 `NaN`，UI 显示错误提示，不得崩溃。
- `Y` 是 16-bit signed（`-32768..32767`）；`state.raw` 是唯一编码事实来源，
  `Y = toSigned(raw, 16)` 始终派生自 `raw`，`state.direct` 只保存 `m/b/R`。
- `m`、`b` 必须是 signed 16-bit integer（`-32768..32767`）；`R` 必须是 signed 8-bit integer（`-128..127`）。
- 系数非法（浮点数、超范围、`m=0`）必须显示明确错误，不得静默接受。
- 编码舍入策略（legacy 兼容）：`Y = clamp(Math.round((m × Value + b) × 10^R), -32768, 32767)`。
  `Math.round` 对 `.5` 向正无穷方向舍入（`1.5 -> 2`，`-1.5 -> -1`）；该策略在获得官方规范
  明确要求前保持不变，并有 golden case 覆盖。

### 2.4 HALF

- `encodeHalf` 必须按 IEEE 754 round-to-nearest-even：
  - mantissa 0.5 的 tie 向偶数舍入；
  - subnormal 与 normal 边界按 subnormal ulp $2^{-24}$ 舍入；
  - `|value| >= 65520` 溢出到 `±Infinity`；
  - `NaN` → `0x7E00`，`±0` 保留符号。

## 3. VOUT_MODE

- 单一领域来源：`src/legacy/vout-mode.ts` 的 `analyzeVoutMode` / `composeVoutMode`；
  `parseVoutMode` 保持兼容（PMBus Part II §8.3 位域解析）：
  - bit7 = Absolute/Relative（Part II §8.5）；bits[6:5] = format（`00` LINEAR、`01` VID、
    `10` DIRECT、`11` IEEE Half）；bits[4:0] = parameter。
  - 旧实现用 `(byte >> 5) & 0x07` 把 bit7 混入 format，是位域解析错误；format 只有 2 位。
- **bit7 语义纠偏（Part II §8.5 / §8.5.1–§8.5.3）**：bit7 配置的是 §8.5 所列
  output-voltage-related commands（VOUT_MARGIN_HIGH/LOW、VOUT_OV/UV_FAULT/WARN_LIMIT、
  POWER_GOOD_ON/OFF）的 absolute/relative 行为；VOUT_COMMAND 是 nominal reference，
  而不是被改成相对值。relative 编码数值是相对比值，绝对阈值 = 相对值 × VOUT_COMMAND
  nominal。本页没有命令选择上下文，因此不把 generic raw 自动标为绝对 V，也不套用器件数据。
- **Relative 不适用于 VID（Part II §8.5.3）**：`0xA0..0xBF` 分类为 `invalid-combination`，
  绝不显示“相对 LINEAR”。
- **DIRECT / IEEE Half 参数必须为 `00000b`（Part II §8.3 Table 2）**：`0x41..0x5F`、
  `0x61..0x7F` 及对应 bit7=1 的组合分类为 `invalid-parameter`，可解码但不可作为有效配置。
- VID 参数是 unsigned VID Code Type（Part II §8.4.2 Table 3）：`00h` = not-used；
  `1Eh/1Fh` = profile-required（制造商自定义）；其余未列 code = reserved。
- **L16 exponent 单一事实源**：`AppState.l16` 只存 `voutMode` byte；N 一律由
  `analyzeVoutMode(voutMode).linearExponent` 派生，不存在第二个 exponent 存储。
- L16 页面只在 **absolute LINEAR** 时计算并显示 `X = V \times 2^N`：
  - relative LINEAR：解释 `V \times 2^N` 的比值语义并说明需要 nominal reference，不计算绝对电压；
  - VID / DIRECT / IEEE Half：不得伪装成 LINEAR16 结果，显示精确的
    not-used / reserved / profile-required / invalid-parameter / invalid-combination 状态。

## 4. 字节序

- `state.raw` 是未交换的 16-bit raw word（寄存器值），是编码的唯一事实来源。
- “on-wire LE/BE bytes” 是 raw word 在总线上的字节序列：LE = `[low, high]`，BE = `[high, low]`。
- L16 在 `byteOrder === 'be'` 时，Hex 输入/显示按字节交换解释；`rawWordHex` 始终显示未交换 raw word。
- 复制偏好（`copy.endian`）只影响 Hex 复制文本；C 宏始终输出未交换 raw word；
  LE bytes / BE bytes 复制按钮输出独立的 byte-array 文本。

## 5. 命令与 profile

- 命令字典唯一数据源：`src/legacy/command-metadata.ts`。
- 标准命令定义声明：
  - `cmd`：命令码
  - `transactions`：可同时表达读/写事务，如 `{ write: { type: 'write_word', dataBytes: 2 }, read: { type: 'read_word', dataBytes: 2 } }`
  - `valueType`：`scalar` | `status` | `block`
  - `units`：物理单位或位字段标记；标准定义不固定 FAN_COMMAND_1 为 RPM（依 FAN_CONFIG_1_2）
  - `spec`：规范章节（Part II 命令章节 + Appendix I Table 31）
  - `encodingRule`：`follows_vout_mode` | `device_defined` | `status` | `block`
- 命令参考面板是只读的：只显示命令码、事务、数据类型、单位、格式来源与规范章节；
  选择命令不能可靠推导数据格式（器件数据手册或 VOUT_MODE 决定），因此参考面板不参与
  模式切换、参数注入或结果计算，也不提供任何 preset 应用入口。
- `command/set` 仅为状态层兼容保留，不得切换模式、加载参数或重编码 raw；
  `command/apply-preset` 已从产品面移除。
- DIRECT 系数必须以具体器件数据手册为准；没有真实来源时禁止内置虚构系数。
- `STATUS_WORD` 是状态位摘要（`encodingRule: status`），`READ_EIN` 是 block read（`encodingRule: block`），均不分配数值转换模式。
- `STATUS_WORD` 通常为 Read Word；特殊写入仅用于清除 UNKNOWN 位（写 0x0100），其他状态位通过底层状态寄存器或 `CLEAR_FAULTS` 处理；不得写成“写入可清除所有状态位”。
- `READ_EIN` 存在规范内部冲突：Part II §18.13 描述 6 个数据字节（accumulator 2 + rollover 1 + sample count 3），Appendix I Table 31 列为 5。实现使用 `dataBytesConflict` 显式记录两个来源，不在 UI 中提供单一权威数字；计算器不是 READ_EIN packet-length authority。
- 当前实现基线为 PMBus Rev 1.3（官方来源与校验信息见 `document/specifications.json`；规范 PDF 不再随源码树分发）。官方 Rev 1.3.1 仍保留上述冲突；官方当前版本为 1.5，但本仓库不评估或声明 1.5 兼容性，未来规范升级列为独立 backlog。
