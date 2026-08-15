# CLAUDE.md

请先阅读并严格遵守 [`AGENTS.md`](./AGENTS.md)。

当前项目阶段：以 [`docs/ROADMAP.md`](./docs/ROADMAP.md) 为唯一实时状态源。  
当前重心：**Web-first 计算器的标准合规、输入正确性、测试与 CI 门禁一致性**。

Claude Code 工作时必须：

1. 先读 `AGENTS.md`
2. 再读 `docs/ROADMAP.md`、`docs/DOMAIN_MODEL.md`、`docs/MIGRATION_MATRIX.md`
3. 不要优先引入 Tauri / Electron / 后端 / 硬件通信
4. 不要无测试改 PMBus 数学算法
5. 不要删除 legacy 功能而不更新 Migration Gap
6. 每次变更后说明：
   - changed files
   - affected modes
   - tests run
   - docs updated
   - remaining gaps

历史执行路线（已 M0–M9 完成，保留为 architecture context，实时状态以 [`docs/ROADMAP.md`](./docs/ROADMAP.md) 为准）：

```text
docs ✅ → Vite React TS skeleton ✅ → design tokens ✅ → AppShell ✅ → ModeSwitcher ✅
→ CommandPicker ✅ → ResultInspector ✅ → PMBusMath legacy adapter ✅
→ L11 loop ✅ → L16 loop ✅ → M4.5 稳定化门禁 ✅ → DIRECT loop ✅ → HALF loop ✅
→ copy tools ✅ → tests migration ✅ → legacy cleanup ✅
```

需要时：

- 独立 FormulaEditor 仅作为可选 backlog，不作为当前功能缺陷。
- DIRECT 内置 `device-datasheet` profiles 因缺少器件数据手册而不实现，这是明确决策；UI 保持手动系数输入并提示需要器件数据手册。
- 未自动化覆盖的 viewport 不得在文档中宣称为已自动测试。
