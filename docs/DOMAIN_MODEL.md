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
- `raw/set-from-hex` 保留 16-bit 截断语义（兼容旧版十六进制输入）。

### 2.3 DIRECT

- `m === 0` 时解码返回 `NaN`，UI 显示错误提示，不得崩溃。
- `Y` 是 16-bit signed；`raw` 与 signed `Y` 必须只有一个事实来源（DIRECT 闭环完成前不得再引入第二个）。

### 2.4 HALF

- `encodeHalf` 必须按 IEEE 754 round-to-nearest-even：
  - mantissa 0.5 的 tie 向偶数舍入；
  - subnormal 与 normal 边界按 subnormal ulp `2^-24` 舍入；
  - `|value| >= 65520` 溢出到 `±Infinity`；
  - `NaN` → `0x7E00`，`±0` 保留符号。

## 3. VOUT_MODE

- `parseVoutMode(byte)`：mode bits `[7:5]`，param bits `[4:0]`。
- `000` = LINEAR，N 取 param bits 的 5-bit signed。
- `011` = IEEE Half，其余为 VID/DIRECT/保留。
- 非 LINEAR 模式不得静默修改 `state.l16.n`。

## 4. 字节序

- 内部 `state.raw` 一律按 PMBus 小端语义存储。
- L16 在 `byteOrder === 'be'` 时，Hex 输入/显示按字节交换解释。
- 复制偏好（`copy.endian`）独立于内部字节序，只影响复制文本。

## 5. 命令与 profile

- 命令字典唯一数据源：`src/legacy/command-metadata.ts`。
- 每个命令必须声明：
  - `dataFormat`：`LINEAR11` | `LINEAR16` | `DIRECT` | `STATUS` | `BLOCK`
  - `transactionType`：`read_word` / `write_word` / `read_block` 等
  - `valueType`：`scalar` | `status` | `block`
- `mode` 只能用于 scalar 数值命令；`STATUS` / `BLOCK` 不得设置 `mode`。
- 数值默认值只是 typical example，必须标 `profileSource` 与 `profileAppliesTo`。
- DIRECT 系数必须以具体器件数据手册为准；没有来源的 DIRECT profile 禁止出现在默认命令列表中。
- `STATUS_WORD` 是状态位摘要，`READ_EIN` 是 block read，均不分配数值转换模式。
