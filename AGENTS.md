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
  - 规范核查任务先读 `document/specifications.json`，只按需 `npm run specs:fetch -- --id <id>` 对应文档，下载进 ignored `.cache/specifications/`，并只打开所需章节；不提交 PDF
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

## 2. 规范来源与分发边界

- 当前领域基线是 PMBus 1.3 / SMBus 3.0；不把 PMBus 1.5 当成当前领域基线。
- 第三方规范 PDF 不进入当前 Git tree。来源、字节数和 SHA-256 只在
  `document/specifications.json` 维护，PDF 由开发者按需下载到 ignored
  `.cache/specifications/`。
- 规范核查任务先读 manifest，只 fetch 实际需要的文档，只打开所需章节，不提交 PDF。
- 官方来源与仓库规则直接冲突且无法保守处理时才停止。

## 3. 绝对禁止

1. 禁止推倒重写旧实现。必须：先迁移 → 再替换 → 再验证 → 最后删除。
2. 禁止无测试修改以下函数：`decodeLinear11`、`encodeLinear11`、`findBestLinear11`、
   `decodeLinear16`、`encodeLinear16`、`decodeDirect`、`encodeDirect`、`decodeHalf`、
   `encodeHalf`、`parseVoutMode`、`calculatePEC`。
3. 禁止在 JSX 中硬编码命令字典、模式配置、profile、单位；必须来自统一数据层。
4. 禁止新增 inline `onclick` / inline `style`（极少数动态 style 可接受，必须有明确理由）。
5. 禁止在组件中直接写 `localStorage`；必须集中在 `src/app/persistence.ts`。
6. 禁止让 UI 在运行时宣称 CI 测试状态（例如“51/51 通过”）。

## 4. 技术栈与目录

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

## 5. 状态与组件规则

- 状态入口：`src/app/state.ts` 的 `AppState`；使用 `useReducer`。
- Action 命名使用命名空间：`mode/set`、`command/set`、`command/apply-preset`、
  `raw/set-from-hex`、`bit/toggle`、`value/set`、`l11/set-n`、`l11/set-y`、
  `l11/toggle-auto-n`、`l16/set-vout-mode`、`direct/set-y`、`direct/set-coeff`、
  `copy/toggle-prefix`、`copy/toggle-space`、`copy/set-endian`、`ui/set-theme`。
- UI 统一使用 `toCalculatorViewModel(state)`；格式化结果不要在 JSX 中重复计算。
- 组件只能：接收 props、显示 viewModel、dispatch(action)、维护局部 UI 状态（如 popover open）。
- 主题由 `state.ui.theme` 驱动；`App.tsx` 负责把主题写到 `document.documentElement.dataset.theme`。
- 偏好持久化只允许通过 `src/app/persistence.ts`。

## 6. 命令字典与领域模型

- 命令字典唯一数据源：`src/legacy/command-metadata.ts`。
- 标准命令定义包含：命令码、`transactions`（可同时表达 write/read）、`valueType`、`units`、`spec`、`encodingRule`。
- `encodingRule` 只能是：`follows_vout_mode`、`device_defined`、`status`、`block`。
- 可选 `preset` 不随 `command/set` 自动应用；只有 `command/apply-preset` 才能切换模式、
  加载参数并重编码 raw。预设必须标 `sourceKind`（当前仅 `project-demo`）、`source`、
  `appliesTo`、`direction`。没有真实器件数据手册就禁止内置 `device-datasheet` 预设。

## 7. 测试规则

- 算法测试至少覆盖 L11 / L16 / DIRECT / HALF / PEC。
- UI E2E 至少覆盖：模式切换、Hex 输入、Value 输入、bit toggle、命令选择、复制、主题、移动端布局。
- 修改算法必须同时补 golden case。
- `npm run test:coverage` 必须达到 `vite.config.ts` 中声明的阈值。
- 分层覆盖策略：`src/app` 与 `src/legacy` 由 Vitest + v8 coverage 覆盖；
  `src/components` 为薄展示/交互层，由 Playwright E2E 覆盖，不纳入 v8 coverage 阈值。

## 8. 每次任务执行流程

1. 读取任务要求、本文件、`docs/ROADMAP.md` 当前状态、`docs/REPOSITORY_HYGIENE.md`；按 Context Loading Policy 条件加载其他文档。
2. 在任务开头明确：Goal、Out of scope、影响模式、规范来源、验收向量。
3. 确认工作区干净；fresh environment 先执行 `npm ci` 与 `npm run test:e2e:install`。
4. 只实现一个可验证的垂直切片，不夹带无关改动。
5. 完成后必须运行：

   ```bash
   npm run verify
   ```

   `npm run verify` 展开为：`format:check`、`typecheck`、`lint`、`check:markdown-math`、`specs:check`、
   `check:release-contract`、`check:toolchain`、`test:coverage`、`test:release-security`、`test:e2e`、`build`、
   `check:tailwind-scope`、`test:e2e:release`、`check:repo-hygiene`、`git diff --check`（未暂存工作区）、
   `git diff --cached --check`（暂存区）、`npm audit --audit-level=high`。
   CI 的 whitespace gate 检查完整 PR base→head 范围（M19-B 起 main 不再有 push CI）。
   CI 仅由目标为 main 的 PR 与手动 `workflow_dispatch` 触发，manual run 始终 full；
   按 `scripts/classify-ci-scope.mjs` 分级（fail closed）：纯 light-only 变更在 CI 中跳过
   coverage/E2E/build/audit，本地对应入口是 `npm run verify:light`；mixed/unknown 或
   产品相关变更必须完整 `npm run verify`。
   任务结束前还需执行 `docs/REPOSITORY_HYGIENE.md` 中「Agent 生命周期清理 → 任务结束」的简短门禁。

6. 输出：changed files、affected modes、实际测试命令与结果、剩余缺口。
   验收记录必须包含每条命令、exit code、实际测试数、coverage 和 CI URL。
7. 里程碑 Done 采用单 PR 闭环：`docs/ROADMAP.md` 只有 main 上的版本是正式事实来源；
   实现分支在最终提交中同时包含对应里程碑的 `Done` 状态与完成日期。本地验证通过、
   最终 PR head CI 全绿后才 merge；合入前分支中的 Done 只是未合入提案。main 由
   ruleset `protect-main` 严格保护：必须 PR、required `check`（GitHub Actions）、
   strict up-to-date、管理员无绕过、禁止 force push 与删除。merge 后拉取最新 main，
   比较 PR CI `Record checked revision` 步骤记录的 `checked_tree` 与最终 merge SHA 的
   `HEAD^{tree}`：完全相同即验证完成，不再执行第二次完整 CI；不一致属于真实阻塞，
   立即用 `workflow_dispatch` 对最终 main 执行 full CI 并定位原因。CI URL、SHA 与
   tree 属于 PR、Actions 与最终执行报告的审计证据，不写入 ROADMAP，也不为此创建
   第二个纯文档 PR。
8. 器件数据不明确时不得猜测：保持禁用/留空，并在 UI 与文档中注明“需要器件数据手册”。
   只有仓库内规范与官方规范存在无法保守处理的直接冲突时才停止。

## 9. Shell, timeout and long-running task guardrails

1. 每次 shell 调用显式指定工作目录（`cd <repo>` 开头），不得依赖 persistent shell 上一次的 cwd。
2. 一个 shell 调用只承担一个主要动作；不把文件写入、测试、网络请求和 CI 等待拼成超长命令。
3. 优先使用已加载的 editor/patch/write 工具修改文件。
4. 在 DSH persistent Bash 中，禁止用单个大 heredoc 写入超过约 3 KiB 的内容。
5. 如果只有 Bash 可用：
   - 将内容拆为不超过约 2 KiB 的块；
   - 每块后检查文件字节数/行数；
   - 完成后运行格式化、语法检查或目标测试；
   - 不使用同一超长 heredoc 原样重试。
6. 同一命令发生 timeout 后最多允许一次诊断，不得原样重试：
   - 先检查 `git status`、目标文件、临时文件、后台进程和 shell reset 状态；
   - 第二次必须改变工具、拆分粒度或执行策略。
7. 不通过调大全局 timeout 掩盖 heredoc、死锁或错误轮询。
8. 普通搜索、编辑、静态检查和目标测试使用短前台调用。
9. 长验证、构建、下载、CI/部署等待：
   - 工具暴露 `run_in_background`/job 能力时使用后台任务，并通过 `job_output`/`job_kill` 管理；
   - 没有后台能力时使用一个有明确 deadline、短于有效工具 timeout 的原生命令；
   - 禁止长时间 `for ... sleep ...` 前台轮询；
   - 禁止无上限 sleep 和无限重试。
10. 网络命令必须有 connect timeout、总 timeout 和有限重试；不得静默使用第三方镜像。
11. 大输出命令写入临时日志，只返回尾部摘要，但必须保留真实退出码：

    ```bash
    command >"$log" 2>&1
    rc=$?
    tail -80 "$log"
    exit "$rc"
    ```

12. 使用 pipeline 时启用 `set -o pipefail`；不得让 `tail`、`tee` 或 `echo` 的成功掩盖原命令失败。
13. `command; echo exit:$?` 只能用于观察，不得作为 Harness 成功状态的唯一依据。
14. 开发阶段优先运行目标测试；最后一次代码/配置修改完成后才运行完整 `npm run verify`。
15. 依赖没有变化时，不因 compact 或上下文恢复重复运行已经有效的长测试。
16. push 前完成本地最终验证；原则上一次 push 形成最终 PR head。
17. CI 必须按精确 head SHA 核对，不只按 branch 的“最新 run”猜测。
18. CI 失败必须先本地复现和定位，不盲目 rerun。
19. PR 描述应在 merge 前完成；除纠正事实错误外，不在 merge 后反复编辑 PR。
20. timeout 后的检查点至少记录：命令、有效 timeout、持续时间、是否 shell reset、工作区状态、策略变化。
21. heredoc 限制同样适用于 shell/Python/Node heredoc、测试源码、临时文件和 PR body；不得用 Python 脚本包裹大内容绕过限制。
22. 使用 editor/patch 工具时不需要人为拆碎正常的结构化修改；只有 Bash 写入才必须 chunk ≤ 约 2 KiB 并逐块检查。
23. 大日志必须以 `rc=$?` 捕获后 `exit "$rc"` 返回；`command; echo rc:$?; tail ...` 不能作为成功判定。
24. 最终报告不得在没有实测 chunk 大小的情况下宣称“完全符合 guardrails”。

## 10. 文档更新规则

- 文档更新继续遵循条件加载；普通代码变更不再要求每次检查全部 `docs/ROADMAP.md`、`docs/MIGRATION_MATRIX.md`、`README.md`，只需在变更实际影响对应文档时更新。
- 发布任务才读取 `docs/RELEASING.md`，并按其规则更新 `CHANGELOG.md` 与 `docs/releases/`。
- 不要在多份文档中重复维护同一份进度表。
- 不再维护手工 WEB-xxxx 变更记录；PR、commit 和 CI 是变更审计来源。

## 11. Pull Request 检查清单

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
- [ ] CI tier（light/full）已标注；policy-skipped 门禁如实说明，未虚构测试数
- [ ] 里程碑 Done 已在实现 PR 最终提交中翻转，未创建第二个 bookkeeping PR
- [ ] 文档已更新，进度表与代码一致
