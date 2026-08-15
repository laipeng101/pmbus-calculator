## 变更说明

<!-- 简要说明本 PR 的 Goal、Out of scope、影响模式与规范来源。 -->

## 关联 Issue

<!-- 例如：Closes #12。单人维护模式下无 Issue 可写 N/A。 -->

## Agent Checklist

- [ ] 我已阅读 AGENTS.md
- [ ] 本次变更符合 Web-first 当前主线
- [ ] 没有引入 Tauri/Electron/后端/硬件通信
- [ ] 没有无测试修改 PMBus 算法
- [ ] 没有删除旧功能而不记录 Migration Gap
- [ ] 没有新增 inline onclick
- [ ] 没有新增散落 localStorage 写入
- [ ] 命令字典/profile 变更已在 `docs/DOMAIN_MODEL.md`、`docs/adr/` 与 `src/legacy/command-metadata.ts` 同步

## Fresh environment 初始化

```bash
npm ci
npx playwright install chromium
```

## 验证

<!-- 替换为实际命令输出摘要；每条命令必须记录 exit code。 -->

```text
npm run format:check      # exit 0
npm run typecheck         # exit 0
npm run lint              # exit 0
npm run test:coverage     # exit 0，实际单测数 ___，coverage ___
npm run test:e2e          # exit 0，实际 E2E 数 ___
npm run build             # exit 0
git diff --check          # exit 0
```

## 影响范围

- Changed files:
- Affected modes:
- 移动端检查（1440/1024/768/430/390/360）:
- 剩余缺口:

## 合并方式

单人维护模式：Agent 自审 + CI 全绿后使用普通 merge commit 合入，不使用 squash。
