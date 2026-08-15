# ROADMAP

> 本文件是里程碑状态的唯一事实来源。不要在其他文档中重复维护进度表。
> 历史完整快照见 [`docs/archive/web-refactor-m0-m10.1/`](archive/web-refactor-m0-m10.1/README.md)。

最后更新：2026-08-16（M10.2 进行中）

## 当前产品基线

- Web-first PMBus Calculator 是主线；技术栈为 Vite + React 19 + TypeScript + Tailwind CSS + Vitest + Playwright。
- L11 / L16 / DIRECT / HALF 四种模式均已双向闭环，并有 Vitest + Playwright 回归覆盖。
- PMBus 规范基线：PMBus 1.3。Rev 1.3.1 冲突仍以显式 conflict 模型呈现；1.5 不评估、不声明兼容。
- `pmbus-calculator.html` 保留为 read-only legacy fallback，不删除、不移动、不重写。
- 命令元数据唯一数据源：`src/legacy/command-metadata.ts`。

## 当前里程碑

- M10.2 context hygiene：Review（PR 中，等待 CI）。

## 当前有序 backlog

1. READ_EIN 权威字节数选择：需要目标器件数据手册或适用规范修订，blocked。
2. DIRECT `device-datasheet` profiles：需要真实器件数据手册，blocked。
3. 独立 FormulaEditor：optional，不是缺陷。
4. 更全面 viewport 业务矩阵：optional。
5. PMBus 新版规范升级：独立工作，当前不得自动开展。

## blocked 条件

- 任何需要器件真实数据手册的 profile 或数据宽度结论：没有真实器件数据手册即 blocked，不虚构。
- PMBus 规范版本升级：仅在用户明确要求并指定规范版本/PDF 时启动。

## 历史归档

- [`docs/archive/web-refactor-m0-m10.1/`](archive/web-refactor-m0-m10.1/README.md)：M0–M10.1 冻结历史快照，不作为当前任务状态。
