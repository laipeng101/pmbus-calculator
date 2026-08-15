# CLAUDE.md

请先阅读并严格遵守 [`AGENTS.md`](./AGENTS.md)。

当前项目阶段：**PMBus Calculator Web-first 重构**。  
当前 99% 重心：**Web 设计、组件化、响应式布局、主题系统**。

Claude Code 工作时必须：

1. 先读 `AGENTS.md`
2. 再读 `docs/WEB_REFACTOR_PLAN.md`
3. 不要优先引入 Tauri / Electron / 后端 / 硬件通信
4. 不要无测试改 PMBus 数学算法
5. 不要删除 legacy 功能而不更新 Migration Gap
6. 每次变更后说明：
   - changed files
   - affected modes
   - tests run
   - docs updated
   - remaining gaps

默认执行路线：

```text
docs ✅ → Vite React TS skeleton ✅ → design tokens ✅ → AppShell ✅ → ModeSwitcher ✅ → CommandPicker ✅ → ResultInspector ✅ → PMBusMath legacy adapter ✅ → L11 loop ✅ → L16 loop（当前）→ DIRECT loop → HALF loop → copy tools → tests migration → legacy cleanup
```

已完成的基础项不要再重复执行；当前应直接进入 **L16 full loop**。  
实际实现进度基线以 `docs/WEB_REFACTOR_PLAN.md` 各 Milestone 的「实际状态」小节与 `MIGRATION_LOG.md` 的迁移缺口表为准。
