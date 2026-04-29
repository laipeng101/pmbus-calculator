# 迁移日志

> 建议路径：`docs/MIGRATION_LOG.md`  
> 用途：记录 Web 重构期间每一次可追踪的代码同步更新。

---

## 变更记录

| 变更编号 | 日期 | 涉及文件 | 类型 | 影响模式 | 测试 | 文档已更新 | 状态 |
|---|---|---|---|---|---|---|---|
| WEB-0000 | 2026-04-29 | docs/WEB_REFACTOR_PLAN.md, AGENTS.md, CLAUDE.md | 文档 | 全局 | 不适用 | 是 | 已提议 |

---

## 迁移缺口

| 旧功能 | 旧代码位置 | 新组件 / 模块 | 状态 | 备注 |
|---|---|---|---|---|
| 模式标签页 | `.tabs`, `switchMode()` | `ModeSwitcher` | 待办 | 移除内联 onclick |
| 命令选择器 | `#commandSelect`, `COMMAND_METADATA` | `CommandPicker` + 元数据模块 | 待办 | 升级为可搜索组合框 |
| PMBus 数学运算 | 内联脚本 `PMBusMath` | `legacy/pmbus-math.ts`, 后续 `packages/core` | 待办 | 初期不重写算法 |
| 结果框 | `#resultBox` | `ResultInspector` | 待办 | 桌面端右侧面板，移动端抽屉 |
| 信息栏 | `#infoBar` | `InfoPanel` | 待办 | 确保显式样式 |
| 位图网格 | `renderBits`, `renderDirectBits` | `BitGrid`, `NibbleGroup`, `BitCell` | 待办 | 保留半字节分组 |
| 公式界面 | `.formula-mode` DOM | `FormulaEditor` | 待办 | 替换 display none 逻辑 |
| 主题切换 | `#themeToggle`, `.dark` | `ThemeToggle`, `data-theme` | 待办 | 移除重复深色令牌 |
| 复制工具 | 复制按钮 + 全局状态 | `CopyToolbar` + 持久化 | 待办 | 保留 0x/空格/字节序 |
| 调试测试 | `runBoundaryTests` | Vitest + `DebugDrawer` | 待办 | 测试存在前勿删除 |

---

## 手动质量检查矩阵

| 里程碑 | 1440px | 1024px | 768px | 430px | 390px | 深色模式 | L11 | L16 | DIRECT | HALF |
|---|---|---|---|---|---|---|---|---|---|---|
| M1 骨架 | 不适用 | 不适用 | 不适用 | 不适用 | 不适用 | 不适用 | 不适用 | 不适用 | 不适用 | 不适用 |
| M2 布局 | 待办 | 待办 | 待办 | 待办 | 待办 | 待办 | 不适用 | 不适用 | 不适用 | 不适用 |
| M3 L11 | 待办 | 待办 | 待办 | 待办 | 待办 | 待办 | 待办 | 不适用 | 不适用 | 不适用 |
| M4 L16 | 待办 | 待办 | 待办 | 待办 | 待办 | 待办 | 完成? | 待办 | 不适用 | 不适用 |
| M5 DIRECT | 待办 | 待办 | 待办 | 待办 | 待办 | 待办 | 完成? | 完成? | 待办 | 不适用 |
| M6 HALF | 待办 | 待办 | 待办 | 待办 | 待办 | 待办 | 完成? | 完成? | 完成? | 待办 |

---

## 备注

- 本文件必须随代码迁移同步更新。
- 不允许功能迁移已完成但迁移缺口仍为"待办"。
- 不允许删除旧功能但未在变更记录中记录。
