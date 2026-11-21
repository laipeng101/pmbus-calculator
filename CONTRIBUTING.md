# Contributing

项目边界和专题资料见 [AGENTS.md](AGENTS.md)。

## 开发环境

本地与主 CI 使用 [`.node-version`](.node-version) 和 [`package.json`](package.json) 的 `packageManager` 指定的版本。`npm run doctor` 核对当前环境。初次检出或锁文件变更时执行 `npm ci`。

```bash
npm run dev               # 本地开发服务器
npm run test:e2e:install  # 需要完整浏览器验收且尚未安装时
```

## 选择验证入口

- 开发中先运行受影响的检查。`npm run check` 提供快速代码检查，完整门禁由下列验证入口提供。
- 纯文档等命中 [`scripts/classify-ci-scope.mjs`](scripts/classify-ci-scope.mjs) allowlist 的变更走 `npm run verify:light`。任何产品、测试、脚本、配置、混合或未知变更均走 `npm run verify`。脚本组合以 [`package.json`](package.json) 为准。
- Playwright 默认验收生产 `dist/`。独立运行桌面、移动或跨引擎套件前先完成 `npm run build`。涉及视觉变化时，按 [UI_CONVENTIONS](docs/UI_CONVENTIONS.md#10-视觉系统与验收) 验证关键视口并在 canonical Darwin 环境运行 `npm run test:e2e:visual`。
- 本地验证使用受控 Analytics stub。真实外部服务验收和环境阻碍口径见 [DEPLOYING](docs/DEPLOYING.md#发布后真实-cloudflare-analytics-验收)。
- `git diff --check` 与 `git diff --cached --check` 分别检查未暂存和暂存内容。PR 本地另用 `git diff --check origin/main...HEAD` 检查完整分支改动，CI 检查完整 PR base→head 范围。

主检出目录的 pre-commit hook 只检查暂存内容的空白错误。完整验证在本地验收入口与 PR CI 执行。已有检出可用 `npm run postinstall` 刷新项目 hook。

## 分支、PR 与合并

获得相应操作授权后，从最新 `origin/main` 创建主题分支并以 `main` 为 PR 目标。提交消息使用 `type(scope): summary`，例如 `fix(L11): saturate out-of-range values`。

`main` 由 `protect-main` 保护，要求 PR、成功的 `check` 和 strict up-to-date，禁止绕过、force push 与删除。单人维护流程允许在授权范围内自审，分支保护要求仍须满足。

1. 本地验证后推送并填写 [PR 模板](.github/pull_request_template.md)。若任务完成了路线图里程碑，在同一个实现 PR 更新 [ROADMAP](docs/ROADMAP.md)。
2. 等待最终 PR head 的 required `check`。CI 使用 PR merge ref 测试；每次推送后以新 head 的运行作为验收证据。`workflow_dispatch` 始终 full。
3. 自审后用普通 merge commit 合入。合并后比较该 CI 的 `Record checked revision` 所记录的 `checked_tree` 与最终 main merge SHA 的 `HEAD^{tree}`。一致时该树已受验证。发现不一致时，对最终 main 触发 full CI 并定位，在验证通过前暂停发布。完成后删除源分支并同步本地。

## 验收证据

- 记录适用门禁的实际结果和未完成的验收。CI 证据使用最终 head SHA 与运行链接。跳过项注明是 CI 分级策略还是环境阻碍，按需要引用当次报告中的用例数、覆盖率及 skip、flaky、retry。
- Playwright 保留失败 trace，CI 上传对应的 HTML report。定位首次失败再定向重跑；未解释的失败阻塞发布。命令结果以自身退出状态为准。
- 发行与重大资产调整需要的树统计见 [REPOSITORY_HYGIENE](docs/REPOSITORY_HYGIENE.md#8-资产变更统计)。
- 性能调查参考 full PR CI 稳态 ≤5m30s、Pages rollout ≤2m30s。分别超过 6m30s 和 3m 时检查关键路径。以同配置运行的 job/step timing 核对收益，保留既有验收和发布完整性边界。
