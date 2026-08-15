# MIGRATION MATRIX

> 本文件是 legacy parity 与变更记录的唯一事实来源。
> 里程碑状态见 [`ROADMAP.md`](ROADMAP.md)；架构与原则见 [`WEB_REFACTOR_PLAN.md`](WEB_REFACTOR_PLAN.md)。

最后更新：2026-08-15

## 1. 变更记录

| Change ID | 日期       | 文件                                                                                                                                   | 类型      | 影响模式                            | 测试                                                                   | 文档同步 | 状态 |
| --------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------- | ----------------------------------- | ---------------------------------------------------------------------- | -------- | ---- |
| WEB-0000  | 2026-04-29 | 规划文档                                                                                                                               | 文档      | GLOBAL                              | 不适用                                                                 | 是       | Done |
| WEB-0001  | 2026-04-30 | 工程配置                                                                                                                               | 配置      | GLOBAL                              | build/lint                                                             | 是       | Done |
| WEB-0002  | 2026-04-30 | Vite/React 入口、tokens                                                                                                                | 新增      | GLOBAL/THEME                        | build                                                                  | 是       | Done |
| WEB-0003  | 2026-04-30 | PMBusMath + 命令字典迁移                                                                                                               | 迁移      | L11/L16/DIRECT/HALF                 | Vitest smoke                                                           | 是       | Done |
| WEB-0004  | 2026-04-30 | 状态层                                                                                                                                 | 新增      | GLOBAL                              | typecheck/lint                                                         | 是       | Done |
| WEB-0005  | 2026-04-30 | UI 骨架                                                                                                                                | 新增      | GLOBAL/LAYOUT/THEME                 | Playwright                                                             | 是       | Done |
| WEB-0006  | 2026-04-30 | P0 视觉修复                                                                                                                            | 修复      | GLOBAL/LAYOUT/THEME                 | tsc+eslint+build+vitest                                                | 是       | Done |
| WEB-0007  | 2026-04-30 | BitGrid 响应式修复                                                                                                                     | 修复      | GLOBAL/LAYOUT                       | Playwright                                                             | 是       | Done |
| WEB-0008  | 2026-04-30 | reducer 测试与 pre-commit                                                                                                              | 清理/测试 | GLOBAL                              | 38 pass + tsc                                                          | 是       | Done |
| WEB-0009  | 2026-04-30 | DebugDrawer 骨架与文档                                                                                                                 | 文档/新增 | GLOBAL/LAYOUT                       | tsc+build+vitest 51 pass+Playwright                                    | 是       | Done |
| WEB-0010  | 2026-08-15 | AGENTS/CLAUDE/计划文档基线校准                                                                                                         | 文档      | GLOBAL                              | 不适用                                                                 | 是       | Done |
| WEB-0011  | 2026-08-15 | M3–M8 实际状态与 Migration Gap 同步                                                                                                    | 文档      | L11/L16/DIRECT/HALF/COPY            | 不适用                                                                 | 是       | Done |
| WEB-0012  | 2026-08-15 | L11 双向闭环                                                                                                                           | 新增/修复 | L11                                 | Vitest 113 pass + Chromium 390px 实测                                  | 是       | Done |
| WEB-0013  | 2026-08-15 | L16 / VOUT 双向闭环                                                                                                                    | 新增/修复 | L16                                 | Vitest 126 pass + typecheck + build                                    | 是       | Done |
| WEB-0014  | 2026-08-15 | M4.5 稳定化：饱和/clamp/Half 舍入/主题/persistence/CI/E2E/文档                                                                         | 修复/文档 | L11/L16/DIRECT/HALF/GLOBAL          | Vitest + coverage + Playwright + build（数量见 CI 日志）               | 是       | Done |
| WEB-0015  | 2026-08-15 | 命令元数据标准定义/预设分离；`command/set` 只读；`command/apply-preset`；FAN_COMMAND_1                                                 | 修复      | GLOBAL/命令字典                     | Vitest（reducer/metadata） + Playwright                                | 是       | Done |
| WEB-0016  | 2026-08-15 | 单人闭环流程文档（AGENTS/CONTRIBUTING/PR模板）与 README 事实修正                                                                       | 文档      | GLOBAL                              | format/typecheck/lint/build                                            | 是       | Done |
| WEB-0017  | 2026-08-15 | M5 DIRECT 闭环：raw 唯一事实来源、Y/Value/m/b/R UI、系数校验与 golden case                                                             | 新增/修复 | DIRECT                              | Vitest 181 pass + coverage + Playwright 32 pass + build                | 是       | Done |
| WEB-0018  | 2026-08-15 | M6 HALF 闭环：Value 输入、Sign/Exp/Mantissa 分区、golden cases、E2E                                                                    | 新增/修复 | HALF                                | Vitest 214 pass + coverage + Playwright 36 pass + build                | 是       | Done |
| WEB-0019  | 2026-08-15 | M7 Copy：raw word 与 LE/BE bytes 分离、C 宏命令名清洗、byte 复制按钮、clipboard 测试                                                   | 修复/新增 | GLOBAL/COPY                         | Vitest 226 pass + coverage + Playwright 40 pass + build                | 是       | Done |
| WEB-0020  | 2026-08-15 | M8 回归：L16/PEC golden cases、CommandPicker 键盘导航/ARIA/Escape、分层覆盖策略                                                        | 测试      | GLOBAL/L11/L16/DIRECT/HALF          | Vitest 240 pass + coverage + Playwright 44 pass + build                | 是       | Done |
| WEB-0021  | 2026-08-15 | M9 legacy 决策：`pmbus-calculator.html` 标记 read-only fallback，README 入口/状态明确                                                  | 文档      | GLOBAL/legacy                       | format/typecheck/lint/build + 全量回归                                 | 是       | Done |
| WEB-0022  | 2026-08-15 | M10 hardening：PMBus 命令事务/数据宽度校准、严格 Hex 输入、DIRECT 错误隔离、持久化测试、响应式 viewport loop、CI 门禁统一              | 修复/测试 | GLOBAL/L11/L16/DIRECT/HALF/命令字典 | Vitest 283 pass + coverage 95.89% + Playwright 68 pass + build + audit | 是       | Done |
| WEB-0023  | 2026-08-15 | M10.1 correctness：CommandPicker 焦点回归 + editable combobox、READ_EIN 规范冲突模型、L16 十进制严格解析、完整 PR diff whitespace gate | 修复/测试 | GLOBAL/命令字典/L16                 | Vitest 291 pass + coverage 96.02% + Playwright 72 pass + build + audit | 是       | Done |

## 2. Legacy parity

| 旧功能          | 旧位置                            | 新组件/模块                  | 状态   | 备注                                                                                                    |
| --------------- | --------------------------------- | ---------------------------- | ------ | ------------------------------------------------------------------------------------------------------- |
| PMBusMath 核心  | 内联 `PMBusMath`                  | `legacy/pmbus-math.ts`       | Done   | 机械迁移；L11 饱和与 Half 舍入已修正并有测试                                                            |
| 命令字典数据    | 内联 `COMMAND_METADATA`           | `legacy/command-metadata.ts` | Done   | 标准定义与 project-demo 预设分离（见 ADR 0002）；`command/set` 只读；`command/apply-preset` 显式应用    |
| 模式 Tabs       | `.tabs` + `switchMode`            | `ModeSwitcher`               | Done   | 支持 Ctrl+1/2/3/4                                                                                       |
| 命令选择器      | `#commandSelect`                  | `CommandPicker`              | Done   | 选中命令只显示信息；显式“应用 project-demo 预设”可加载参数；键盘导航/Escape/焦点恢复/ARIA 已覆盖        |
| Bit Grid        | `renderBits` / `renderDirectBits` | `BitGrid`                    | Done   | 图例按模式切换；L11 分区 N/Y、HALF 分区 Sign/Exp/Mantissa；L16/DIRECT 显示 16-bit 单值区域              |
| 结果面板        | `#resultBox`                      | `ResultInspector`            | Done   | 展示 value/raw/LE/BE/误差/复制                                                                          |
| 信息栏          | `#infoBar`                        | `InfoPanel`                  | Done   | 三级提示                                                                                                |
| 公式界面        | `.formula-mode` DOM               | `ModeWorkspace` 内联公式区   | Done   | L11/L16/DIRECT/HALF 双向；独立 FormulaEditor 仅作可选 backlog，不作为功能缺陷                           |
| DebugPanel      | `#debugPanel`                     | `DebugDrawer`                | Done   | 不再宣称 CI 测试状态；边界测试由 Vitest golden cases 覆盖，无需 UI 入口                                 |
| 主题切换        | `#themeToggle` + `.dark`          | `ThemeToggle`, `data-theme`  | Done   | 由 `state.ui.theme` 驱动，经 `persistence.ts` 持久化                                                    |
| 复制工具        | 复制按钮 + 全局状态               | `CopyToolbar`                | Done   | raw word 与 LE/BE bytes 分离；C 宏默认 raw word + 命令名清洗；clipboard fallback 单测覆盖               |
| DIRECT profiles | inline buttons                    | `DirectCoeffPanel`           | 不实现 | 明确决策：缺少真实器件数据手册，禁止内置 `device-datasheet` 预设；UI 保持手动系数输入并提示需要数据手册 |
| Boundary tests  | `runBoundaryTests`                | Vitest + `DebugDrawer`       | Done   | L11/L16/DIRECT/HALF/PEC golden 全覆盖；E2E 全通过（数量见 CI 日志）                                     |

## 3. 手动质量检查矩阵

| 里程碑    | 1440px | 1024px | 768px  | 430px  | 390px  | 深色模式 | L11              | L16                | DIRECT           | HALF                   |
| --------- | ------ | ------ | ------ | ------ | ------ | -------- | ---------------- | ------------------ | ---------------- | ---------------------- |
| M2 布局   | 已完成 | 已完成 | 已完成 | 已完成 | 已完成 | 已完成   | 不适用           | 不适用             | 不适用           | 不适用                 |
| M3 L11    | 已完成 | 已完成 | 已完成 | 已完成 | 已完成 | 已完成   | 已完成（含饱和） | 不适用             | 不适用           | 不适用                 |
| M4 L16    | 已完成 | 已完成 | 已完成 | 已完成 | 已完成 | 已完成   | 已完成           | 已完成（含 clamp） | 不适用           | 不适用                 |
| M4.5 门禁 | 已完成 | 已完成 | 已完成 | 已完成 | 已完成 | 已完成   | 已完成           | 已完成             | 命令应用不适用   | 命令应用不适用         |
| M5 DIRECT | 已完成 | 已完成 | 已完成 | 已完成 | 已完成 | 已完成   | 不适用           | 不适用             | 已完成（含校验） | 不适用                 |
| M6 HALF   | 已完成 | 已完成 | 已完成 | 已完成 | 已完成 | 已完成   | 不适用           | 不适用             | 不适用           | 已完成（含±0/NaN/Inf） |
| M9 legacy | 已完成 | 已完成 | 已完成 | 已完成 | 已完成 | 已完成   | 已完成           | 已完成             | 已完成           | 已完成                 |
