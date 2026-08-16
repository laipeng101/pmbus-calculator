# AGENTS.md

> 所有编程 Agent（Claude / Copilot / Cursor / Codex）在本仓库工作前必须阅读并遵守本文件。
> 稳定规则只放在这里；里程碑状态看 `docs/ROADMAP.md`；legacy parity 看 `docs/MIGRATION_MATRIX.md`；
> 格式/舍入/字节序/命令 profile 规则看 `docs/DOMAIN_MODEL.md`；开发流程看 `CONTRIBUTING.md`；仓库卫生与制品政策看 `docs/REPOSITORY_HYGIENE.md`。

## 0. Context Loading Policy

- **Always**：`AGENTS.md`、当前 `docs/ROADMAP.md`、`docs/REPOSITORY_HYGIENE.md`
- **Conditional**：
  - 数学/格式/命令元数据任务才读 `DOMAIN_MODEL.md`
  - UI/公式/交互动效任务才读 `docs/UI_CONVENTIONS.md`，且视觉验收必须包含关键 viewport 截图与逐图检查
  - Git/PR/CI 流程任务才读 `CONTRIBUTING.md`
  - 发布任务才读 `docs/RELEASING.md`
  - legacy/parity 任务才读 `MIGRATION_MATRIX.md`
  - 决策相关任务只读相关 ADR
  - 规范核查只打开所需 PDF 与具体章节
- **Historical**：`docs/archive/**` 默认不读、不搜索；只有明确历史调查理由时才加载
- 使用 `rg` 做普通代码搜索时，默认添加：

```bash
rg ... -g '!docs/archive/**'
```

## 1. 项目主线

```text
把单文件 PMBus Calculator 重构为可维护的现代 Web App。
主线：Web-first。当前里程碑状态一律以 docs/ROADMAP.md 为准，不在本文件重复。
```

不追求（除非用户明确要求进入对应阶段）：

```text
Tauri / Electron / 移动原生 / 硬件通信 / 后端 / 复杂状态库 / 算法重写 / monorepo
```

## 2. 绝对禁止

1. 禁止推倒重写旧实现。必须：先迁移 → 再替换 → 再验证 → 最后删除。
2. 禁止无测试修改以下函数：`decodeLinear11`、`encodeLinear11`、`findBestLinear11`、
   `decodeLinear16`、`encodeLinear16`、`decodeDirect`、`encodeDirect`、`decodeHalf`、
   `encodeHalf`、`parseVoutMode`、`calculatePEC`。
3. 禁止在 JSX 中硬编码命令字典、模式配置、profile、单位；必须来自统一数据层。
4. 禁止新增 inline `onclick` / inline `style`（极少数动态 style 可接受，必须有明确理由）。
5. 禁止在组件中直接写 `localStorage`；必须集中在 `src/app/persistence.ts`。
6. 禁止让 UI 在运行时宣称 CI 测试状态（例如“51/51 通过”）。

## 3. 技术栈与目录

```text
Vite + React 19 + TypeScript + Tailwind CSS + CSS variables + Vitest + Playwright
```

目录约定：

```text
src/app/          state / actions / reducer / view-model / persistence
src/legacy/       pmbus-math.ts、command-metadata.ts（迁移资产）
src/components/   组件只做展示与交互，不写算法
tests/e2e/        Playwright 真实用户流程
```

## 4. 状态与组件规则

- 状态入口：`src/app/state.ts` 的 `AppState`；使用 `useReducer`。
- Action 命名使用命名空间：`mode/set`、`command/set`、`command/apply-preset`、
  `raw/set-from-hex`、`bit/toggle`、`value/set`、`l11/set-n`、`l11/set-y`、
  `l11/toggle-auto-n`、`l16/set-vout-mode`、`direct/set-y`、`direct/set-coeff`、
  `copy/toggle-prefix`、`copy/toggle-space`、`copy/set-endian`、`ui/set-theme`。
- UI 统一使用 `toCalculatorViewModel(state)`；格式化结果不要在 JSX 中重复计算。
- 组件只能：接收 props、显示 viewModel、dispatch(action)、维护局部 UI 状态（如 popover open）。
- 主题由 `state.ui.theme` 驱动；`App.tsx` 负责把主题写到 `document.documentElement.dataset.theme`。
- 偏好持久化只允许通过 `src/app/persistence.ts`。

## 5. 命令字典与领域模型

- 命令字典唯一数据源：`src/legacy/command-metadata.ts`。
- 标准命令定义包含：命令码、`transactions`（可同时表达 write/read）、`valueType`、`units`、`spec`、`encodingRule`。
- `encodingRule` 只能是：`follows_vout_mode`、`device_defined`、`status`、`block`。
- 可选 `preset` 不随 `command/set` 自动应用；只有 `command/apply-preset` 才能切换模式、
  加载参数并重编码 raw。预设必须标 `sourceKind`（当前仅 `project-demo`）、`source`、
  `appliesTo`、`direction`。没有真实器件数据手册就禁止内置 `device-datasheet` 预设。

## 6. 测试规则

- 算法测试至少覆盖 L11 / L16 / DIRECT / HALF / PEC。
- UI E2E 至少覆盖：模式切换、Hex 输入、Value 输入、bit toggle、命令选择、复制、主题、移动端布局。
- 修改算法必须同时补 golden case。
- `npm run test:coverage` 必须达到 `vite.config.ts` 中声明的阈值。
- 分层覆盖策略：`src/app` 与 `src/legacy` 由 Vitest + v8 coverage 覆盖；
  `src/components` 为薄展示/交互层，由 Playwright E2E 覆盖，不纳入 v8 coverage 阈值。

## 7. 每次任务执行流程

1. 读取任务要求、本文件、`docs/ROADMAP.md` 当前状态、`docs/REPOSITORY_HYGIENE.md`；按 Context Loading Policy 条件加载其他文档。
2. 在任务开头明确：Goal、Out of scope、影响模式、规范来源、验收向量。
3. 确认工作区干净；fresh environment 先执行 `npm ci` 与 `npm run test:e2e:install`。
4. 只实现一个可验证的垂直切片，不夹带无关改动。
5. 完成后必须运行：

   ```bash
   npm run verify
   ```

   `npm run verify` 展开为：`format:check`、`typecheck`、`lint`、`check:markdown-math`、`test:coverage`、
   `test:e2e`、`build`、`test:e2e:release`、`check:repo-hygiene`、`git diff --check`（未暂存工作区）、
   `git diff --cached --check`（暂存区）、`npm audit --audit-level=high`。
   CI 的 whitespace gate 还额外检查：PR 为完整 base→head；push 为完整 event.before→github.sha。
   任务结束前还需执行 `docs/REPOSITORY_HYGIENE.md` 中「Agent 生命周期清理 → 任务结束」的简短门禁。

6. 输出：changed files、affected modes、实际测试命令与结果、剩余缺口。
   验收记录必须包含每条命令、exit code、实际测试数、coverage 和 CI URL。
7. 只有验收条件通过，才能把里程碑从 Review 改为 Done。
8. 器件数据不明确时不得猜测：保持禁用/留空，并在 UI 与文档中注明“需要器件数据手册”。
   只有仓库内规范与官方规范存在无法保守处理的直接冲突时才停止。

## 8. 文档更新规则

- 文档更新继续遵循条件加载；普通代码变更不再要求每次检查全部 `docs/ROADMAP.md`、`docs/MIGRATION_MATRIX.md`、`README.md`，只需在变更实际影响对应文档时更新。
- 发布任务才读取 `docs/RELEASING.md`，并按其规则更新 `CHANGELOG.md` 与 `docs/releases/`。
- 不要在多份文档中重复维护同一份进度表。
- 不再维护手工 WEB-xxxx 变更记录；PR、commit 和 CI 是变更审计来源。

## 9. Pull Request 检查清单

- [ ] 已读 AGENTS.md 与相关 DOMAIN_MODEL 规则
- [ ] 符合 Web-first 主线，未引入 Tauri/Electron/后端/硬件通信
- [ ] 未无测试修改 PMBus 算法
- [ ] 未删除旧功能而不记录 Migration Gap
- [ ] 未新增 inline onclick / 散落 localStorage / 硬编码命令字典
- [ ] 已运行格式、lint、typecheck、单测+coverage、E2E、build
- [ ] 公式变更已确认单一数据源（`formulaText` 与 `formulaLatex` 来自同一层）
- [ ] 已检查键盘焦点（focus-visible）、移动端布局与 `prefers-reduced-motion`
- [ ] UI 任务已生成关键 viewport 截图；dropdown/popover 已测试 viewport 边界与不跳动；无图像读取能力时用几何/对比度/overflow/computed-style 断言代替目检
- [ ] Markdown 数学变更已通过本地检查，并已用 GitHub 实际渲染页面验证
- [ ] 发布前已确认 `github-pages` environment 允许对应稳定 tag（branch/tag policy）
- [ ] 文档已更新，进度表与代码一致
