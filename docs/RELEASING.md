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
- Release 和 Pages 是实时发布状态的权威来源；README 不重复维护“最新 Pages 已成功”类状态，避免发布后再产生补文档 PR。
- 发布后除非发现真实运行缺陷，不得创建补测试/补文档 PR；若发布后发现真实缺陷，按 SemVer 规则准备下一个 PATCH（例如 `v1.1.5`），不得移动已发布 tag。
- GitHub Release 是当前正式发行渠道，不发布 npm 包（`private: true`，不得执行 `npm publish`）。
- Pages 只部署不可变 GitHub Release 资产，不部署 main 的临时构建。
- 版本跨文件一致性由 `npm run check:release-contract` 离线门禁保证（已接入 `npm run verify` 与 full CI）。

## 中断恢复

若 `npm run release:prepare-assets` 被中断（Ctrl+C、进程崩溃、断电等），
可能遗留锁文件或备份目录。以下命令用于显式恢复：

- **锁文件恢复**：`node scripts/prepare-release-assets.mjs --recover-lock`
  仅当锁的 PID 确已不存在、repo 路径匹配、元数据完整且 schema 已知时删除锁文件。
  PID 仍在运行、EPERM 或未知 schema 时拒绝恢复，需人工审计。这是唯一可以在
  未持有互斥锁的情况下操作锁文件的命令。

- **事务恢复**：`node scripts/prepare-release-assets.mjs --recover`
  与普通生成一样**必须先获取互斥锁**；活跃锁存在时拒绝执行。
  恢复前对 backup 做深度验证（恰好两个普通文件、SHA256SUMS 单行匹配实际 hash、
  verify_release_zip.py 通过）；PRE_COMMIT + backup 时，在删除或 rename 任何路径
  **之前**先将 backup 的 zip+sums 实际 hash 与 journal.oldSha256 比较，不匹配则
  零磁盘 mutation（journal/backup/output 全部原样保留）并要求人工审计；output 与
  backup 同时存在时按 versioned transaction journal 裁决：PRE_COMMIT 恢复已验证
  旧 backup，COMMITTED 保留已验证新 output 仅清理残余 backup；journal
  缺失/损坏/未知 schema 一律拒绝并要求人工审计。多个 backup 一律拒绝。恢复完成后
  重新验证正式 output。损坏的 backup 绝不会被 rename 为正式 output。
  事务在信号/中断下的最终磁盘状态只能是：已验证 committed output，或 journal 可
  自动恢复的明确 PRE_COMMIT 状态；不允许不确定 topology。

- **不得自动删除**：无效 JSON、权限不明、未知 schema 的锁不会被自动删除；
  中断后的备份也不被自动移除。始终使用显式恢复命令或人工审计后清理。

- **`npm run clean` 不清理锁文件**（M27 起修正）：`.release-staging.lock` 永远
  不是 clean 目标——只有 `--recover-lock` 在证明 owner PID 已死后才可删除它。
  锁存在时 cleaner fail closed，在删除任何 release 目标（`release-output/`、
  `.release-staging/`、transaction journal、backup 目录）之前停止并退出非零。

- **锁状态处理**：
  - 活跃锁（owner PID 存活）：普通生成/--force/--recover 全部拒绝，等待或人工介入；
  - 无效/不完整元数据锁：acquire 与 recover 均拒绝，需人工审计后手工处理；
  - EPERM/PID 状态不明：拒绝自动恢复，需人工确认进程状态；
  - SIGINT/SIGTERM：持有锁时尽可能释放 owned lock；无法释放时保留完整可恢复
    元数据（--recover-lock 可清理），绝不删除非 owned 的锁。

- **重复信号（M30 WP-A）**：SIGINT/SIGTERM 的 listeners 从锁获取前注册、到
  `lock.release` 完成**之后**才移除；第一个信号决定最终退出码（SIGINT=130、
  SIGTERM=143），后续相同或不同信号只记录 `termination already in progress`，
  任何重复信号都不会触发默认 raw death（进程总是受控退出、锁总是被释放）。
  signal 被观察后，本次运行不得输出 `Done:` 或 `Transaction recovered
successfully` 等完整成功声明。

- **子进程/进程树（M30 WP-B）**：helper/verifier 通过受控 `execFileAsync`
  执行——Promise 只在子进程 `close` 后 settle；timeout 先请求停止（POSIX 向
  整个进程组发 SIGTERM）、等待 close、必要时升级 SIGKILL、清理后代后才
  reject；stdin EPIPE 等流错误被捕获为受控 rejection，绝不作为 unhandled
  stream error 崩溃；active-child registry 在锁释放前必须为空（否则拒绝
  释放并保留恢复元数据）。POSIX 使用独立进程组，helper 的孙进程无法在
  Promise settle 后继续存活写 release 路径；Windows 无进程组，仅杀直接
  子进程（文档化 fail-closed 边界）。

## 发布流程

### 1. 版本准备（实现 PR 内完成）

1. 在目标 `origin/main` 之上创建实现分支，完成代码、测试与文档变更。
2. 用无 tag 的版本更新方式（例如 `npm version 1.1.4 --no-git-tag-version`）同步
   `package.json` 与 `package-lock.json`。
3. 更新 `CHANGELOG.md`（保留新的空 `[Unreleased]`，新增 `[X.Y.Z] - 实际发布日期`）、
   `docs/releases/vX.Y.Z.md`、两份 README 的 stable/live/Release/SHA256SUMS 链接、
   `docs/ROADMAP.md` 的 stable release 声明。
4. `npm run check:release-contract` 必须在提交前通过。

### 2. 合入 main（M19-B 模型）

1. 本地完整验证（`npm run verify`，UI 变更另加 `npm run test:e2e:visual`）通过后，
   一次 push 源分支并创建 PR。
2. 等待 PR 最新 head SHA 的 required check（full CI）成功，记录 run URL、`head_sha`
   与 `Record checked revision` 步骤输出的 `checked_sha`/`checked_tree`。
3. 普通 merge commit 合入 main（不 squash）。
4. `git fetch origin` 后比较 main merge SHA 的 `HEAD^{tree}` 与 PR CI 记录的
   `checked_tree`：
   - 完全相同：验证完成，不重复执行第二次 CI；
   - 不一致：属于真实阻塞，立即用 `workflow_dispatch` 对精确 merge SHA 执行
     full CI 并定位原因，未解决前不得继续发布。
5. main 不再有 push CI（M19-B）；不存在“等待 main push CI 全绿”这一步。

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
   生成过程自动调用 `verify_release_zip.py` 与 `shasum -a 256 -c` 反向验证。
3. zip 可解压；内容只来自最终 `dist/`；`index.html` 资源路径与 CSP 正确；
   不包含源码、`node_modules`、source map 或临时文件。
4. 再次运行 `npm run release:prepare-assets -- --force` 以验证可复现性（两次
   zip hash 必须完全相同）。

以上任一步失败：停止发布并修复，不得带病打 tag。

### 4. tag 与 GitHub Release

1. 全部验证成功后创建 annotated tag：

   ```bash
   git tag -a vX.Y.Z <exact-merge-sha> -m "PMBus Calculator vX.Y.Z"
   ```

2. 推送 tag 前再次确认 `git rev-parse vX.Y.Z^{commit}` 等于已验证 merge SHA、
   `vX.Y.Z^{tree}` 等于已验证 tree，然后推送 tag。
   tag push 是 PR 合并后的独立发布动作，不是源代码分支的第二次 push。
3. 创建 GitHub Release：
   - tag `vX.Y.Z`；非 draft、非 prerelease；
   - Release notes 使用 `docs/releases/vX.Y.Z.md`；
   - 上传 `pmbus-calculator-vX.Y.Z-web.zip` 与 `SHA256SUMS.txt`。
4. 下载刚发布的两个资产，重新校验 checksum 与预期名称。
5. 若 tag 已存在或远端版本冲突：停止，不得移动或覆盖。

### 5. Pages 部署与线上 smoke

1. `release published` 事件自动触发 Pages workflow（或手动 dispatch 传入 tag）；
   等待其成功。部署顺序与校验细节见 `docs/DEPLOYING.md`（Release → Pages →
   deployment smoke）。
2. 对正式 Pages URL 执行 `DEPLOYMENT_URL=<url> npm run test:e2e:deployment`；
   全部 deployment tests 必须真实运行并通过，不得记为 skip。
3. 确认线上页面来自对应 Release 资产，而非 main 临时构建。
4. 清理任务分支、detached worktree 与临时产物。

## 稳定公共契约

稳定公共契约定义为：

- L11 / L16 / DIRECT / HALF 的计算和舍入语义。
- raw word、字节序和复制格式。
- 命令元数据行为。
- 已持久化的用户偏好。
- README 中声明的用户流程。

任何不向后兼容地改变以上稳定公共契约的变更必须提升 MAJOR 版本；
向后兼容的新能力使用 MINOR，兼容性修复使用 PATCH。
