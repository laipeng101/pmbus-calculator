# ROADMAP

> 本文件是里程碑状态的唯一事实来源。不要在其他文档中重复维护进度表。
> M25–M34 详细历史与探针记录由 Git/PR 保存，不再维护在 ROADMAP 中。

最后更新：2026-08-25（发布链路简化：发布资产生成恢复为可重新执行的打包步骤；CI 拆分为并行 job）

## 当前产品基线

- Web-first PMBus Calculator 是主线；技术栈为 Vite + React 19 + TypeScript + Tailwind CSS + Vitest + Playwright。
- L11 / L16 / DIRECT / HALF 四种模式均已双向闭环，并有 Vitest + Playwright 回归覆盖。
- PMBus 规范基线：PMBus 1.3。Rev 1.3.1 冲突仍以显式 conflict 模型呈现；1.5 不评估、不声明兼容。
- 维护基线：第三方规范 PDF 不进入当前 Git tree；官方来源、字节数和 SHA-256 统一维护在
  `document/specifications.json`，开发者按需从官方 URL 下载到 ignored `.cache/specifications/`。
  这是分发边界维护，不是规范升级，不创建新的产品版本里程碑，也不把 PMBus 1.5 升级标成已开始。
- `pmbus-calculator.html` 保留为 read-only legacy fallback，不删除、不移动、不重写。
- 命令元数据唯一数据源：`src/legacy/command-metadata.ts`。
- 发布资产生成（`scripts/prepare-release-assets.mjs`）是小型静态 Web 项目的可重新执行打包步骤：
  从 `dist/` 确定性生成 ZIP + SHA256SUMS，临时生成物可丢弃，失败后清理临时输出并重新执行即可；
  不使用长期锁、journal、恢复协议或进程监督。

## 当前里程碑

```text
M0–M34 complete；stable release v1.1.11；production distribution: GitHub Pages；当前无活动功能里程碑。
```

## 简短已完成索引

- M0–M10.1：单文件 Web App 重构（历史快照见 `docs/archive/web-refactor-m0-m10.1/`）。
- M11–M24：领域模型、命令元数据、规范分发边界与发布合同建立。
- M25–M34：发布链路事务化与加固（v1.1.11 工程基线；2026-08-25 完成发布链路简化后，
  事务锁/journal/恢复/进程监督机制已退役，详见 Git 历史与本任务 PR）。
- 当前：v1.1.11 已发布；无进行中的功能里程碑。

## 下一产品目标

- 暂无活动功能里程碑。下一次产品增量（新功能、UI、算法或数据变更）由新的功能任务定义；
  发布流程遵循 `docs/RELEASING.md`，里程碑状态在本文件更新。
