# DEPLOYING

本文档说明 PMBus Calculator 的正式生产站点（GitHub Pages）如何部署与回滚。

## 部署原则

- **正式站点只部署稳定 GitHub Release 资产。** 每次部署都从指定的 Release 下载
  `pmbus-calculator-<tag>-web.zip` 与 `SHA256SUMS.txt`，校验通过后解压为静态站点。
- **不部署 main 的未发布构建。** Pages 工作流不执行 `npm run build`，也不会把 main
  上的未发布提交发布到生产站点。
- **不改动已发布 tag 与 Release。** 已发布的 tag 和 Release 是不可变资产；部署失败
  时不得通过移动 tag、替换资产或重新构建同名包来“修复”。
- Pages 故障不修改任何已发布的 tag、Release 和资产；若部署需要改变产品字节，应停止部署，
  并改为规划独立的新 PATCH 修复发行。

## 生产 URL

```text
https://laipeng101.github.io/pmbus-calculator/
```

> 仓库根目录的 `pmbus-calculator.html` 保留仓库内离线兼容用途（只接受必要纠偏），不是
> Pages 部署资产；Pages 上的 `/pmbus-calculator.html` 路径实际返回 404。产品入口只有
> Pages 根页面（React Web App，HTTP 200）。

## Pages workflow

工作流文件：`.github/workflows/pages.yml`

触发方式：

- `release` 事件 `published`：自动部署刚发布的稳定 Release。
- `workflow_dispatch` 手动触发：必须提供稳定 Release tag（例如 `v1.0.0`）。

工作流步骤：

1. 解析目标 tag（release 事件使用 `github.event.release.tag_name`，手动触发使用
   `inputs.release_tag`）。
2. 验证 tag 符合稳定 SemVer：`^v[1-9][0-9]*\.[0-9]+\.[0-9]+$`。不得部署
   `alpha`、`beta`、`rc`、draft 或 prerelease。
3. 通过 GitHub API 验证 Release 存在、`draft == false`、`prerelease == false`、
   Release tag 与输入完全一致，且对应 Git tag 存在（annotated 或 lightweight）。
   资产就绪合同（存在、名称唯一、`state == uploaded`、`size > 0`、URL 有效）
   由 `scripts/release-assets-verify.mjs --mode published` 在同一读取步骤内校验
   （v2.5.8）；缺失、重复、上传中、零字节分别报出明确错误与退出码，失败发生在
   任何下载/部署动作之前。v2.5.7 的 publish-before-upload 竞态（Pages 在资产
   存在前触发下载）在该步骤表现为明确的资产合同错误；流程层修复见
   `docs/RELEASING.md` §4（draft → 上传 → 回验 → publish）。
4. 下载 Release 中的 `pmbus-calculator-<tag>-web.zip` 与 `SHA256SUMS.txt`：
   只使用校验脚本解析出的 URL，网络调用带 connect/总 timeout 与仅针对瞬时
   故障的有限重试；下载后先核对文件字节数与元数据一致，不一致立即停止部署
   （错误码 9），不会到达 checksum 步骤。元数据请求失败、资产选择失败与
   下载失败是三个可区分的失败面，保留真实退出码。
5. 执行 `sha256sum -c SHA256SUMS.txt`，校验失败立即停止部署。
6. 解压前检查 zip：不包含绝对路径、不包含 `../` 路径穿越、不包含符号链接；
   必须包含 `index.html` 和 `assets/`；`index.html` 必须包含 production CSP；
   script 和 stylesheet 必须使用相对资源路径；不得包含 `/src/main.tsx`。
7. 解压到临时 `_site` 目录。
8. 上传 GitHub Pages artifact 并执行 `actions/deploy-pages`。
9. 在同一工作流中对真实部署 URL 执行远程 Playwright smoke（`npm run test:e2e:deployment`）。

## 远程 smoke

- 测试文件：`tests/e2e/deployment.spec.ts`
- Playwright 配置：`playwright.deployment.config.ts`
- URL 由环境变量 `DEPLOYMENT_URL` 提供；测试不启动本地 dev/preview server。
- 覆盖：HTTPS URL、页面可加载、标题包含 PMBus、模式切换/只读命令参考/结果面板可见、
  production CSP meta 存在、无 page error、document/script/stylesheet/font/image/fetch
  无 4xx/5xx、资源位于 Pages origin、390px viewport 无横向滚动、L11 输入/结果闭环。

## 回滚方式

- **重新部署上一个稳定 Release：** 手动触发 Pages workflow 并传入上一个稳定 tag。
  Pages 会从该 Release 的不可变资产重新部署。
- **发布新的 PATCH：** 按 `docs/RELEASING.md` 创建新的 PATCH 版本（例如 `v1.0.1`），
  合入 main 后发布 Release，Pages 会自动或手动部署新版本。
- **禁止移动旧 tag。** 旧 tag 必须保持在原 commit 上。
- 生产站点故障时，先回滚站点；不得修改、移动或删除已发布的 Release 与资产。

## Environment 部署策略

`github-pages` environment 使用 deployment branch policy 保护，但必须同时允许：

- `main` branch；
- 稳定 SemVer tag pattern：`v*.*.*`（type: tag）。

这样 `release published` 事件（ref 为 `refs/tags/vX.Y.Z`）才能自动部署稳定 Release。
验证方法：

```bash
gh api repos/OWNER/REPO/environments/github-pages/deployment-branch-policies
```

或通过 GitHub 仓库 Settings → Environments → github-pages → Deployment branches 查看。

如果环境策略只允许 `main`，release event 会被拒绝并记录为
`Tag "vX.Y.Z" is not allowed to deploy to github-pages due to environment protection rules`。
此时应添加 tag policy；不得关闭全部 environment protection。

## 安全与权限

- Pages workflow 使用最小权限：`contents: read`、`pages: write`、`id-token: write`。
- 所有 GitHub Actions 固定到官方 Release 的完整 commit SHA。
- 站点不设置自定义域名，只使用默认 `laipeng101.github.io` 域名。
