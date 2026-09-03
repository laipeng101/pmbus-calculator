# DEPLOYING

本文档说明 PMBus Calculator 的正式生产站点（GitHub Pages）如何部署与回滚。

## 部署原则

- **正式站点只部署稳定 GitHub Release 资产。** 每次部署都从指定的 Release 下载
  `pmbus-calculator-<tag>-web.zip` 与 `SHA256SUMS.txt`，校验通过后解压为静态站点。
- **不部署 main 的未发布构建。** Pages 工作流只从**被部署 tag 本身** fresh
  rebuild，且该 rebuild 必须与 Release ZIP 逐字节一致；上传给 Pages 的字节永远是
  **已下载并验证的 Release ZIP**（解压的 `_site`），不是 rebuild 产物本身。
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
   资产就绪合同（存在、名称唯一、`state == uploaded`、`size > 0`、URL 为本仓库
   本 tag 的 canonical `browser_download_url`）由
   `scripts/release-assets-verify.mjs --mode published` 在同一读取步骤内校验
   （v2.5.8）；缺失、重复、上传中、零字节分别报出明确错误与退出码，失败发生在
   任何下载/部署动作之前。v2.5.7 的 publish-before-upload 竞态（Pages 在资产
   存在前触发下载）在该步骤表现为明确的资产合同错误；流程层修复见
   `docs/RELEASING.md` §4（draft → 上传 → 回验 → publish）。
4. 下载 Release 中的 `pmbus-calculator-<tag>-web.zip` 与 `SHA256SUMS.txt`：
   自 v2.5.9 起 verifier 的 stdout 是一个 JSON 数据对象（诊断走 stderr），
   下载由 `scripts/download-release-assets.mjs` 以静态 JSON 读取消费——每个
   URL 先经 `scripts/release-url-contract.mjs` 重新校验（scheme/host/path、
   无 userinfo/query/fragment），下载受**真实累计总预算**约束
   （v2.5.10）：整个下载操作（两项资产、重试与 backoff）共享
   `TOTAL_DOWNLOAD_BUDGET_MS = 5 分钟` 预算，重试不重置时限；每次 fetch 的
   AbortSignal 取剩余预算，预算耗尽立即以退出码 10 与「deadline exhausted」
   诊断终止。该预算刻意远小于 Pages job 的 `timeout-minutes: 20`，为
   npm ci、校验、上传、部署与 remote smoke 留足时间。重试仅针对瞬时故障
   （网络错误与 HTTP 408/429/5xx），次数有界（每资产最多 3 次）且 backoff
   短小并计入预算（v2.5.11：网络 reject 与瞬时 HTTP 状态走同一退避路径，
   退避量取 `min(退避配置, 剩余预算)`；由共享 deadline 的 AbortSignal 触发
   的 abort 属于预算耗尽，立即以 code 10 的「deadline exhausted」诊断终止，
   不再重试）；其他 4xx 与元数据/URL/size 合同错误立即失败。下载后先
   核对文件字节数与元数据一致，不一致立即停止部署（错误码 9），不会到达
   checksum 步骤；两项资产全部下载并通过 size 校验后才会写盘，不产生部分
   下载的发布输入。元数据请求失败、资产选择失败与下载失败是三个可区分的
   失败面，保留真实退出码。元数据文本永远只作为数据传递，不被
   `source`/`eval`/拼接 shell 再次解释（v2.5.9 数据边界）。
5. **v2.5.12 起下载后的字节门禁是统一入口**
   `scripts/verify-downloaded-assets.mjs --metadata release-metadata.json
--dir . --tag <tag> --repo <repo> --mode published`：它在进程内复用
   `release-assets-verify.mjs` 的完整元数据合同（published 模式保持严格
   canonical tag URL，不放宽为 draft 占位），再校验本地文件存在且为普通
   文件、本地字节数等于元数据 size、`SHA256SUMS.txt` 严格格式合同（一行
   `<64 hex>␠␠<name>`、无重复、无未知名、不列自身）、ZIP 的 SHA-256
   （node:crypto，跨平台，替代 `sha256sum -c` 的二进制依赖）以及共享
   python ZIP 安全校验。失败按类分级：元数据 2-8、本地缺失 10、大小不符
   11、sums 合同 12、checksum 13、ZIP 安全 14；任一失败发生在解压或部署
   之前。stdout 只输出一个 JSON 数据对象，诊断走 stderr，永远不被
   `source`/`eval`/拼接 shell 再次解释。
6. 解压前检查 zip：不包含绝对路径、不包含 `../` 路径穿越、不包含符号链接；
   必须包含 `index.html` 和 `assets/`；`index.html` 必须包含 production CSP；
   script 和 stylesheet 必须使用相对资源路径；不得包含 `/src/main.tsx`
   （该合同由上一步的共享 python 校验器统一执行）。
7. **Release→tag 源码机械绑定（deploy 前）**：workflow 已在第 1-5 步
   确认 checkout 的 HEAD 就是被解析 annotated tag 的 peeled commit；本步骤在该
   checkout 上 fresh 执行 `npm run build` 与 `npm run release:prepare-assets
-- --force`（确定性资产生成），并断言 `package.json` 版本与部署 tag 一致，
   随后用 `scripts/verify-release-rebuild.mjs` 将 rebuild 的 zip 与已下载
   Release zip **逐字节比较**（流式比较，首字节差异即失败）。一个格式合法、
   ZIP 安全、checksum 自洽但**并非由该 tag 源码生成**的 Release zip 在此失败，
   且发生在解压/部署之前。
8. **可预备的部署前置条件全部在 `actions/deploy-pages` 之前**：
   Playwright Chromium 安装与**本地 release smoke**（`npm run test:e2e:release`）
   在 deploy 前执行；本地 smoke 作用于与 Release zip 字节绑定的 rebuild 产物。
   任一前置失败时 deploy 尚未开始，线上旧版不受影响。
9. 解压到临时 `_site` 目录。
10. 上传 GitHub Pages artifact 并执行 `actions/deploy-pages`。
11. **部署后全清单实体验证**：从本次已验证的 `_site`（字节绑定
    于 Release zip）**动态枚举完整清单**，对每个相对 URL 执行带总 deadline 与
    并发上限的 identity GET；每项要求最终 URL 同源、HTTP 200、非意外
    Content-Encoding、实体长度与 SHA-256 与清单一致，并显式拒绝 200 HTML
    fallback。清单文件数与 asset 名全部来自运行时枚举，不硬编码。失败按类
    分级退出（status 21 / origin 23 / content-encoding 24 / fallback 25 /
    length 26 / hash 27 / timeout 28 / deadline 29 / network 20 / 配置 3）。
12. 在同一工作流中对真实部署 URL 执行远程 Playwright smoke（`npm run test:e2e:deployment`）。

## 远程 smoke

- 测试文件：`tests/e2e/deployment.spec.ts`
- Playwright 配置：`playwright.deployment.config.ts`
- URL 由环境变量 `DEPLOYMENT_URL` 提供；测试不启动本地 dev/preview server。
- 覆盖：HTTPS URL、页面可加载、标题包含 PMBus、模式切换/只读命令参考/结果面板可见、
  production CSP meta 存在、无 page error、document/script/stylesheet/font/image/fetch
  无 4xx/5xx、资源位于 Pages origin、390px viewport 无横向滚动、L11 输入/结果闭环。

## 部署后全清单实体验证

- 脚本：`scripts/verify-pages-entities.mjs`（`.github/workflows/pages.yml` 的
  "Verify deployed Pages entities" 步骤，位于 deploy-pages 之后、远程 smoke 之前）。
- 清单**动态**来自已解压、已字节验证的 `_site`：每个文件产生一个相对 URL，文件数
  与 asset 名不硬编码。
- 每项检查：安全解析相对路径（拒绝 `..`/绝对/反斜杠/URL 特殊字符/带 scheme 引用）；
  最终（含 redirect 后）URL 必须同源且位于 base pathname 前缀内；请求显式
  `Accept-Encoding: identity` + `Cache-Control: no-cache`；GitHub run id 作为
  唯一 cache-busting query（`--query`），不进仓库、不进 stdout/stderr 诊断；
  无任何凭据；HTTP 200；非 identity Content-Encoding 失败；实体长度与 SHA-256
  与 `_site` 本地字节一致；非 index 实体返回 200 `text/html` 且字节不符 → 显式
  HTML-fallback 失败分类。
- 并发默认 8（`--concurrency`），每请求超时默认 30s（`--request-timeout-ms`），
  共享总 deadline 默认 120s（`--deadline-ms`）。任一失败非零退出并按类分级；
  stdout 只有一个 JSON 汇总对象，诊断走 stderr。

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
