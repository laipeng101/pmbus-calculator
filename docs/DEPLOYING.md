# GitHub Pages 部署

正式站点为 [laipeng101.github.io/pmbus-calculator](https://laipeng101.github.io/pmbus-calculator/)。正常发布时，[Release and Pages](RELEASING.md) 会部署同一次构建生成的 Web ZIP。

## 补部署和回滚

从 `main` 运行同一个工作流，传入已公开的稳定版本。工作流只接受官方仓库的不可变 Release，下载并校验 ZIP 与 `SHA256SUMS.txt`，再部署。

```bash
gh workflow run release.yml --ref main -f release_tag=vX.Y.Z
```

要补部署就填原版本，要回滚就填此前可用的版本。工作流会在部署前检查发行包是否支持 Pages 专用内容。

## 确认上线

部署后会比对线上文件，并在 Chromium 验证页面版本、资源加载、移动端布局和计算器输入。部署成功后仍可能出现线上检查失败。排查日志后，重新运行工作流并传入要补部署或回滚的 `release_tag`。

Cloudflare Analytics 在正式站点用真实请求检查。失败会在作业摘要中提示，站点检查结果仍有效。可打开对应步骤排查脚本加载、服务响应或站点配置。

## Pages 专用内容

源码链接、样式和 Cloudflare Web Analytics 只在准备部署的 `_site/` 中注入。分析脚本随页面加载，计算器不会向它传入输入、计算结果或操作事件。

修改这些内容时，构建后运行 `npm run test:pages-overlay`，用模拟的 Analytics token 验证页面、CSP 和外部请求。

在仓库 **Settings → Pages** 将来源设为 **GitHub Actions**。在 **Settings → Environments → github-pages** 允许 `main` 部署，并设置环境密钥 `CLOUDFLARE_WEB_ANALYTICS_TOKEN`。它使用官方站点的 Cloudflare Web Analytics site token。缺失或格式错误会在公开 Release 和部署前停止。
