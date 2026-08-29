# ROADMAP

> 本文件是里程碑状态的唯一事实来源。不要在其他文档中重复维护进度表。
> M25–M34 详细历史与探针记录由 Git/PR 保存，不再维护在 ROADMAP 中。

最后更新：2026-08-30（v2.5.12 DIRECT 精确请求 provenance——raw 编码与
provenance 共享同一词法真值，量化分类/误差由精确有理数决定并忠实呈现；
精确 lexeme 长度边界 4096；默认 5s 单测门禁消除确定性真实睡眠；draft
Release 资产本地字节验证成为仓库正式入口 verify-downloaded-assets.mjs，
operator draft 门禁与 Pages published 门禁共用）

## 当前产品基线

- 产品定位：**PMBus 数值格式计算器**（L11/L16/DIRECT/HALF 双向换算），不是 PMBus/SMBus
  控制器或一致性实现；不覆盖总线传输、命令执行、设备 Profile、PMBus 1.5 安全扩展与 Part IV。
- Web-first PMBus Calculator 是主线；技术栈为 Vite + React 19 + TypeScript + Tailwind CSS + Vitest + Playwright。
- L11 / L16 / DIRECT / HALF 四种模式均已双向闭环，并统一“字段解析 → 公式 → 计算过程 → 结果”展示，有 Vitest + Playwright 回归覆盖。
- PMBus 规范基线：PMBus 1.3（validated reference）。Rev 1.3.1 冲突仍以显式 conflict 模型呈现；
  官方当前发布版本为 1.5，但本仓库不评估、不声明 1.5 兼容性，`document/specifications.json`
  仅记录 1.5 为 currentPublishedRevision，不伪装成完整 1.5 基线。
- 维护基线：第三方规范 PDF 不进入当前 Git tree；官方来源、字节数和 SHA-256 统一维护在
  `document/specifications.json`，开发者按需从官方 URL 下载到 ignored `.cache/specifications/`。
  这是分发边界维护，不是规范升级，不创建新的产品版本里程碑，也不把 PMBus 1.5 升级标成已开始。
- `pmbus-calculator.html` 保留为仓库内离线历史归档（read-only），不删除、不移动、不重写；
  保留仓库内离线兼容用途，只接受必要纠偏，不再作为当前 Pages 产品入口。Pages 根路径为
  产品入口（返回 200），仅 legacy `/pmbus-calculator.html` 路径返回 404。
- 命令元数据唯一数据源：`src/legacy/command-metadata.ts`；只读命令参考，无 preset、无选择副作用。
- 发布资产生成（`scripts/prepare-release-assets.mjs`）是小型静态 Web 项目的可重新执行打包步骤：
  从 `dist/` 确定性生成 ZIP + SHA256SUMS，临时生成物可丢弃，失败后清理临时输出并重新执行即可；
  不使用长期锁、journal、恢复协议或进程监督。

## 当前里程碑

```text
M0–M39 complete；stable release v2.5.12；production distribution: GitHub Pages；当前无活动功能里程碑。
```

## 简短已完成索引

- M0–M10.1：单文件 Web App 重构（历史快照见 `docs/archive/web-refactor-m0-m10.1/`）。
- M11–M24：领域模型、命令元数据、规范分发边界与发布合同建立。
- M25–M34：发布链路事务化与加固（v1.1.11 工程基线；2026-08-25 完成发布链路简化后，
  事务锁/journal/恢复/进程监督机制已退役，详见 Git 历史与本任务 PR）。
- M35：工程质量加固——Vite 构建拆包消除 500 kB 警告；覆盖率门槛上调并补测；
  清理全部 React inline style 并新增 `check:inline-style` 门禁。
- M36：结果优先响应式布局 + 确定性视觉基线治理——物理值首屏可见、计算过程默认折叠、
  命令参考降级、visual scene 版本规范化。
- M37：LINEAR 指数编辑器与 VOUT_MODE 结构化配置器——共享 LINEAR 公式编辑器（N 锚定 2 右上
  指数槽）、L16 VOUT_MODE composer（bit7/format/parameter 双向同步 + canonical byte）、
  VOUT_MODE analyzer/composer 单一领域来源、精确 validity 分类（relative-VID 非法组合、
  DIRECT/Half 非零参数非法）、Hex 过渡态合同修正、L16 exponent 单事实源。
- M38：独立 VOUT_MODE 计算器 + 标准 LINEAR16 语义——第五个 VOUT_MODE 模式（8-bit 双 nibble
  交互位网格、raw lossless、Normalize canonicalize）、ULINEAR16（X=Y_u×2^N）与
  SLINEAR16 offset（X_offset=Y_s×2^N）payload 语义、relative ULINEAR16 比值
  X=V_NOM×R、固定 0x 前缀 HexInput 合同。历史注记：M38 当时实现含「L16 共享 VOUT_MODE
  非 LINEAR 回退 0x18」，该行为**已由 v2.5.2 移除**（非 LINEAR 一律 fail closed，
  显式 apply-default 恢复），当前契约见 DOMAIN_MODEL §3；不要把此摘要当现行行为。
- M39：中文优先界面 + 可访问术语气泡 + 字体角色统一 + 共享位字段网格——单一术语数据源
  `terminology.ts` 与 `TechnicalTerm` 浮层（点击/键盘/触屏、防裁切）、双语 explanation
  model 重构为中文主文案、VOUT_MODE 配置摘要移出 KaTeX（UI/数据/数学三字体角色）、
  `BitFieldGrid` 统一 16 位与 8 位（含 L16 compact 双 nibble）与中文图例、
  页面 `<title>` 补全 VOUT_MODE。
- M40（v2.5.0）：格式编码量化误差读数扩展到 L16/DIRECT/HALF——可判别结果分类
  （exact/quantized/saturated/overflow/special）、provenance 合同、零分母/溢出/
  特殊值正确呈现、fallback 标注、DOMAIN_MODEL §6 与 UI_CONVENTIONS §15。
- M41（v2.5.1）：SLINEAR16 offset 在 bit7=1 时的物理输入可达性（payload 上下文取代
  字节级 status 判定）与手动 Y_s provenance 失效；DOMAIN_MODEL §2.2/§6.1 与
  UI_CONVENTIONS §15 契约同步。complete。
- v2.5.2（PATCH）：非 LINEAR 共享 VOUT_MODE 在 L16 页 fail closed（Part II §8.4，移除隐式 0x18 回退；显式 apply-default 恢复），默认 E2E 与 deployment smoke 口径隔离。
- v2.5.3（PATCH）：VID scope 纠偏（Part II §8.4.2 支持 VID，仅 VOUT_TRIM/VOUT_CAL_OFFSET
  在 VID 下由 §13.3/§13.4 禁止、相对 ×VID 由 §8.5.3 排除）——payload discriminated
  contract 取代全局 vidProhibited；非 LINEAR raw 位域改用中性图例；文档与测试矩阵同步。
- v2.5.4（PATCH）：IEEE Half 语义纠偏（Part II §7.6/§8.4.4 标准 binary16，换算不需要
  m/b/R/VID 表/器件 profile；仅 relative 字节需 §8.5.2 标称参考值）——独立 VOUT_MODE
  页面 status/warning/explanation/steps 由 `vout-mode-requirements.ts` discriminated
  requirement 单一来源驱动；文档登记 §7.2 Half 与 LINEAR/DIRECT 设备级互斥。
- v2.5.5（PATCH）：HALF 特殊值 PMBus §7.6.2 操作语义（NaN 写入=invalid data+
  communications fault/读回=值不可用，±Inf 写入=正/负满量程/读回=测量通道饱和，
  有限值不显示，raw/value 双路径可见，binary16 数学与量化分类不变）——
  `half-special-semantics.ts` 单一来源 + 特殊值卡；VOUT_MODE 结构合法性、可计算性
  与外部数据三维正交（§8.4.2 Table 3 明列的 1Eh/1Fh 为结构合法+需器件资料，不再
  复用非法 alert 标志）；status/InfoPanel/说明/步骤四个表面真正全部消费
  requirement 判别式，E2E 改为逐表面断言。
- v2.5.6（PATCH）：物理值输入 untouched blur 事务化（无编辑的 focus/blur 严格
  no-op——不改写 raw、不伪造 §6.1 请求来源，HALF `7C01` 等非规范 NaN 原码
  raw-lossless）——VID Table 3 出处纠偏（`classifyVidCode` 机器区分 not-used/
  listed-reserved+family/unlisted-reserved/profile-required，requirement 拆分
  `vid-reserved-listed`/`vid-reserved-unlisted`，五个表面消费单一来源，明列 code
  不再被写成「未列出」）——移除矛盾的双重结构合法性事实源
  `VoutModeAnalysis.isLegal`（结构合法性只由 `structureLegal` 输出）。
- v2.5.7（PATCH）：HALF signed-zero 简写修复（`-.0` 等解析为真 `-0`、编码
  `0x8000`，Part II §7.6/§7.6.2）——untouched-blur 事务语义推广到全部共享输入
  （Hex/Integer/Decimal/NominalVoutInput，共享 `input-transaction.ts`）——
  已选语义控件幂等（同字节写入不清除 provenance）——0x18 表述纠偏
  （`CALCULATOR_LINEAR_EXAMPLE_VOUT_MODE` / `l16/apply-calculator-linear-example`，
  明示计算器示例值而非 PMBus 默认）。
- v2.5.8（PATCH）：解析层静默限幅修复（共享 `classifyFloatText` 单一来源：
  有限值不限幅，DIRECT m=1/b=0/R=-21 下 `1e21→0x0001`、`-1e21→0xFFFF`；
  ±1e400 等十进制溢出文本在所有模式报明确范围错误、不改旧 raw；HALF 显式
  字面量与十进制溢出区分）——relative L16 标称参考值可清除（
  `l16/clear-nominal-vout`，null 与 0 区分，清除只影响标称通道）——发布
  流程 draft→上传→回验→publish（`release-assets-verify.mjs` 单一就绪门禁，
  Pages 侧 fail-closed 于部署前）。
- v2.5.9（PATCH）：无效草稿失焦修复（过渡态严格化：无数字尾数的指数碎片
  不再是过渡态；共享 `resolveFloatTextOnBlur` 分类在先——invalid/out-of-range
  失焦保留草稿与错误、不提交、不清 provenance；`fixFloatTextOnBlur` 成为
  分类约束下的纯函数）——relative 派生范围诊断（共享
  `resolveRelativeVoltage`：缺参考值/有限/乘法溢出/非零因子下溢；结果卡、
  公式、步骤、警告、物理值复制五个表面一致，溢出/下溢显示 `—` 与共享
  说明，真零不误判）——发布元数据只作为数据（verifier stdout 单一 JSON +
  `--repo` + canonical URL 合同 `release-url-contract.mjs`；新增
  `download-release-assets.mjs` 消费者；Pages workflow 弃用 `source`）——
  验收证据留存（Playwright `trace: 'retain-on-failure'` + JSON reporter，
  失败留存与真实退出码纪律入 CONTRIBUTING）。
- v2.5.10（PATCH）：LINEAR11 自动编码严格最近值修复（`findBestLinear11`
  移除固定 1e-15 epsilon——严格不同误差不再被归并为 tie；bit-exact tie
  采用显式 smaller-`|N|` 确定性策略，DOMAIN_MODEL §2.1；65536 全码
  oracle + 中点邻接矩阵锁定）——非零十进制输入下溢拒绝（
  `classifyFloatText` 新增可判别 `underflow`：尾数数学非零而 binary64
  结果为 ±0 的文本报明确输入范围错误，不提交、不清旧 raw/请求/标称；
  真零与最小 subnormal 合同不变，UI_CONVENTIONS §8）——发布下载器
  5 分钟真实累计预算（重试/backoff 消耗同一预算，不再出现 30 分钟
  最坏累计对 20 分钟 job 的矛盾）——draft 占位 URL `untagged-<hex>`
  合同收紧（PR #70 修复正式纳入发布源码）。
- v2.5.12（PATCH）：DIRECT 精确请求 provenance（state 判别联合保存
  提交 lexeme，量化 exact 分类与误差有理化，全部表面忠实呈现）；精确
  lexeme 长度边界 4096（BigInt 前置字符串边界）；默认 5s 门禁稳定性
  （backoff 注入 + pow10 记忆化 + sweep 拆分）；draft 资产本地字节门禁
  `scripts/verify-downloaded-assets.mjs`（draft/published 双模式）。
- v2.5.11（PATCH）：DIRECT 精度保真修复（新增 `src/app/direct-exact.ts`
  BigInt 精确参照：typed 提交按完整十进制 lexeme 经 exact rational 复现
  `Math.round`+signed16 clamp 合同，消除「exact → binary64 显示 → 回录」
  静默改 raw 的精度折叠——DOMAIN_MODEL §2.3；折叠状态由 `directFidelity`
  单一来源在警告/量化注记/步骤标记近似值、精确有理数/十进制与回编后果，
  「物理值」复制返回经独立 exact encoder 验证、可安全回录的精确文本；
  bit-exact 回归：全 65536-Y 扫描 + 固定种子 fuzz + 真实键盘/剪贴板
  回录 E2E）——发布下载器网络 reject 与瞬时 HTTP 同一有界退避（计入
  共享预算，deadline abort 立即失败不重试，日志区分五类事件）——
  bit-field-grid 超长多视口用例按视口拆分（断言不变，单用例 <2s）。
- 当前：无进行中的功能里程碑；v2.5.12 已完成发布准备，M40–M41 complete。
  下一次 PATCH/功能增量按本文件与 `docs/RELEASING.md` 定义。

## 下一产品目标

- 暂无活动功能里程碑。下一次产品增量（新功能、UI、算法或数据变更）由新的功能任务定义；
  发布流程遵循 `docs/RELEASING.md`，里程碑状态在本文件更新。
