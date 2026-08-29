# RELEASING

本项目首次稳定发行统一为 **v1.0.0**。后续所有发行遵循本文件。

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
- `package.json` 版本必须和最新稳定 tag 一致。
- 禁止在验证完成前创建或推送 tag；tag 永远建立在已通过完整验证的精确 main merge SHA 上。
- Release 和 Pages 是实时发布状态的权威来源；README 不重复维护“最新 Pages 已成功”类状态。
- 发布后除非发现真实运行缺陷，不得创建补测试/补文档 PR；若发布后发现真实缺陷，按 SemVer
  规则准备下一个 PATCH（例如 `v1.1.5`），不得移动已发布 tag。
- GitHub Release 是当前正式发行渠道，不发布 npm 包（`private: true`，不得执行 `npm publish`）。
- Pages 只部署不可变 GitHub Release 资产，不部署 main 的临时构建。
- 版本跨文件一致性由 `npm run check:release-contract` 离线门禁保证（已接入 `npm run verify` 与 CI）。

## 发布流程

### 1. 版本准备（实现 PR 内完成）

1. 在目标 `origin/main` 之上创建实现分支，完成代码、测试与文档变更。
2. 用无 tag 的版本更新方式（例如 `npm version 1.1.4 --no-git-tag-version`）同步
   `package.json` 与 `package-lock.json`。
3. 更新 `CHANGELOG.md`（保留新的空 `[Unreleased]`，新增 `[X.Y.Z] - 实际发布日期`）、
   `docs/releases/vX.Y.Z.md`、两份 README 的 stable/live/Release/SHA256SUMS 链接、
   `docs/ROADMAP.md` 的 stable release 声明。
4. `npm run check:release-contract` 必须在提交前通过。

### 2. 合入 main

1. 本地完整验证（`npm run verify`，UI 变更另加 `npm run test:e2e:visual`）通过后，
   一次 push 源分支并创建 PR。
2. 等待 PR 最新 head SHA 的 required check（CI）成功。
3. 普通 merge commit 合入 main（不 squash）。
4. `git fetch origin` 后比较 PR CI `Record checked revision` 步骤记录的 `checked_tree` 与
   main merge SHA 的 `HEAD^{tree}`：
   - 完全相同：验证完成，不重复执行第二次 CI；
   - 不一致：属于真实阻塞，立即用 `workflow_dispatch` 对精确 merge SHA 执行 full CI
     并定位原因，未解决前不得继续发布。
5. main 不再有 push CI；不存在“等待 main push CI 全绿”这一步。

### 3. 发布前验证（tag 之前，强制）

tree 审计成功后才允许进入本阶段。在精确 merge SHA 上创建干净 detached worktree，
在其中 fresh 执行全部步骤，不得复用 PR 工作区旧产物：

```bash
git worktree add --detach <path> <exact-merge-sha>
cd <path>
npm ci
npx playwright install chromium        # 或核对既有安装
npm run typecheck
npm run verify
npm run test:e2e:visual
npm run build
npm run test:e2e:release
```

然后生成并校验发行资产：

1. 运行 `npm run release:prepare-assets`（`scripts/prepare-release-assets.mjs`），
   该命令从 `dist/` 生成 `pmbus-calculator-vX.Y.Z-web.zip` 与 `SHA256SUMS.txt`，
   输出到 `release-output/`；版本唯一来源是 `package.json`。
2. 资产生成是确定性的：相同 `dist/` 两次生成，zip 与 SHA256SUMS 逐字节一致。
   生成过程自动调用 `verify_release_zip.py` 与 checksum 反向验证。
3. zip 可解压；内容只来自最终 `dist/`；`index.html` 资源路径与 CSP 正确；
   不包含源码、`node_modules`、source map 或临时文件。
4. 再次运行 `npm run release:prepare-assets -- --force` 以验证可复现性（两次
   zip hash 必须完全相同）。

以上任一步失败：停止发布并修复，不得带病打 tag。

### 4. tag 与 GitHub Release（draft → 上传 → 回验 → publish）

> v2.5.8 起发布流程固定为 **先创建 draft，上传并回验全部资产，最后才 publish**。
> 「最终态是非 draft」不等于「创建时就必须公开」：v2.5.7 曾按"先公开、后上传资产"
> 执行，release-published 事件触发的 Pages 在资产尚未存在时读取失败。本节顺序
> 是对该竞态的流程修复，不是可选优化。

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
   gh release upload vX.Y.Z pmbus-calculator-vX.Y.Z-web.zip SHA256SUMS.txt
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

   v2.5.12 起这是**唯一**的 publish 前资产门禁（脚本：
   `scripts/verify-downloaded-assets.mjs`），它在进程内复用
   `release-assets-verify.mjs` 的完整元数据合同（tag/prerelease、资产存在
   且名称唯一、`state == "uploaded"`、`size > 0`、draft 模式接受 GitHub 的
   `untagged-<hex>` 占位 URL），并叠加本地字节校验：文件存在且为普通文件、
   本地字节数等于元数据 size、`SHA256SUMS.txt` 严格格式合同、ZIP 的
   SHA-256（node:crypto，跨平台）与共享 python ZIP 安全校验。失败按类分级
   报告：元数据 2-8、本地缺失 10、大小不符 11、sums 合同 12、checksum 13、
   ZIP 安全 14。stdout 只输出一个 JSON 对象（数据），诊断走 stderr——不要
   把它的输出交给 `source`/`eval` 等会再次解释文本的机制（v2.5.9：元数据
   只作为数据）。Pages 侧的下载消费由 `scripts/download-release-assets.mjs`
   在 5 分钟共享总预算内完成（v2.5.10：预算覆盖两项资产、重试与 backoff，
   不因重试重置，远小于 Pages job 的 20 分钟上限；v2.5.11：网络 reject 与
   HTTP 408/429/5xx 走同一有界退避并计入预算，共享 deadline 触发的 abort
   不再重试）。**任何一项失败都停止在 draft 状态，不得 publish。**

6. 两项资产回验通过后，将 draft 公开为稳定 Release：

   ```bash
   gh release edit vX.Y.Z --draft=false
   ```

7. 下载刚发布的两个资产，重新校验 checksum 与预期名称（公开态复核）。
8. 若 tag 已存在或远端版本冲突：停止，不得移动或覆盖。

### 5. Pages 部署与线上 smoke

1. `release published` 事件自动触发 Pages workflow（或手动 dispatch 传入 tag）；
   等待其成功。部署顺序与校验细节见 `docs/DEPLOYING.md`（Release → Pages →
   deployment smoke）。
2. 对正式 Pages URL 执行 `DEPLOYMENT_URL=<url> npm run test:e2e:deployment`；
   全部 deployment tests 必须真实运行并通过，不得记为 skip。
3. 确认线上页面来自对应 Release 资产，而非 main 临时构建。
4. 清理任务分支、detached worktree 与临时产物。

## 失败处理

- 发布资产生成失败时，`release-output/` 保持旧值或不存在；可丢弃的临时 staging 残留
  （`.release-staging/`）可安全清理。恢复方式就是**清理临时输出并重新执行**：
  `npm run clean` 后重新 `npm run build` 与 `npm run release:prepare-assets`。
- 不维护长期 release 锁、事务 journal 或恢复命令；生成流程不支持并发运行，
  不要在多个进程同时执行 `release:prepare-assets`。
- 中断（Ctrl+C、进程崩溃）后的处理与上述失败处理相同：清理临时输出并重新执行。

## 稳定公共契约

稳定公共契约定义为：

- L11 / L16 / DIRECT / HALF 的计算和舍入语义。
- raw word、字节序和复制格式。
- 命令元数据行为。
- 已持久化的用户偏好。
- README 中声明的用户流程。

任何不向后兼容地改变以上稳定公共契约的变更必须提升 MAJOR 版本；
向后兼容的新能力使用 MINOR，兼容性修复使用 PATCH。
