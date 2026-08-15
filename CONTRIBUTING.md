# Contributing

## 1. 开始之前

1. 阅读 [`AGENTS.md`](AGENTS.md)（强制规则）。
2. 阅读 [`docs/DOMAIN_MODEL.md`](docs/DOMAIN_MODEL.md) 中与本次变更相关的规则。
3. 阅读 [`docs/ROADMAP.md`](docs/ROADMAP.md) 确认当前里程碑状态，避免重复或越界。
4. 有不清楚的规范/舍入/字节序/器件系数问题，先开 Issue 提问，不要猜测。

## 2. 分支与 Issue

- 新功能/修复从 `web-refactor` 切分支；里程碑完成后通过 PR 合回 `web-refactor`。
- 先开 Issue 描述 Goal / Out of scope / 影响模式 / 规范来源 / 验收向量。
- 每个 PR 只实现一个可验证的垂直切片。

## 3. 本地验证

```bash
npm ci
npm run format:check
npm run typecheck
npm run lint
npm run test:coverage
npm run test:e2e
npm run build
git diff --check
```

所有命令都通过后才提交 PR。

## 4. 提交信息

```text
type(scope): summary
```

类型：`feat`、`fix`、`docs`、`chore`、`test`、`refactor`。
示例：`fix(L11): saturate out-of-range values instead of encoding 0x0000`。

## 5. PR 流程

1. 填写 PR 模板中的验收清单。
2. 确保 CI 全绿（format、typecheck、lint、coverage、E2E、build）。
3. PR 描述中写明：changed files、affected modes、测试命令与结果、剩余缺口。
4. 只有通过验收条件，里程碑才能从 `Review` 改为 `Done`。
5. 合并前至少需要一次人工审查，所有对话解决。

## 6. 文档同步

- 里程碑状态只更新 `docs/ROADMAP.md`。
- legacy parity 只更新 `docs/MIGRATION_MATRIX.md`。
- 架构/原则变更更新 `docs/WEB_REFACTOR_PLAN.md` 与 `docs/DOMAIN_MODEL.md`。
- 不要在 README、AGENTS、计划文档中重复维护进度表。
