# ROADMAP

> 本文件是里程碑状态的唯一事实来源。不要在其他文档中重复维护进度表。
> 历史完整快照见 [`docs/archive/web-refactor-m0-m10.1/`](archive/web-refactor-m0-m10.1/README.md)。

最后更新：2026-08-22（M18 Done：成本感知 CI 分级与单 PR 闭环）

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
M0–M18 complete；stable release v1.1.3；production distribution: GitHub Pages；当前无活动功能里程碑。
```

### M18 done — 成本感知 CI 分级与单 PR 闭环

- Workflow 级 concurrency：同一 PR 的新提交自动取消该 PR 的过时 run（`cancel-in-progress`
  仅 pull_request 事件为真）；不同 PR、PR 与 main、main push 互不取消，main 不设
  cancel-in-progress，保留每个 merge SHA 的验证证据。
- 单一来源分类器 `scripts/classify-ci-scope.mjs`：light-only allowlist 只在该脚本维护
  （`docs/**`、根级 README/README_zh-CN/CHANGELOG/AGENTS/CLAUDE/CONTRIBUTING/LICENSE/
  THIRD_PARTY_NOTICES/.gitignore、`document/README.md`、`.github/ISSUE_TEMPLATE/**`、
  `.github/pull_request_template.md`）；全部 changed paths 命中才 light；diff 使用
  `--name-only --no-renames -z` 与 merge-base（PR `base...head`）/`before..sha`（push）语义。
- Fail closed：空变更集、缺失/非法 SHA、全零 push before、git diff 失败、未知事件、
  任意未知路径、light/full 混合一律 full；分类器自身、测试、workflow、配置与依赖变更
  均为 full；changed paths 只进日志，`$GITHUB_OUTPUT` 只写受控常量
  （`tier`/`run_full`/`changed_count`/`reason`）。
- CI 仍为单一 `check` job：npm ci、repo hygiene、format、markdown math 与完整
  PR base→head / push before→head whitespace gate 两个 tier 都执行；
  specs/typecheck/lint/coverage/Playwright/build/Tailwind gate/release smoke/audit
  仅 full tier（`run_full != 'false'` 的 fail-closed 条件控制全部重型步骤）；不使用
  workflow 级 `paths`/`paths-ignore`，required check 名称不变，Playwright report
  上传仅限 full tier 失败时。
- 本地入口：`npm run verify:light` 仅限分类器确认的 pure light-only 任务；
  `npm run verify` 完整强度不变。
- 单 PR 里程碑闭环：`docs/ROADMAP.md` 以 main 为正式事实来源，Done 在实现 PR 最终
  提交中翻转，PR head CI 全绿后 merge；不再创建第二个 bookkeeping PR；CI URL 与
  SHA 属于 PR/Actions/最终报告的审计证据，不写入 ROADMAP。
- 产品算法、UI 与 snapshot 零改动（0/0/0）。
- 状态依据：分类器单测（含真实 git 临时仓库集成）、历史 commit range 验证与本地
  `npm run verify`；PR/CI 审计证据见对应 PR 与 Actions 运行，不在本文件维护。

### M17 done — 生产样式源码隔离与可复现构建

- 问题：`src/styles/tokens.css` 此前依赖 Tailwind v4 默认的工作目录候选词扫描，非生产文件
  （`scripts/`、`tests/`、`docs/` 以及 `src/` 内 colocated 单测）中的英文文本会泄漏成 utility
  规则（如 `lowercase`、`table`），造成 v1.1.3 之后 main 构建 CSS 与制品哈希的无意义漂移。
- 修复：改为显式 source 配置——`source(none)` 关闭自动扫描，`@source '../'` 只登记 `src/`，
  `@source not '../**/*.test.ts'` 排除 colocated 测试；`index.html` 无 utility class，不纳入扫描。
- 门禁：`npm run check:tailwind-scope`（`scripts/check-tailwind-scope.mjs`）检查真实 `dist/`：
  生产范围外 canary utility（单一来源 `tests/tailwind-source-canary.ts`）不得生成、已知泄漏规则
  （`.lowercase` / `.table`）不得出现、产品必需 utility 必须存在；已接入 `verify` 链与 CI（Build 之后）。
- 行为不变：算法、舍入、字节序、复制格式、命令元数据与持久化契约零改动；JS 制品内容与基线一致；
  两次干净构建制品树逐文件 SHA-256 完全一致。
- 状态依据：PR #30 head `ae753e1` CI 全绿；main merge SHA `bbbe9f9` CI 全绿；本地 `npm run verify`、
  visual（23 passed，snapshot 零变化）与两次干净构建逐文件 SHA-256 一致性均通过。

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
