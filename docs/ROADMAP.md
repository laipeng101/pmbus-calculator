# ROADMAP

> 本文件是里程碑状态的唯一事实来源。不要在其他文档中重复维护进度表。
> 历史完整快照见 [`docs/archive/web-refactor-m0-m10.1/`](archive/web-refactor-m0-m10.1/README.md)。

最后更新：2026-08-16（M13 release candidate 已合入，等待 v1.1.0 Release 与 Pages 部署）

## 当前产品基线

- Web-first PMBus Calculator 是主线；技术栈为 Vite + React 19 + TypeScript + Tailwind CSS + Vitest + Playwright。
- L11 / L16 / DIRECT / HALF 四种模式均已双向闭环，并有 Vitest + Playwright 回归覆盖。
- PMBus 规范基线：PMBus 1.3。Rev 1.3.1 冲突仍以显式 conflict 模型呈现；1.5 不评估、不声明兼容。
- `pmbus-calculator.html` 保留为 read-only legacy fallback，不删除、不移动、不重写。
- 命令元数据唯一数据源：`src/legacy/command-metadata.ts`。

## 当前里程碑

```text
M0–M12 complete；stable release v1.0.0；production distribution: GitHub Pages。
M13（统一 LaTeX 数学公式展示与交互反馈系统）release candidate，等待 v1.1.0 Release 与 Pages 部署闭环。
```

### M13 release candidate

- 代码与文档已合入 main；版本号 `1.1.0`。
- 在 GitHub Release `v1.1.0` 创建、SHA256 校验、Pages 自动部署与远程 smoke 完成前，不声明 M13 Done。
- 发布成功后通过小型文档闭环 PR 将本文件与 README 的当前线上版本更新为 `v1.1.0`。

### M11 release baseline

- 首次稳定发行统一为 `v1.0.0`；`package.json` 版本不带 `v`，Git tag 带 `v`。
- 发布纪律、稳定公共契约与发布流程见 `docs/RELEASING.md`。
- 变更日志见 `CHANGELOG.md`；发行说明见 `docs/releases/v1.0.0.md`。
- GitHub Release 是当前正式发行渠道，不发布 npm 包。

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
