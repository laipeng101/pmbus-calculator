# 发布

GitHub Actions 的 [Release and Pages](../.github/workflows/release.yml) 一次完成 GitHub Release 和 [Pages 部署](DEPLOYING.md)。

1. 用 `npm version X.Y.Z --no-git-tag-version` 更新版本和锁文件，可随要发布的改动一起合入 `main`。按 [SemVer](https://semver.org/lang/zh-CN/) 选择版本号。兼容修复升 PATCH，兼容功能升 MINOR，改变计算结果、复制格式或已保存偏好等兼容契约时按影响判断是否升 MAJOR。
2. 合入后，在 Actions 中从 `main` 运行 **Release and Pages**，将 `release_tag` 留空。也可以运行下方命令。
3. 查看本次 Actions 运行。确认 Release 已公开、Pages 已部署且线上检查通过。发布说明由 GitHub 生成，可在 Releases 页面补充对用户有影响的变化和迁移方法。

```bash
gh workflow run release.yml --ref main
```

工作流从本次运行选定的 `main` 提交构建，验证构建产物并生成 Web ZIP 与 `SHA256SUMS.txt`。核对 GitHub Release 草稿中的文件摘要后公开，由 Pages 部署使用同一个 ZIP。仓库的 **Settings → General** 需启用 **Immutable releases**。

公开前失败可重跑原作业，工作流会续用指向同一提交的草稿。若版本已公开而 Pages 失败，按[部署指南](DEPLOYING.md#补部署和回滚)重新部署该版本。发布内容需修正时，用新版本号重新发布。

## 本地验证发行包

运行 `npm run build` 后，用 `npm run test:e2e:release` 检查自托管页面，用 `npm run release:prepare-assets` 在 `release-output/` 生成并校验 Web ZIP 和校验和。要替换已有的本地发行包，加 `-- --force`。若替换和自动恢复均失败，错误信息会给出原包的保留路径。
