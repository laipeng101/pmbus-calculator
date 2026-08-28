# Changelog

本项目遵循 Keep a Changelog 风格。版本号遵循 Semantic Versioning 2.0.0。

## [Unreleased]

## [2.5.7] - 2026-08-28

### Fixed

- **HALF 负零简写丢失符号（P1）**：`float-parse.ts` 的 `/^[+-]?\.0*$/` 分支直接
  `return 0`，使 `-.0`、`-.00` 被解析为 `+0`（raw `0x0000`），并把裸 `.`、`+.`、`-.`
  过早视为完整数值。IEEE 754 binary16 中 `+0` 与 `-0` 是不同原码（`0x0000` 与
  `0x8000`，Part II §7.6），`Number('-.0')` 本就是 `-0`，解析器不得用字面量 `0`
  覆盖其符号；§7.6.2 要求设备读回主机先前写入的精确 IEEE 编码。现在：
  - `-0`、`-0.0`、`-.0`、`-.00`、`-0e3` 都解析为真正的 JavaScript `-0`
    （`Object.is` 断言），HALF 编码为 `0x8000`、显示 `-0`；
  - `0`、`+0`、`0.0`、`.0`、`+.0`、`0e3` 编码为 `0x0000`；
  - 裸 `.`、`+.`、`-.` 是编辑过渡态，不立即提交 raw、不创建 provenance；blur
    明确规范化：`.`/`+.` → `0`（`0x0000`），`-.` → `-0`（`0x8000`）；
  - `encodeHalf` round-to-nearest-even 算法未改动。
- **untouched-blur 事务语义推广到全部共享输入（P1）**：v2.5.6 只为物理值输入
  增加了真实编辑事务检测；`HexInput`、`IntegerInput`（L11 Y/N、DIRECT Y/m/b/R、
  SLINEAR16 Y_s、VOUT_MODE N）、`DecimalInput`（L16 V）与 `NominalVoutInput`
  在 untouched blur 时仍无条件 `onCommit`——L16 输入物理值 `1`（raw `0100`、
  provenance 存在）后只 focus/blur 原始 Hex，raw 不变但量化来源被清除。现在
  全部共享输入在当前 focus 会话内没有任何真实 `onChange` 时，blur/Enter 严格
  no-op：不派发 commit、不改写 raw/参数、不清除 provenance、不清除仍存在的
  字段错误；dirty 依据真实编辑事务（共享 helper `src/app/input-transaction.ts`），
  不以解析数值相等判断。显式清空后 blur、显式重输相同值、粘贴、非法文本修复
  仍按既有合同提交。
- **点击已选语义控件清除 provenance（P2）**：L16 输入物理值 `1` 后点击当前
  已选中的「绝对值」radio，raw 不变但 provenance 消失——`vout-mode/set-relative`
  无条件走 `setVoutModeByte` 清除请求来源。现在同字节写入幂等（reducer 返回
  同一 state 引用），composer 的绝对值/相对值与格式 radio 仅在目标状态与当前
  状态不同时才派发；重复选择现有 VOUT_MODE 语义、相同格式与相同参数保持幂等，
  真正改变字节时仍清除失效 provenance。
- **`0x18` 被表述为「标准默认值」误导（P2）**：`DEFAULT_LINEAR_VOUT_MODE` 的
  注释仍声称它是 non-LINEAR 时的 fallback，UI 又称「应用默认 VOUT_MODE」——
  与 v2.5.2 起 fail-closed 行为直接矛盾，也违背 Part II §8.3（只定义位布局与
  合法组合，不存在 PMBus 标准默认字节；器件可固定 Mode/Parameter 并拒绝写入）。
  现在：
  - 常量更名为 `CALCULATOR_LINEAR_EXAMPLE_VOUT_MODE`，action 更名为
    `l16/apply-calculator-linear-example`，删除全部 stale fallback 说明；
  - UI、warning、steps、说明统一表述「应用计算器 LINEAR 示例 0x18
    （absolute、N=-8）」，并明示它不是 PMBus 规范默认值、不代表真实器件一定
    接受 VOUT_MODE 写入；
  - 反词测试（unit + E2E）禁止任何用户可见表面把 0x18 称为规范/器件默认或
    声称 non-LINEAR 自动回退；初始化字节与显式恢复后的实际数值行为不变。

### 文档

- DOMAIN_MODEL §2.2/§3 登记 0x18 计算器示例值合同与同字节写入幂等；§6.1 的
  untouched-blur no-op 合同推广到全部共享输入；UI_CONVENTIONS §8 登记共享输入
  no-op 与 signed-zero 解析/blur 规范化、§15 更新恢复入口文案合同。

## [2.5.6] - 2026-08-28

### Fixed

- **物理值输入无操作 focus/blur 重编码 raw 并伪造量化请求来源（P1）**：共享
  `ValueInput` 的 blur 无条件派发 `value/set`，用户只获得焦点再离开（未编辑任何
  字符）就会静默重编码 raw word 并伪造一次显式编码请求：
  - HALF raw `0x7C01`（非规范 NaN payload）被改写为 canonical `0x7E00`——违反
    §7.6.2「设备必须精确返回主机写入的 IEEE 编码」与本工具的 raw-lossless 承诺，
    signaling/quiet NaN 等 2,046 个非规范 NaN 原码都可能被显示层往返合并；
  - LINEAR11 raw `0801`（N=1,Y=1,X=2）被规范化为 `0002`（N=0,Y=2），数值不变但
    raw word 改变，并出现伪造的 `0%` 量化误差；
  - 所有模式即使 raw 恰好不变也会伪造 `valueRequest`/`l11.valueInput`，使本应
    隐藏的量化误差变成 `0%/特殊值` 读数（DOMAIN_MODEL §6.1 请求来源合同）。
    现在 blur 是事务化的：当前 focus 会话内没有任何 `onChange` 编辑事务时，blur
    （含 Enter 触发）是严格 no-op——不派发、不改 raw、不伪造 provenance、不清除
    已有错误；dirty 判定依据真实编辑事务，不用解析数值比较（`NaN !== NaN`、`-0`、
    文本表示差异都不可靠）。显式编辑合同不变：即时提交、blur 规范化（空/符号/尾随
    点/尾随 exponent）、HALF 显式重输 `NaN` 仍 canonical 化为 `0x7E00` 并出现
    special/warn provenance。回归矩阵在
    `tests/e2e/value-blur-lossless.spec.ts`（HALF/L11/L16/DIRECT 真实用户路径，
    同时锁定「无操作 blur 无副作用」与「显式编辑仍提交」两条相反路径）。
- **VID Table 3 明列保留 code 被写成「未列出」（P2）**：Part II §8.4.2 Table 3
  明列 `01h..04h`（保留给未来 Intel 处理器）、`10h..11h`（未来 AMD）、
  `1Ch..1Dh`（留作未来使用）与 `1Eh/1Fh`（制造商自定义），其余 code 才是
  「Table 3 未列出」。此前 `view-model.ts` 把所有 reserved code 一律写成
  「Part II §8.4.2 Table 3 未列出」（如 `0x21`/code `01h`），出处错误。现在：
  - `classifyVidCode` 机器区分 not-used / listed-reserved（含 Table 3 family 与
    reason）/ unlisted-reserved / profile-required（单一分类来源）；
  - `resolveVoutModeRequirement` 把 `vid-reserved` 拆分为
    `vid-reserved-listed` / `vid-reserved-unlisted`；状态文本、InfoPanel 警告、
    说明、计算步骤与结构化 VID code 下拉全部消费该判别式与分类来源，明列 code
    的文案表述「Table 3 明列」及对应 family，绝不含「未列出」；
  - 明列保留与未列出保留仍都不可作为通用电压 profile（`structureLegal=false`），
    仅用户可见出处文案被纠正。
- **移除矛盾的双重合法性事实源（P2）**：未使用的旧字段 `VoutModeAnalysis.isLegal`
  （`status === 'valid'`）与权威的 `requirement.structureLegal` 对 `0x3E/0x3F`
  给出矛盾结论（`isLegal=false` 而 `structureLegal=true`）。字段及其旧测试已删除，
  结构合法性只由 `resolveVoutModeRequirement().structureLegal` 输出。
- **VID code 下拉不再撑破 360px 视口**：更长的出处文案使无宽度约束的
  `<select>` 固有宽度超过容器，补 `w-full min-w-0` 与同级输入一致。

### 文档

- DOMAIN_MODEL §3 登记 Table 3 五类 VID code 出处（明列保留 vs 未列出保留）、
  §6.1 登记 untouched blur no-op 与事务化 dirty 判定、结构合法性单一事实源；
  UI_CONVENTIONS §8 新增未编辑 blur no-op 合同、§16 更新 VID 出处文案合同。

## [2.5.5] - 2026-08-28

### Fixed

- **HALF 页遗漏 PMBus §7.6.2 特殊值操作语义（P1）**：页面此前允许输入、编码并复制
  NaN / ±Infinity，却只称其为「支持的特殊值」，未告知设备的操作语义，可能让用户把
  特殊值当普通数值写入器件。新增 `src/app/half-special-semantics.ts` 单一语义来源
  （`half-finite` / `half-nan` / `half-positive-infinity` / `half-negative-infinity`，
  输出稳定 machine id、severity、send/read 双解释、spec ref），HALF 页在当前 raw word
  为特殊值时显示 §7.6.2 特殊值卡（raw 解码与 value 编码两条路径均可见；有限值不显示）：
  - NaN：作为写入数据，设备必须按 invalid data 处理、声明 communications fault 并按
    §10.8 响应；作为设备读回值，表示值不可用；
  - +Inf / -Inf：作为写入数据，设备分别解释为正 / 负满量程；作为设备读回值，分别表示
    测量通道正 / 负方向饱和；
  - 卡片同时列出两种解释（不猜测命令方向），并注明这是 PMBus 操作语义、不代表已发生
    总线通信、binary16 数学换算保持不变；
  - 量化误差分类不变：主动输入特殊值 = `special/warn`；有限 `65520` 溢出 =
    `overflow/error`；有限溢出编码出的 +Inf word 同时显示 overflow/error 读数与
    §7.6.2 卡（两个表面回答不同问题，不合并成一个状态）。
- **VOUT_MODE 结构合法性与可计算性分离（P1/P2）**：Part II §8.4.2 Table 3 明列
  `1Eh/1Fh` 为 PMBus 器件制造商自定义 VID Code Type——字节结构合法，电压映射必须来自
  器件资料。此前领域层 `isLegal=false` 被 view-model 映射成 `structureLegal=false`，
  正式页面给 `0x3E/0x3F` 配置摘要与状态 chip 加了代表非法结构的 alert 标志/class。
  现在 requirement 判别式新增 `structureLegal` 字段（valid 与 profile-required 为
  true；not-used/reserved/invalid 仍为 false），view-model 从中取值并新增正交的
  `requiresExternalData` 字段；`0x3E/0x3F` 呈现为「制造商自定义（需器件资料）」，
  不再复用非法 alert 标志；`00h`（未使用）、保留 code、relative+VID、DIRECT/Half
  非零参数保持不可用分类；Normalize 对 `0x3E/0x3F` 保持 raw 不变；L16 页继续
  fail closed，阻断原因保持「合法但缺 profile」。
- **requirement「单一来源」真正收口（P2）**：v2.5.4 中
  `resolveVoutModeRequirement` 实际只驱动 status 文本；InfoPanel 警告、说明与计算
  步骤仍各自从 `format`/`status` 推导，已出现可观察分叉。现在四个表面全部 switch 在
  同一判别式的 `req.id` 上（字段解析仍读取 format/parameter）：
  - `0xC0` 的 InfoPanel 警告本身现在同时写明 m/b/R 系数与 VOUT_COMMAND 标称参考值
    （§7.4 + §8.5.2），不再靠其他表面拼出；
  - `0x3E/0x3F` 计算步骤不再落入 `vout-mode-invalid` 分支，改用专门的
    `vout-mode-vid-profile` 步骤（not-used/reserved/invalid-combination/param-invalid
    亦有独立步骤 id）；
  - E2E helper 不再把所有表面拼接成单一字符串只检查一次——改为逐表面独立断言
    （反向禁词与必含片段均按表面检查），unit 矩阵对 `0xC0`/`0xE0` 逐表面断言。

### 文档

- DOMAIN_MODEL §2.4 登记 §7.6.2 特殊值双向语义与展示合同；§3 登记
  structureLegal / calculable / requiresExternalData 三维正交与四表面收口；
  UI_CONVENTIONS §16 更新逐表面 E2E 合同与合法性正交状态、新增 §17 特殊值卡合同。

## [2.5.4] - 2026-08-27

### Fixed

- **IEEE Half 被错误当成需要器件 Profile 的格式（P1）**：独立 VOUT_MODE 页面曾把
  `0x60`（绝对 Half）标为「IEEE Half（需器件资料）」并显示「需要器件 Profile
  （DIRECT 系数/设备数据）」警告——与同页 L16 阻断卡「Half 是合法标准格式」直接
  矛盾。按 Part II §7.6/§8.4.4，Half 的 word ↔ 数值换算是标准 IEEE 754 binary16，
  不依赖任何 m/b/R 系数、VID 表或器件 profile。新增
  `src/app/vout-mode-requirements.ts` discriminated requirement 单一来源，状态文本、
  InfoPanel 警告、说明与计算步骤共同消费：
  - `0x60`：状态「IEEE Half（标准 binary16）」，warning/explanation/steps 表述标准
    binary16 并指向 HALF 模式页；全部表面反向禁词（`需器件资料`/`器件 Profile`/
    `m/b/R`/`DIRECT 系数`），不出现标称参考值要求；
  - `0xE0`：payload 仍是标准 binary16；仅按 §8.5.2 增加相对阈值需要 VOUT_COMMAND
    标称参考值的表述，不要求任何器件数值；
  - `0x40`/`0xC0`：DIRECT 继续明确要求器件 m/b/R（§7.4），relative 叠加标称参考值；
  - `0x61`/`0xE1`：保持 invalid-parameter error 级与 00000b 约束；
  - L16 页 `half-unsupported-in-l16` 阻断卡文案不变，仅以回归测试固定；L16 页继续
    对 Half fail closed，不借用 0x18、不改造成 Half 解码器。
- **文档收口**：DOMAIN_MODEL 登记 Part II §7.2/§8.1.2 设备级互斥（器件使用 Half 则
  所有 numerical data 只能 Half；使用任一 LINEAR/DIRECT 则不得使用 Half；数据手册
  决定采用格式但不改变 binary16 解码公式）与 §3 requirement 单一来源合同；
  UI_CONVENTIONS §15 拆开合并的 DIRECT/Half 文案合同并新增 §16；两份 README 以 §7.2
  全设备互斥规则取代「器件可自由混用格式组合」表述；ROADMAP 删除与已发布 v2.5.3
  矛盾的「发布进行中」过期状态。

## [2.5.3] - 2026-08-27

### Fixed

- **VID 数据格式被错误描述为「输出电压相关命令禁止使用 VID」（P1）**：v2.5.2 的
  fail-closed 数值行为有效，但阻断文案把 §8.4.2 支持的 VID 格式扩大成了全局禁令，
  制造商自定义 code（raw `0x3E`/`0x3F`）也被一并归为禁止。现在 L16 × VOUT_MODE 组合
  由 discriminated contract（`src/app/l16-payload-contract.ts`）统一判定并驱动文案、
  输入可用性、warning 级别与测试：
  - 绝对 VID + 数值 payload → `vid-profile-required`：VID 合法但本页未选定 VID 表 /
    产品 profile，不能换算 code ↔ 电压，也不借用 LINEAR16 指数 N；不再出现
    「输出电压相关命令禁止使用 VID」；
  - 绝对 VID + SLINEAR16 offset → `vid-offset-prohibited`：仅 VOUT_TRIM /
    VOUT_CAL_OFFSET 被规范禁止（Part II §13.3/§13.4，error 级提示），并明确禁止范围
    仅限这两条命令；
  - 相对 + VID（如 `0xA0`）→ `vid-relative-invalid`：字节组合无效（Part II §8.5.3）；
  - DIRECT / IEEE Half → 合法输出电压数据格式但本页不实现解释（`direct-profile-required`
    / `half-unsupported-in-l16`），不猜测系数或 N；
  - 非法参数 → `reserved-or-invalid`。
- **非 LINEAR raw word 仍被标成 LINEAR16 V/Y（P1/P2）**：`getBitRegions` 现在接收实际
  共享 VOUT_MODE 字节——任何非 LINEAR 状态（含 `0x20`/`0x3E`/`0x40`/`0x60`、相对
  VID 与非法参数）的 16 位位域图例改为中性 `raw word [15:0]（未按 LINEAR16 解释）`，
  payload 下拉切换不会复活 V/Y 图例；LINEAR 字节（含 bit7=1 的 `0x98`）恢复
  payload-specific 图例。
- **文档与矩阵**：DOMAIN_MODEL §3 / UI_CONVENTIONS §15 登记新契约并禁止回归旧的全局
  禁令文案；ROADMAP M38 的历史「回退 0x18」摘要标注已被 v2.5.2 supersede。

## [2.5.2] - 2026-08-27

### Fixed

- **非 LINEAR 共享 VOUT_MODE 被隐式替换为 0x18 后继续 LINEAR16 编码（P1）**：v2.5.1 中
  共享字节为 VID / DIRECT / IEEE Half 时，LINEAR16 页面静默回退到
  `DEFAULT_LINEAR_VOUT_MODE = 0x18` 并继续编码——`0x20 + SLINEAR16` 下输入 `1` 生成
  `raw=0x0100`、显示 `1` 与 `0%` 量化误差，仅以 fallback 标注（Part II §8.4：输出电压
  相关命令的数据格式由当前 VOUT_MODE 决定，不能静默改用另一个字节）。现在
  fail closed：`effectiveL16VoutMode` 返回实际共享字节（`source: 'non-linear'`），
  `value/set` 对非 LINEAR 共享字节 no-op（不生成 raw、不伪造 provenance），结果为
  `—`、无伪「可表示范围」、无量化面板、计算步骤无伪 N/伪 V；VID 阻断卡引用
  §8.4 + §13.3/§13.4（禁止组合、不生成 word），DIRECT / IEEE Half 声明需要相应
  format/profile/coefficients、不猜测 N；invalid-parameter / invalid-combination
  保持 error 级。恢复编码的唯一路径是显式「应用默认 VOUT_MODE」
  （`l16/apply-default-vout-mode`）——真实写入 `0x18` 并清除旧 provenance 后，
  输入、范围、结果与量化读数恢复。
- **默认 E2E 套件混入 deployment 用例**：默认 `playwright.config.ts` 现在排除
  `deployment.spec.ts`；Pages smoke 只由 `playwright.deployment.config.ts` 对正式
  URL 运行。口径：默认 326 tests / 15 files（无 URL-gated skip），deployment
  4 tests / 1 file。
- **测试基建**：嵌套 git fixture 仓库不再继承 `git commit` 钩子导出的 `GIT_*`
  环境变量（pre-commit 下运行会寻址外层仓库 index）。

## [2.5.1] - 2026-08-27

### Fixed

- **SLINEAR16 offset 在 bit7=1 时物理输入不可达（P1-A）**：0x98 + SLINEAR16 下页面按
  signed offset 解码结果，却隐藏物理值输入并保留 relative LINEAR 的 nominal 阻断卡；
  reducer `encodeL16FromValue` 在 payload 判定前因 bit7 relative 拒绝，量化层也没有
  signed 可编码范围（200 无法分类为饱和）。现在编码/范围/UI 入口全部按 payload 上下文
  判定（Part II §13.3/§13.4）：任意 LINEAR 字节下 `value/set 3.3 → 0x034D`、
  `200 → 0x7FFF` saturated/error、范围 `-128..127.99609375`；nominal 门槛与阻断卡
  只作用于 relative ULINEAR16（比值）。
- **手动 Y_s 编辑后旧请求未失效（P1-B）**：`l16/set-slinear-y` 直接改写 raw 而不清除
  `valueRequest`，误差面板与计算步骤继续报告过期的请求-表示对。现在提交性 Y_s 编辑
  与其他 raw 变更一致清除 provenance；非法/过渡输入不改变 raw 也不清除仍有效请求。
- **DOMAIN_MODEL §2.2 与 §6.1 矛盾纠偏**：relative LINEAR 拒绝规则限定为
  ULINEAR16 比值语义；SLINEAR16 offset 的编码顺序、可编码范围与 bit7 不参与数学
  成为明确契约；provenance 失效清单加入手动 Y_s；UI_CONVENTIONS §15 记录
  payload 上下文入口与手动失效验收。

## [2.5.0] - 2026-08-27

### Added

- **格式编码量化误差读数扩展到全部数值模式（MINOR，向后兼容）**：LINEAR16 / DIRECT /
  IEEE 754 binary16 现在与 LINEAR11 共享同一 `ErrorDelta` 面板与计算过程步骤，领域模型
  重构为可判别联合（`exact / quantized / saturated / overflow / special`，
  `src/app/quantization-error.ts`），严重度由结果分类决定。

### Fixed

- **不再伪造零误差**：无显式编码请求（初始状态、手工 Hex/bit/raw 编辑、清除请求来源）时
  误差读数整体隐藏——「未输入请求」与「误差为零」是不同领域状态；请求来源
  （`l11.valueInput` + 模式标签的 `state.valueRequest`）在任何改变 raw 位或编码解释的
  动作（系数、payload kind、VOUT_MODE 字节、模式切换）后失效清除。
- **零请求值的相对误差显示「—」**：零分母（requested = 0 / −0）不再显示 0%；
  绝对误差照常保留（如 DIRECT m=1,b=1,R=−1 请求 0：+1.000000 (—)）。
- **HALF 有限值溢出不再隐藏**：65520 → +Infinity 以 overflow/error 状态呈现；
  NaN / ±Infinity 显式请求以 special 状态分类显示，不再静默消失。
- **非零小误差绝不渲染为文本零**：|x| ≥ 1e-6 用固定 6 位小数，更小非零值
  （如 binary16 次正规 ties-to-even 的 2^-25 → +0）用自适应有效数字显示。
- **移除跨格式 1e-5 绝对阈值**：PMBus 设备准确度由产品资料规定（Part II §7.8/§7.9），
  不存在通用阈值；UI 更名为「格式编码量化误差」，L11 饱和、L16 clamp、DIRECT Y 饱和
  统一为 saturated/error 分类。
- **L16 语义对齐**：SLINEAR16 offset 的量化不受 VOUT_MODE bit7 relative 影响
  （payload 语义优先，§13.3/§13.4）；fallback 0x18 时读数标注「按 fallback 0x18 计算」；
  relative ULINEAR16（比值语义）不显示物理量化误差。
- **重复选择当前模式不再清除请求来源**（same-mode dispatch 幂等）。
- DOMAIN_MODEL §2.2 fallback 矛盾消除（拒绝仅限 relative LINEAR），新增 §6 量化语义；
  UI_CONVENTIONS 新增 §15 面板契约。

### 证据

- 4 张桌面 L11 视觉基线按 REPOSITORY_HYGIENE 3.10 逐图审查更新（移除伪造零误差卡），
  其余 24 张场景（含全部移动端）不变。

## [2.4.2] - 2026-08-27

### Fixed

- **位字段网格过于紧凑**：v2.4.1 的溢出修复保留了 v2.4.0 放大的位格（按钮 36px、
  行间隙 4px），收缩轨道上位格行占满 nibble 卡片并贴合边框。恢复 v2.3.0 密度：
  按钮 28px（flex-basis 1.75rem）、行间隙 2px、cell 24px——nibble 卡片内恢复居中
  留白，收缩链仍保证不溢出。基线按 REPOSITORY_HYGIENE 3.10 审查更新（26 张，
  新旧成对对比三张关键基线无意图外变化）。

## [2.4.1] - 2026-08-27

### Fixed

- **位字段网格卡片内溢出（v2.4.0 回归）**：M39 统一位网格后 16 位 4 列 auto 轨道
  最小需求 714px 超出卡片内容宽 618px，`justify-content: center` 使溢出对称分布在
  卡片两侧（1024–1151px 双栏布局最严重，达 112px/侧）；8 位两列在 390/360px 移动端
  同样溢出。网格轨道改为可收缩 `minmax(0, 设计宽)` 并建立 nibble→bits→button→cell
  收缩链；16 位 4 列断点从 1024px 修正到 1152px 以对齐双栏工作区实际列宽。
  全模式 × 全视口（2048→360）位格几何断言与 23 张 visual 基线更新，新增
  “位格始终落在宿主卡片内容盒内”回归测试。计算语义、raw、字节序与复制合同不变。
- 文档与流程：视觉重构 PR 更新基线时必须附新旧基线 diff 审查记录
  （REPOSITORY_HYGIENE 第 3 节第 10 条），并同步 AGENTS.md PR checklist 与
  PR 模板 UI/visual evidence 字段。

## [2.4.0] - 2026-08-26

### Added

- M39：中文优先界面 + 可访问术语气泡 + 字体角色统一 + 共享位字段网格（MINOR，向后兼容）。
- **术语气泡**：canonical 英文 token（VOUT_MODE、LINEAR/VID/DIRECT/IEEE 754 binary16 等）
  通过虚下划线触发器提供单一中文解释数据源 `src/app/terminology.ts`；`TechnicalTerm` 组件
  基于 `@floating-ui/react-dom`（offset/flip/shift/size/autoUpdate + portal），支持点击/
  键盘/触屏、Escape 关闭并恢复焦点、点外关闭而气泡内不误关，viewport 边缘防裁切。
- **共享位字段网格**：新 `BitFieldGrid` + `getBitRegions` 单一来源替换原 `BitGrid` 与
  `VoutModeBitGrid` 两套实现；16 位恒为 4 nibble 组、8 位恒为 2 nibble 组；
  L16 内嵌 VOUT_MODE 为 compact 密度但保留两个四位分组与统一图例；
  bits[6:5] 在 L16 真正 disabled 且 ARIA 注明“格式位固定为 LINEAR”。
- 全模式位图例中文化（指数/尾数/符号位/数值/绝对相对/格式/参数）。

### Changed

- **中文优先语言合同**：双语 explanation model（zh/en 并排）重构为中文主文案 + canonical
  token 引用；按钮/状态/徽标/ARIA 不再中英双写（如“说明 / Details”“规范化 / Normalize”
  “应用默认 … / Apply default”、linked/fallback-default → 已关联/默认回退、
  Absolute/Relative → 绝对值/相对值）；VID code 分类标签改为 未使用/保留/制造商自定义。
- **字体角色统一**：VOUT_MODE 结果摘要改为结构化配置视图（byte 用 mono、token/状态用
  系统 UI 字体），不再经 KaTeX/serif 排版；真实数学等式仍由 KaTeX 渲染。
- 页面 `<title>` 补全第五个模式 VOUT_MODE；release/deployment smoke 同步断言。

## [2.3.0] - 2026-08-26

### Added

- M38：独立 VOUT_MODE 计算器（第五个模式）——8-bit 交互位网格（bit7 Absolute/Relative、
  bits[6:5] format、bits[4:0] parameter 双 4-bit nibble 卡），raw 位/Hex 编辑 lossless
  （可构造 `0xA0`/`0x41`/`0xE1`），语义控件 canonicalize（VID 强制 Absolute、DIRECT/Half
  参数强制 0），`Normalize` 显式规范化非法组合/参数。
- M38：标准 LINEAR16 payload 语义——`ULINEAR16`（`X = Y_u × 2^N`，`Y_u` 无符号 0..65535）
  与 `SLINEAR16 offset`（`X_offset = Y_s × 2^N`，`Y_s` 二补码 -32768..32767）；相对
  ULINEAR16 解出正比例 `R = Y_u × 2^N`，提供 nominal reference 时 `X = V_NOM × R`；
  SLINEAR16 相对 + 有符号比例被拒绝（bit7 不参与 offset payload）。
- L16 共享 `VOUT_MODE` 字节单一事实源 + `effectiveL16VoutMode` 选择器：非 LINEAR 共享字节
  回退到 `DEFAULT_LINEAR_VOUT_MODE = 0x18` 而不静默改写共享字节，linked/fallback 双语徽标。

### Fixed

- `HexInput` 固定 `0x` 前缀：前缀渲染在 `<input>` 之外，输入值只含十六进制数字；粘贴
  `18`/`0x18`/`0X18` 归一化为 `18`，裸 `0x` 过渡为空 digits（blur 归零）而非报错。
- VOUT_MODE 公式不再输出 KaTeX 非法转义 `\#`（结果面板 fallback 为纯文本的问题）。
- 修正 `format` 只取 `(byte >> 5) & 0x03` 的全字节 0x00..0xFF 遍历 golden 覆盖。

## [2.2.0] - 2026-08-26

### Added

- M37：共享 LINEAR 公式编辑器（`LinearFormulaEditor` / `ExponentEditor`），L11 与 L16 LINEAR
  复用同一 `Y/V × 2^N` 视觉；N 控件锚定到底数 2 的右上指数槽，锁按钮在相邻独立槽，
  `-16/-1/15` 与锁定切换时底数与乘号锚点不漂移。
- M37：L16 `VoutModeComposer` 结构化配置器——bit7（Absolute/Relative）、bits[6:5]
  （LINEAR/VID/DIRECT/IEEE Half）、bits[4:0]（LINEAR signed N / VID unsigned code /
  DIRECT·Half 固定 0）双向同步，实时显示 canonical byte、8-bit binary 与明确合法性状态。
- 新增单一领域来源 `src/legacy/vout-mode.ts`：`analyzeVoutMode`（0..255 全字节 total）、
  `composeVoutMode`、`classifyVidCode` / `VID_CODE_TABLE`，输出机器可测试的 validity status
  与 reason code。

### Fixed

- VOUT_MODE 相对非 LINEAR（如 `0xA0` relative VID）不再被误标为“相对 LINEAR”；
  Part II §8.5.3 的 relative-VID 非法组合被明确分类并阻止计算。
- DIRECT / IEEE Half 的 parameter 非零（如 `0x5F`、`0xE1`）被判为 invalid parameter
  （Part II §8.3 Table 2 要求 `00000b`），可解码但不再被宣称为有效配置。
- 删除 `AppState.l16.n` 冗余状态：VOUT_MODE byte 成为 L16 exponent 的唯一事实来源，
  view-model/formula/steps 统一从 analyzer 派生 N，消除双事实源漂移。
- `HexInput` 空串与裸 `0x` 过渡态合同修正：聚焦编辑中暂存为 draft、不修改 committed state、
  不逐键报错；空串 blur/Enter 归一化为 0，裸 `0x` blur/Enter 后显示“输入不完整”，非法修正
  后错误/ARIA/draft 同时清除。
- bit7 语义按 Part II §8.5 纠偏：bit7 配置 §8.5 所列 output-voltage-related commands 的
  absolute/relative 行为，VOUT_COMMAND 为 nominal reference；UI/文档不再笼统暗示任意 payload
  都是绝对/相对电压。

## [2.1.0] - 2026-08-26

### Changed

- 结果优先的响应式布局（M36）：物理值 `ResultSummary` 移至模式切换之后、主 workspace 之前，
  桌面与移动端首屏内完整可见，无需滚动；详细计算过程默认折叠为可访问 disclosure。
- `ResultInspector` 按职责拆分为 `ResultSummary`（唯一结果面板与 live region）与
  `ResultDetails`（原始 Hex / LE / BE / 量化误差 / 复制工具 / warnings / 计算过程），
  单一结果实例，不复制 view-model。
- 命令参考移动至主 workspace 之后；默认折叠时只显示按钮，说明移入展开内容顶部。
- 桌面 workspace 右栏改为 320–380px 自适应，移除整栏 sticky；移动端保持单列。
- visual scene 在截图前断言真实版本徽标并按 SemVer 形状规范化，隔离每次发布必变的
  非布局数据；release/deployment smoke 继续断言真实 `v2.1.0`。

## [2.0.2] - 2026-08-26

### Changed

- 工程质量加固（M35）：Vite 构建拆分为 `katex` / `react-vendor` / 应用三块，消除主 JS chunk
  超过 500 kB 的构建警告，并改善依赖缓存。
- 覆盖率门槛从 `lines/functions/statements 80 / branches 70` 上调至
  `lines/functions/statements 90 / branches 85`，并补充 `pow2` 回退、`encodeLinear16`、
  HALF 次正规数进位、命令事务标签等边界用例；当前实际覆盖率约
  statements 95.86% / branches 93.82% / functions 97.84% / lines 98.13%。
- 清理全部 React inline `style` prop，迁移到 `src/styles/tokens.css` 语义 class / data
  属性；新增 `npm run check:inline-style` 防回归门禁并接入 `npm run verify`、`npm run check`
  与 CI quality job。
- `HexInput` / `IntegerInput` / `DecimalInput` 移除已无调用方的 `style` prop 通道。

## [2.0.1] - 2026-08-25

### Fixed

- 线上产品名称统一为 **PMBus 数值格式计算器**：页面标题（AppHeader）与浏览器标题
  （index.html）与 README/ROADMAP/Release notes 的产品定位一致，并补充范围说明
  “数值格式换算，不实现完整 PMBus/SMBus 协议栈”。
- 新增构建时版本徽标：`__APP_VERSION__` 由 vite.config.ts 从 package.json 注入，
  页面显示只读 `v2.0.1`，不再手工维护版本文本；release/deployment smoke 增加版本断言。
- legacy `pmbus-calculator.html` 领域语义对齐（离线兼容文件不再宣称已纠正却保留旧算法）：
  - `parseVoutMode` 修正为 bits[6:5] 两位 mode + bit7 `isRelative`（Part II §8.3）；
  - `checkSpecial` 不再把 Y=1023 / Y=-1024 标记为饱和/溢出边界；
  - STATUS_WORD 说明补充“通常为 Read Word；特殊写入 0x0100 仅用于清除 UNKNOWN 位”；
  - READ_EIN 说明展示 §18.13 6 字节 vs Appendix I Table 31 5 字节的规范冲突；
  - 下拉引用由 Part II 18.14 改为 Part II 18.13；
  - 内置自检新增 0x98/0x20/0x40/0x60/0xE0 VOUT_MODE、L11 边界、STATUS_WORD/READ_EIN 说明断言。
- 命令参考视觉快照改为对 `.command-ref-table-shell` 元素截图（light/dark），
  真正覆盖表格与新增的“说明”列，不再只拍 viewport 折叠区。
- 新增 `tests/legacy-html-contract.test.ts`，在 CI 中守护 legacy 文件的领域一致性。

## [2.0.0] - 2026-08-25

### Changed

- 发布链路简化（自 v1.1.11 以来的未发布变更）：`release:prepare-assets` 恢复为可重新执行的打包步骤——每次运行
  使用唯一临时 staging 目录，生成/checksum/ZIP verifier 全部成功后才把结果移入 `release-output/`；
  删除长期 release lock、transaction journal、`--recover`/`--recover-lock`/`--audit-lock`、
  child-state sidecar、detached process-group supervisor、SIGINT/SIGTERM 生命周期状态机、
  crash/failpoint matrix、repeated-signal/orphan/PGID/stress evidence runner 与 zero-skip
  release-security 聚合 runner；对应专项测试退役，发布生成器测试纳入普通单测。
  失败时正式输出保持旧值或不存在，恢复方式为清理临时输出并重新执行；并发生成不作为受支持场景。
- CI 并行化：单一串行 `check` job 拆为 `quality`（format/typecheck/lint/coverage/build/基础合同）、
  `e2e`（Playwright 安装、用户流程、release smoke）、`compatibility`（Node 22 typecheck + unit）、
  轻量 `check` 聚合 job（继续作为 branch protection required check）。
- 文档纠偏：AGENTS.md 只保留长期产品约束/目录边界/标准验证入口；ROADMAP 只保留当前产品基线、
  下一产品目标与简短已完成索引（M25–M34 详细历史由 Git/PR 保存）；RELEASING 只描述正常发布步骤
  与失败后清理重跑。
- 产品定位正式确立为 **PMBus 数值格式计算器**：不再自称“PMBus 协议实现”，也不声明完整
  PMBus 1.5 一致性；明确不覆盖总线传输、命令执行、设备 Profile、PMBus 1.5 安全扩展与 Part IV。
  `document/specifications.json` 的 `validatedReference`/`currentPublishedRevision`/
  `productScope`/`fullRevisionCompliance` 声明保持一致。
- VOUT_MODE 位域按 PMBus Part II §8.3 修正：bit7=absolute/relative、bits[6:5]=mode、
  bits[4:0]=parameter；不再用 `(byte >> 5) & 0x07` 把 bit7 混入模式。全仓库 VOUT_MODE
  章节引用统一为 Part II §8.3。
- L16 状态约束：reducer/domain 层拒绝在 relative LINEAR、VID、DIRECT、IEEE Half
  VOUT_MODE 下通过 `value/set` 生成 LINEAR16 编码——不能只靠隐藏 UI 输入阻止错误状态。
  只有 absolute LINEAR 才显示绝对电压结果、V、N、2^N 与可表示电压范围；relative LINEAR
  仅解释 VOUT_MODE 参数位的指数/比值语义，不把 raw 标成绝对电压；VID/DIRECT/IEEE Half
  不生成虚假的 LINEAR16 V/N/range/result。
- L11 饱和语义：autoN=true 用全格式全局可表示范围判断饱和；autoN=false 按当前锁定 N
  对应的 Y=-1024..1023 范围判断；真实发生 clamp 时才显示 saturation warning；
  Y=1023/-1024 本身仍是合法边界编码，不因边界值报警。
- 四模式统一“字段解析 → 通用公式 → 数值代入 → 中间值 → 结果”计算过程展示
  （新增 `src/app/calculation-steps.ts` 与共享 CalculationSteps 组件），JSX 不再自行计算。
- 命令参考降级：主流程移除 CommandPicker，改为默认折叠的只读“命令参考”面板；移除
  `command/apply-preset` action 与全部 project-demo presets。命令参考实际渲染 metadata
  中的 note：STATUS_WORD 显示“通常为 Read Word；特殊写入 0x0100 仅用于清除 UNKNOWN 位”，
  READ_EIN 显示 Block Read 与规范字节数/有效载荷冲突（§18.13 6 字节 vs Appendix I Table 31
  5 字节）；展开/阅读任何命令都不修改 mode、raw、VOUT_MODE 或 DIRECT 参数。
- 清理本批新增的静态 inline style，迁移到既有 CSS/class 体系（tokens.css 与 legacy HTML
  class），未放宽 lint、测试或 AGENTS.md 规则。
- 文档一致性：`docs/MIGRATION_MATRIX.md` 明确 Pages 根路径返回 200（产品入口），仅 legacy
  `/pmbus-calculator.html` 路径为 404；legacy 文案改为“保留仓库内离线兼容用途，只接受
  必要纠偏，不再作为当前 Pages 产品入口”；`docs/DEPLOYING.md` 的“命令选择器”改为
  “只读命令参考”；README、README_zh-CN、DOMAIN_MODEL、specifications manifest、部署与
  发布文档的产品范围声明和 Part II §8.3 引用保持一致。
- `pmbus-calculator.html` 明确为仓库内离线历史归档（非 Pages 部署资产，对应路径 404），
  保留仓库内离线兼容用途，只接受必要纠偏，不再作为当前 Pages 产品入口。
- 版本升至 **2.0.0**（详见下方破坏性变化与迁移方式）。

### Removed

- 命令选择器（CommandPicker）及其自动修改计算状态的行为；`command/apply-preset` action
  与全部 project-demo presets 不再存在。

### Breaking changes

- 移除命令选择器与 preset 自动应用：选择命令不再切换模式、不注入参数、不重写 raw，
  也不会自动填入 VOUT_MODE 或 DIRECT 系数。
- 命令参考降级为默认折叠的只读面板：任何命令行都没有选中态、没有搜索框、没有预设入口。
- 迁移方式：需要 preset 的旧工作流改用手动输入（数据格式由器件数据手册或 VOUT_MODE
  决定）；命令码、事务、数据类型、单位、格式来源与规范章节仍可在只读命令参考中查阅。
- L16 在 non-absolute-LINEAR VOUT_MODE 下不再产生任何 LINEAR16 电压结果（此前仅 UI
  隐藏输入、reducer 仍会编码的错误行为已修正）。

## [1.1.11] - 2026-08-24

### Fixed

- release child-process lifecycle（WP-A/WP-B）：`process.once` 重复信号 raw death 修复为显式
  listener 生命周期管理——第一个 SIGINT/SIGTERM 决定最终退出码（130/143），后续同/异信号只记录
  `termination already in progress`，listeners 在 `lock.release` 完成之后才移除，重复信号绝不触发
  默认 raw death；`execFileAsync` 只在 child `close` 后 settle，timeout 先请求停止（POSIX 进程组
  SIGTERM）→ 等 close → 升级 SIGKILL → 再等 close → 清理后代 → 才 reject，active-child registry
  在锁释放前强制为空，stdin EPIPE 捕获为受控 rejection（原实现为 unhandled stream error 崩溃）。
- 成功声明只在最终协议完成后输出（WP-C）：`generateAssets` 不再打印 `Done:`，由 runCli 在
  runLocked 完成、child registry 归零、lock release 成功、listeners 移除、无已观察 signal 后才输出
  单一成功声明；signal-observed run 零 `Done:`/零 `Transaction recovered successfully`（原实现存在
  checkStop 与 Done 之间的 TOCTOU 窗口，探针实证 handler 观察后 Done 仍打印且现有测试允许）。
- 完整 zero-skip release-security manifest（WP-D）：`SECURITY_TEST_FILES` 扩展至九个文件
  （新增 m29-crash-matrix、m29-release-gates、m29-signal-protocol、m30-signal-lifecycle、
  m30-child-lifecycle；探针实证原门禁不含三个 m29 文件，其 it.skip 完全不可见），
  total=188 passed=188 skipped/todo=0，CI 日志打印实际九文件清单。
- canonical Node/npm toolchain（WP-E）：官方 release index 核对 v24 LTS latest=24.19.0/npm
  11.17.0；`.node-version`/`.nvmrc`/engines/packageManager/devEngines 全部对齐 24.19.0 与
  npm@11.17.0；CI 主验证改读 `.node-version`（24.19.0）、compatibility 精确 22.20.0、双运行时
  精确 npm 11.17.0；Pages 改读 `.node-version`；无 rolling/latest/lts/\*；`@types/node` 保持精确
  22.20.1；新增 `npm run doctor`/`check:toolchain` 门禁并接入 verify 链与 CI。
- worktree/CI hooks（WP-F）：postinstall 改为 worktree-aware wrapper，linked/detached worktree、
  CI 与非 Git 目录跳过 hook 安装并输出清晰信息，不再输出被吞的 ENOTDIR（探针实证原行为），
  主 checkout 正常安装。

### 探针与验证

- 修改前探针 A–H（未修改 main 的临时 worktree）：重复信号 raw death + lock 遗留、listener 移除→
  release 窗口信号 raw death、timeout 在 child close 前 reject 且孙进程继续写、stdin EPIPE unhandled
  崩溃、三个 m29 文件不在门禁、handler 观察后 Done 仍打印、工具链漂移、worktree npm ci ENOTDIR。
- Node 24.19.0 / npm 11.17.0：verify exit 0、单测 813（41 文件）、release-security 188 零 skip、
  coverage 92.92/89.18/95.18/94.83、visual 23 passed（+0/~0/-0）、signal stress 225 轮 bad=0。
- Node 22.20.0 / npm 11.17.0 compatibility（临时 worktree）：typecheck、test:run（813）、
  release-security（188）、coverage（同数字）、build 全过；signal stress 225 轮 bad=0。

## [1.1.10] - 2026-08-24

### Fixed

> **M29 strengthening（v1.1.10，如实披露）：** v1.1.9 的线上 Release/Pages 资产本身正确且未做任何回滚、
> tag 移动或资产覆盖；以下 M28 表述在 M29 修复完成前超出实际实现，全部由 v1.1.10/M29 强化/取代：
>
> 1. "signal handler 只记录终止请求…收到 signal 后不得输出完整成功声明"：M28 实现依赖最多 10 次
>    `setImmediate` 的时序启发式等待信号投递；修改前探针实证 SIGINT 15/20、SIGTERM 8/20 的 `Done:`
>    在 handler 观察到信号前打印（v1.1.9 生效前 Node 24.0.0 CI 曾因此失败）。
> 2. "全部 M28 security tests zero-skip"：M28 runner 实际只运行 prepare-release-assets 与
>    zip-helper-security 两个文件；探针实证 m28-recovery 中一个测试改为 it.skip 后门禁仍 exit 0。
> 3. "journal rename 后按平台能力 fsync 父目录"：M28 将父目录 fsync 的任何错误（含 EIO/ENOSPC/EROFS/
>    EBADF/close 失败）降级为 note 并继续成功发布；探针实证 EIO 注入后仍 SUCCESS、journal 被删。
> 4. "完整自动恢复"：M28 在 STAGING_VERIFIED 写入空 hash 后、OLD_OUTPUT_BACKED_UP 写入 null oldSha256
>    后存在 crash window，磁盘 journal 无法通过 validateJournal；PRE_COMMIT 恢复在验证 oldSha256 前已
>    删除 output、移动 backup（topology 不再自洽）。

- zero-skip security gate 完整覆盖（WP-A）：新建 `scripts/release-security-test-contract.mjs` 共享清单
  `SECURITY_TEST_FILES`（prepare-release-assets、zip-helper-security、m28-recovery、run-release-security-tests
  四个文件），runner 与合同测试引用同一清单、不得分别硬编码；清单文件缺失/重命名/未执行时 fail closed；
  报告必须精确包含四个预期 suite，多余 suite 也失败；skipped/todo/pending 任一大于 0 即非零；
  CI 日志列出实际覆盖的四个文件与 zero-skip 结果；runner 自身测试加入门禁时用 fake vitest fixture，
  不产生无限递归。
- 确定性 signal/lock 协议（WP-B）：删除 bounded 10×setImmediate flush loop；Python helper/verifier 子进程
  改为 async spawn，`generateAssets`/`recoverTransaction` 在事务 stage 边界（每次 journal 写、每次子进程
  完成）检查注入的终止状态，signal 被观察后不进入新 transaction stage、不打印 Done/完整成功声明；
  INIT journal 在任何长时子进程前持久化，信号到达任何时点都留下可恢复 journal；SIGINT 精确返回 130、
  SIGTERM 精确返回 143；lock 在所有写/rename/子进程停止前不释放；第二 generator 在第一进程完全停止前
  无法获得锁；Node 22.20.0 与 24.0.0 各 100 轮（50×SIGINT + 50×SIGTERM）stress 0 flaky、0 skip。
- 目录 durability fail-closed（WP-C）：新增 `fsyncParentDirectorySync`，错误分类——EINVAL/ENOTSUP/
  EOPNOTSUPP（平台不支持目录 fsync，经实测与文档说明）降级为 note；EIO/ENOSPC/EROFS/EBADF/未知错误/
  close 失败抛 DurabilityError，保留 journal/backup/lock 恢复信息、返回非零、不得报告完整成功；
  覆盖全部六个 mutation boundary（journal temp write/fsync/close、journal rename、output→backup rename、
  staging→output promotion、backup 删除、journal unlink）。
- 恢复前验证与 crash-consistent journal（WP-D）：PRE_COMMIT + backup 恢复在删除/rename 任何路径前，
  将 backup 的 zip+sums hash 与 journal.oldSha256 比较，不匹配时零磁盘 mutation（无 rm/rename 被调用）、
  journal/backup/output 原样保留；新增 `OLD_OUTPUT_BACKUP_INTENT` 状态（rename 前持久化，oldSha256 从
  未触碰的 output 计算）；hash 先填充再持久化 STAGING_VERIFIED；STAGING_GENERATED 允许空 hash；
  14 个 crash matrix failpoint（13 force + 首次发布）逐一验证：磁盘 journal 可被 validator 解析、
  --recover 可重复运行、第二次 recovery 幂等、无 journal 指向不存在 backup 的状态。
- 统一 ZIP entry contract（WP-E）：共享 fixture `tests/fixtures/zip-entry-contract.json`；JS
  `validateZipEntry`、`_zip_helper.py`、`verify_release_zip.py` 三层对同一 fixture 表一致结论；
  Windows drive absolute/drive-relative（C:/、C:\、C:）与 UNC（//、\\）三层全部拒绝；'.' 段、空段、
  backslash、control、node_modules/src、.map 三层一致拒绝；helper 直接调用 fail closed 且不留 partial ZIP。
- runner 私有临时目录与清理失败（WP-F）：报告位于 `mkdtempSync` 随机私有目录（0o700），不再使用可预测的
  `/tmp/release-security-tests-${pid}.json`；成功删除报告与目录；删除失败必须使最终门禁非零并在 stderr
  报告，原始 test failure 与 cleanup failure 同时发生时两者都报告；runner 不调用中途 process.exit；
  新增 symlink/path replacement race、rmSync EACCES/EIO、report 替换为 symlink/directory、temp dir 创建
  失败、test child timeout/signal（`RELEASE_SECURITY_TIMEOUT_MS` 可注入）与零残留 fixture。
- 文档与审计合同（WP-G）：ROADMAP/CHANGELOG 将上述四项 M28 表述标记为 M29 strengthening/superseded
  （不修改已发布 v1.1.9 tag 或 Release notes 资产）；PR 模板新增 base SHA/tree、final head SHA、push 次数、
  每次 CI URL/head/conclusion、最终成功 CI head_sha、checked_sha/checked_tree、merge SHA/tree、tree equality、
  security runner 实际覆盖文件列表、passed/failed/skipped/todo、temp residue、signal stress 次数/平台、
  journal crash matrix 数量、hygiene 两个 size 指标语义（tracked path entry 计数与 blob size 求和）。

## [1.1.9] - 2026-08-23

### Fixed

> **v1.1.8 勘误（如实披露）：** v1.1.8 的线上 Release/Pages 资产本身正确且未做任何回滚、tag 移动或资产覆盖；
> 但发布管线存在以下缺陷，全部由 v1.1.9/M28 修复：
>
> 1. COMMITTED 恢复接受非 ZIP 文件及自洽 checksum，并删除唯一有效 backup。
> 2. 首次发布或 backup 已清除后，只剩 COMMITTED/BACKUP_CLEANED journal 时 --recover 返回"无 backup"无法恢复。
> 3. zero-skip runner 在 JSON report 缺失/损坏时可能 exit 0。
> 4. runner 的临时 JSON cleanup 位于 process.exit() 之后，永远不可达。
> 5. SIGINT/SIGTERM 释放锁但不终止/中止工作，退出码还可能被 main 覆盖。
> 6. lock/journal writeSync 返回 0 时存在无限循环。
> 7. journal 的 version/path/hash 没有与当前事务及磁盘资产严格绑定。
> 8. Python ZIP helper 不验证 manifest entry 名。
> 9. --force、--recover、--recover-lock 的冲突组合未明确拒绝。

- 恢复状态机以 journal 为唯一事实来源（WP-A）：recoverTransaction 先读取并严格验证 journal，
  再依据 journal state + output 是否存在 + backup 数量决定动作；COMMITTED + output + backup 时对 output
  执行完整 reverify（asset pair、SHA256SUMS、verify_release_zip.py、版本合同、实际 hash 等于 journal.newSha256），
  全部通过后才可删除 backup，任一失败保留 output/backup/journal 返回 manual audit；COMMITTED/BACKUP_CLEANED +
  output + 无 backup（首次发布 journal.delete 失败或已完成 backup cleanup 的正式恢复路径）完整验证 output 与
  journal.newSha256，成功时只清理 journal；PRE_COMMIT + 无 backup 只允许基于精确 journal/path/hash 采取保守动作，
  无法证明所有权时 manual audit；PRE_COMMIT + backup 先深度验证 backup、再恢复、恢复后再次完整验证，
  失败不删除最后一个有效副本；journal 不得仅靠 state 字符串决定删除资产。
- journal 绑定与耐久性（WP-B）：validateJournal 验证 journal.version 等于 package.json version、
  outputPath 精确等于规范化的 release-output、backupPath 为 null 或安全单段名称并与唯一实际 backup 精确一致、
  禁止绝对路径/.. /反斜杠/路径分隔符、oldSha256/newSha256 为小写 64 位十六进制、
  state 与 backupPath/oldSha256/newSha256 的必需字段组合一致、updatedAt 为严格 ISO 时间；
  抽取 writeAllSync，writeSync 返回 0/负数/NaN/非整数/大于 remaining 均立即失败、不得无限循环，
  lock 创建失败时只删除自己创建的 inode，journal 写失败不得把部分 journal 提升为正式 journal，
  close/fsync/rename 错误全部有负向测试，journal rename 后按平台能力 fsync 父目录。
- zero-skip runner 真正 fail-closed（WP-C）：重构 scripts/run-release-security-tests.mjs，
  不在中间调用 process.exit()，main 返回退出码、顶层最后设置 process.exitCode，
  report cleanup 位于 try/finally 并在所有结果路径执行，report 缺失/空/损坏/字段缺失/字段非有限整数/
  统计不一致无论 Vitest status 是多少都必须 exit nonzero，result.status 必须严格为 0，
  total > 0、failed === 0、skipped === 0、passed + failed + skipped 与 total 一致，
  输出失败测试名但不得因 malformed assertionResults 自身崩溃；为 runner 本身增加独立单测，
  运行真实 npm run test:release-security 后确认 /tmp 无报告残留。
- SIGINT/SIGTERM 与锁生命周期（WP-D）：进程仍可能修改 staging/output/backup/journal 时绝不能提前释放锁，
  signal handler 只记录终止请求、锁由统一 finally 在所有写操作停止后释放，
  无法安全即时中断同步操作时保守地保持锁完成当前原子阶段后停止，
  最终 SIGINT 返回 130、SIGTERM 返回 143，main 不得用 runCli 的 0 覆盖 signal code，
  收到 signal 后不得输出完整成功声明，lock release 失败保持 recoverable metadata 并返回非零；
  真实子进程测试使用慢速可控 helper 在持锁期间发送 SIGINT/SIGTERM，
  另一 generator 在第一进程完全停止前绝不能获得锁，退出码精确为 130/143。
- ZIP helper 自身 fail-closed（WP-E）：\_zip_helper.py 直接验证 manifest entry（非空 POSIX relative path、
  禁止绝对路径/.. /反斜杠/空 segment/"." segment/重复 entry），与 release-artifact-contract 的 ZIP entry policy
  保持一致，非法 manifest 或任一文件失败时删除 partial ZIP；补充同 inode 同大小但读取期间内容变化的策略
  （比较 size/dev/ino/mtime_ns/ctime_ns），无法证明稳定快照时失败。
- CLI 与审计（WP-F）：--force/--recover/--recover-lock 互斥，任意冲突组合在创建 lock 前 exit 2，
  未知参数仍在创建 lock 前失败。

## [1.1.8] - 2026-08-23

### Fixed

> **v1.1.7 勘误（如实披露）：** v1.1.7 的线上 Release/Pages 资产本身正确且已重新验证，
> 未做任何回滚、tag 移动或资产覆盖；但发布管线存在以下缺陷，全部由 v1.1.8/M27 修复：
>
> 1. `--recover` 不获取互斥锁即可运行，且仅按文件名/数量校验 backup——损坏的 backup
>    （非 ZIP 内容、非法 checksum）会被直接提升为正式 output 并返回 exit 0。
> 2. 部分备份删除导致数据丢失：`--force` 在 backup 清理阶段失败时，rollback 会删除
>    已验证的新 output、把残缺 backup 恢复为 output——新旧 ZIP 同时丢失。
> 3. symlink 测试实际始终 skip：`symlinkTest` 在模块加载时求值，而能力标志在
>    `beforeEach` 中才置位，注册时恒为 `it.skip`。
> 4. rollback 测试未达到 publish 阶段：基于 createHash 调用次数的注入在 staging 校验阶段
>    即失败，backup rename 与 promotion 从未执行，publish 阶段回滚零覆盖。
> 5. behavioral contract 仍可 fallback 假通过：动态 import 失败时回退到源码字符串检查，
>    "缺模块 + 错误本地命名"与"plan 正确但 generateAssets 不消费 plan"均判 ok。
> 6. `npm run clean` 声称清理锁文件但实际 exit 1 且什么都不删（锁不是目录），文档与行为矛盾。

- 统一锁域（WP-A）：普通生成、`--force`、`--recover` 全部使用同一原子互斥锁；
  `--recover-lock` 是唯一可在不持锁时操作锁文件的命令；`--recover` 先 `acquireLock`、
  在 try/finally 中执行恢复、release 失败使 CLI 非零；cleaner 发现锁时 fail closed，
  在删除任何 release 目标前停止，且永不删除锁文件；`GENERATED_TARGETS` 移除锁文件、
  新增事务 journal；RELEASING.md 同步更新。并发测试由 25 个真实子进程调用真实导出函数。
- 锁创建与释放错误完整性（WP-B）：`open('wx')` 成功后的 write 失败、short write、close 失败均关闭 fd
  并只清理由本次创建的 lock inode（fstat/lstat dev+ino 所有权校验，替换后的锁绝不误删）；
  `release()` 不再吞错——unlink/read/parse 失败抛出 `LockReleaseError` 并保留可恢复元数据；
  资产已生成但锁未释放时 CLI 非零并明确提示部分成功；新增 SIGINT/SIGTERM 行为测试
  （尽可能释放 owned lock、无法释放时保留可恢复元数据、绝不删除非 owned lock）；
  锁元数据 schemaVersion/startedAt/nonce 类型与格式校验，未知 schema 禁止自动恢复。
- 事务 commit point 与故障恢复（WP-C）：显式状态机 STAGING_VERIFIED → OLD_OUTPUT_BACKED_UP →
  NEW_OUTPUT_PROMOTED → NEW_OUTPUT_VERIFIED → COMMITTED → BACKUP_CLEANED；COMMITTED 之后 backup
  删除失败不删除已验证新 output、不用残缺 backup 覆盖、保留残余 backup/journal 并要求显式清理；
  versioned transaction journal（schema/nonce/version/state/output/backup/old/new SHA-256），
  更新走临时文件 + fsync + 原子 rename；12 个具名 failpoint（staging checksum、staging zip verifier、
  backup rename 前/后、promotion 前/后、published checksum、published zip verifier、commit journal、
  backup 删除开始前、部分删除后、journal 删除），测试断言 failpoint 名与阶段 trace，
  禁止 createHash 调用次数冒充注入；rollback restore 自身失败保留 backup/journal 且不吞错。
- Recovery 完整性（WP-D）：`recoverTransaction` 深度验证 backup（恰好两个普通文件、SHA256SUMS 仅一行、
  checksum 与实际 hash 一致、verify_release_zip.py 通过）；symlink/目录/多余文件/错误 ZIP/checksum 全部拒绝；
  output 与 backup 并存时读取 journal——PRE_COMMIT 恢复已验证旧 backup、COMMITTED 保留已验证新 output 仅清理
  backup、journal 缺失/损坏/未知 schema 一律拒绝并要求人工审计；多 backup 一律拒绝；recovery 必须持锁；
  恢复完成后重新验证正式 output；损坏 backup 绝不被 rename 为 output。
- artifact contract 真实执行路径（WP-E）：移除动态 import fallback，任何 import/解析失败一律 fail closed；
  `buildReleasePlan(version)` 成为唯一实现并放入共享合同模块，generator 与 contract checker 均直接导入；
  `generateAssets` 只消费 plan（zipName/sumsName/layout/tag/template），禁止直接调用 assetNames 或本地命名模板；
  `runCli` 支持注入 repoRoot，fixture 运行真实 CLI；新增正/负向 CLI fixture（缺失 module、plan 正确但
  generator 不消费 plan、wrong ZIP/sums/tag/template）。
- symlink、并发与 Python helper（WP-F）：symlink 能力在测试注册前同步探测（mkdtemp → symlink → finally 清理）
  再选择 it/it.skip，canonical 环境 symlink file/dir/helper 测试零 skip；同一 shell 连续两次运行结果完全一致；
  25 子进程真实 `acquireLock` 竞争严格一个 winner；Python helper 对原始路径使用 O_NOFOLLOW 打开、fstat 比较
  初始 lstat 的 dev+ino、循环 os.read 直到 EOF 并处理 short read、长度/identity 变化即失败；新增 helper 直接
  测试（symlink final component/parent、lstat 与 open 之间替换、FIFO/directory、path escape、duplicate entry、
  short-read、deterministic bytes）。
- 测试真实性（WP-G)：删除以 expect(true) 充当合同的测试；catch 使用 unknown narrowing、无理由 @ts-expect-error
  移除；每个 failpoint 测试断言 failpoint 名确实触发并记录事务阶段 trace；full CI 新增 Linux generator/security
  专项（不依赖 Playwright，零 skip 门禁 `npm run test:release-security`，任一 skip 即失败）。

## [1.1.7] - 2026-08-23

### Fixed

- 原子并发锁与所有权：`acquireLock` 从 `existsSync → writeFileSync`（TOCTOU 竞态）重构为 `fs.openSync(path, 'wx', 0o600)`（O_CREAT|O_EXCL 原子创建）；锁内容改为结构化 JSON 元数据（schema version、PID、timestamp、random nonce、repo realpath）；cleanup 仅删除 nonce/PID/repo 三方匹配的本进程锁；无效 JSON、EPERM、PID 状态不明、stale lock 均不得自动删除；新增 `--recover-lock` 显式恢复命令；`process.exit()` 不再出现在 try/catch 中，CLI 返回 exit code；未知参数在锁创建前失败且无残留。
- 事务状态机与恢复：`generateAssets` 重构为显式事务状态机（INIT → STAGING_GENERATED → STAGING_VERIFIED → OLD_OUTPUT_BACKED_UP → NEW_OUTPUT_PROMOTED → NEW_OUTPUT_REVERIFIED → BACKUP_REMOVED）；首次发布时 staging 直接 rename 到尚不存在的 output（不再预 mkdir）；已有 output 先验证恰好是合法资产对；`--force` 使用唯一 nonce 备份目录；新增 `--recover` 命令（output 缺失 + 已验证 backup 可恢复，output 与 backup 同时存在拒绝）；每个 failpoint 可注入依赖（fs rename/remove/verifier/checksum）并断言旧资产不丢失、无含糊状态、owned lock/staging 零残留。
- 测试确定性与路径安全：移除固定路径 `/tmp/.m25-symlink-probe`，改用 `fs.mkdtempSync` 创建唯一能力探针并在 `afterAll` 中无条件清理；同一 shell 连续运行 generator test 两次测试数、passed、skipped 完全一致，临时目录零残留；新增 20+ 并发竞争测试（严格一个 winner）；新增 FIFO/socket/device/文件名含特殊字符/control char 拒绝测试；`catch` 使用 `unknown` 并做正确 narrowing。
- Python ZIP helper TOCTOU 修复：`_zip_helper.py` 改为先 `os.lstat` 原始路径（检测 symlink），再 `os.path.realpath`（containment 校验）；POSIX 上优先使用 `os.open(..., O_RDONLY | O_NOFOLLOW)` 防 check-vs-read 替换；`external_attr` 包含 `stat.S_IFREG | 0o644`；新增 symlink swap/TOCTOU fixture 测试。
- 行为式 artifact contract：`check-release-contract` 不再仅检查 `includes("from './release-artifact-contract.mjs'")` 字符串，改为导入 `getReleasePlan(version)` 并验证其返回的 zipName/sumsName/pagesZipTemplate/tag 与共享合同一致；动态 import 失败时回退到源码级检查并记录；`readContract` 返回 `generatorBehavioralOk` 与 `generatorBehavioralErrors` 字段。
- 锁清理：`clean-generated.mjs` 增加 `.release-staging.lock` 到清理目标（17→18 项）；`.gitignore` 备份模式更新为 `release-output.backup*/`。
- 文档：`RELEASING.md` 新增"中断恢复"章节，记录 `--recover-lock`、`--recover` 命令与人工审计规则。

> **v1.1.6 勘误：** v1.1.6 的发行资产本身正确，但以下实现缺陷由 v1.1.7/M26 修复：
>
> 1. `acquireLock` 使用非原子 `existsSync → writeFileSync`（TOCTOU 竞态）；锁文件无结构化所有权元数据，清理仅比对 PID 字符串。
> 2. Release 资产生成器失败路径（如 dist 缺失）会遗留 `.release-staging.lock`，`npm run clean` 未清理该文件。
> 3. `tests/prepare-release-assets.test.ts` 使用固定路径 `os.tmpdir()/.m25-symlink-probe` 作为 symlink 能力探针且未清理，导致同一 shell 第二次运行 symlink 测试被意外 skip。
> 4. `generateAssets` 的 rollback 路径（`--force` 失败后恢复旧 output）仅在 `finally` 块中作为 best-effort 实现，无 explicit failpoint 测试覆盖，也未验证 backup rename 后、staging promotion 前、re-verify 中等各阶段的故障恢复。
> 5. `_zip_helper.py` 先 `os.path.realpath` 再 `os.lstat`，symlink 被 `realpath` 解析后 `S_ISLNK` 检查永不会触发（TOCTOU）。
> 6. `check-release-contract` 仅检查 generator 源码中是否包含 shared-contract import 字符串，不验证实际行为；generator 可使用硬编码错误 ZIP 名仍通过门禁。

## [1.1.6] - 2026-08-23

### Fixed

- 发布资产生成器 fail-closed 与事务式发布：`walkDist` 显式分类所有 Dirent 类型（symlink/FIFO/socket/device 均报错，禁止静默跳过）；路径校验使用分量级判断（拒绝 `..`、`node_modules`、`src`、`.map`、控制字符）；使用固定 `scripts/_zip_helper.py` 替代动态生成临时脚本；Python executable 可注入（`PYTHON3` 环境变量）；checksum 反向验证使用 Node `crypto`（不依赖 shell `shasum`）；新增事务式发布（`.release-staging/` 唯一 staging → 验证 → 发布，`--force` 使用 backup/rollback 保护旧资产）；并发锁（`.release-staging.lock`）；零遗留 `.cache/zip-*` 临时文件。新增 `tests/prepare-release-assets.test.ts`（19 测试）。
- 发布合同完整性：`check-release-contract` 新增结构化 CHANGELOG 解析——恰好一个 `## [Unreleased]`、必须是第一个 release-level heading、当前版本是其后的第一个 dated section、fenced code block 内伪标题忽略、重复/缺失/乱序全部失败；`readContract` 现在读取 RELEASING.md 和 generator 共享合同导入检查；删除 `main()` 中 RELEASING 旁路追加逻辑（纯函数、fixture 和 CLI 走同一 read→validate 路径）。新增 10 个 CHANGELOG 结构测试和 9 个 integration fixture 测试。
- 共享发行资产合同：新增 `scripts/release-artifact-contract.mjs`（`assetZipName`、`assetSumsName`、`PAGES_ZIP_TEMPLATE`、`validateZipEntry` 等），`prepare-release-assets` 和 `check-release-contract` 均从该模块导入，消除多处重复命名模板。
- Node 精确运行时下限：engines 从 `>=22 <23` 收紧为 `>=22.20.0 <23`（Node 24 保持 `>=24.0.0 <25`）；`@types/node` 从 `^22.20.1` 改为精确 `22.20.1`（防止自动漂移到更高 minor）；CI `setup-node` 从滚动 `22`/`24` 改为精确 `'22.20.0'`/`'24.0.0'`（带引号）；runtime contract 测试解析完整 major.minor.patch 并锁定精确下限；新增 `tests/node-ffi-type-probe.ts`（`@ts-expect-error` 负向 fixture，由主 typecheck 覆盖）。
- 类型边界清理：删除 `specifications.mjs` 中注释掉的 `pushIf` 死代码。
- 文档勘误：CHANGELOG v1.1.5 和 ROADMAP M24 节注明 M24 未实际验证 missing `[Unreleased]`、generator 未实现 fail-closed 遍历和事务式发布、运行时下限只比较主版本；明确这些由 v1.1.6/M25 修复。
- 文档同步：`CHANGELOG.md`、`docs/releases/v1.1.6.md`、双 README（stable/live/Release/SHA256SUMS 链接）、`ROADMAP.md`（M25 Done + stable v1.1.6）、`RELEASING.md` 全部更新。

## [1.1.5] - 2026-08-23

### Fixed

- Node 运行时下限类型合同：`@types/node` 从 26（Current）改为 22（最低支持运行时），消除类型门禁接受 Node 22/24 运行时不存在 API（如 `node:ffi`）的 false-pass；新增 `tests/runtime-type-contract.test.ts` 结构性锁定引擎下限、CI 主/次验证与 `@types/node` 主版本一致性。注：M24 只比较主版本（major），未锁定精确 minor/patch 下限（engines 接受 Node 22.0，但 jsdom 实际要求 ≥22.13.0），CI 使用滚动 `22`/`24` 而非精确版本；这些在 v1.1.6/M25 修复。
- 发布合同真实文件检查：`scripts/check-release-contract.mjs` 重构为读取真实文件表面（Pages workflow 模板、RELEASING.md），不再自生成 `artifactNames` 循环校验；新增精确 Gregorian 日期验证、release notes 第一非空行精确标题匹配、README Live Demo 行版本校验、ROADMAP 唯一 stable 声明检查、lockfile 双版本必需验证。注：M24 未实际校验 `## [Unreleased]` 缺失（删除后仍 exit 0），也未校验 generator 是否导入共享合同；这两项在 v1.1.6/M25 修复。
- 发布合同集成级负向测试：`tests/release-contract.test.ts` 新增 13 个 fixture 集成测试（lockfile 漂移、缺失 [Unreleased]、非法日期、错误标题、陈旧 README 链接、ROADMAP 重复/陈旧声明、Pages 模板错误、RELEASING 资产名错误），每个错误使真实 read+validate 链非零。
- scripts checkJs 类型覆盖：新增 `tsconfig.scripts.json`（strict + checkJs + Node types），根 tsconfig 扩展为 app/node/scripts/tests 四项目；`scripts/**/*.mjs` 七个文件补全 JSDoc 类型注解（含 `FetchLike` 结构类型、`manifest`/`document` JSON 边界 `any` 窄桥接），不降低 strict、不使用 `@ts-nocheck` 或全局 `any`。
- 可复现发行资产生成：新增 `scripts/prepare-release-assets.mjs`（从 `dist/` 确定性生成 `pmbus-calculator-vX.Y.Z-web.zip` 与 `SHA256SUMS.txt`，版本唯一来源 `package.json`），相同 `dist/` 两次生成 zip 与 checksum 逐字节一致；自动调用 `verify_release_zip.py` 与 `shasum -a 256 -c` 反向验证；`release-output/` ignored；`RELEASING.md` 改用该唯一命令。注：M24 生成器未实现 fail-closed 遍历（symlink 静默跳过）、事务式发布（失败遗留 `.cache/zip-*` 临时文件）、并发锁和 Python 可注入性；这些在 v1.1.6/M25 修复。
- 文档同步：`CHANGELOG.md`、`docs/releases/v1.1.5.md`、双 README（stable/live/Release/SHA256SUMS 链接）、`ROADMAP.md`（M24 Done + stable v1.1.5）全部更新。

## [1.1.4] - 2026-08-23

### Fixed

- TypeScript 验证门禁真实性：`npm run typecheck` 从对 solution 根配置执行 `tsc --noEmit`（受检文件数为 0）改为 `tsc -b` 构建模式，真实检查应用源码、Vite/Node 配置、单元测试、E2E 测试与全部 Playwright 配置；新增 `tsconfig.tests.json`（strict + Node/Vitest 类型）与结构性回归测试，负向探针证明 src/tests/Playwright 配置错误均使门禁非零退出；`@types/node` 成为直接 devDependency；四个 mjs 脚本边界补精确 JSDoc 类型，修复 strict 检查暴露的 59 处测试类型错误（含 `documentPdfs` 过期断言与两处 E2E null 处理）。
- 发布合同自动检查：新增完全离线的 `npm run check:release-contract`，以 `package.json` 版本为唯一来源校验 lockfile、CHANGELOG、release notes、双 README 链接、ROADMAP 声明与 Release 资产命名一致性（含成功/失败单测），接入 `npm run verify` 与 full CI。
- 发布流程文档修正：`docs/RELEASING.md` 重写为 M19-B 后的正确流程——PR head full CI → 记录 checked_sha/checked_tree → 普通 merge → tree 审计（一致不重复 CI，不一致 workflow_dispatch full CI）→ 在精确 merge SHA 的干净 detached worktree 完成发布前全量验证与 zip/SHA256SUMS 校验后才能创建 annotated tag；删除已失效的“等待 main push CI”要求。
- CI 与 Node 矩阵：full CI 的 Type check 步骤运行真实 `tsc -b`（日志可见 app/node/tests 三个项目）；Node 24 次级验证升级为 `typecheck + 单测`。
- 仓库卫生与规范分发加固（v1.1.3 后合入）：repo-hygiene 门禁与制品政策、按 blob 计算树大小、clean preflight 跨平台；第三方规范 PDF 移出 Git tree，provenance/哈希集中维护在 manifest，下载走白名单 host、流式写入与 deadline 提交门禁。
- Tailwind 构建范围可复现：`source(none)` + 显式 `@source` 隔离生产扫描范围，canary 回归防止非生产工具类再次泄漏进发行 CSS。
- CI tier 与受保护 main：fail-closed light/full 分级、Playwright report 按失败步骤门控上传、`protect-main` ruleset（PR 必须、required check、strict up-to-date、禁 force push）与 merge 后 `checked_tree` 审计替代重复 CI。
- Vitest/Node 验证加固：Vitest 4 与 coverage provider 成对升级（glob 弃用链移除）、engines 收紧为 Node 22/24、CI 增加 Node 24 次级验证。
- 输入校验与键盘可靠性（M21）：统一整数语法拒绝 `1e2`/`0x10` 等宽松转换；过渡态不逐键报错、非法终值字段级可见错误并保留 draft；DIRECT 系数错误按字段隔离；`Ctrl+1..4` 仅在非编辑上下文生效；CommandPicker 搜索框显式 `aria-label`。
- CommandPicker APG 焦点与搜索生命周期（M22）：`role="option"` 迁移到不进 Tab 顺序的 `<li>`；`aria-selected` 恒等于 `aria-activedescendant` 指向；ArrowUp/Down 首尾不循环；Tab/Shift+Tab 关闭弹层并移焦到 trigger 逻辑相邻控件；Escape 恢复 trigger 焦点；外部焦点关闭不抢焦；零匹配显示状态文案且 Enter 安全 no-op；清空 query 恢复选项、active 与滚动位置。

## [1.1.3] - 2026-08-16

### Fixed

- 结果主数值：等宽 + tabular-nums，按长度使用可预测字号档位；长精确值不截断、不换行、不 scale；结果 tile 增加 min-width/overflow 防护。
- HALF 公式：headline 已显示最终物理值时，展开式不再重复最终长小数；normal 显示 `s / E / F` 字段摘要与展开式；subnormal、zero、Infinity、NaN 保留各自语义。
- DIRECT LaTeX：负指数渲染为 `10^{-12}`，不再出现 `10^{(-12)}`；`plainText` 与 C 宏注释保持兼容。
- 量化误差：文案改为“量化误差”；`ok`/`warn`/`error` 分别映射 success/warning/danger，负号只表示方向。
- 复制工具栏：Hex 主按钮动态显示 `Hex（LE）` / `Hex（BE）`；偏好区拆为“Hex 格式”与“Hex 复制顺序”两个语义分组。
- 文案统一：`PMBus 命令`、`物理值`、`小端序（LE）`、`大端序（BE）`、`V（16 位无符号，0～65535）`、`Y（16 位有符号，−32768～32767）`、`IEEE 754 binary16（半精度）`。
- 交互与排版：BitGrid 移除 hover 放大；InfoPanel 与图例改用设计 token；暗色滚动条统一为细滚动条并覆盖 Firefox/WebKit。
- 视觉回归：新增 L11/L16/DIRECT/HALF 非零应力场景、亮暗主题、移动端与小高度弹层截图。

## [1.1.2] - 2026-08-16

### Fixed

- 对比度：拆分 `--color-accent` / `--color-accent-solid` / `--color-on-accent`，暗色选中 tab 改用 `#2563eb` + `#ffffff`；成功/失败反馈改用 surface/text/border token。
- BitGrid：region 颜色改为语义 token，移除 nibble group 投影；360/390px 下 2×2 nibble 布局，bit index 字号 10px。
- 公式：DIRECT 参数面板改为 KaTeX 通用关系式；HALF 动态公式按 sign/exponent/fraction 展示 zero/subnormal/normal/±Infinity/NaN 分解；`formulaGenericLatex` 由展示层统一提供。
- 语义：删除 L11 默认 `Y = 0，表示零值或未初始化` 提示。
- 布局：统一 Header/ModeSwitcher/CommandPicker/Workspace 左右 gutter；复制工具栏改为 6 列平衡网格，LE/BE 字节中文标签，复制字节序 segmented control。
- 测试：新增 contrast、layout-gutters 测试；visual snapshot 改用稳定场景名并归档 v1.1.1 GitHub 渲染证据。

## [1.1.1] - 2026-08-16

### Fixed

- Markdown：移除 GitHub 不支持的 `\operatorname`，HALF 表格改为分段解码定义；修复 `docs/UI_CONVENTIONS.md` 原始 fenced-block 示例；新增活动 Markdown 数学检查。
- 命令下拉框：改为 `@floating-ui/react-dom` 的 viewport-aware 定位，portal 渲染，默认向下展开，空间不足自动翻转；修复 `scrollIntoView` 意外滚动页面。
- 公式纯文本：修复 DIRECT `10^(--1)` / `--3` / `10^(-0)` 可读性；HALF 按 zero / subnormal / normal / ±Infinity / NaN 分类展示。
- 交互：删除全局 `filter: brightness` hover，统一语义 token、控件高度、图标；模式切换补全 tabs 键盘行为；复制反馈改为受控 timer，reduced-motion 下仍保留足够可读时长。
- 调试面板：正式 Pages 默认隐藏，仅 `import.meta.env.DEV` 或 `?debug=1` 显示。
- 发布：记录并修复 GitHub Pages environment 只允许 main branch 导致 release event 被拒绝的问题，新增稳定 tag policy。

## [1.1.0] - 2026-08-16

- Markdown 数学公式：活动文档中的数学表达式统一使用 GitHub 支持的 `$...$` / `$$...$$` LaTeX 语法。
- Web 公式 KaTeX 排版：新增集中式 `MathFormula` 组件与公式展示层，L11/L16/DIRECT/HALF 四种模式均由 KaTeX 正式排版，纯文本公式与 C 宏输出保持不变。
- 交互反馈系统：统一 cursor、hover、active、focus-visible、disabled 状态矩阵，支持 `prefers-reduced-motion`。
- Release/Pages smoke：生产构建与真实 Pages 部署均验证 KaTeX CSS、字体与 MathML 输出。

## [1.0.0] - 2026-08-15

- 四模式双向转换：LINEAR11 / LINEAR16 (VOUT) / DIRECT / IEEE 754 Half-Precision 均支持 Hex 与物理值双向编码解码。
- 命令字典与显式 project-demo presets：内置 13 条 PMBus 1.3 标准命令定义；preset 仅在显式点击后应用。
- copy/theme/persistence：Hex/值/C 代码复制、亮暗主题、字节序与偏好持久化。
- 严格输入校验：拒绝 partial parse、科学计数法、越界与非法输入。
- READ_EIN 冲突呈现：以显式 conflict 模型呈现 Rev 1.3 与 1.3.1 冲突，不虚构单一权威 packet length。
- 单测、coverage、E2E 与 CI 门禁：Vitest + v8 coverage、Playwright desktop/mobile Chromium E2E、build、lint、typecheck、format 与 audit。
- legacy HTML fallback：`pmbus-calculator.html` 保留为 read-only fallback。
- Agent context archive：M0–M10.1 历史上下文归档至 `docs/archive/`。
