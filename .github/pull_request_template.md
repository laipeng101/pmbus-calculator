## 变更说明

<!-- 简要说明本 PR 的 Goal、Out of scope、影响模式与规范来源。 -->

## 关联 Issue

<!-- 例如：Closes #12。单人维护模式下无 Issue 可写 N/A。 -->

## 验收记录

- Base SHA / Final head SHA:
- Changed files（数量）/ additions / deletions（与 `git show --stat` 一致）:
- Affected modes:
  <!-- 例如：L11/L16/DIRECT/HALF；本 PR 若为卫生/工具类改动可写 N/A -->
- `npm run verify` exit code（light tier 任务用 `npm run verify:light` 并注明）:
- 单测文件数与测试数（light tier 填 policy-skipped）:
- `npm run check:repo-hygiene`: tracked file count / policy allowlisted / final HEAD tree size（bytes）:
- `git diff --check origin/main...HEAD` exit code:
- 禁止制品扫描结果（dist/build/out/coverage/report/output/DSH JSONL 等）:
- 残留检查（临时目录、release-output/staging、孤儿进程）:
- CI tier: light / full（由 `scripts/classify-ci-scope.mjs` 判定，fail closed；`workflow_dispatch` 始终 full）
- 最终成功 CI 的 head_sha 与 URL:

## 发布相关（仅发布任务必填；否则 N/A）

- 两次 `release:prepare-assets`（含 `--force`）逐字节一致性与已发布资产 hash 核对:
- tag / GitHub Release / Pages 状态（本轮是否创建/修改）:

## UI/visual evidence（UI 任务必填；否则 N/A）

- `npm run test:e2e:visual` snapshot 新增/修改/删除数量与字节变化:
- 关键 viewport 截图与逐图检查说明:

## Post-merge evidence（merge 后由**唯一一次 PR comment** 记录）

- merge SHA / merge tree:
- tree equality（merge HEAD^{tree} 与 PR CI `Record checked revision` 的 checked_tree 必须完全相同；不一致用 `workflow_dispatch` 对最终 main 执行 full CI）:

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
- [ ] 统计数字来自最终 committed HEAD

## 剩余缺口

<!-- 无则写 N/A。 -->
