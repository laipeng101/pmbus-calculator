# 仓库卫生

- 跟踪源码、配置、测试、锁文件、现行文档与产品实际引用的资源。按 [UI 约定](UI_CONVENTIONS.md#11-视觉基线治理)跟踪 Playwright 视觉基线，按[兼容性说明](LEGACY_COMPATIBILITY.md)保留旧版单文件。
- 构建输出、覆盖率、测试报告、失败截图、调试记录与代理会话放在忽略目录或临时位置。CI 失败报告作为短期 Artifact。发行 ZIP 与校验和由 GitHub Releases 分发。
- 第三方规范的来源、字节数和 SHA-256 维护在 [manifest](../document/specifications.json)。PDF 按需下载到 `.cache/specifications/`。分发条款见 [第三方声明](../THIRD_PARTY_NOTICES.md)。
- `npm run check:repo-hygiene` 查 Git 跟踪路径及 blob 大小，拒绝生成物、PDF 和大于 1 MiB 的单个文件。分类统计按路径计数，包括视觉基线与离线单文件。新增二进制应在 PR 说明用途，大小限制的调整需明确审核。

## 生成物与清理

```bash
npm run clean -- --dry-run
npm run clean
```

清理命令只处理 [`scripts/clean-generated.mjs`](../scripts/clean-generated.mjs) 列出的可重建目标，其中包括规范缓存。先检查 dry-run，再按需清理。诊断所需报告和用户文件应保留。

修改 Playwright 输出路径时同步 Playwright 配置、[`.gitignore`](../.gitignore)、清理脚本及 [hygiene 门禁](../scripts/check-repo-hygiene.mjs)。一致性由 [产物路径测试](../tests/playwright-artifacts-consistency.test.ts)覆盖。
