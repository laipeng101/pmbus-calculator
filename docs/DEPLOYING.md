# GitHub Pages 部署

正式站点为 [laipeng101.github.io/pmbus-calculator](https://laipeng101.github.io/pmbus-calculator/)。站点以不可变 GitHub Release 的 Web ZIP 为基础，由 [Pages 工作流](../.github/workflows/pages.yml) 部署。

## 触发部署

公开稳定 Release 会自动触发部署。手动部署或回滚时，在符合条件的 tag 上运行工作流，并传入同名的 `release_tag`。

```bash
gh workflow run pages.yml --ref vX.Y.Z -f release_tag=vX.Y.Z
```

候选版本必须满足两项条件。

- 对应 Release 的 API 返回 `immutable: true`，并且已公开、属于稳定版。
- 该 tag 内的工作流及校验脚本已经要求 Release 不可变。从 `v2.6.2` 起包含这项检查。手动执行使用所选 tag 的代码。

候选条件也适用于回滚。若无合格版本，或修复需要修改产品文件，按[发布流程](RELEASING.md)发布新版本。已公开的 tag 和 Release 保持原样。

## 工作流检查

1. 确定目标 tag，检查版本格式与带注释的 tag，确认 checkout 对应的提交。
2. 校验 Release 元数据和资产，下载 Web ZIP 与 `SHA256SUMS.txt`。校验资产大小、SHA-256、ZIP 结构及资源路径。两项下载和网络重试共用一个时限。
3. 从 tag 重新构建并生成 ZIP，与已下载的 ZIP 逐字节比较。运行 Release smoke 检查构建产物。
4. 解压已验证的 ZIP 到 `_site`，添加并检查 Pages 专用内容，运行本地 Pages 测试。
5. 上传并部署 `_site`。检查每个公开站点文件与本次部署产物的字节一致，再运行线上浏览器测试和[真实 Analytics 验收](#发布后真实-cloudflare-analytics-验收)。

第 1 至第 4 步失败时，部署尚未开始。第 5 步部署动作成功但后续检查失败时，站点已经更新，应记录出错的检查及运行链接。修复后可按上方条件重跑同一 tag 的工作流。确认整个 Pages 作业通过后再报告上线完成。

线上文件校验从最终 `_site` 枚举文件，包括更新后的 `index.html` 和新增的 CSS。每个 URL 须返回同源的 HTTP 200 文件，大小与 SHA-256 和本地文件一致。

线上浏览器测试验证页面、同源资源、CSP、移动端布局和计算器交互。Cloudflare 请求由测试代答，第三方服务的实际状态由单独的验收步骤检查。修改 Pages 文件处理时，可先构建并运行 `npm run test:pages-overlay`，使用测试 token 和本地静态文件验证。

## Pages 专用内容与隐私

Pages 工作流在临时目录 `_site` 中添加 Cloudflare Web Analytics、页头的源码链接和相应 CSS。普通构建、Release Web ZIP 和自托管版本不包含这些文件或统计脚本。相同 Release 与相同站点 token 产生相同的部署内容。

Cloudflare Web Analytics 用于页面级访问统计。计算器的输入、结果及复制内容不会作为统计事件发送。Pages 仅在应用现有 CSP 中加入以下 Cloudflare 请求所需的权限。

| 请求          | 地址                                                  |
| ------------- | ----------------------------------------------------- |
| GET 加载脚本  | `https://static.cloudflareinsights.com/beacon.min.js` |
| POST 发送统计 | `https://cloudflareinsights.com/cdn-cgi/rum`          |

应用脚本、样式和字体仍从本站加载。测试以相同 URL 和请求方法识别 Cloudflare 请求。

## 发布后真实 Cloudflare Analytics 验收

查看 Pages 作业的 `Real Cloudflare Analytics acceptance` 步骤。它使用 GitHub 托管的 Chromium 打开正式页面，核对页面版本，再观察 Analytics 脚本加载和它实际发起的统计请求。两项请求均须返回 2xx 并完成，浏览器不能出现 CORS、域名校验、页面错误或意外第三方请求。

暂时的网络或 Cloudflare 错误可有限重试，共享 45 秒上限。日志记录请求类型、状态和用时，不记录 token 和请求正文。本地与 PR 检查使用模拟请求，开发者可保留本地隐私规则。

若该步骤失败，记录「Pages 已部署，Analytics 验收失败」及运行链接。可确认的第三方临时故障可从同一 tag 重跑。项目缺陷按正常发布流程修复。

## 配置部署环境

在仓库 **Settings → Environments → github-pages** 中允许 `main` 分支及 `v*.*.*` 类型为 **Tag** 的部署规则。Release 事件使用 tag，因此只允许 `main` 时 GitHub 会拒绝部署。

```bash
gh api repos/laipeng101/pmbus-calculator/environments/github-pages/deployment-branch-policies
```

在该环境的 **Environment secrets** 添加 `CLOUDFLARE_WEB_ANALYTICS_TOKEN`，值为官方站点的 Cloudflare Web Analytics site token。工作流通过两个 Pages 专用内容处理步骤的环境变量传入，缺失或格式错误会在部署前中止。将 token 保存在环境 Secret 中，避免写入仓库或普通构建。
