# RELEASING

取得发行授权后，按下列流程准备、验证并发布稳定版本。

## 版本号规则

- 使用 Semantic Versioning 2.0.0（https://semver.org/spec/v2.0.0.html）。
- `package.json` 中的 package version 不带 `v`（例如 `1.0.0`）。
- Git tag 带 `v`（例如 `v1.0.0`）。
- PATCH：向后兼容的 bug、安全、文档或构建修复。
- MINOR：向后兼容的新功能。
- MAJOR：计算语义、持久化数据、现有用户流程等不兼容变化。
- prerelease 使用 `1.1.0-rc.1` 格式。

## 发布纪律

- 已发布的 tag 和 GitHub Release 永不修改、移动或覆盖。
- 新 Release 受 GitHub immutable releases 保护。发布前复核仓库设置已启用，发布后通过 Release API 确认 `immutable: true`。
- 手动 Pages 部署与回滚只接受不可变的稳定 Release，且目标 tag 的源码树已包含 immutable 门禁（v2.6.2 起）。`workflow_dispatch` 使用目标 tag 自带的工作流与校验器。v2.5.12 及更早的 mutable Release 不作为候选。
- tag 必须建立在已完成独立发布前验证的精确 main merge SHA 上。实际发行与部署状态以 GitHub Release 和 Pages 验收记录为准。
- GitHub Release 是正式发行渠道。`package.json` 保持 `private: true`，不执行 `npm publish`。

## 发布流程

### 1. 版本准备（实现 PR 内完成）

1. 用无 tag 的版本更新方式（例如 `npm version 1.1.4 --no-git-tag-version`）同步
   `package.json` 与 `package-lock.json`。
2. 更新 `CHANGELOG.md`（保留新的空 `[Unreleased]`，新增 `[X.Y.Z] - YYYY-MM-DD`）、
   `docs/releases/vX.Y.Z.md`、两份 README 的 stable/live/Release/SHA256SUMS 链接、
   `docs/ROADMAP.md` 的 stable release 声明。
   尚未获准正式发布时，日期使用准备日期并紧接明确的待发布说明；README Live
   Demo 标注 release target / 发布目标，ROADMAP 的 stable release 声明同样标注
   发布准备。最终验证前复核实际日期，将临时“尚未创建/发布”措辞改为条件声明：
   本源码为对应版本的发行目标，稳定 Release 公开前按待发布处理，发行/部署
   状态以 GitHub Release / Pages 验收为准。这样无需发布后修改不可变 tag 文档，
   也不得在版本准备 PR 中声称已经发布或部署。
3. `npm run check:release-contract` 必须在提交前通过。

### 2. 合入 main

按 [CONTRIBUTING](../CONTRIBUTING.md) 完成本地验证、PR CI、合并与最终 main merge tree 核对。发行准备运行 `npm run verify` 完整门禁，UI 变更另加 `npm run test:e2e:visual`。

### 3. 发布前验证（tag 之前，强制）

tree 审计成功后才允许进入本阶段。在精确 merge SHA 上创建干净 detached worktree，
在其中 fresh 执行全部步骤，不得复用 PR 工作区旧产物：

```bash
git worktree add --detach <path> <exact-merge-sha>
cd <path>
npm ci
npm run test:e2e:install               # chromium + firefox + webkit，或核对既有安装
npm run verify
npm run test:e2e:visual
```

`verify` 已包含的检查取本次独立运行的结果。源码、配置或依赖在验证后发生变化时，重验受影响项。
本阶段使用精确 Cloudflare stub，保留本机隐私设置。真实第三方验收和网络受阻的结果归类见 [DEPLOYING](DEPLOYING.md#发布后真实-cloudflare-analytics-验收)。

然后生成并校验发行资产：

1. 运行 `npm run release:prepare-assets`（`scripts/prepare-release-assets.mjs`），
   该命令从 `dist/` 生成 `pmbus-calculator-vX.Y.Z-web.zip` 与 `SHA256SUMS.txt`，
   输出到 `release-output/`；版本唯一来源是 `package.json`。
2. 资产生成是确定性的：相同 `dist/` 两次生成，zip 与 SHA256SUMS 逐字节一致。
   生成过程自动调用 `verify_release_zip.py` 与 checksum 反向验证。
3. zip 可解压；内容只来自最终 `dist/`；`index.html` 资源路径与 CSP 正确；
   不包含源码、`node_modules`、source map 或临时文件。普通 build 与 Release ZIP
   必须没有 Cloudflare beacon/域名、部署 token、Pages-only repository marker
   或 `pages-overlay.css`；Release smoke 和 ZIP 合同对此提供负向回归门禁。
4. 再次运行 `npm run release:prepare-assets -- --force` 以验证可复现性（两次
   zip hash 必须完全相同）。

全部检查通过后才创建 tag。

### 4. tag 与 GitHub Release（draft → 上传 → 回验 → publish）

先创建 draft，上传并回验全部资产，再公开 Release。`release published` 事件立即触发 Pages 部署。

0. **平台前置条件复核（tag/draft 之前，人工授权步骤）**：

   ```bash
   gh api repos/laipeng101/pmbus-calculator/immutable-releases
   gh api repos/laipeng101/pmbus-calculator --jq '{full_name, permissions: .permissions.admin}'
   git ls-remote --tags origin refs/tags/vX.Y.Z
   ```

   三项必须分别满足：immutable releases 返回 `enabled: true`（未启用时先以
   admin 执行 `gh api --method PUT repos/laipeng101/pmbus-calculator/immutable-releases`
   并再次 GET 复核；该设置只影响未来 Release）；authenticated 身份对
   `laipeng101/pmbus-calculator` 具有 admin 权限且 full_name 与预期仓库一致；
   目标 tag 不存在。任一不满足：停止发布并解决前置条件，不得绕过。
   设置查询/启用属于发布前人工步骤，Pages workflow 不持有也不需要 admin 权限。

1. 全部验证成功后创建 annotated tag：

   ```bash
   git tag -a vX.Y.Z <exact-merge-sha> -m "PMBus Calculator vX.Y.Z"
   ```

2. 推送 tag 前再次确认 `git rev-parse vX.Y.Z^{commit}` 等于已验证 merge SHA、
   `vX.Y.Z^{tree}` 等于已验证 tree，然后推送 tag。
   tag push 是 PR 合并后的独立发布动作，不是源代码分支的第二次 push。
3. 创建 **draft** Release（不勾选 prerelease；notes 使用 `docs/releases/vX.Y.Z.md`）：

   ```bash
   gh release create vX.Y.Z --draft --title "PMBus Calculator vX.Y.Z" \
     --notes-file docs/releases/vX.Y.Z.md
   ```

4. 上传 `pmbus-calculator-vX.Y.Z-web.zip` 与 `SHA256SUMS.txt`（不使用 clobber）：

   ```bash
   gh release upload vX.Y.Z release-output/pmbus-calculator-vX.Y.Z-web.zip \
     release-output/SHA256SUMS.txt
   ```

5. **publish 前强制回验 draft 资产**。draft 不可经 `/releases/tags/<tag>` 读取，
   用 release list 过滤出 REST 形状的元数据后运行统一字节门禁：

   ```bash
   gh api repos/laipeng101/pmbus-calculator/releases \
     --jq '.[] | select(.tag_name=="vX.Y.Z")' > draft-release.json
   gh release download vX.Y.Z --dir /tmp/vX.Y.Z-draft-assets
   node scripts/verify-downloaded-assets.mjs --metadata draft-release.json \
     --dir /tmp/vX.Y.Z-draft-assets \
     --tag vX.Y.Z --repo laipeng101/pmbus-calculator --mode draft > draft-verified.json
   ```

   统一字节门禁验证元数据、普通文件、文件大小、校验和与 ZIP 安全；draft 模式接受 GitHub 的 `untagged-<hex>` 占位 URL。退出码与发布态约束见 [Pages workflow](DEPLOYING.md#pages-workflow)。stdout 的 JSON 仅作为数据读取。任一检查失败时保持 draft。

6. 两项资产回验通过后，将 draft 公开为稳定 Release：

   ```bash
   gh release edit vX.Y.Z --draft=false
   ```

7. 下载刚发布的两个资产，重新校验 checksum 与预期名称（公开态复核）。
8. **publish 后不可变与完整性复核**：

   ```bash
   gh api repos/laipeng101/pmbus-calculator/releases/tags/vX.Y.Z \
     --jq '{draft, prerelease, immutable, tag_name}'
   gh release verify vX.Y.Z        # 校验 Release 加密签名 attestation（CLI 支持时）
   gh release verify-asset vX.Y.Z pmbus-calculator-vX.Y.Z-web.zip
   ```

   API 必须报告 `draft: false`、`prerelease: false`、`immutable: true` 且
   `tag_name` 精确匹配；`gh release verify` / `verify-asset` 校验资产
   attestation（CLI 不支持时以匿名重新下载的 SHA-256 与 size 复核为准）。若 `immutable` 不是 `true`：保留现场、停止
   声明完成，不得删除重建同名 Release，也不得移动 tag。

9. 若 tag 已存在或远端版本冲突：停止，不得移动或覆盖。

### 5. Pages 部署与线上 smoke

1. 发布前核对 [`github-pages` Environment 部署策略](DEPLOYING.md#environment-部署策略)与其中的 Cloudflare Analytics secret 配置。
2. 核对精确 tag 和 SHA 的 [Pages workflow](DEPLOYING.md#pages-workflow)运行记录。完整上线验收要求不可变 Release 复核成功、Pages 工作流的全部部署前与部署后门禁通过，包括正式 URL 的 remote smoke 与同一 GitHub-hosted job 的真实 Analytics 验收。记录其 run URL 与实际结果。
3. 部署完成而验收失败时，分别记录部署与验收状态。真实 Analytics 的验收信号和故障处置见[部署说明](DEPLOYING.md#发布后真实-cloudflare-analytics-验收)。
4. 验收完成后，清理为本次发行创建的 detached worktree 与无需保留的临时产物。

## 失败处理

- 发布资产生成失败时，`release-output/` 保持旧值或不存在；可丢弃的临时 staging 残留
  （`.release-staging/`）可安全清理。恢复方式就是**清理临时输出并重新执行**：
  `npm run clean` 后重新 `npm run build` 与 `npm run release:prepare-assets`。
- 不维护长期 release 锁、事务 journal 或恢复命令；生成流程不支持并发运行，
  不要在多个进程同时执行 `release:prepare-assets`。
- 中断（Ctrl+C、进程崩溃）后的处理与上述失败处理相同：清理临时输出并重新执行。
- post-deploy real acceptance 失败不改变 Release 的 immutable 状态；不能移动 tag、
  替换 assets 或自动回滚。真实代码/部署配置缺陷按后续 PATCH 修复。明确瞬时
  Cloudflare 故障保留失败证据后，可按 [DEPLOYING](DEPLOYING.md) 的既有受控
  dispatch 规则，从同一 immutable tag ref、同名 release input 重跑 Pages workflow；
  不从 main 部署、不放宽 CSP/allowlist，全部 provenance 门禁仍须重新通过。

## 稳定公共契约

稳定公共契约定义为：

- L11 / L16 / DIRECT / HALF 的计算和舍入语义。
- raw word、字节序和复制格式。
- 命令元数据行为。
- 已持久化的用户偏好。
- README 中声明的用户流程。

任何不向后兼容地改变以上稳定公共契约的变更必须提升 MAJOR 版本；
向后兼容的新能力使用 MINOR，兼容性修复使用 PATCH。
