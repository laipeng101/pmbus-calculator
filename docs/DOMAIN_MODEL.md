# DOMAIN MODEL

> 本文件是 PMBus 数据格式、舍入、饱和、字节序与命令 profile 的领域规则。
> 算法实现位于 `src/legacy/pmbus-math.ts`；命令元数据位于 `src/legacy/command-metadata.ts`。

## 1. 数据格式

| 格式     | 公式                            | 取值范围                                                |
| -------- | ------------------------------- | ------------------------------------------------------- |
| LINEAR11 | `X = Y × 2^N`                   | N 5-bit signed `-16..15`，Y 11-bit signed `-1024..1023` |
| LINEAR16 | `X = V × 2^N`                   | V 16-bit unsigned `0..65535`，N 来自 VOUT_MODE          |
| DIRECT   | `X = (1/m) × (Y × 10^(−R) − b)` | Y 16-bit signed `-32768..32767`，m/b/R 器件相关         |
| HALF     | IEEE 754 binary16               | 1-bit sign，5-bit exponent，10-bit mantissa             |

## 2. 饱和与错误处理

### 2.1 LINEAR11

- `findBestLinear11(val)` 必须在 `val` 超出可表示范围时饱和：
  - `val >= 1023 × 2^15` → `N=15, Y=1023`；
  - `val <= -1024 × 2^15` → `N=15, Y=-1024`。
- 不得返回 `N=0,Y=0` 使 `0x0000` 被错误编码。
- 饱和时 `delta` 保留原始差值，UI 必须显示误差警告。

### 2.2 LINEAR16

- 手动 V 输入和 `raw/set` 必须 clamp 到 `0..65535`，不得使用 `raw & 0xffff` 回绕。
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
  - subnormal 与 normal 边界按 subnormal ulp `2^-24` 舍入；
  - `|value| >= 65520` 溢出到 `±Infinity`；
  - `NaN` → `0x7E00`，`±0` 保留符号。

## 3. VOUT_MODE

- `parseVoutMode(byte)`：mode bits `[7:5]`，param bits `[4:0]`，规范引用为 PMBus Part II §8.3。
- `000` = LINEAR，N 取 param bits 的 5-bit signed。
- `011` = IEEE Half，其余为 VID/DIRECT/保留。
- 非 LINEAR 模式不得静默修改 `state.l16.n`。

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
- 可选 `preset` 与标准定义分离；当前只允许 `sourceKind: project-demo`。
- `command/set` 只记录选择并显示命令信息，不得切换模式、加载参数或重编码 raw。
- 只有 `command/apply-preset` 显式触发时才应用预设；UI 必须标注“应用 project-demo 预设”。
- DIRECT 系数必须以具体器件数据手册为准；没有真实来源的 `device-datasheet` 预设禁止内置。
- `STATUS_WORD` 是状态位摘要（`encodingRule: status`），`READ_EIN` 是 block read（`encodingRule: block`），均不分配数值转换模式。
