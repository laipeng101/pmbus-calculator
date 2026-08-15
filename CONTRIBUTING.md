# Contributing

本仓库为单人维护模式。Agent 可以在 CI 全绿后自审合并；人工评审只适用于外部贡献者，不是当前合并的阻塞条件。

## 1. 开始之前

1. 阅读 [`AGENTS.md`](AGENTS.md)（强制规则）。
2. 阅读 [`docs/DOMAIN_MODEL.md`](docs/DOMAIN_MODEL.md) 中与本次变更相关的规则。
3. 阅读 [`docs/ROADMAP.md`](docs/ROADMAP.md) 确认当前里程碑状态，避免重复或越界。
4. 器件数据不明确时不得猜测：保持禁用/留空，并在 UI 与文档中注明“需要器件数据手册”。
   只有仓库内规范与官方规范存在无法保守处理的直接冲突时才停止。

## 2. 分支与 PR

- 新功能/修复从 `web-refactor`（或当前阶段分支）切分支；里程碑完成后通过 PR 合回主线。
- 每个 PR 只实现一个可验证的垂直切片。
- 当前为单人维护：Agent 自审 + 全绿 CI 即可合并；不为每个小任务机械创建 Issue。
- 不启用强制分支保护；不等待人工确认。

## 3. Fresh environment 初始化

```bash
npm ci
npx playwright install chromium
```

CI 可继续使用 `npx playwright install --with-deps chromium`。

## 4. 本地验证

```bash
npm run format:check
npm run typecheck
npm run lint
npm run test:coverage
npm run test:e2e
npm run build
git diff --check
```

所有命令都必须以 exit code 0 正常结束，并记录在验收记录中。

## 5. 验收记录

每个 PR 描述必须包含可验证事实：

- 每条质量命令与 exit code；
- 单元测试实际数量与 coverage；
- E2E 实际数量；
- CI URL 与 conclusion。

## 6. 提交信息

```text
type(scope): summary
```

类型：`feat`、`fix`、`docs`、`chore`、`test`、`refactor`。
示例：`fix(L11): saturate out-of-range values instead of encoding 0x0000`。

## 7. PR 流程

1. 填写 PR 模板中的验收清单。
2. 确保 CI 全绿（format、typecheck、lint、coverage、E2E、build）。
3. PR 描述中写明：changed files、affected modes、测试命令与结果、剩余缺口。
4. CI 全绿后使用普通 merge commit 合入，不使用 squash。

## 8. 文档同步

- 里程碑状态只更新 `docs/ROADMAP.md`。
- legacy parity 只更新 `docs/MIGRATION_MATRIX.md`。
- 架构/原则变更更新 `docs/adr/` 与 `docs/DOMAIN_MODEL.md`。
- 不要在 README、AGENTS、计划文档中重复维护进度表。
