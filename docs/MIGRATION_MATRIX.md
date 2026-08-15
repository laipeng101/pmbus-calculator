# MIGRATION MATRIX

> 本文件是 legacy parity 与变更记录的唯一事实来源。
> 里程碑状态见 [`ROADMAP.md`](ROADMAP.md)；架构与原则见 [`WEB_REFACTOR_PLAN.md`](WEB_REFACTOR_PLAN.md)。

最后更新：2026-08-15

## 1. 变更记录

| Change ID | 日期       | 文件                                                                    | 类型      | 影响模式                   | 测试                                                    | 文档同步 | 状态   |
| --------- | ---------- | ----------------------------------------------------------------------- | --------- | -------------------------- | ------------------------------------------------------- | -------- | ------ |
| WEB-0000  | 2026-04-29 | 规划文档                                                                | 文档      | GLOBAL                     | 不适用                                                  | 是       | Done   |
| WEB-0001  | 2026-04-30 | 工程配置                                                                | 配置      | GLOBAL                     | build/lint                                              | 是       | Done   |
| WEB-0002  | 2026-04-30 | Vite/React 入口、tokens                                                 | 新增      | GLOBAL/THEME               | build                                                   | 是       | Done   |
| WEB-0003  | 2026-04-30 | PMBusMath + 命令字典迁移                                                | 迁移      | L11/L16/DIRECT/HALF        | Vitest smoke                                            | 是       | Done   |
| WEB-0004  | 2026-04-30 | 状态层                                                                  | 新增      | GLOBAL                     | typecheck/lint                                          | 是       | Done   |
| WEB-0005  | 2026-04-30 | UI 骨架                                                                 | 新增      | GLOBAL/LAYOUT/THEME        | Playwright                                              | 是       | Done   |
| WEB-0006  | 2026-04-30 | P0 视觉修复                                                             | 修复      | GLOBAL/LAYOUT/THEME        | tsc+eslint+build+vitest                                 | 是       | Done   |
| WEB-0007  | 2026-04-30 | BitGrid 响应式修复                                                      | 修复      | GLOBAL/LAYOUT              | Playwright                                              | 是       | Done   |
| WEB-0008  | 2026-04-30 | reducer 测试与 pre-commit                                               | 清理/测试 | GLOBAL                     | 38 pass + tsc                                           | 是       | Done   |
| WEB-0009  | 2026-04-30 | DebugDrawer 骨架与文档                                                  | 文档/新增 | GLOBAL/LAYOUT              | tsc+build+vitest 51 pass+Playwright                     | 是       | Done   |
| WEB-0010  | 2026-08-15 | AGENTS/CLAUDE/计划文档基线校准                                          | 文档      | GLOBAL                     | 不适用                                                  | 是       | Done   |
| WEB-0011  | 2026-08-15 | M3–M8 实际状态与 Migration Gap 同步                                     | 文档      | L11/L16/DIRECT/HALF/COPY   | 不适用                                                  | 是       | Done   |
| WEB-0012  | 2026-08-15 | L11 双向闭环                                                            | 新增/修复 | L11                        | Vitest 113 pass + Chromium 390px 实测                   | 是       | Done   |
| WEB-0013  | 2026-08-15 | L16 / VOUT 双向闭环                                                     | 新增/修复 | L16                        | Vitest 126 pass + typecheck + build                     | 是       | Review |
| WEB-0014  | 2026-08-15 | M4.5 稳定化：饱和/clamp/命令应用/Half 舍入/主题/persistence/CI/E2E/文档 | 修复/文档 | L11/L16/DIRECT/HALF/GLOBAL | Vitest 139 pass + coverage + Playwright 22 pass + build | 是       | Review |

## 2. Legacy parity

| 旧功能          | 旧位置                            | 新组件/模块                  | 状态     | 备注                                                                                                |
| --------------- | --------------------------------- | ---------------------------- | -------- | --------------------------------------------------------------------------------------------------- |
| PMBusMath 核心  | 内联 `PMBusMath`                  | `legacy/pmbus-math.ts`       | Done     | 机械迁移；L11 饱和与 Half 舍入已修正并有测试                                                        |
| 命令字典数据    | 内联 `COMMAND_METADATA`           | `legacy/command-metadata.ts` | Review   | 领域模型已重做（dataFormat/transactionType/valueType/profileSource）；STATUS/BLOCK 不再绑定数值模式 |
| 模式 Tabs       | `.tabs` + `switchMode`            | `ModeSwitcher`               | Done     | 支持 Ctrl+1/2/3/4                                                                                   |
| 命令选择器      | `#commandSelect`                  | `CommandPicker`              | Review   | 选中命令会加载模式与参数并重新编码；键盘方向键导航待补                                              |
| Bit Grid        | `renderBits` / `renderDirectBits` | `BitGrid`                    | 部分完成 | 图例按模式切换；DIRECT/HALF 分区仍简化                                                              |
| 结果面板        | `#resultBox`                      | `ResultInspector`            | Done     | 展示 value/raw/LE/BE/误差/复制                                                                      |
| 信息栏          | `#infoBar`                        | `InfoPanel`                  | Done     | 三级提示                                                                                            |
| 公式界面        | `.formula-mode` DOM               | `ModeWorkspace` 内联公式区   | 部分完成 | L11/L16 双向；DIRECT/HALF 待闭环；独立 FormulaEditor 待拆                                           |
| DebugPanel      | `#debugPanel`                     | `DebugDrawer`                | 部分完成 | 不再宣称 CI 测试状态；边界测试入口待 M8                                                             |
| 主题切换        | `#themeToggle` + `.dark`          | `ThemeToggle`, `data-theme`  | Done     | 由 `state.ui.theme` 驱动，经 `persistence.ts` 持久化                                                |
| 复制工具        | 复制按钮 + 全局状态               | `CopyToolbar`                | 部分完成 | 0x/空格/LE-BE 偏好已接 UI 并持久化；clipboard fallback 已有                                         |
| DIRECT profiles | inline buttons                    | `DirectCoeffPanel`           | Todo     | 需绑定器件 profile 与来源                                                                           |
| Boundary tests  | `runBoundaryTests`                | Vitest + `DebugDrawer`       | 部分完成 | 139 unit pass；L16/DIRECT/HALF golden-case 待补；E2E 22 pass                                        |

## 3. 手动质量检查矩阵

| 里程碑    | 1440px | 1024px | 768px  | 430px  | 390px  | 深色模式 | L11              | L16                | DIRECT         | HALF           |
| --------- | ------ | ------ | ------ | ------ | ------ | -------- | ---------------- | ------------------ | -------------- | -------------- |
| M2 布局   | 已完成 | 已完成 | 已完成 | 已完成 | 已完成 | 已完成   | 不适用           | 不适用             | 不适用         | 不适用         |
| M3 L11    | 已完成 | 已完成 | 已完成 | 已完成 | 已完成 | 已完成   | 已完成（含饱和） | 不适用             | 不适用         | 不适用         |
| M4 L16    | 已完成 | 已完成 | 已完成 | 已完成 | 已完成 | 已完成   | 已完成           | 已完成（含 clamp） | 不适用         | 不适用         |
| M4.5 门禁 | 已完成 | 已完成 | 已完成 | 已完成 | 已完成 | 已完成   | 已完成           | 已完成             | 命令应用不适用 | 命令应用不适用 |
| M5 DIRECT | 待办   | 待办   | 待办   | 待办   | 待办   | 待办     | 不适用           | 不适用             | 待办           | 不适用         |
| M6 HALF   | 待办   | 待办   | 待办   | 待办   | 待办   | 待办     | 不适用           | 不适用             | 不适用         | 待办           |
