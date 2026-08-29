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

- **格式采用与设备级互斥（Part II §7.2 / §8.1.2）**：若器件对 numerical data 使用
  IEEE Half，则该器件**所有**数值命令（含与输出电压无关的命令）只能使用 IEEE Half；
  若器件对任一数值命令使用 LINEAR 或 DIRECT，则不得对任何命令使用 IEEE Half。
  器件资料决定采用哪种格式，但**不改变** binary16 的数值解码公式——Half 的
  word ↔ 数值换算是标准 IEEE 754 binary16（bit15 符号、bits[14:10] 指数、bits[9:0]
  尾数，§7.6），不依赖任何 m/b/R 系数、VID 表或器件 profile；只有 DIRECT 需要
  器件专属 m/b/R（§7.4）。本工具的四个 tab 是四个独立换算器，不代表某个器件同时
  支持多种格式。

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
- 自动选 N/Y 的搜索策略（v2.5.10）：`findBestLinear11` 在 `N=-16..15`、Y 合法范围内
  返回 `|X − Y×2^N|` **严格最小**的表示；不使用固定绝对容差把严格不同的误差归并为
  并列。误差按 binary64 计算值**完全相等**（bit-exact tie）时采用确定性的仓库 tie
  policy：偏好更小的 `|N|`，同一 `|N|` 保持 N 升序枚举中的先见者。该策略是计算器的
  host-side 选择——PMBus Part II §7.3 只规定表示关系 `X = Y × 2^N`，不规定自动编码的
  tie 规则；锁定 N 的手动编码路径不受该搜索影响。

### 2.2 LINEAR16

- 手动 V 输入和 `raw/set` 必须 clamp 到 `0..65535`，不得使用 `raw & 0xffff` 回绕。
- reducer/domain 层在 **relative LINEAR + ULINEAR16（比值语义）** 下必须拒绝 `value/set`
  生成 LINEAR16 编码——不能只靠隐藏 UI 输入阻止错误状态。拒绝按 payload 上下文判定，
  而非字节级 status：
- 非 LINEAR 共享字节（VID / DIRECT / IEEE Half 格式）遵循 §3 的 fail-closed 契约（v2.5.2）：
  输出电压相关命令的数据格式由当前 VOUT_MODE 决定（Part II §8.4），`value/set` 对
  非 LINEAR 共享字节**直接 no-op**——不生成 raw、不伪造 provenance、不回退到
  `CALCULATOR_LINEAR_EXAMPLE_VOUT_MODE`。UI 显示实际共享字节与非 LINEAR 说明；恢复
  LINEAR16 编码的唯一路径是显式 `l16/apply-calculator-linear-example`（真正写入
  0x18 并清除旧 provenance）。「拒绝 non-LINEAR 与 relative `value/set`」都是本仓库行为。
- 只有 **absolute LINEAR** 才显示绝对电压结果、V、N、2^N 与可表示电压范围；
  relative LINEAR 可以解释 VOUT_MODE 参数位的 exponent/ratio 语义，但不得把 raw 标成
  绝对电压；VID/DIRECT/IEEE Half 不得生成虚假的 LINEAR16 V/N/range/result。
- L16 payload 是独立于 VOUT_MODE 字节的命令 payload 语义，分两种：
  - `ULINEAR16`：`X = Y_u × 2^N`，`Y_u` 是无符号 16 位整数 `0..65535`；absolute LINEAR
    直接解出电压，relative LINEAR 解出无量纲正比例 `R = Y_u × 2^N`，最终电压
    `X = V_NOM × R`（`raw=0` 时 `R=0`，规范要求 relative value 为正，标记为非符合性）。
    标称参考值缺失是可达的提交状态（v2.5.8）：真实清空标称输入并 blur/Enter 通过
    `l16/clear-nominal-vout` 把 `l16.nominalVout` 置回 `null`（幂等，只影响该通道，
    不改 raw / VOUT_MODE / payload kind / 字节序）；`null`（未提供参考值，只显示比值，
    最终电压为 `—`）与显式输入 `0`（decode-only 合同的合法显示值）是两个不同状态。
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
- **typed 提交的精确编码（v2.5.11）**：物理值提交不再先折算成 binary64——
  `value/set` 把用户输入的完整十进制 lexeme 解析为 BigInt 有理数
  （`parseDecimalExactRational`），再以 exact 算术复现同一 `Math.round` +
  signed16 clamp 合同（`encodeDirectExactFromRational`）。舍入策略本身
  不变；消除的是「exact → binary64 → 回录」的不可逆精度折叠。m=0 时
  精确参照返回 invalid，不伪造有理数；lexeme 不是完整十进制时 reducer
  fail-closed（UI 路径经 `classifyFloatText` 不可达）。
- **精确参照与回程分析单一来源（v2.5.11）**：`src/app/direct-exact.ts`
  提供 §7.4 的精确解码有理数（分母恒正、约分）、真实 binary64 管线的
  回程分析（`roundTripSafe` 按构造等价于 `PMBusMath.encodeDirect(
PMBusMath.decodeDirect(y, …))`）与经验证的安全回录文本生成
  （终止小数优先精确展开；循环有理数用有界经验证近似——候选串必须经
  独立 parse + exact encode 回到原 Y，否则返回 null 触发安全降级）。
  该模块是 fidelity 判断的单一来源；组件与测试不得用浮点比较自行推导。
- **精度折叠的呈现（v2.5.11，UI_CONVENTIONS §15）**：当 raw 的精确解码值
  超出 binary64 精度、显示值直接回输会编码为不同 Y 时，view-model 输出
  `directFidelity`（精确有理数/十进制文本、近似显示值、回编 Y、经验证
  回录文本）；警告 `direct-precision-fold`、量化读数注记（deltaKind 降为
  warn）与计算步骤的精确值行全部消费同一解析。这不是 PMBus 公式错误，
  也不表示 `encodeDirect(Number)` 有错——是显示层不可逆性的诚实标注；
  raw/Y 编辑始终是位级真值的权威路径。
- **精确请求 provenance 与 exact 分类（v2.5.12）**：`valueRequest` 是模式
  判别联合；DIRECT 保留 reducer 实际用于 exact 编码的同一 lexeme
  （`{ mode: 'DIRECT', value, text }`），L16/HALF 行为不变。DIRECT 的量化
  分类（`saturated` / `exact` / `quantized`）与误差全部由精确有理数决定：
  requested 来自 `text` 的精确解析、represented 来自当前 raw 的
  `decodeDirectExact`、范围端点来自 signed16 Y 极值的精确解码（按 m 符号
  排序）；Number 字段只作近似展示，绝不反向决定分类。`text` 是字符串
  （非 BigInt），同一失效事件（raw/Y/系数编辑、模式切换）清除整个
  request；非法、越界、下溢与过长文本不生成 provenance。这修复的是同一
  次事务使用两套真值的产品缺陷（raw 精确、provenance 折叠），不是 PMBus
  公式变更。
- **精确 lexeme 长度边界（v2.5.12；v2.5.13 统一度量，交互资源边界而非 PMBus 限制）**：
  `DIRECT_EXACT_MAX_LEXEME_LENGTH = 4096` 是 DIRECT 精确十进制路径接受的
  单条 lexeme 最大字符数。依据：安全回录生成器在 531,932 条文本的实测中
  最大长度为 136（理论生成器上限约 607，即
  `TERMINATING_EXPANSION_MAX_DIGITS=600` 加符号/整数位），4096 保留 ≥6.7×
  理论余量、≥30× 实测余量，并把单条 lexeme 的 BigInt 构造限制在
  ≤~13.6k bit。v2.5.13 起边界度量是**调用方提供的原始字符串长度（raw
  `length`，在任何 trim 之前）**：UI 输入门与 reducer/exact parser 防线共享
  同一度量，空白填充（如 `4096 个空格 + "1"`，raw 长度 4097）不能通过先
  trim 换取额外预算，直接 dispatch 超长文本是严格 no-op；
  `checkExactLexemeBoundary` 在任何 BigInt 构造之前以纯字符串工作完成
  raw 长度/语法/指数移位检查（O(1)/O(n)），兆字节粘贴在微秒级被拒绝；
  短输入的空白语义（首尾空白 trim、`0e-400`/`-0.0e-999` 等任何指数下的
  true zero）不变。UI 显示明确的「输入过长，未提交」错误并保留旧 raw 与
  旧请求；超长粘贴在进入 React draft state 之前被拒绝（不把超长字符串
  驻留在组件状态中），不静默截断、不改写为 ±Infinity/±0。

### 2.4 HALF

- `encodeHalf` 必须按 IEEE 754 round-to-nearest-even：
  - mantissa 0.5 的 tie 向偶数舍入；
  - subnormal 与 normal 边界按 subnormal ulp $2^{-24}$ 舍入；
  - `|value| >= 65520` 溢出到 `±Infinity`；
  - `NaN` → `0x7E00`，`±0` 保留符号。
- **特殊值 PMBus 操作语义（Part II §7.6.2，v2.5.5）**：数学编码之外，HALF 页必须
  解释设备如何操作 NaN / ±Infinity。单一来源
  `src/app/half-special-semantics.ts`（可判别 `half-finite` / `half-nan` /
  `half-positive-infinity` / `half-negative-infinity`，输出 machine id、severity、
  send/read 双解释、spec ref）：
  - 设备读回主机先前写入的值时必须返回主机发送的精确 IEEE 编码（含 NaN、±Inf）；
  - NaN 作为写入数据：设备必须按 invalid data 处理、声明 communications fault 并按
    §10.8 响应；作为读回值：设备可在值不可用时返回 NaN；
  - +Inf / -Inf 作为写入数据：设备分别解释为正 / 负满量程；作为读回值：分别表示
    测量通道正 / 负方向饱和。
  - 展示由 view-model `halfSpecial` 驱动特殊值卡（raw 解码与 value 编码两条路径
    均出现，有限值不出现），且必须注明这是 PMBus 操作语义、不代表已发生总线通信。
    量化误差分类不变：主动输入特殊值 = `special/warn`，有限 `65520` 溢出 =
    `overflow/error`；有限溢出编码出的 ±Inf word 同时显示 overflow 读数与 §7.6.2
    卡是正确形态（两个表面回答不同问题）。

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
- VID 参数是 unsigned VID Code Type（Part II §8.4.2 Table 3；v2.5.6 起按 Table 3
  出处机器区分五类）：`00h` = not-used；`01h..04h`（reserved for a future Intel
  processor generation）、`10h..11h`（reserved for a future AMD processor generation）、
  `1Ch..1Dh`（reserved for future use）= **Table 3 明列**的保留 code；
  `05h..0Fh`、`12h..1Bh` 等其余 code = **Table 3 未列出**、保留供未来使用；
  `1Eh/1Fh` = profile-required（Table 3 明列的制造商自定义）。明列保留与未列出保留
  都不可作为通用电压 profile，但用户可见文案必须区分出处——不得把明列 code 写成
  「未列出」，也不得反向合并。单一分类来源是 `classifyVidCode`（`kind` +
  `reservedFamily`/`reservedReason`），requirement 判别式输出
  `vid-reserved-listed` / `vid-reserved-unlisted` 两个 id，各表面不得再硬编码出处。
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
    说明与显式应用计算器 LINEAR 示例 0x18 的入口（`l16/apply-calculator-linear-example`
    真正改写共享字节）。
    invalid-parameter / invalid-combination 保持 error 级。
- **0x18 是计算器示例值，不是规范默认值（v2.5.7）**：Part II §8.3 只定义 VOUT_MODE
  位布局与合法组合，不存在 PMBus 标准默认字节；器件可在制造时固定 Mode/Parameter
  并拒绝写入。`CALCULATOR_LINEAR_EXAMPLE_VOUT_MODE = 0x18`（absolute、N=-8）仅是
  计算器的初始/恢复示例值，任何用户可见表面不得称其为「PMBus 规范默认/器件默认」，
  也不得声称 non-LINEAR 会自动回退。
- **L16 × VOUT_MODE payload 合同为 discriminated union（v2.5.3）**：单一来源是
  `src/app/l16-payload-contract.ts` 的 `resolveL16PayloadContext(byte, payloadKind)`，
  view-model 文案、输入可用性、warning 级别与测试共同消费它，禁止在组件或测试里用
  布尔再推导规范结论：
  - `linear-supported`：LINEAR 共享字节，按 payload 语义正常编码；
  - `vid-profile-required`：绝对 VID 字节 + 非偏移 payload——**VID 是 §8.4.2 支持的
    输出电压数据格式，不是被禁止格式**；本页未选定 VID 表 / 产品 profile，不能换算
    code ↔ 电压；code 类别沿用 Table 3 分类（not-used / reserved / 制造商自定义），
    制造商自定义映射必须来自器件资料；
  - `vid-offset-prohibited`：绝对 VID 字节 + `slinear16-offset`——VOUT_TRIM /
    VOUT_CAL_OFFSET 的二补码偏移命令被规范明确禁止（§13.3/§13.4），error 级提示；
    **禁止范围仅限这两条命令**，不得扩大成“输出电压相关命令禁止 VID”；
  - `vid-relative-invalid`：bit7 相对 + VID（§8.5.3 相对格式不适用于 VID），字节组合无效；
  - `direct-profile-required` / `half-unsupported-in-l16`：DIRECT 需要 m/b/R（§7.4）、
    IEEE Half 是合法输出电压格式但本页不实现解释（§8.4.4）；均不借用 0x18 或猜测 N；
  - `reserved-or-invalid`：DIRECT/Half 参数非零等无解释合同的保留/非法配置。
- **VOUT_MODE 格式 requirement 单一来源（v2.5.4 / v2.5.5）**：
  `src/app/vout-mode-requirements.ts` 的
  `resolveVoutModeRequirement(analyzeVoutMode(byte))` 是独立 VOUT_MODE 页面 status
  文本、InfoPanel 警告、说明与计算步骤的共享判别来源。其语义按 Part II 固定：
  - DIRECT（`0x40`/`0xC0` 等）：合法结构，word ↔ 物理量**需要**器件 m/b/R 系数
    （§7.4，来自 COEFFICIENTS 或器件资料）；bit7=1 时最终电压还需 VOUT_COMMAND
    标称参考值（§8.5.2）；
  - IEEE Half（`0x60`/`0xE0` 等）：合法结构，payload 是**标准 IEEE 754 binary16**
    （§7.6 / §8.4.4），换算**不需要** m/b/R、VID 表或器件 profile；bit7=1 时同样需要
    标称参考值（§8.5.2）。任何用户可见表面不得把 Half 描述成需要器件 profile、
    DIRECT 系数或设备数据；
  - 参数非零（`0x41..0x5F`/`0x61..0x7F` 及对应 relative 组合）保持 invalid-parameter
    error 级，不进入任何格式要求分支；
  - 状态/警告/说明/步骤全部消费该来源（v2.5.5 起四个表面全部 switch 在 `req.id` 上，
    字段解析仍可读取 format/parameter），禁止在组件或测试中用 `format === 2 || 3`
    这类散落布尔重新推导规范结论。
- **结构合法性、可计算性与外部数据三维正交（v2.5.5）**：requirement 判别式输出
  `structureLegal`、`requiresDeviceCoefficients` / `requiresVidProfile`（合成为
  view-model 的 `requiresExternalData`）等可分别断言的字段：
  - VID code `1Eh/1Fh` 是 §8.4.2 Table 3 明列的制造商自定义 code——
    `structureLegal=true`、`requiresVidProfile=true`、当前不可换算；「需要器件资料」
    不等于「VOUT_MODE 结构非法」，呈现不得复用非法结构的 alert 标志/class 或
    「保留/非法」文案；
  - `00h`（not-used）与保留 code（Table 3 明列保留与未列出保留，v2.5.6）仍是
    不可用配置（`structureLegal=false`）；relative+VID、DIRECT/Half 非零参数同样非法；
  - view-model 的 `calculable` 表示当前计算器能否直接算出数值（仅绝对 LINEAR），
    与结构合法性独立（`0x60` 结构合法但本页不可算）。
- **结构合法性单一事实源（v2.5.6）**：`VoutModeAnalysis` 不再携带旧 `isLegal`
  字段（其旧定义 `status === 'valid'` 与 `structureLegal` 对 `0x3E/0x3F` 矛盾）；
  结构合法性只由 `resolveVoutModeRequirement(...).structureLegal` 输出。
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
- **只 focus 后 blur、未发生任何编辑不是显式请求（v2.5.6 起；v2.5.7 推广到全部共享输入）**：
  所有共享输入（物理值、raw Hex、L11/L16/DIRECT 的 Y/N/V/m/b/R、SLINEAR16 Y_s、
  VOUT_MODE expert Hex/N、标称参考值）在当前 focus 会话内没有发生任何 `onChange`
  编辑事务时，blur/Enter 必须是严格 no-op——不派发 commit、不改写 raw/参数/VOUT_MODE
  字节、不伪造请求来源、不隐藏也不显示误差、不清除仍存在的字段错误。dirty 判定依据真实
  编辑事务，不得用解析数值比较（`NaN !== NaN`、`-0`、`1.0` vs `1` 等文本表示差异都
  不可靠）。HALF raw `0x7C01`（非规范 NaN）在无操作 focus/blur 后必须保持
  `0x7C01`——§7.6.2 要求设备精确返回主机写入的 IEEE 编码，显示层往返不得把
  不同 NaN 原码合并成 canonical `0x7E00`。
- 以下任一动作会使请求失效（provenance 清除，误差变为**未知**）：
  - 任何不经物理值输入的 raw 变更（Hex 输入、bit toggle、`raw/set`、DIRECT Y、
    SLINEAR16 手动 `l16/set-slinear-y`）；
  - 改变编码解释的状态变更（DIRECT m/b/R、L16 payload kind、任何 VOUT_MODE 字节变更）；
  - 切换到另一个模式。重复选择当前模式是幂等 no-op，**不清除**请求。
- **同字节写入幂等（v2.5.7）**：重复选择当前 VOUT_MODE 语义（absolute/relative）、
  相同格式、相同参数或相同 N——即目标字节与当前字节完全相同的写入——是幂等 no-op，
  **不清除**请求；已选中的语义控件点击不派发会失效 provenance 的状态写入。只有
  真正改变字节的状态变更才使旧请求失效。
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
  （`computeQuantizationOutcome` 返回 null，v2.5.2 fail-closed），显式应用计算器
  LINEAR 示例 0x18 后恢复。
- DIRECT 的量化只描述「当前用户给定系数下的编码量化」，不代表器件读/写方向的
  真实准确度（读写方向系数可能不同）。
