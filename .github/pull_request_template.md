## 变更说明

<!-- 简要说明本 PR 的 Goal、Out of scope、影响模式与规范来源。 -->

## 关联 Issue

<!-- 例如：Closes #12。单人维护模式下无 Issue 可写 N/A。 -->

## 验收记录

- Base SHA / Final head SHA:
- Changed files（数量）/ additions / deletions（从最终 `git diff --numstat <base SHA>...<final head SHA>` 一次性统计，不累加各提交）:
- Affected modes:
  <!-- 例如：L11/L16/DIRECT/HALF；本 PR 若为卫生/工具类改动可写 N/A -->
- `npm run verify` exit code（light tier 任务用 `npm run verify:light` 并注明）:
- 单测文件数与测试数（light tier 填 policy-skipped）:
- Coverage S/B/F/L 与各 E2E 套件实际数量（default / mobile / cross-engine / release / visual / deployment；skip/flaky/retry 单列，未运行不得写成通过）:
- `npm run check:repo-hygiene`: tracked file count / policy-classified（分类统计，非大小豁免）/ final HEAD tree size（bytes，与 `git ls-tree -r -l HEAD` 交叉核对）:
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
- 视觉重构（组件/CSS 重构、类名统一、布局调整）更新基线时的新旧基线 diff 审查记录:
  <!-- 更新前失败场景清单（预期影响面）→ 新旧 PNG 成对对比结论 → 实际更新集合与影响面核对；
  预期受影响却未更新的基线需说明原因。非视觉重构或未更新基线填 N/A。完整条款:
  docs/REPOSITORY_HYGIENE.md 第 3 节第 10 条。 -->

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
- [ ] 统计数字来自最终 committed HEAD；新增提交后已重新采集，未沿用 base 或中间提交统计

## 剩余缺口

<!-- 无则写 N/A。 -->
