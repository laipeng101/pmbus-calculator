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

- `npm run verify` exit code:
- 单测文件数与测试数:
- coverage（All files Stmts/Branch/Funcs/Lines）:
- `npm run test:e2e` passed/skipped 数:
- `npm run test:e2e:release` production smoke 数:
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

- PR CI URL:
- PR CI head SHA:
- PR CI conclusion:
- main CI URL（合并后补）:
- main CI head SHA（合并后补，应等于 merge SHA）:
- main CI conclusion（合并后补）:

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
- [ ] 统计数字来自最终 committed HEAD，并经 `git ls-tree -r -l HEAD` 交叉核对

## 剩余缺口

<!-- 无则写 N/A。 -->
