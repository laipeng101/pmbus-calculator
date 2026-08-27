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
- reducer/domain 层在 **relative LINEAR + ULINEAR16（比值语义）** 下必须拒绝 `value/set`
  生成 LINEAR16 编码——不能只靠隐藏 UI 输入阻止错误状态。拒绝按 payload 上下文判定，
  而非字节级 status：
- 非 LINEAR 共享字节（VID / DIRECT / IEEE Half 格式）遵循 §3 的 fail-closed 契约（v2.5.2）：
  输出电压相关命令的数据格式由当前 VOUT_MODE 决定（Part II §8.4），`value/set` 对
  非 LINEAR 共享字节**直接 no-op**——不生成 raw、不伪造 provenance、不回退到
  `DEFAULT_LINEAR_VOUT_MODE`。UI 显示实际共享字节与非 LINEAR 说明；恢复 LINEAR16
  编码的唯一路径是显式 `l16/apply-default-vout-mode`（真正写入 0x18 并清除旧
  provenance）。「拒绝 non-LINEAR 与 relative `value/set`」都是本仓库行为。
- 只有 **absolute LINEAR** 才显示绝对电压结果、V、N、2^N 与可表示电压范围；
  relative LINEAR 可以解释 VOUT_MODE 参数位的 exponent/ratio 语义，但不得把 raw 标成
  绝对电压；VID/DIRECT/IEEE Half 不得生成虚假的 LINEAR16 V/N/range/result。
- L16 payload 是独立于 VOUT_MODE 字节的命令 payload 语义，分两种：
  - `ULINEAR16`：`X = Y_u × 2^N`，`Y_u` 是无符号 16 位整数 `0..65535`；absolute LINEAR
    直接解出电压，relative LINEAR 解出无量纲正比例 `R = Y_u × 2^N`，最终电压
    `X = V_NOM × R`（`raw=0` 时 `R=0`，规范要求 relative value 为正，标记为非符合性）。
  - `SLINEAR16 offset`：`X_offset = Y_s × 2^N`，`Y_s` 是 16 位二补码 `-32768..32767`
    （Part II §13.3 VOUT_TRIM / §13.4 VOUT_CAL_OFFSET）；bit7 不参与该 payload 的数学，
    相对 + 有符号比例是伪标准组合，不提供。编码顺序契约（v2.5.2）：`value/set` 先判
    **共享字节非 LINEAR 即 fail-closed no-op**（不回退 0x18，见 §3），再按 payload 判定——
    `slinear16-offset` 在**任意 LINEAR 字节**
    （含 bit7=1，如 0x98）下按 signed 16-bit 编码并记录 provenance；`ulinear16` + relative
    拒绝；absolute ULINEAR 保持 `0..65535` 行为。可编码范围（`encodableRange`）同样
    payload 优先：signed payload 适用 `-32768..32767 × 2^N`，与 bit7 无关——
    0x98 / N=-8 的范围是 `-128..127.99609375`，`200 → 0x7FFF` 分类为 saturated/error。
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
- **L16 exponent 单一事实源**：`AppState.voutMode.byte` 是共享字节；N 一律由
  `analyzeVoutMode(byte).linearExponent` 派生，不存在第二个 exponent 存储。
- L16 页面使用 `effectiveL16VoutMode`：共享字节为 LINEAR 时直接 linked 使用；
  非 LINEAR 时返回 `source: 'non-linear'` 与**实际共享字节**（v2.5.2）——selector 不再
  提供 0x18 替身，所有计算/编码路径（value text、range、quantization、calculation
  steps、formula）必须对 `non-linear` fail closed。
- L16 页面只在 **absolute LINEAR** 时计算并显示 `X = V \times 2^N`：
  - relative ULINEAR16：解出比值 `R`，有 nominal reference 时 `X = V_NOM × R`，否则只显示比值；
  - SLINEAR16 offset：始终按 `X_offset = Y_s × 2^N` 计算，bit7 不适用；
  - 非 LINEAR 共享字节：fail closed——结果为 `—`、无物理值输入、无伪 LINEAR 范围、
    `computeQuantizationOutcome` 返回 null、计算步骤无伪 N/伪 V/伪结果；显示非 LINEAR
    说明与显式应用默认 0x18 的入口（`l16/apply-default-vout-mode` 真正改写共享字节）。
    VID（§8.4 + §13.3/§13.4 禁止）与 DIRECT/IEEE Half（需要相应 profile/coefficients，
    不猜测 N）有各自的阻断文案；invalid-parameter / invalid-combination 保持 error 级。
- 独立 VOUT_MODE 计算器（第五个模式）是 8-bit 字节配置器：双 nibble 交互位网格、bit7
  Absolute/Relative、bits[6:5] format、bits[4:0] parameter；raw 位/Hex 编辑 lossless
  （可构造 `0xA0`/`0x41`/`0xE1`），语义控件 canonicalize，`Normalize` 显式规范化。

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

## 6. 格式编码量化误差（format-encoding quantization）

实现单一来源：`src/app/quantization-error.ts`（可判别联合 `QuantizationOutcome`），
展示呈现在 `src/app/view-model.ts` 与共享组件 `src/components/result/ErrorDelta.tsx`。
本节语义适用于 LINEAR11 / LINEAR16 / DIRECT / IEEE Half 四个数值格式页。

### 6.1 请求来源（provenance）

- 量化误差仅在存在**显式且仍然有效**的编码请求时定义：请求 = 用户通过物理值输入
  最后一次成功提交的 `value/set`。L11 使用历史通道 `l11.valueInput`；L16/DIRECT/HALF
  共享模式标签的 `state.valueRequest`（`{ mode, value }`），防止跨页污染。
- 以下任一动作会使请求失效（provenance 清除，误差变为**未知**）：
  - 任何不经物理值输入的 raw 变更（Hex 输入、bit toggle、`raw/set`、DIRECT Y、
    SLINEAR16 手动 `l16/set-slinear-y`）；
  - 改变编码解释的状态变更（DIRECT m/b/R、L16 payload kind、任何 VOUT_MODE 字节变更）；
  - 切换到另一个模式。重复选择当前模式是幂等 no-op，**不清除**请求。
- 没有请求来源时 UI **必须隐藏**误差读数——禁止伪造 `+0.000000 (0.0000%)`。
  「未输入请求」与「误差为零」是两个不同的领域状态。

### 6.2 结果分类（可判别状态）

| status      | 条件                                                           | UI 严重度 |
| ----------- | -------------------------------------------------------------- | --------- |
| `exact`     | 有限请求与表示值相等                                           | ok        |
| `quantized` | 有限请求，表示值为最接近可编码值且不相等（含 ties-to-even）    | warn      |
| `saturated` | 请求超出当前指数/系数下的可表示范围，编码器 clamp 到边界有限值 | error     |
| `overflow`  | 有限请求按 IEEE 754 binary16 舍入为 ±Infinity（HALF 特有）     | error     |
| `special`   | 请求本身是 NaN / ±Infinity（HALF 一等值），编码为同类特殊值    | warn      |

- 误差方向沿用 legacy 定义：`requested − represented`（UI 必须写明，避免与
  `represented − requested` 混淆）。
- 相对误差仅在 `requested ≠ 0` 且两侧均为有限数时定义；零分母显示「—」，
  禁止显示 0%。±0 与 +0 相等（`=== 0`），同属零分母。
- 绝对误差格式化必须保证**任何非零差值绝不渲染为文本零**：`|x| ≥ 1e-6` 使用
  固定 6 位小数（legacy 观感），更小的非零值使用自适应有效数字/科学计数法。
- 严重度只由结果分类决定，**不存在跨格式的绝对误差阈值**：PMBus 设备准确度由
  产品资料规定（Part II §7.8/§7.9），LINEAR16 的 LSB 由指数决定、Half 的 ULP 随
  指数变化、DIRECT 的单位由命令/器件决定。UI 名称统一为「格式编码量化误差」，
  不得暗示设备测量/设置/调节准确度。
- HALF 有限值溢出（`|value| ≥ 65520`，见 §2.4）必须以 overflow/error 展示，
  不得因表示值非有限而隐藏读数。
- L16 SLINEAR16 offset 的量化计算不受 VOUT_MODE bit7 relative 影响（payload 语义
  优先，见 §2.2 与 Part II §13.3/§13.4）；非 LINEAR 共享字节无量化读数
  （`computeQuantizationOutcome` 返回 null，v2.5.2 fail-closed），显式应用 0x18 后恢复。
- DIRECT 的量化只描述「当前用户给定系数下的编码量化」，不代表器件读/写方向的
  真实准确度（读写方向系数可能不同）。
