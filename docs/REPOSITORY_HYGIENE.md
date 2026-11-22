# 文件跟踪与清理

跟踪源码、测试、配置、锁文件、现行文档和产品资源。视觉基线见 [UI 约定](UI_CONVENTIONS.md#截图比对)，离线单文件见[兼容性说明](LEGACY_COMPATIBILITY.md)。发行 ZIP 与校验和通过 GitHub Releases 分发，CI 失败报告作为短期 Artifact 上传。

[.gitignore](../.gitignore) 定义不入库的路径。第三方规范按需下载到 `.cache/specifications/`，来源和使用方法见[规范获取说明](../document/README.md)。检查暂存内容时运行 `npm run check:repo-hygiene`，路径按工作区的 `.gitignore` 检查，大小按 Git 索引计算，单个文件上限为 1 MiB。

## 清理本地生成物

在仓库根目录预览下列目录中的忽略文件，确认后把 `-ndX` 改为 `-fdX` 执行。

```bash
git clean -ndX -- dist/ build/ out/ _site/ coverage/ playwright-report/ test-results/ release-output/
```

旧版本的浏览器报告可能还在 `tests/e2e/` 中，可用以下命令预览。

```bash
git clean -ndX -- tests/e2e/output tests/e2e/report 'tests/e2e/output-*' 'tests/e2e/report-*' 'tests/e2e/e2e-results*.json'
```

需要释放规范缓存时，可单独用 `git clean -ndX -- .cache/specifications/` 预览。
