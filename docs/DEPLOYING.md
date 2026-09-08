# DEPLOYING

本文档说明 PMBus Calculator 的正式生产站点（GitHub Pages）如何部署与回滚。

## 部署原则

- **正式站点以稳定、不可变 GitHub Release 资产为产品基线。** 每次部署都从指定的
  Release 下载 `pmbus-calculator-<tag>-web.zip` 与 `SHA256SUMS.txt`，完成全部
  完整性、provenance 和本地 Release smoke 门禁后，才解压到 `_site` 并执行
  确定性的 Pages-only overlay。
- **不部署 main 的未发布构建。** Pages 工作流只从**被部署 tag 本身** fresh
  rebuild，且该 rebuild 必须与下载的 Release ZIP 逐字节一致。最终 `_site` 是
  **已下载并验证的 Release 基线 + 确定性且已验证的 Pages-only overlay**；
  overlay 有意改变 `index.html` 并新增 `pages-overlay.css`，因此最终 Pages
  字节不再等于未修改的 Release ZIP。下载与重建的两个 ZIP 本身均不得改写。
- **不改动已发布 tag 与 Release。** 已发布的 tag 和 Release 是不可变资产；部署失败
  时不得通过移动 tag、替换资产或重新构建同名包来“修复”。
- Pages 故障不修改任何已发布的 tag、Release 和资产；若部署需要改变产品字节，应停止部署，
  并按 SemVer 规划新的修复或功能发行，不得临时绕过 overlay 合同。
- **手动部署与回滚必须遵守 [RELEASING 的发布纪律](RELEASING.md#发布纪律)。**
  目标必须是 API 报告 `immutable: true` 的稳定 Release，且目标 tag 自身的 tree
  已包含 immutable 校验门禁（v2.6.2 起）。手动运行执行的是该 tag 内的 workflow
  与脚本，main 上的新门禁不会追溯保护旧 tag；历史 mutable Release 不得作为候选。

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
- `workflow_dispatch` 手动触发：从符合上述条件的稳定 Release tag ref 运行，
  并将 `inputs.release_tag` 设为完全相同的 tag。不能从 main、其他分支或不同 tag ref
  部署输入的 Release。

工作流步骤：

1. 解析目标 tag（release 事件使用 `github.event.release.tag_name`，手动触发使用
   `inputs.release_tag`）。
2. 验证 tag 符合稳定 SemVer：`^v[1-9][0-9]*\.[0-9]+\.[0-9]+$`。不得部署
   `alpha`、`beta`、`rc`、draft 或 prerelease。
3. 验证对应 Git tag 是 **annotated tag**，checkout HEAD 等于该 tag 的 peeled commit；
   lightweight tag 不满足部署合同。通过 GitHub API 验证 Release 存在、
   `draft == false`、`prerelease == false`、`immutable == true`，且 Release tag
   与输入完全一致。
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
9. 将已下载并验证的 Release ZIP 解压到临时 `_site` 目录。
10. **Apply Pages-only overlay**：`scripts/apply-pages-overlay.mjs --site _site`
    从 step `env` 读取 `CLOUDFLARE_WEB_ANALYTICS_TOKEN`，只修改 `_site`。
    受控仓库必须为 `laipeng101/pmbus-calculator`；缺失/非法 token、未知 CSP、
    非普通文件或已有 overlay 都失败，不自动跳过或重复注入。
11. **Verify Pages-only overlay**：`scripts/verify-pages-overlay.mjs --site _site`
    独立验证 FINAL `_site` 的 beacon、环境 token 一致性、精确 CSP、repository
    link、同源 CSS 及外部资源 allowlist；stdout 为不含 token 的 JSON，诊断走
    stderr。然后运行 `npm run test:e2e:pages-overlay`，在本地生产静态树上验证
    桌面/390px、亮暗主题、键盘焦点、无遮挡与无 page error；Cloudflare 由 route
    stub 隔离。任一 overlay 或本地 smoke 失败时尚未调用 deploy-pages，线上旧站不变。
12. Configure Pages、上传 FINAL `_site` artifact，然后执行 `actions/deploy-pages`。
13. **部署后全清单实体验证**：从本次 overlay 后的 FINAL `_site`
    **动态枚举完整清单**（包含变更后的 `index.html` 与新增 `pages-overlay.css`），
    对每个相对 URL 执行带总 deadline 与
    并发上限的 identity GET；每项要求最终 URL 同源、HTTP 200、非意外
    Content-Encoding、实体长度与 SHA-256 与清单一致，并显式拒绝 200 HTML
    fallback。清单文件数与 asset 名全部来自运行时枚举，不硬编码。失败按类
    分级退出（status 21 / origin 23 / content-encoding 24 / fallback 25 /
    length 26 / hash 27 / timeout 28 / deadline 29 / network 20 / 配置 3）。
14. 在同一工作流中对真实部署 URL 执行远程 Playwright smoke（`npm run test:e2e:deployment`）。

## Pages-only overlay 与隐私边界

普通 `npm run build`、clone / Download source ZIP / fork 的默认构建、Release
Web ZIP 与自托管构建均无 Analytics、无外部 tracking，也无 Pages-only repository
link。overlay 不进入 React source、Vite build 或 Release ZIP generation。

正式 Pages payload 恰好增加一份 Cloudflare Web Analytics 页面级 beacon、一枚
页头主题按钮旁的源码仓库图标链接，以及同源 `./pages-overlay.css`。链接随页头
滚动，计算器保持完整宽度，不为部署控件预留整页侧栏。Analytics 使用面向隐私的
聚合统计；不增加用户行为参数，不把 PMBus raw word、物理值、DIRECT 系数、
VOUT_MODE、复制内容或其他计算器输入/结果作为自定义 analytics event 收集。
beacon 保持第三方 runtime script，不下载/vendor，不添加不受支持的 version-pinned SRI。

`vite.config.ts` 的 Release CSP 完全不变。overlay 先严格校验已生成 CSP 的
directive shape，然后只做以下差异；其余 directive 保持原语义：

| Directive     | Release / self-host               | Official Pages                                               |
| ------------- | --------------------------------- | ------------------------------------------------------------ |
| `script-src`  | `'self'`                          | `'self' https://static.cloudflareinsights.com/beacon.min.js` |
| `connect-src` | 未声明，继承 `default-src 'self'` | `'self' https://cloudflareinsights.com`                      |

不允许 wildcard、宽泛 `https:` 或其他第三方 script/connect。KaTeX 字体、应用 JS、
应用 CSS 与 `pages-overlay.css` 继续同源；repository link 只在用户激活时导航。

overlay 只接受预期 `_site` staging directory 与普通 `index.html` 文件；production
CSP 必须恰好一份，执行前不得已有 Cloudflare、Pages marker 或 overlay CSS。
相同 Release tree 与相同部署输入产生相同 `_site` bytes；第二次执行必须明确失败。
verifier 在 upload 前拒绝重复 beacon/marker、错误 href/ARIA、token 不一致、
宽泛 CSP 或额外外部 script/stylesheet/font/image。

本地可在普通 build 后使用 `npm run test:pages-overlay` 完成测试 fixture 准备、
overlay 校验与 browser smoke。该入口使用合成测试 token，无需官方 Environment
Secret，也不发布任何资源；正式 workflow 直接消费已验证 ZIP 解压出的 `_site`，
不得把这个 fixture 准备入口替代生产 provenance 链。

## 远程 smoke

- 测试文件：`tests/e2e/deployment.spec.ts`
- Playwright 配置：`playwright.deployment.config.ts`
- URL 由环境变量 `DEPLOYMENT_URL` 提供；测试不启动本地 dev/preview server。
- 覆盖：HTTPS URL、页面可加载、标题包含 PMBus、模式切换/只读命令参考/结果面板可见、
  精确 production CSP、恰好一个 beacon、exact repository href、无 page error、
  相关 document/script/stylesheet/font/image/fetch/XHR 无 4xx/5xx、390px viewport
  无横向滚动、L11 输入/结果闭环及既有计算器回归。
- 外部请求只允许当前 Pages deployment origin，以及以下两个精确目的地：
  `GET https://static.cloudflareinsights.com/beacon.min.js`（script）与
  `POST https://cloudflareinsights.com/cdn-cgi/rum`（fetch/xhr/ping/other）。
  两者均不接受额外 query、path、userinfo、protocol 或 port；其他外部请求一律失败。
  CSP 的 `connect-src` 仍使用上方经过审计的 origin 例外；运行时测试 allowlist
  进一步限定 RUM endpoint，不用未经验证的 CSP path-source 替代它。
  应用 JS、应用 CSS、KaTeX 字体与 `pages-overlay.css` 明确保持同源，unexpected
  external origins 必须为空。广告/隐私拦截或 Cloudflare 网络故障不扩大 allowlist；
  smoke 对预期 Cloudflare endpoints 同样使用受控 route stub，不依赖真实
  Cloudflare 服务成功；Pages 文档和同源资源仍通过真实网络加载。该测试验证
  HTML/CSP wiring 与 allowlist，不宣称 Cloudflare 服务健康。

## 发布后真实 Cloudflare Analytics 验收

v3.3.0 起，在声明一次 Release 与 Pages 上线验收全部完成前，必须在 Pages
workflow、FINAL `_site` 实体校验和 deterministic remote smoke 成功之后，独立
完成一次真实 Cloudflare network acceptance。普通 PR CI、本地 overlay smoke 和
deterministic remote smoke 继续 stub Cloudflare，不依赖第三方 uptime。

使用一次性 Playwright 检查和现有 Chromium：新建干净 context，无广告拦截、
隐私扩展、request blocking 或 `stubCloudflare()`，访问正式 HTTPS Pages URL。
导航前注册 request/response、console 与 pageerror observers，并要求：

1. 主页面 HTTP 200、版本正确、production CSP 与 repository link 符合上述合同。
2. 真实 `GET https://static.cloudflareinsights.com/beacon.min.js`（script）收到
   成功 2xx response；只加载这一份外部 module。
3. 真实 `POST https://cloudflareinsights.com/cdn-cgi/rum` 收到成功 2xx response，
   URL 不含 query 或其他变体。页面稳定后可导航到 `about:blank`，以真实
   visibility-hidden/sendBeacon 行为触发上报，并等待已开始请求的 response。
4. 没有 hostname mismatch、Access-Control-Allow-Origin/CORS 错误、未知外部
   请求或计算器 page error。应用 JS/CSS、字体与 overlay CSS 仍全部同源。

只记录 URL、方法、资源类型、状态码和脱敏后的通过/失败结论；不得记录完整
`data-cf-beacon`、token、RUM request body 或含 token 的 headers/payload。
该检查不修改 Release ZIP，不进入普通 build，不添加框架或长期依赖。

beacon 成功但未出现 RUM 时不得按通过处理：检查当前官方 beacon 行为、
Origin/Referer、Cloudflare site hostname 与 token/site 配对。CORS hostname
mismatch 是 Analytics 部署失败，不能用 deterministic smoke 的绿色结果替代。
第三方临时故障须与本站配置缺陷区分；保持 CSP 和 endpoint allowlist 不变，
报告真实 Analytics 验收未完成。已公开 immutable Release 出现真实代码缺陷时，
只能通过后续 SemVer 发行修复，不得移动 tag、替换资产或临时部署 main。

## 部署后全清单实体验证

- 脚本：`scripts/verify-pages-entities.mjs`（`.github/workflows/pages.yml` 的
  "Verify deployed Pages entities" 步骤，位于 deploy-pages 之后、远程 smoke 之前）。
- 清单**动态**来自 overlay 已通过独立 verifier 的 FINAL `_site`：每个文件产生一个
  相对 URL，文件数与 asset 名不硬编码；变更后的 `index.html` 和新增
  `pages-overlay.css` 自动纳入。Cloudflare 远程 beacon JS 不在本地树中，不下载或
  加入该 manifest。
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

- **重新部署符合条件的稳定 Release：** 先按「部署原则」确认候选 Release 的
  `immutable: true` 与其 tag tree 中的校验门禁，再从该 tag ref 手动触发 Pages，
  `inputs.release_tag` 必须同名。仅“是上一个稳定版”不足以成为回滚候选。
- **发布新的 PATCH：** 没有合格回滚候选或需要改变产品字节时，按
  [RELEASING](RELEASING.md) 创建新的 PATCH 版本；合入 main 并完成发行验证后发布
  Release，由 Pages 部署新版本。
- **禁止移动旧 tag。** 旧 tag 必须保持在原 commit 上。
- 生产站点故障不允许绕过上述候选条件；不得修改、移动或删除已发布的 Release 与资产。

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

### Cloudflare Environment Secret（一次性配置）

在 `laipeng101/pmbus-calculator` 的 Settings → Environments → `github-pages` →
Environment secrets 添加 **`CLOUDFLARE_WEB_ANALYTICS_TOKEN`**，值为官方站点的
Cloudflare Web Analytics site token。它是客户端 site token，不是 Cloudflare API
credential；仍必须仅以 Environment Secret 保存，避免官方部署配置进入 tracked
source、clone、普通 build 或 Release ZIP。

Environment Secret 的访问权限属于引用 `github-pages` environment 的 job；
本 workflow 仅在 overlay/verifier 两个 step 的 `env` 引用并传入 secret，
不设置 job/workflow 级 token 环境变量。脚本从
`process.env.CLOUDFLARE_WEB_ANALYTICS_TOKEN` 读取并校验，禁止 CLI token argument、
`VITE_*` 注入、提交 `.env`、写入 `vite.config.ts` 或在 stdout/stderr 打印完整值。
token 缺失或格式错误时在 deploy-pages 之前 fail closed。无配置权限时，完成仓库
实现与本地合成 token 验证，保留这一项管理员配置步骤；不得改为提交 token。

部署 overlay 随 v3.3.0 的 tag tree 引入；它不追溯更改旧 tag 的 workflow 或已发布
Release。相同 token 是确定性输入的一部分，变更 Environment Secret 会有意改变
下一次 Pages `index.html` 的部署字节，但仍不改变 Release ZIP。

## 安全与权限

- Pages workflow 使用最小权限：`contents: read`、`pages: write`、`id-token: write`。
- 所有 GitHub Actions 固定到官方 Release 的完整 commit SHA。
- 站点不设置自定义域名，只使用默认 `laipeng101.github.io` 域名。
