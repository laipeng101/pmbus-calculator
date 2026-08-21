# Contributing

本仓库为单人维护模式。Agent 可以在 CI 全绿后自审合并；人工评审只适用于外部贡献者，不是当前合并的阻塞条件。

## 1. 开始之前

1. 阅读 [`AGENTS.md`](AGENTS.md)（强制规则）。
2. 阅读 [`docs/REPOSITORY_HYGIENE.md`](docs/REPOSITORY_HYGIENE.md)（仓库卫生与制品政策）。
3. 阅读 [`docs/DOMAIN_MODEL.md`](docs/DOMAIN_MODEL.md) 中与本次变更相关的规则。
4. 阅读 [`docs/ROADMAP.md`](docs/ROADMAP.md) 确认当前里程碑状态，避免重复或越界。
5. 器件数据不明确时不得猜测：保持禁用/留空，并在 UI 与文档中注明“需要器件数据手册”。
   只有仓库内规范与官方规范存在无法保守处理的直接冲突时才停止。

## 2. 分支与 PR

- 所有开发分支必须从最新 `origin/main` 创建：`git fetch origin --prune && git switch -c agent/<scope> origin/main`。
- PR base 固定为 `main`；禁止以 `web-refactor` 或任何旧 `agent/*` 分支作为长期开发线。
- 每个 PR 只实现一个可验证的垂直切片。
- 当前为单人维护：同一 Agent 可以完成本地检查、创建 PR、等待 CI、自审与普通 merge commit 合并的闭环；不为每个小任务机械创建 Issue。
- 不启用强制分支保护；不等待人工确认。

单人无人值守闭环：

```text
latest main → one scoped branch → local verify → PR → CI green
→ self-review → normal merge commit → main CI green
→ delete branch → sync main
```

所有推送新提交都会使此前验收失效，必须等待最新 head 的 CI。

里程碑闭环采用单 PR（M18 起）：`docs/ROADMAP.md` 以 main 上的版本为正式事实来源；
实现分支在最终提交中一并把对应里程碑翻为 `Done`（含完成日期），最终 PR head CI
全绿并 merge 后，Done 才在 main 正式生效。不再创建第二个纯文档 PR 只为补写
Review → Done、CI URL 或 SHA；merge SHA 与 main CI 结论写入最终任务报告。
main CI 真实失败时诊断并创建实际修复 PR，不能用 bookkeeping PR 掩盖失败。

## 3. Fresh environment 初始化

```bash
npm ci
npm run test:e2e:install
```

CI 可继续使用 `npx playwright install --with-deps chromium`。

## 4. 本地验证

Fresh environment 先执行 `npm ci` 与 `npm run test:e2e:install`。核心门禁与 CI 保持一致，可直接使用：

```bash
npm run verify
```

`npm run verify` 依次执行：

```bash
npm run format:check
npm run typecheck
npm run lint
npm run check:markdown-math
npm run specs:check
npm run test:coverage
npm run test:e2e
npm run build
npm run test:e2e:release
npm run check:repo-hygiene
git diff --check
git diff --cached --check
npm audit --audit-level=high
```

提交前建议先执行：

```bash
npm run clean
npm run check:repo-hygiene
git status --short
```

`npm run verify:light`（format:check、check:markdown-math、check:repo-hygiene 与两个
whitespace 检查）只用于 `scripts/classify-ci-scope.mjs` 判定为 pure light-only 的任务；
mixed/unknown 或产品相关变更必须完整 `npm run verify`。无参数调用 `npm run ci:classify`
返回用法错误并 exit 2，不会悄悄得到 light。

第三方规范 PDF 不进入当前 Git tree：provenance、官方链接和哈希维护在
`document/specifications.json`，PDF 按需下载到 ignored `.cache/specifications/`；
CI 只执行 `npm run specs:check`，不依赖也不发起规范 PDF 下载。DSH 会话、
缓存和 PDF 均不得提交；历史 tag/commit 不重写。

详细安全边界见 [`docs/REPOSITORY_HYGIENE.md`](docs/REPOSITORY_HYGIENE.md)。
Shell 超时、后台等待、日志与退出码 guardrails 见 [`AGENTS.md`](AGENTS.md) 第 9 节；本文件只同步实际命令，不复制整套规则。

whitespace 检查口径：

- `git diff --check`：未暂存工作区；
- `git diff --cached --check`：暂存区；
- PR 本地全量检查：`git diff --check origin/main...HEAD`；
- PR CI：完整 PR base→head；
- push CI：完整 event.before→github.sha；
- 不得再把 `git show --check` 描述成普通 merge commit 的完整变更检查。

所有命令都必须以 exit code 0 正常结束，并记录在验收记录中。
`npm run check` 只用于快速检查（format/typecheck/lint/test:run/build），不包含 coverage、E2E 与 audit，不得宣称它覆盖这些门禁。

## 5. 验收记录

每个 PR 描述必须包含可验证事实：

- 每条质量命令与 exit code；
- 单元测试实际数量与 coverage；
- E2E 实际数量；
- CI URL、head SHA 与 conclusion。

PR 统计必须来自 final committed HEAD，并通过 `npm run check:repo-hygiene` 与 `git ls-tree -r -l HEAD` 交叉验证；每次新增修复提交后必须重新采集。详细证据规则见 [`docs/REPOSITORY_HYGIENE.md`](docs/REPOSITORY_HYGIENE.md) 第 8 节。

## 6. 提交信息

```text
type(scope): summary
```

类型：`feat`、`fix`、`docs`、`chore`、`test`、`refactor`。
示例：`fix(L11): saturate out-of-range values instead of encoding 0x0000`。

## 7. PR 流程

1. 填写 PR 模板中的验收清单。
2. 确保 CI 全绿。CI 由 `scripts/classify-ci-scope.mjs` 分级（fail closed）：纯 light-only
   变更执行轻量门禁与完整 whitespace gate，跳过的门禁在 PR 中如实标 `policy-skipped`；
   full/mixed/unknown 变更执行完整 format、typecheck、lint、coverage、E2E、build、
   whitespace gate 与 audit。所有推送新提交都会使此前验收失效，必须等待最新 head 的 CI。
3. PR 描述中写明：changed files、affected modes、测试命令与结果、剩余缺口。
4. CI 全绿后使用普通 merge commit 合入，不使用 squash。

## 8. 文档同步

- 里程碑状态只更新 `docs/ROADMAP.md`。
- legacy parity 只更新 `docs/MIGRATION_MATRIX.md`。
- 架构/原则变更更新 `docs/adr/` 与 `docs/DOMAIN_MODEL.md`。
- 不要在 README、AGENTS、计划文档中重复维护进度表。
