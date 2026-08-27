# ROADMAP

> 本文件是里程碑状态的唯一事实来源。不要在其他文档中重复维护进度表。
> M25–M34 详细历史与探针记录由 Git/PR 保存，不再维护在 ROADMAP 中。

最后更新：2026-08-27（v2.5.4 IEEE Half 语义纠偏：DIRECT 器件系数要求与标准 binary16 语义拆分 + §7.2 设备级互斥文档收口）

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
M0–M39 complete；stable release v2.5.3；production distribution: GitHub Pages；当前无活动功能里程碑。
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
- 当前：无进行中的功能里程碑；v2.5.3 已完成发布（Release + Pages，2026-08-27），
  M40–M41 complete。下一次 PATCH/功能增量按本文件与 `docs/RELEASING.md` 定义。

## 下一产品目标

- 暂无活动功能里程碑。下一次产品增量（新功能、UI、算法或数据变更）由新的功能任务定义；
  发布流程遵循 `docs/RELEASING.md`，里程碑状态在本文件更新。
