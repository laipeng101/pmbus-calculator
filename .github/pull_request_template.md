## 变更说明

<!-- 简要说明本 PR 的 Goal、Out of scope、影响模式与规范来源。 -->

## 关联 Issue

<!-- 例如：Closes #12 -->

## Agent Checklist

- [ ] 我已阅读 AGENTS.md
- [ ] 本次变更符合 Web-first 当前主线
- [ ] 没有引入 Tauri/Electron/后端/硬件通信
- [ ] 没有无测试修改 PMBus 算法
- [ ] 没有删除旧功能而不记录 Migration Gap
- [ ] 没有新增 inline onclick
- [ ] 没有新增散落 localStorage 写入
- [ ] 命令字典/profile 变更已在 `docs/DOMAIN_MODEL.md` 与 `src/legacy/command-metadata.ts` 同步

## 验证

<!-- 替换为实际命令输出摘要。 -->

```text
npm run format:check
npm run typecheck
npm run lint
npm run test:coverage
npm run test:e2e
npm run build
git diff --check
```

## 影响范围

- Changed files:
- Affected modes:
- 移动端检查（1440/1024/768/430/390/360）:
- 剩余缺口:
