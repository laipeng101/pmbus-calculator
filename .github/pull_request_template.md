## 变更说明

<!-- 简要说明本 PR 的 Goal、Out of scope、影响模式与规范来源。 -->

## 关联 Issue

<!-- 例如：Closes #12。单人维护模式下无 Issue 可写 N/A。 -->

## 变更范围

- Base SHA:
- Final head SHA:
- Changed files:
- Affected modes:
  <!-- 例如：L11/L16/DIRECT/HALF；本 PR 若为卫生/工具类改动可写 N/A -->

## 验证

<!-- 所有统计必须来自最终 committed HEAD，不要使用 working tree 或中间 commit 结果。 -->
<!-- 每次新增修复提交后，以下统计必须重新生成并更新。 -->

- `npm run verify` exit code（light tier 任务用 `npm run verify:light` 并注明）:
- 单测文件数与测试数（light tier 填 policy-skipped）:
- coverage（All files Stmts/Branch/Funcs/Lines；light tier 填 policy-skipped）:
- `npm run test:e2e` passed/skipped 数（light tier 填 policy-skipped）:
- `npm run test:e2e:release` production smoke 数（light tier 填 policy-skipped）:
- `npm run check:repo-hygiene` 结果:
  - tracked file count:
  - policy allowlisted / snapshots / legacy fallbacks:
  - `npm run specs:check` 结果 / manifest entries / tracked PDF:
  - final HEAD tree size（bytes）:
- `git ls-tree -r -l HEAD` tree size（用于交叉核对）:
- snapshot 新增/修改/删除数量与字节变化:
- 禁止制品扫描结果（dist/build/out/coverage/report/output/DSH JSONL 等）:
- `git diff --check origin/main...HEAD` exit code:

## CI 证据

<!-- CI 必须核对其 head_sha 等于最终 PR head / 最终 merge SHA。 -->

- CI tier: light / full（由 `scripts/classify-ci-scope.mjs` 判定，fail closed；`workflow_dispatch` 始终 full）
- light 时分类器结论（tier、原因、changed path 摘要）:
- push 次数（每次 push 的 head SHA；第二次 push 后必须立即更新下方 Final head SHA，不得保留第一次提交 SHA）:
- 每次 CI URL / head SHA / conclusion:
- 最终成功 CI head_sha:
- PR CI `checked_sha` / `checked_tree`（`Record checked revision` 步骤输出）:
- merge SHA / merge tree（merge 后填写）:
- tree equality（merge HEAD^{tree} 与 PR CI checked_tree 必须完全相同；main 不再有 push CI，必要时用 `workflow_dispatch` 手工执行 full 验证）:
- security runner 实际覆盖文件列表（`npm run test:release-security` 输出的九个文件）:
- release-security passed / failed / skipped / todo（zero-skip 合同要求 skipped+todo 为 0）:
- temp residue（runner 私有目录、系统临时目录、release-output/staging/backup/journal 检查）:
- signal stress 次数与平台（Node 版本 × SIGINT/SIGTERM 各轮数；0 flaky、0 skip）:
- repeated-signal stress 轮次（INT+INT / TERM+TERM / INT+TERM / TERM+INT / 三连信号；0 raw signal death、0 stale lock、0 orphan process）:
- timeout/process-tree stress 轮次（0 孤儿进程；Promise settle 后 helper 后代停止写 sentinel）:
- signal-observed run 的 `Done:`/`Transaction recovered successfully` 出现次数（必须为 0）:
- canonical toolchain：Node（.node-version/.nvmrc/engines/CI primary）、npm（packageManager/engines.npm/devEngines/CI 双运行时）、`npm run doctor`/`check:toolchain` exit code、@types/node 精确版本:
- worktree hooks：主 checkout / linked+detached worktree / CI env / 非 Git 目录四形态 postinstall 行为（skip 消息清晰、无 ENOTDIR、exit 0）:
- journal crash matrix failpoint 数量（每个 mutation boundary 的 crash 注入覆盖）:
- hygiene 两个 size 指标语义：tracked file count = Git index/HEAD 中 tracked path 的 entry 计数；tree size = 每个 tracked path 对应 blob size 求和（同一 blob 被多路径共享时每路径都计入），两者均以 `git ls-tree -r -l HEAD` 为准

## M31 证据字段（release lifecycle 证据加固 / 跨平台 fail-closed / 验证去重）

- 验证去重：`test:coverage` 测试文件数/测试数（不含 security）、`test:release-security` 文件数/测试数、九 security suite 在 coverage 中的重复执行数（必须为 0）、coverage 墙钟 / security 墙钟（修改前后对比）:
- coverage 配置排除集与 SECURITY_TEST_FILES 一致性（结构测试）:
- 平台 gate：POSIX-only（linux/darwin）声明、win32 拒绝退出码、副作用前退出验证（零锁/staging/journal/output）:
- 严格进程树证据：quiescence 断言（size+sha256 稳定期后不变）、孙进程 kill(pid,0) ESRCH 轮数、双 SIGTERM-ignore 升级 SIGKILL 轮数、escalation/main timer 清理断言:
- spawn 失败合同：ENOENT error-event reject + registry 为空（结构/行为测试）:
- 本地磁盘策略执行情况（canonical 保留、compat 临时、worktree/node_modules 清理、npm cache verify、Playwright revision）:

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

## 剩余缺口

<!-- 无则写 N/A。 -->
