# 迁移日志

> 建议路径：`docs/MIGRATION_LOG.md`  
> 用途：记录 Web 重构期间每一次可追踪的代码同步更新。

---

## 变更记录

| 变更编号 | 日期 | 涉及文件 | 类型 | 影响模式 | 测试 | 文档已更新 | 状态 |
|---|---|---|---|---|---|---|---|
| WEB-0000 | 2026-04-29 | docs/WEB_REFACTOR_PLAN.md, AGENTS.md, CLAUDE.md | 文档 | 全局 | 不适用 | 是 | 已提议 |
| WEB-0001 | 2026-04-30 | package.json, vite.config.ts, tsconfig*.json, index.html, .gitignore, .prettierrc, eslint.config.js | 配置 | 全局 | build / lint | 是 | 已完成 |
| WEB-0002 | 2026-04-30 | src/main.tsx, src/App.tsx, src/styles/tokens.css | 新增 | 全局 / THEME | build | 是 | 已完成 |
| WEB-0003 | 2026-04-30 | src/legacy/pmbus-math.ts, src/legacy/command-metadata.ts, src/legacy/legacy-adapter.ts | 迁移 | L11/L16/DIRECT/HALF | Vitest smoke 13 pass | 是 | 已完成 |
| WEB-0004 | 2026-04-30 | src/app/state.ts, src/app/actions.ts, src/app/reducer.ts, src/app/view-model.ts | 新增 | 全局 | typecheck / lint | 是 | 已完成 |
| WEB-0005 | 2026-04-30 | App.tsx, AppHeader, WorkspaceLayout, ModeSwitcher, ModeWorkspace, CommandPicker, ResultInspector, InfoPanel, CopyToolbar, BitGrid, ThemeToggle | 新增 | GLOBAL / LAYOUT / THEME | Playwright 1440px+390px | 是 | 已完成 |

---

## 迁移缺口

| 旧功能 | 旧代码位置 | 新组件 / 模块 | 状态 | 备注 |
|---|---|---|---|---|
| 模式标签页 | `.tabs`, `switchMode()` | `ModeSwitcher` | 已完成 | React 组件化，无 inline onclick；支持 Ctrl+1/2/3/4 快捷键 |
| 命令选择器 | `#commandSelect`, `COMMAND_METADATA` | `CommandPicker` + 元数据模块 | 已完成 | 可搜索下拉框；数据来自 `command-metadata.ts` |
| PMBus 数学运算 | 内联脚本 `PMBusMath` | `legacy/pmbus-math.ts`, 后续 `packages/core` | 已完成 | 机械迁移完成，带类型定义和 smoke test (13 pass) |
| 结果框 | `#resultBox` | `ResultInspector` | 已完成 | 桌面端右侧 sticky 面板，移动端跟随流式布局 |
| 信息栏 | `#infoBar` | `InfoPanel` | 已完成 | 警告/信息/错误三级提示，带图标和颜色区分 |
| 位图网格 | `renderBits`, `renderDirectBits` | `BitGrid` | 已完成 | 保留 nibble 分组；桌面 4×1，移动 2×2 |
| 公式界面 | `.formula-mode` DOM | `ModeWorkspace` 内联公式区 | 进行中 | L11/L16/DIRECT/HALF 参数区静态版已建；双向编辑待接入 |
| 主题切换 | `#themeToggle`, `.dark` | `ThemeToggle`, `data-theme` | 已完成 | `tokens.css` token 体系 + `ThemeToggle` 组件；支持 light/dark/system |
| 复制工具 | 复制按钮 + 全局状态 | `CopyToolbar` | 已完成 | Hex / 值 / C 宏复制按钮；clipboard API + 视觉反馈 |
| 调试测试 | `runBoundaryTests` | Vitest + `DebugDrawer` | 进行中 | Vitest 框架已接入；`pmbus-math.test.ts` smoke test 通过；UI 入口待建 |

---

## 手动质量检查矩阵

| 里程碑 | 1440px | 1024px | 768px | 430px | 390px | 深色模式 | L11 | L16 | DIRECT | HALF |
|---|---|---|---|---|---|---|---|---|---|---|
| M1 骨架 | 不适用 | 不适用 | 不适用 | 不适用 | 不适用 | 不适用 | 不适用 | 不适用 | 不适用 | 不适用 |
| M2 布局 | 已完成 | 已完成 | 已完成 | 已完成 | 已完成 | 已完成 | 不适用 | 不适用 | 不适用 | 不适用 |
| M3 L11 | 待办 | 待办 | 待办 | 待办 | 待办 | 待办 | 待办 | 不适用 | 不适用 | 不适用 |
| M4 L16 | 待办 | 待办 | 待办 | 待办 | 待办 | 待办 | 完成? | 待办 | 不适用 | 不适用 |
| M5 DIRECT | 待办 | 待办 | 待办 | 待办 | 待办 | 待办 | 完成? | 完成? | 待办 | 不适用 |
| M6 HALF | 待办 | 待办 | 待办 | 待办 | 待办 | 待办 | 完成? | 完成? | 完成? | 待办 |

---

## 备注

- 本文件必须随代码迁移同步更新。
- 不允许功能迁移已完成但迁移缺口仍为"待办"。
- 不允许删除旧功能但未在变更记录中记录。
