## 变更说明

<!-- 简要说明本 PR 的 Goal、Out of scope、影响模式与规范来源。 -->

## 关联 Issue

<!-- 例如：Closes #12。单人维护模式下无 Issue 可写 N/A。 -->

## Core evidence（所有任务必填；统计必须来自最终 committed HEAD，不用 working tree/中间 commit 结果）

- Base SHA / Base tree:
- Final head SHA / head tree:
- Changed files（数量）/ additions / deletions（与 `git show --stat`、evidence 脚本一致）:
- Affected modes:
  <!-- 例如：L11/L16/DIRECT/HALF；本 PR 若为卫生/工具类改动可写 N/A -->
- `npm run verify` exit code（light tier 任务用 `npm run verify:light` 并注明）:
- 单测文件数与测试数（light tier 填 policy-skipped）:
- `npm run check:repo-hygiene`: tracked file count / policy allowlisted（snapshots/legacy fallbacks）/ final HEAD tree size（bytes）:
- `git diff --check origin/main...HEAD` exit code:
- 禁止制品扫描结果（dist/build/out/coverage/report/output/DSH JSONL 等）:
- 残留检查（temp residue：runner 私有目录、系统临时目录、release-output/staging/backup/journal、孤儿进程、`/tmp/<milestone>-*`）:
- CI tier: light / full（由 `scripts/classify-ci-scope.mjs` 判定，fail closed；`workflow_dispatch` 始终 full）
- push 次数（每次 push 的 head SHA；第二次 push 后必须立即更新 Final head SHA，不得保留第一次提交 SHA）:
- 每次 CI URL / head SHA / conclusion:
- 最终成功 CI head_sha:
- PR CI `checked_sha` / `checked_tree`（`Record checked revision` 步骤输出）:
- 证据采集摘要：`node scripts/collect-verification-evidence.mjs --json --results <test-summary.json>` 的 head/tree/changed/hygiene/security/toolchain 输出:

## Release-security evidence（release/进程树相关任务必填；非 release 任务一律明确填 N/A，减少无关证据填写成本）

- 验证去重：`test:coverage` 测试文件数/测试数、`test:release-security` 文件数/测试数（文件列表一律来自共享 `SECURITY_TEST_FILES`，数量以 `node scripts/collect-verification-evidence.mjs` 输出为准，不写死“N 个文件”）、security suite 在 coverage 中的重复执行数（必须为 0）:
- release-security passed / failed / skipped / todo（zero-skip 合同要求 skipped+todo 为 0）:
- 进程树/child ownership 证据（按任务要求列出）：
  - child-state 状态机与 crash window（SPAWN_INTENT/ACTIVE/QUIESCENCE_PROVEN/MANUAL_AUDIT_REQUIRED）:
  - journal crash matrix failpoint 数量（每个 mutation boundary 的 crash 注入覆盖）:
  - recovery 正负向矩阵（owner 死+组存活拒绝、SPAWN_INTENT 拒绝、ESRCH+metadata 匹配显式恢复成功、v1 lock/EPERM/nonce 不匹配拒绝）:
  - fail-closed natural exit（CLI 非零自然退出、锁保留、helper 存活时 recovery 拒绝、清理后显式恢复成功）:
  - 四 SIGTERM 组合与 post-spawn error、timer created/cleared 与 live-timer 断言:
- signal gate 证据（INT+INT/TERM+TERM/INT+TERM/TERM+INT/triple/no-Done 轮次；0 raw signal death、0 stale lock、0 orphan、watchdog 触发次数）:
- 压力验证（Node 24/22 各轮次与 bad/orphan/stale-lock/unsafe-recovery/residual-writer/live-timer/skipped/todo 计数）:

## UI/visual evidence（UI 任务必填；否则 N/A）

- `npm run test:e2e:visual` snapshot 新增/修改/删除数量与字节变化（预期 +0/~0/-0 时如实填写）:
- 关键 viewport 截图与逐图检查说明（无图像读取能力时用几何/对比度/overflow/computed-style 断言说明）:

## Toolchain evidence（涉及 Node/npm/依赖/CI/Pages 任务必填；否则 N/A）

- `npm run doctor` / `check:toolchain` exit code:
- canonical/compatibility 双运行时（Node 版本 × npm 版本）验证摘要:

## Release publish evidence（仅发布任务必填；否则 N/A）

- 两次 `release:prepare-assets`（含 `--force`）逐字节一致性与已发布资产 hash 核对:
- tag / GitHub Release / Pages 状态（本轮是否创建/修改）:

## Post-merge evidence（merge 后由**唯一一次 PR comment** 记录；不在 merge 后反复编辑 PR body）

- merge SHA / merge tree:
- tree equality（merge HEAD^{tree} 与 PR CI checked_tree 必须完全相同；main 不再有 push CI，必要时用 `workflow_dispatch` 手工执行 full 验证）:
- 本地/远端任务分支删除与 main 同步状态、open PR=0:

## Fresh environment 初始化

```bash
npm ci
npm run test:e2e:install
```

## Agent Checklist

- [ ] 我已阅读 AGENTS.md
- [ ] 本次变更符合 Web-first 当前主线
- [ ] 没有引入 Tauri/Electron/后端/硬件通信
- [ ] 没有无测试修改 PMBus 算法
- [ ] 没有删除旧功能而不记录 Migration Gap
- [ ] 没有新增 inline onclick
- [ ] 没有新增散落 localStorage 写入
- [ ] 没有修改版本号、tag、GitHub Release 或 Pages 配置
- [ ] CI tier 已标注；policy-skipped 门禁如实说明，未虚构测试数
- [ ] 里程碑 Done 已在实现 PR 最终提交中翻转，未创建第二个 bookkeeping PR
- [ ] 统计数字来自最终 committed HEAD，并经 `git ls-tree -r -l HEAD` 交叉核对
- [ ] post-merge evidence 走 PR comment，未在 merge 后编辑 PR body

## 剩余缺口

<!-- 无则写 N/A。 -->
