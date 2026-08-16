# ROADMAP

> 本文件是里程碑状态的唯一事实来源。不要在其他文档中重复维护进度表。
> 历史完整快照见 [`docs/archive/web-refactor-m0-m10.1/`](archive/web-refactor-m0-m10.1/README.md)。

最后更新：2026-08-16（M16 Done：v1.1.3 result presentation, interaction polish and release provenance hardening）

## 当前产品基线

- Web-first PMBus Calculator 是主线；技术栈为 Vite + React 19 + TypeScript + Tailwind CSS + Vitest + Playwright。
- L11 / L16 / DIRECT / HALF 四种模式均已双向闭环，并有 Vitest + Playwright 回归覆盖。
- PMBus 规范基线：PMBus 1.3。Rev 1.3.1 冲突仍以显式 conflict 模型呈现；1.5 不评估、不声明兼容。
- 维护基线：第三方规范 PDF 不进入当前 Git tree；官方来源、字节数和 SHA-256 统一维护在
  `document/specifications.json`，开发者按需从官方 URL 下载到 ignored `.cache/specifications/`。
  这是分发边界维护，不是规范升级，不创建新的产品版本里程碑，也不把 PMBus 1.5 升级标成已开始。
- `pmbus-calculator.html` 保留为 read-only legacy fallback，不删除、不移动、不重写。
- 命令元数据唯一数据源：`src/legacy/command-metadata.ts`。

## 当前里程碑

```text
M0–M16 complete；stable release v1.1.3；production distribution: GitHub Pages；当前无活动功能里程碑。
```

### M15 done

- 代码与文档已合入 main；版本号 `1.1.2`。
- GitHub Release `v1.1.2` 已发布，release event 已自动触发 Pages 并完成部署，远程 smoke 4 passed。
- 对比度、公式语义、复制工具栏、移动端密度与视觉验收规则见 `docs/UI_CONVENTIONS.md`。

### M14 done

- 代码与文档已合入 main；版本号 `1.1.1`。
- GitHub Release `v1.1.1` 已发布，release event 已自动触发 Pages 并完成部署，远程 smoke 4 passed。
- Markdown 数学检查、popup viewport 约束、视觉与 a11y 规则见 `docs/UI_CONVENTIONS.md`。

### M13 done

- 代码与文档已合入 main；版本号 `1.1.0`。
- GitHub Release `v1.1.0` 已发布，SHA256 校验通过，Pages 已从不可变 Release 资产完成部署，远程 smoke 4 passed。
- Markdown 数学公式、Web KaTeX 公式、交互状态矩阵与 reduced-motion 规则见 `docs/UI_CONVENTIONS.md`。

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
