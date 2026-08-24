# ROADMAP

> 本文件是里程碑状态的唯一事实来源。不要在其他文档中重复维护进度表。
> 历史完整快照见 [`docs/archive/web-refactor-m0-m10.1/`](archive/web-refactor-m0-m10.1/README.md)。

最后更新：2026-08-25（M34 done：child-state invariant safety、bounded signal termination、deterministic release-security gate 与 truthful stress evidence，v1.1.11 工程基线，未发布新版本）

## 当前产品基线

- Web-first PMBus Calculator 是主线；技术栈为 Vite + React 19 + TypeScript + Tailwind CSS + Vitest + Playwright。
- L11 / L16 / DIRECT / HALF 四种模式均已双向闭环，并有 Vitest + Playwright 回归覆盖。
- PMBus 规范基线：PMBus 1.3。Rev 1.3.1 冲突仍以显式 conflict 模型呈现；1.5 不评估、不声明兼容。
- 维护基线：第三方规范 PDF 不进入当前 Git tree；官方来源、字节数和 SHA-256 统一维护在
  `document/specifications.json`，开发者按需从官方 URL 下载到 ignored `.cache/specifications/`。
  这是分发边界维护，不是规范升级，不创建新的产品版本里程碑，也不把 PMBus 1.5 升级标成已开始。
- `pmbus-calculator.html` 保留为 read-only legacy fallback，不删除、不移动、不重写。
- 命令元数据唯一数据源：`src/legacy/command-metadata.ts`。

## 当前里程碑

```text
M0–M34 complete；stable release v1.1.11；production distribution: GitHub Pages；当前无活动功能里程碑。
```

### M31 done — release lifecycle 证据加固、跨平台 fail-closed 与验证去重（v1.1.11 工程基线，未发布新版本）

- 本地与 CI 门禁一致并去重（WP-A）：`npm run verify` 接入 `npm run test:release-security`
  （zero-skip runner），本地完整门禁与 CI full tier 对齐；新增独立 coverage 配置
  `vitest.coverage.config.ts`，从共享 `SECURITY_TEST_FILES` **精确排除**九个 security
  suite（单一来源、禁止复制文件名列表，新增 security suite 自动排除）；coverage 范围
  （`src/app`、`src/legacy`）与阈值（80/80/70/80）与 `vite.config.ts` 保持一致；full CI
  保留独立零跳过 security step，每个 security suite 在 primary CI 中恰好执行一次；
  结构测试锁定：coverage 排除集与 `SECURITY_TEST_FILES` 完全一致、verify 必须包含
  zero-skip runner、CI 阶段顺序 coverage → security → Playwright（既有 ci-workflow
  断言保持）。实测：修改前 `test:coverage` 82.8s（813 测试，其中九文件 188 个重复）
  - security 83.4s（重复 188）；修改后 coverage 6.8s（34 文件/634 测试，九文件零执行）
  - security 83.5s（192 测试）——重复 188 → 0，验证总耗时约 166s → 约 90s。
- 严格 child/process-tree 生命周期证据（WP-B）：`<2048` 字节宽松断言替换为严格
  quiescence——settle 后等待稳定窗口、快照 sentinel size + sha256、再等待 ≥1.5s、
  两者必须完全不变（探针 P3 实证 `<2048` 在孙进程仍存活且慢速写时通过）；POSIX 测试
  记录孙进程 PID，settle 后 `kill(pid, 0)` 必须 ESRCH；新增直接子进程与孙进程**都忽略
  SIGTERM** 的场景，确认升级 SIGKILL 后全部消失（wrapper PID 与孙 PID 均 ESRCH）；
  escalation timer 保存引用并在 close/error settle 时清除（探针 B7 实证原实现遗留
  timer）；spawn 失败采用明确合同——未成功创建进程（如 ENOENT）在 `error` 事件上受控
  reject，成功 spawn 的 child 必须等 `close` 后 settle（探针 P5 实证原实现 error 分支
  抢先 settle，与“只在 close 后 settle”的绝对表述不符），JSDoc/RELEASING/测试同步；
  activeChildren 在所有 resolve/reject 路径最终为空（success/nonzero/timeout/kill-false/
  spawn error 全路径测试）；POSIX 严格进程树 stress 25 轮（normal/gc-ignore/both-ignore
  三场景）bad=0、0 残留进程。
- Windows 真正 fail-closed（WP-C）：release asset generation 暂定为 POSIX-only——新增
  可测试 platform capability gate（`SUPPORTED_GENERATION_PLATFORMS=['linux','darwin']`、
  `isSupportedPlatform`）；`runCli` 支持 platform 注入，Windows 上在 `--recover-lock`、
  创建锁、staging、journal、backup 或 output 等任何事务副作用之前直接 exit 2 并输出
  “仅支持 Linux/macOS”，测试断言零副作用（repo 根目录无任何条目）；`docs/RELEASING.md`
  删除“Windows 仅杀直接子进程是 fail-closed 边界”的错误说法（探针 P3/P4 实证
  direct-child-only kill 下孙进程存活并继续写 release 路径）；不新增第三方 process-kill
  依赖。
- 工具链与资源策略（WP-D）：canonical Node 24.19.0/npm 11.17.0 与 compatibility Node
  22.20.0/npm 11.17.0 全部保持（`.node-version`/`.nvmrc`/engines/packageManager/
  devEngines/CI/Pages 零改动）；compatibility setup-node 锁定 `package-manager-cache:
false`，npm 11.17.0 激活在 repo 外（`cd /tmp`）；ci-workflow 结构测试新增断言：
  compatibility setup 无 `cache: 'npm'`/`cache-dependency-path`；CI 注释与 RELEASING
  说明同一 job 中 primary 已恢复 npm 下载缓存、compatibility 不建立第二套缓存、
  node_modules 一律不缓存；RELEASING 新增“本地验证环境与磁盘策略”——长期只保留
  canonical Node、compat runtime 临时安装、worktree/node_modules 用完即删、`npm cache
verify` 不清空有效缓存、只保留 lockfile 对应 Playwright browser revision、不自动删除
  用户全局 Node/npm cache/Playwright 浏览器。
- 状态依据：本地 Node 24.19.0/npm 11.17.0 fresh `npm ci` + `npm run doctor` 0 +
  `npm run verify` 全绿（单测 826/43 文件、release-security 192 零 skip、coverage
  634/34 文件 92.92/89.18/95.18/94.83、e2e 236 passed/8 基线 skip、e2e:release 1、
  audit 0 high/critical、visual snapshot 零变化 +0/~0/-0）；Node 22.20.0/npm 11.17.0
  fresh worktree（精确 5fd6cf9）npm ci（postinstall worktree-skip 无 ENOTDIR）/
  typecheck/test:run 826/security 192/build 全过；POSIX 严格进程树 stress 25 轮 bad=0；
  PR/CI 审计证据见对应 PR 与 Actions 运行，不在本文件维护。

> **M31 strengthening（v1.1.11 工程基线）——以下 M30 表述在 M31 修复完成前超出实际实现：**
>
> 1. “coverage 与 security 门禁各自完整执行”：M30 的 `test:coverage` 会执行全部九个
>    security suite（探针 P2：coverage 813 测试中含九文件 188 个，随后 CI 的 zero-skip
>    step 又把同一 188 个跑一遍）；“每个 security suite 恰好执行一次”仅在 M31 独立
>    coverage 配置排除后成立。
> 2. “Promise 只在 child close 后 settle”：spawn 失败（如 ENOENT）时原实现在 `error`
>    事件上抢先 settle（探针 P5），绝对“只在 close 后 settle”表述超出实现；M31 明确
>    合同——未成功创建进程在 error 受控 reject、成功 spawn 的 child 等 close。
> 3. “Windows 无进程组，仅杀直接子进程（文档化 fail-closed 边界）”：该表述不成立
>    （探针 P3/P4：direct-child-only kill 下孙进程存活并继续写，activeChildren 只跟踪
>    直接子进程）；M31 改为 POSIX-only platform gate，Windows 在副作用前拒绝。
> 4. “子进程清理以 <2048 字节增长为证据”：宽松断言在慢速残留 writer 下仍通过
>    （探针 P3：settle 后孙进程存活、1200ms 只写 4 字节）；M31 以严格 quiescence
>    （size+sha256 稳定期后不变）与 `kill(pid,0)` ESRCH 替代。

> **M32 strengthening（v1.1.11 工程基线）——以下 M31 表述在 M32 修复完成前超出实际实现：**
>
> 1. “成功 spawn 的 child 必须等 `close` 后 settle / 孙进程无法在 Promise settle 后
>    继续存活写 release 路径”：direct child 的 `close` 不等于进程组消失（探针 P1：
>    孙进程**单独**忽略 SIGTERM、direct child 不忽略时，M31 实现在 close 后立即
>    settle，孙进程继续存活写 sentinel、`activeChildren` 已清空）；M32 改为 close
>    后必须 `kill(-pgid, 0)` 证明进程组消失（ESRCH）才 settle，否则向剩余组升级
>    SIGKILL 并有界轮询（50ms/10s deadline）到 ESRCH，该表述仅在 M32 之后成立。
> 2. “成功 spawn 后只等 close、error 仅代表 spawn 失败”：成功 spawn 后的
>    ChildProcess `error`（kill 失败/IPC 失败/abort）被 M31 当成 spawn 失败——reject
>    伪称 `failed to start`、误删仍存活进程的 registry 条目、遗留 escalation timer
>    （探针 P2）；M32 以 `spawn` 事件区分“从未成功 spawn”（ENOENT 等，立即受控
>    reject）与“post-spawn error”（记录 runtime error、不 settle、不清 registry、
>    继续受控终止、最终消息不伪称 `failed to start`），deadline 内无法证明组消失时
>    fail closed（registry 保留、runCli 拒绝释放锁），该表述仅在 M32 之后成立。
>
> ### M32 done — release process-group 真正闭环、post-spawn error 修复、验证合同单一来源与证据流程加固（v1.1.11 工程基线，未发布新版本）
>
> - 进程组生命周期状态机（WP-A）：`execFileAsync` 重构——`spawn` 事件确认成功创建
>   进程并在 spawn 时保存 PGID（close 后不再从可复用 PID 推断所有权）；只有“从未
>   成功 spawn”的 error（如 ENOENT）才立即 reject 并清空 registry（无进程可泄漏）；
>   成功 spawn 后的 error 记录为 runtime error：不 settle、不清 registry、继续受控
>   终止，最终消息绝不伪称 `failed to start`；timeout 后 direct child 的 `close`
>   不再是 settle 条件——必须 `kill(-pgid, 0)` 证明进程组消失（ESRCH），否则向剩余
>   组升级 SIGKILL 并有界轮询（导出可测的 `GROUP_SETTLE_POLL_MS=50` 与
>   `GROUP_SETTLE_DEADLINE_MS=10000`，无无限等待/随机重试）到 ESRCH；main/
>   escalation/termination-deadline/group-poll 四个 owned timer 全部在 settle 时
>   清除；有界 deadline 内仍无法证明进程组消失（EPERM/未知/kill 失败）→ fail
>   closed：reject 明确审计消息、registry 条目**保留**、runCli 拒绝释放 release 锁
>   （状态可恢复/可审计）；Windows POSIX-only gate 保持（不回退 direct-child-only
>   kill）。
> - 探针（修改前，未复用旧证据）：P1——direct 不忽略、grandchild 单独忽略 SIGTERM：
>   Promise 已因 timeout reject、wrapper 已退出，但 grandchild `kill(pid,0)` 仍成功、
>   `activeChildren.size===0`、settle 后 sentinel 117→369 字节持续增长（hash 变化）；
>   P2——成功 spawn 后经可控 kill 注入触发 ChildProcess `error`（EPERM，非 ENOENT）：
>   reject 伪称 `failed to start`、PID 仍存活、registry 被误删、timer created=2/
>   cleared=1（escalation 遗留）；P3——M31 的 `grandchildWrapper(..., true)` 把同一个
>   boolean 同时传给 wrapper 与 grandchild，B5/B6 未覆盖“仅孙进程忽略”的不对称组合；
>   P4——AGENTS.md/CONTRIBUTING.md 的 verify 展开缺失 `check:toolchain`、
>   `test:release-security`、`check:tailwind-scope`（package.json 与 CI 均有）；
>   P5——M31 commit `d82b13b` 首行为 `[agent/m31-… a9c310a]` 且含 `files changed`/
>   `create mode`（Git stdout 污染；已合并历史不重写，仅修正后续流程）。
> - 测试矩阵（WP-B）：新增 `tests/m32-child-group-lifecycle.test.ts`（第十个
>   release-security suite，加入共享 `SECURITY_TEST_FILES`，coverage 自动排除、
>   重复执行数仍为 0）：四种 SIGTERM 组合（direct/grandchild 各自忽略或不忽略——含
>   M31 缺失的“仅孙进程忽略”不对称组合，M3 为本轮核心红测）、post-spawn
>   SIGTERM/SIGKILL kill-error fail-closed（子进程隔离验证 registry 保留 + 锁不
>   释放）、ENOENT 受控早期 rejection、success/nonzero/timeout/kill-false/spawn
>   failure 全路径 registry 合同、timeout 路径双 PID ESRCH + 严格 quiescence（size+
>   sha256 稳定期后 ≥1.5s 不变）+ 四 timer 全 cleared；红测失败时 finally 强制清理
>   进程组，文件级 afterAll 兜底扫描（0 orphan）。
> - 验证合同单一来源（WP-C）：`package.json#scripts.verify`（17 步）为唯一事实来源
>   ——AGENTS.md/CONTRIBUTING.md 的 verify 展开与它逐项完全一致（结构测试 V2/V3
>   检测缺失/重复/顺序，不只断言 substring）；ci.yml full-tier 核心步骤与 verify
>   相对顺序一致（typecheck/lint 移回 `check:markdown-math` 之前；`check:repo-hygiene`
>   在 CI 无条件前置、whitespace 为一次 base..head 检查，均为设计差异并豁免）；
>   coverage 范围/阈值/排除抽取到共享 `scripts/vitest-shared-config.mjs`，
>   `vite.config.ts` 与 `vitest.coverage.config.ts` 消费同一来源（不再手工复制、
>   不再靠事后比对维持一致）；security 排除仍来自 `SECURITY_TEST_FILES` spread
>   （V7 断言源码无字面量文件列表）；PR 模板 M31 一次性字段改为条件化
>   release-security 字段（非 release 任务明确填 N/A）。
> - 证据流程加固（WP-D）：commit message 独立文件创建、push 前 `git show -s
--format=%B` 核对（subject 格式 + 无 Git 输出污染 + `--stat` 与 PR 描述一致）；
>   长任务日志统一 `command >log 2>&1; rc=$?; tail -80 "$log"; exit "$rc"`；
>   同一失败命令不原样重试（先定位根因再改变策略）；最终完整 verify 只在最后一次
>   源码/配置/文档修改之后运行。
> - 状态依据：本地 Node 24.19.0/npm 11.17.0 fresh `npm ci` + `npm run verify` 全绿
>   （单测/security/coverage/e2e 实测数字见最终任务报告；release-security 十文件
>   零 skip；coverage **35 文件/641 测试** 92.92/89.18/95.18/94.83 与 v1.1.11 一致；
>   修正：M33 勘误 M32 报告曾写 34/634，实际 M32 状态依据为 35/641）；四种
>   SIGTERM 组合 × 25 轮 stress bad=0、0 orphan、0 residual writer、0 stale lock、
>   0 registry false-empty、0 live timer、0 skip/todo；Node 22.20.0/npm 11.17.0
>   fresh worktree 四种组合 × 10 轮 + 全套验证通过；资产回归：两次
>   `release:prepare-assets`（含 `--force`）zip/SHA256SUMS 逐字节一致且与 v1.1.11
>   已发布资产 hash 完全相同（ZIP `777c871b…`、SHA256SUMS `743b43c3…`）；PR/CI
>   审计证据见对应 PR 与 Actions 运行，不在本文件维护。

> **M33 strengthening（v1.1.11 工程基线）——以下 M32 表述在 M33 修复完成前超出实际实现：**
>
> 1. “fail-closed 时 registry 保留、runCli 拒绝释放 release 锁（状态可恢复/可审计）”：
>    该表述只在 runCli 进程仍存活时成立；owner 进程被 SIGKILL 后，
>    `recoverLock` 只检查 owner PID（ESRCH）就删除锁，无法证明 detached
>    helper 组已消失（探针 P1-A：recover 返回成功、replacement lock 可获取、
>    旧 helper 仍存活持续写 sentinel，54→1926→2007 字节）；M33 建立崩溃一致
>    的 child-state sidecar（EMPTY/SPAWN_INTENT/ACTIVE/QUIESCENCE_PROVEN/
>    MANUAL_AUDIT_REQUIRED），recoverLock 必须证明 ACTIVE 组 ESRCH 且
>    nonce/repo/schema 合同全成立才显式恢复，该表述仅在 M33 之后成立。
> 2. “有界 deadline 内仍无法证明进程组消失 → fail closed：reject …”：
>    M32 的 Promise reject 有界（10s deadline），但 reject 后 CLI 进程不
>    自然退出（探针 P1-B：top-level await 结束 1s 后父进程仍存活、子进程
>    仍存活——存活 child 的 stdio handle 保持事件循环）；M33 在 fail-closed
>    settle 时 unref child 并销毁 stdio pipes，CLI 有界自然退出非零、锁保留。
> 3. “signal handler 只记录 terminating”（M30/M31/M32 沿用）：信号到达时
>    仅记录终止请求，不请求当前 active helper 停止，signal-observed run
>    依赖 helper 自然完成或自身 timeout；M33 在记录后立即对每个受控进程组
>    发送 SIGTERM（与 transaction stage 一致的受控 child termination）。
> 4. “四种 SIGTERM 组合”测试覆盖：M31 的 `grandchildWrapper(..., true)` 把
>    同一个 boolean 同时传给 wrapper 与 grandchild（M32 探针 P3 修正）；
>    M33 补充真实 crash-window（SPAWN_INTENT → manual audit）、recovery
>    正负向矩阵与 fail-closed natural exit 行为测试。
>
> ### M33 done — release child ownership crash-consistency、bounded fail-closed exit、lock recovery safety、signal gate determinism 与证据流程降本（v1.1.11 工程基线，未发布新版本）
>
> - 崩溃一致的 child ownership（WP-A）：lock schema 升 v2 并绑定
>   `.release-staging.child-state.json` sidecar（同 nonce、同 repoRealpath），
>   状态机 EMPTY → SPAWN_INTENT → ACTIVE → QUIESCENCE_PROVEN（失败路径
>   MANUAL_AUDIT_REQUIRED）。SPAWN_INTENT 在**任何** helper spawn 之前以
>   temp+fsync+rename durable（启动 barrier）；“child 已 spawn 但 ACTIVE 未
>   持久化时父进程 SIGKILL”的 crash window 由 SPAWN_INTENT → manual audit
>   fail-closed 覆盖；child-state 持久化/清理失败不得释放主锁；正常组被证明
>   ESRCH 后才持久化 QUIESCENCE_PROVEN；v1 锁（无 child-state 证明）一律
>   manual audit；recoverLock 新合同——owner 活拒绝、ACTIVE 组存在/EPERM/
>   pgid 未知拒绝、SPAWN_INTENT 拒绝、仅 ACTIVE 组 `kill(-pgid,0)` ESRCH 且
>   全部合同成立才显式恢复，绝不向可能 reuse 的旧组发信号。
> - 有界 fail-closed 退出（WP-B）：fail-closed settle 时对存活 child 执行
>   unref() 并销毁 stdio pipes（不 process.exit、不清 registry、不先杀
>   child），CLI 进程有界自然退出非零、锁保留、sidecar 置
>   MANUAL_AUDIT_REQUIRED；post-spawn error 即使无 opts.timeout 也启动受控
>   终止（SIGTERM → deadline → SIGKILL 升级）；ENOENT 早期 reject 合同保持。
> - signal gate 确定性（WP-C）：真实 subprocess 测试改为确定性握手（锁出现
>   - helper ready pidfile 才发首个信号）；signal handler 记录 terminating
>     后立即向每个受控进程组发 SIGTERM（不再等待 helper timeout）；watchdog
>     触发/测试失败/断言失败三路径都清理完整进程组（组 SIGKILL + ESRCH）；
>     保持 first-signal 决定 130/143、后续信号不 raw death、signal-observed
>     零 Done。
> - 测试降耗与 stress（WP-D）：escalation/poll/deadline 改为显式
>   `timingProfile` 注入（生产默认 50ms/10s/1s 不变，测试用短确定性值，无
>   全局可变常量，不用 fake timer）；m30 signal suite 从约 83s 降到约 40s；
>   新增 `scripts/stress-release-security.mjs` 结构化 stress runner（固定
>   seed、每例独立 deadline、JSON summary、失败打印 seed/round/PID/PGID/
>   stage、所有退出路径 cleanup）；保留至少一个 production-default smoke。
> - 证据流程降本（WP-E）：ROADMAP 修正 M32 实际 coverage（35 文件/641 测试/
>   92.92/89.18/95.18/94.83，不再写 34/634）；PR 模板不再写死“N 个文件”
>   （文件数与列表来自 `SECURITY_TEST_FILES`，由 evidence 脚本输出），
>   core/release-security/UI/toolchain/release-publish 分段条件化，post-merge
>   evidence（merge SHA/tree/tree equality）走**唯一一次 PR comment** 不再
>   反复编辑 PR body；新增 `scripts/collect-verification-evidence.mjs`（只收集
>   事实：head/base/tree、changed 统计、tracked/tree bytes、snapshot 计数、
>   SECURITY_TEST_FILES 实际列表、toolchain、whitespace 状态，测试结果由
>   显式传入的机器可读 summary 合并）；temp residue 如实报告、最终报告前清理。
> - 探针（修改前，未复用旧证据）：P1-A——owner 持锁并 spawn detached
>   helper（写 sentinel）后被 SIGKILL，recoverLock 返回成功、replacement
>   锁可获取、旧 helper 仍存活写（54→1926→2007 字节、hash 变化）；P1-B——
>   成功 spawn 后注入 kill EPERM，fail-closed Promise 10.4s 有界 reject、
>   registry 保留、top-level 结束，但 1s 后 CLI 进程仍存活、helper 仍存活
>   （stdio handle 保持事件循环）；P1-C——m30-signal-lifecycle 可审计矩阵
>   （M31 与 main 各 2 轮 vitest + 18 轮 detail 探针，全部通过；一次 run2
>   失败被证明为编辑污染而非真实 flake），结论“current-main 无 flake 复现，
>   根因未证，本轮按 WP-C 加固”，不伪称已证明回归。
> - 测试矩阵（WP-B 正式）：新增 `tests/m33-child-ownership-recovery.test.ts`
>   （第十一个 release-security suite）：owner SIGKILL+ACTIVE 拒绝恢复、
>   sentinel 增长时 replacement 拒绝、SPAWN_INTENT crash window manual
>   audit、child-state 缺失/损坏/未知 schema/nonce/repo 不匹配拒绝、ACTIVE
>   组存在/EPERM/pgid 未知拒绝、ACTIVE ESRCH+metadata 匹配显式恢复成功、
>   fail-closed reject 后 CLI 自然有界退出非零+锁保留+MANUAL_AUDIT_REQUIRED、
>   清理组后显式恢复成功、no-timeout post-spawn error 受控终止、timer
>   created/cleared 零 live handle、watchdog 完整组清理、连续两次运行一致
>   且零 /tmp 残留；M32 四 SIGTERM 组合与 registry 合同保持通过。
> - 状态依据：本地 Node 24.19.0/npm 11.17.0 `npm run verify` 全绿（release-security
>   十一文件 213/213 零 skip；coverage 35 文件/641 测试 92.92/89.18/95.18/94.83
>   与 v1.1.11 一致；e2e 236 passed/8 基线 skip；audit 0）；Node 24 stress——
>   recovery 25 轮、fail-closed natural-exit 25 轮、四 SIGTERM 组合 100 轮、
>   repeated/cross signal 150 轮全部 bad=0、0 orphan、0 stale lock、
>   0 unsafe-recovery、0 residual-writer、0 live timer、0 raw-signal-death、
>   0 skipped/todo（合计 300 轮）；Node 22.20.0/npm 11.17.0 fresh worktree
>   全套验证 + 每类 ≥10 轮 stress 通过；资产回归：两次
>   `release:prepare-assets`（含 `--force`）zip/SHA256SUMS 逐字节一致且与
>   v1.1.11 已发布资产 hash 完全相同（ZIP `777c871b…`、SHA256SUMS
>   `743b43c3…`）；PR/CI 审计证据见对应 PR 与 Actions 运行，不在本文件维护。

> **M34 strengthening（v1.1.11 工程基线）——以下 M33 表述在 M34 修复完成前超出实际实现：**
>
> 1. “child-state 必须先通过 nonce/repo/schema 合同才显式恢复”：M33 的
>    `validateChildState` 只校验字段**类型**，不校验状态—字段**不变量**——
>    探针 P1-A 实证 `QUIESCENCE_PROVEN`/`EMPTY` + 非空且仍存活的 pgid/helperPid
>    被 validator 接受、`recoverLock` 删除锁，而 detached helper 组仍存活持续写
>    sentinel（54→… 字节增长）；其余不可能组合（SPAWN_INTENT+非空 PID、
>    ACTIVE+null pgid、ACTIVE pgid≠helperPid、MANUAL 伪装字段）validator 也全部
>    错误接受。M34 实现状态—字段不变量 + 额外字段/非法时间拒绝，该表述仅在
>    M34 之后成立。
> 2. “signal 后立即向每个受控进程组发送 SIGTERM（受控 child termination）”：
>    M33 的 signal handler 只发送**一次** SIGTERM，没有启动 escalation timer 与
>    bounded deadline——探针 P1-B 实证 helper 忽略 SIGINT/SIGTERM 时，父进程
>    在 >GROUP_SETTLE_DEADLINE_MS（10s）后仍存活、无任何升级，只能等 helper
>    自身 60s timeout。M34 把用户信号接入 execFileAsync 受控终止状态机
>    （controller.requestTermination → SIGTERM → deadline → SIGKILL → group
>    ESRCH → settle），该表述仅在 M34 之后成立。
> 3. “release-security 连续稳定、零 flake”：M33 未做串行对照与连续多轮验证；
>    M34 P1-C 显示整批并行运行墙钟 ~44s，且真实 signal/process-group 文件同批
>    并行存在进程间干扰风险。M34 建立分阶段调度（结构文件有限并行 + 真实
>    进程文件单 worker 串行）+ 聚合负向测试 + 连续 3 次验证，稳定性表述仅在
>    M34 之后成立。
> 4. “stress summary 包含 unsafeRecovery/residual-writer/live-timer/… 计数”：
>    M33 stress 的多个计数器**没有更新路径**（恒 0 假零），`doneSeen` 不参与
>    NO-DONE round 判定，`staleLock` 在删除 temp 目录后才读取（恒 false），
>    safe-completion 后仍活、被 force cleanup 杀的 helper 不计入 orphan，
>    `all N` 语义为“每类 N”而非“总 N”但未文档化（探针 P1-D 实证）。M34 重构为
>    versioned schema + 全部真实更新路径 + 注入自测，该表述仅在 M34 之后成立。
> 5. “MANUAL_AUDIT_REQUIRED 人工审计后可显式恢复”：M33 的恢复只能通过测试/
>    维护者**手改 sidecar JSON** 为 ACTIVE 实现（P2-3），正式 CLI 没有安全路径。
>    M34 增加显式 `--audit-lock <nonce> <lastKnownPgid>` acknowledgement
>    （精确 nonce/PGID、owner 与组 ESRCH、inode/schema/repo 重验证、零删除），
>    该表述仅在 M34 之后成立。

### M34 done — child-state invariant safety、bounded signal termination、deterministic release-security gate 与 truthful stress evidence（v1.1.11 工程基线，未发布新版本）

- child-state 不变量与恢复安全（WP-A）：锁 schema 升 v3、child-state schema v2；
  sidecar 改为 nonce-qualified basename（`.release-staging.child-state-<nonce>.json`，
  绑定锁 nonce，旧恢复 cleanup 结构上无法触碰新 acquisition 的 sidecar）；
  `validateChildState` 强制状态—字段不变量（EMPTY/SPAWN_INTENT/QUIESCENCE_PROVEN
  的 pgid/helperPid 必须为 null；ACTIVE 两者为正整数且相等——POSIX detached
  group-leader 合同；MANUAL_AUDIT_REQUIRED 用独立 lastKnownPgid/
  lastKnownHelperPid/auditReason，不伪装成 QUIESCENCE），额外危险字段、未知
  schema/state、非法时间、nonce/repo 不匹配全部拒绝；`writeChildStateSync` 写入
  前调用同一 validator（实现自身无法生成非法状态）；sidecar 读取 lstat 拒绝
  symlink/FIFO/目录/设备、64 KiB 字节上限、open+fstat dev/ino 竞态校验；
  recoverLock 删除前重新验证锁 inode/metadata 与 sidecar 形态；恢复绝不向历史
  PGID 发信号。探针 P1-A（修改前）：QUIESCENCE_PROVEN/EMPTY + 存活组被错误
  恢复，锁删除、replacement 可获取、helper 仍写 sentinel。
- 正式 MANUAL audit 流程（WP-B）：普通 `--recover-lock` 对 MANUAL 继续拒绝；
  新增 `--audit-lock <nonce> <lastKnownPgid>` 显式 acknowledgement——要求精确
  lock nonce 与精确 last-known PGID、owner PID ESRCH、last-known 组 ESRCH
  （probe only，绝不发信号）、metadata/inode/repo/schema 全量重验证、锁或
  sidecar 被替换/EPERM/未知 schema 拒绝且零删除；只确认状态不杀进程；
  测试不再通过 `fs.writeFileSync` 手改状态模拟恢复（P2-3 修正）。
- 用户信号接入受控终止状态机（WP-C）：`activeChildren` 注册 child controller
  （`requestTermination(reason)`），runCli 的 signal handler 只决定退出码并请求
  所有 controller 启动一次受控终止（SIGTERM → bounded deadline → SIGKILL 升级
  → 等 direct close + group ESRCH → settle）；重复信号只记录
  `termination already in progress` 且不改变退出码；signal 路径绝不等待 helper
  自身 30/60 秒 timeout（P1-B 修改前实证：SIGTERM 后父进程 12s 仍存活、无
  escalation）；deadline 后无法证明组消失 → MANUAL_AUDIT_REQUIRED（last-known
  ownership 持久化）+ registry/锁 fail closed + 父进程自然非零有界退出；
  fault-injection timer 也是 owned timer（settle 时清除）。
- release-security 分阶段调度（WP-D）：`SECURITY_TEST_FILES_PARALLEL`（结构/
  fixture，有限并行）与 `SECURITY_TEST_FILES_SERIAL`（真实 signal/process-group/
  recovery，单 worker + fileParallelism=false）穷尽且不相交；每文件只执行一次；
  多 JSON report 由 `aggregateSecurityReports` 聚合（独立负向测试覆盖
  missing/extra/duplicate/skip/todo/failed/corrupt/信号/status）；
  同时输出 default reporter 与机器可读 merged summary；失败时保留明确路径
  （本地打印私有目录，CI 经 `RELEASE_SECURITY_REPORT_DIR` 上传 7 天短期
  retention artifact）。
- truthful stress（WP-E）：versioned schema v2 + 真实计数器
  （unsafeRecovery/orphanAtSafeCompletion/cleanupResidual/
  staleLockAfterSafeCompletion/residualWriter/liveTimer/rawSignalDeath/doneSeen/
  recoveredSuccessClaimSeen/watchdogTriggered/timeout），每个 counter 有更新路径
  与注入自测（`--self-test` 逐计数器注入后精确变 1）；`doneSeen`/recovered
  success claim 出现在 signal-observed round 即失败；cleanup 前仍活的 helper
  计为 orphan、cleanup 后仍活的计 cleanupResidual（fail-closed/recovery 的
  合同存活不计 orphan——它们是 MANUAL 受控状态）；`all N` 语义唯一化：N 为
  总轮数、五个类别间确定性分配；任一非零安全计数 exit 1；skipped/todo 无法
  真实测量故删除字段（不再伪造 0）；失败 round 保留最小诊断 artifact。
- evidence 与文档纠偏（WP-F）：`collect-verification-evidence.mjs` 的 changedFiles
  现在包含 binary 文件（additions/deletions 为 null，不合并进文本行数）；
  `--results` 增加 schema/head/tree/command/exitCode/durationMs/toolchain 合同
  校验，不匹配拒绝或标记 unverified（head/tree 不匹配标 unverified，不再无标签
  背书）；ROADMAP/RELEASING/PR 模板同步 M34 合同。
- 探针（修改前，未复用旧证据）：P1-A（impossible QUIESCENCE/EMPTY + 存活组被
  错误恢复）、P1-B（signal 无 escalation/deadline，父进程 12s 仍存活）、P1-C
  （并行两次 213/213 全绿 ~44s；串行对照运行期间代码被编辑故结果无效、最终
  阶段重新串行验证）、P1-D（stress 假零：7 个计数器无更新路径、doneSeen 不参与
  判定、staleLock 在 rm 后读恒 false、all 1=4 轮）、P2（symlink sidecar 被跟随
  并恢复、FIFO sidecar 阻塞、固定名 cleanup 删除新 nonce sidecar、MANUAL 只能
  手改 JSON、evidence binary 少算）。
- 状态依据：本地 Node 24.19.0/npm 11.17.0 全套验证与 stress 矩阵结果见最终任务
  报告（release-security 十二文件零 skip、分阶段 batch 全部 status=0、
  merged summary missing/extra/duplicates 为空）；Node 22.20.0/npm 11.17.0
  fresh worktree 兼容验证；资产回归：两次 `release:prepare-assets`（含
  `--force`）逐字节一致且与 v1.1.11 已发布资产 hash 完全相同；PR/CI 审计证据
  见对应 PR 与 Actions 运行，不在本文件维护。

### M30 done — release child-process lifecycle、repeated-signal safety、zero-skip completeness 与 canonical Node/npm toolchain（v1.1.11 PATCH）

- 重复信号与完整 listener 生命周期（WP-A）：`process.once` 改为显式管理的 `process.on`——首个
  SIGINT/SIGTERM 决定最终退出码（130/143），后续相同或不同信号只记录 `termination already in
progress` 且绝不触发默认 raw death（修改前探针实证 TERM+TERM/INT+INT/三连信号均为 code=null
  raw death + lock 遗留）；listeners 从锁获取前注册、到 `lock.release` 完成**之后**才移除；
  新增真实子进程测试：INT+INT、TERM+TERM、INT+TERM、TERM+INT、三连信号、
  finalization/lock-release barrier 信号，全部非 raw death、first-signal exact code、零孤儿进程。
- 受控 child/process-tree 生命周期（WP-B）：`execFileAsync` 重构——Promise 只在 child `close`
  后 settle；timeout 记录 TimeoutError → 请求停止（POSIX 整组 SIGTERM）→ 等 close → 升级
  SIGKILL → 再等 close → 清理后代 → 才 reject（探针实证原实现在 child close 前 3ms reject、
  孙进程在 settle 后继续写 SENTINEL）；`child.kill` 返回 false 不崩溃；stdin EPIPE 捕获为受控
  rejection（探针实证原实现为 unhandled `write EPIPE` 崩溃 + lock 遗留）；active-child registry
  在锁释放前强制为空；POSIX 独立进程组、Windows 文档化 fail-closed 边界。
- 成功声明只在最终协议完成后输出（WP-C）：`generateAssets` 不再打印 `Done:`，只返回
  plan/zipSize/sumsName/committed；runCli 在 runLocked 完成 → registry 归零 → lock release 成功 →
  listeners 移除 → 无已观察 signal 后才打印单一成功声明；signal-observed run 零 `Done:`/零
  `Transaction recovered successfully`（探针实证原实现 checkStop 与 Done 之间存在 TOCTOU 窗口，
  handler 观察后 Done 仍打印且现有测试允许）。
- 完整 zero-skip release-security manifest（WP-D）：`SECURITY_TEST_FILES` 扩展至九个文件
  （新增 m29-crash-matrix、m29-release-gates、m29-signal-protocol、m30-signal-lifecycle、
  m30-child-lifecycle）；修改前探针实证三个 m29 文件不在门禁（m29-crash-matrix 中一个测试改
  it.skip 后门禁仍 exit 0）；门禁实际执行九文件 total=188 passed=188 skipped/todo=0，
  CI 日志打印实际九文件清单；runner 自测仍用 fake vitest fixture 不递归。
- canonical Node/npm toolchain（WP-E）：官方 release index（任务执行日核对）v24 LTS latest=
  24.19.0 / npm 11.17.0；`.node-version`/`.nvmrc`/engines.node（`>=22.20.0 <23 || >=24.19.0
<25`）/engines.npm（`>=11.17.0 <12`）/packageManager（npm@11.17.0）/devEngines.packageManager
  fail-closed 合同全部对齐；CI 主 full verify 改读 `.node-version`（24.19.0）、compatibility 精确
  22.20.0、双运行时精确 npm 11.17.0；Pages 改读 `.node-version`；无 rolling 22/24/latest/current/
  lts/\*/check-latest；`@types/node` 保持精确 22.20.1；新增 `npm run doctor`/`check:toolchain`
  门禁（输出实际 Node/npm、校验 canonical 文件/package/CI/Pages 一致、不一致非零）并接入
  verify 链与 CI；runtime-type-contract/ci-workflow/toolchain-contract 测试同步更新；
  `npm outdated --json` 摘要（19 项）仅保存为 M31 输入，不升级依赖。
- worktree/CI hooks（WP-F）：postinstall 改为 `scripts/install-git-hooks.mjs` worktree-aware
  wrapper——主 checkout 正常安装 simple-git-hooks；linked/detached worktree（.git 为文件）、CI
  环境与非 Git 目录跳过并输出清晰信息；跳过不输出 ERROR、npm ci exit 0 且无 ENOTDIR（探针实证
  原行为输出被吞的 ENOTDIR）；不修改其他 worktree 或用户全局 hooks；fixture 覆盖 .git 目录、
  .git 文件、CI env、非 Git 目录四种形态。
- 状态依据：本地 Node 24.19.0/npm 11.17.0 完整 verify 全绿（单测 813/41 文件、release-security
  188 零 skip、coverage 92.92/89.18/95.18/94.83、visual 23 passed +0/~0/-0）；Node 22.20.0/
  npm 11.17.0 临时 worktree 全套兼容验证 + 双运行时 signal stress 各 225 轮（50×SIGINT +
  50×SIGTERM + 25×4 双信号 + 25×timeout/process-tree）bad=0、0 Done、0 raw death、0 stale lock、
  0 孤儿进程；PR/CI 审计证据见对应 PR 与 Actions 运行，不在本文件维护。

### M29 done — Release durability、signal determinism、recovery state consistency 与 security gate completeness（v1.1.10 PATCH）

> **M30 strengthening（v1.1.11）——以下 M29 表述在 M30 修复完成前超出实际实现，已被 M30 强化/取代：**
>
> 1. “signal 被观察后不打印 Done/完整成功声明”：M29 的最终 `checkStop` 与 `Done:` 打印之间存在
>    TOCTOU 窗口（修改前探针 F：SIGTERM 在最终 checkStop 之后被 handler 观察到，`Done:` 仍在
>    901ms 后打印，且现有 m29-signal-protocol 测试只禁止 “Done 早于 handler”、允许该行为）。
>    M30 将成功声明移出 generateAssets，由 runCli 在 child registry 归零 → lock release →
>    listeners 移除 → 无已观察 signal 检查全部完成后统一打印，该表述仅在 M30 之后成立。
> 2. “zero-skip security gate 完整覆盖”：M29 门禁只执行四个文件；`tests/m29-crash-matrix.test.ts`、
>    `tests/m29-release-gates.test.ts`、`tests/m29-signal-protocol.test.ts` 不在门禁内（探针 E：
>    m29-crash-matrix 中一个测试改为 it.skip 后门禁仍 exit 0）。M30 将清单扩展至九个文件，
>    zero-skip 表述对全部 release-security suite 仅在 M30 之后成立。
> 3. “重复信号/完整 listener 生命周期”：M29 使用 `process.once`，首个信号触发后该信号 listener 被
>    移除，同信号第二次到达走默认 raw death 并遗留 lock（探针 A：TERM+TERM/INT+INT/三连信号均为
>    code=null + lock 遗留；探针 B：listeners 在 lock.release 之前移除的窗口内信号 raw death）。
>    M30 改为显式管理的 `process.on` + listeners 在 release 后移除，该表述仅在 M30 之后成立。
> 4. “子进程/进程树生命周期”：M29 的 execFileAsync 在 timeout 时 SIGKILL 后立即 reject（早于 child
>    close），孙进程在 Promise settle 后继续存活写输出（探针 C）；stdin EPIPE 为 unhandled stream
>    error 崩溃（探针 D）。M30 重构为 close 后 settle + POSIX 进程组清理 + active-child registry，
>    该表述仅在 M30 之后成立。

- zero-skip security gate 完整覆盖（WP-A）：新建 `scripts/release-security-test-contract.mjs` 共享清单
  `SECURITY_TEST_FILES`（prepare-release-assets、zip-helper-security、m28-recovery、
  run-release-security-tests 四个文件），runner 与合同测试引用同一清单、不得分别硬编码；清单文件
  缺失/重命名/未执行时 fail closed；报告必须精确包含四个预期 suite（多余 suite 也失败）；
  skipped/todo/pending 任一大于 0 即非零；CI 日志列出实际覆盖的四个文件与 zero-skip 结果；
  runner 自身测试加入门禁时用 fake vitest fixture，不产生无限递归。
- 确定性 signal/lock 协议（WP-B）：删除 bounded 10×setImmediate flush loop；Python helper/verifier
  子进程改 async spawn，`generateAssets`/`recoverTransaction` 在每个事务 stage 边界检查注入的终止
  状态（SignalStoppedError），signal 被观察后不进入新 transaction stage、不打印 Done/完整成功声明；
  INIT journal 在任何长时子进程前持久化；SIGINT 精确 130、SIGTERM 精确 143；lock 在所有写/rename/
  子进程停止前不释放；第二 generator 在第一进程完全停止前无法获得锁；Node 22.20.0 与 24.0.0 各
  100 轮 stress 0 flaky、0 skip。
- 目录 durability fail-closed（WP-C）：新增 `fsyncParentDirectorySync`，错误分类——EINVAL/ENOTSUP/
  EOPNOTSUPP（平台不支持目录 fsync）降级为 note；EIO/ENOSPC/EROFS/EBADF/未知/close 失败抛
  DurabilityError，保留 journal/backup/lock、返回非零、不得报告完整成功；覆盖全部六个 mutation
  boundary（journal temp write/fsync/close、journal rename、output→backup rename、staging→output
  promotion、backup 删除、journal unlink）。
- 恢复前验证与 crash-consistent journal（WP-D）：PRE_COMMIT + backup 恢复在删除/rename 任何路径前
  将 backup 的 zip+sums hash 与 journal.oldSha256 比较，不匹配时零磁盘 mutation、journal/backup/output
  原样保留；新增 `OLD_OUTPUT_BACKUP_INTENT` 状态（rename 前持久化，oldSha256 从未触碰的 output
  计算）；hash 先填充再持久化 STAGING_VERIFIED；STAGING_GENERATED 允许空 hash；14 个 crash matrix
  failpoint（13 force + 首次发布）逐一验证磁盘 journal 可解析、--recover 可重复、第二次幂等、无
  journal 指向不存在 backup。
- 统一 ZIP entry contract（WP-E）：共享 fixture `tests/fixtures/zip-entry-contract.json`；JS
  validateZipEntry、\_zip_helper.py、verify_release_zip.py 三层一致；Windows drive absolute/
  drive-relative（C:/、C:\、C:）与 UNC（//、\\）三层全部拒绝；'.' 段、空段、backslash、control、
  node_modules/src、.map 三层一致拒绝；helper 直接调用 fail closed 且不留 partial ZIP。
- runner 私有临时目录与清理失败（WP-F）：报告位于 mkdtempSync 随机私有目录（0o700）；删除失败必须
  使最终门禁非零并在 stderr 报告，原始 test failure 与 cleanup failure 同时发生时两者都报告；
  不调用中途 process.exit；新增 symlink/path replacement race、rmSync EACCES/EIO、report 替换为
  symlink/directory、temp dir 创建失败、test child timeout/signal、零残留 fixture。
- 文档与审计合同（WP-G）：ROADMAP/CHANGELOG 将 M28 四项超出实现的表述标记为 M29
  strengthening/superseded（不修改已发布 v1.1.9 tag 或 Release notes 资产）；PR 模板新增 base
  SHA/tree、final head SHA、push 次数、每次 CI URL/head/conclusion、checked_sha/checked_tree、
  merge SHA/tree、tree equality、security runner 覆盖文件、passed/failed/skipped/todo、temp residue、
  signal stress 次数/平台、crash matrix 数量、hygiene 两个 size 指标语义。
- 状态依据：本地 `npm run verify` 全绿；Node 22.20.0 与 24.0.0 fresh worktree 全套验证 + signal
  stress 各 100 轮 0 flaky；PR/CI 审计证据见对应 PR 与 Actions 运行，不在本文件维护。

### M28 done — Release recovery integrity、zero-skip fail-closed、signal/lock lifecycle 与 journal durability（v1.1.9 PATCH）

- 恢复状态机以 journal 为唯一事实来源（WP-A）：recoverTransaction 先读取并严格验证 journal，
  再依据 journal state + output 是否存在 + backup 数量决定动作，不再先要求 backup；
  COMMITTED + output + backup 时对 output 执行完整 reverify（asset pair、SHA256SUMS、verify_release_zip.py、
  版本合同、实际 hash 等于 journal.newSha256），全部通过后才可删除 backup，任一失败保留 output/backup/journal
  返回 manual audit；COMMITTED/BACKUP_CLEANED + output + 无 backup（首次发布 journal.delete 失败或已完成
  backup cleanup 的正式恢复路径）完整验证 output 与 journal.newSha256，成功时只清理 journal；
  PRE_COMMIT + 无 backup 只允许基于精确 journal/path/hash 采取保守动作，无法证明所有权时 manual audit；
  PRE_COMMIT + backup 先深度验证 backup、再恢复、恢复后再次完整验证，失败不删除最后一个有效副本。
- journal 绑定与耐久性（WP-B）：validateJournal 验证 journal.version 等于 package.json version、
  outputPath 精确等于规范化的 release-output、backupPath 为 null 或安全单段名称并与唯一实际 backup 精确一致、
  禁止绝对路径/.. /反斜杠/路径分隔符、oldSha256/newSha256 为小写 64 位十六进制、
  state 与 backupPath/oldSha256/newSha256 的必需字段组合一致、updatedAt 为严格 ISO 时间；
  抽取 writeAllSync，writeSync 返回 0/负数/NaN/非整数/大于 remaining 均立即失败、不得无限循环，
  lock/journal 写失败不得把部分提升为正式，close/fsync/rename 错误全部有负向测试，
  journal rename 后按平台能力 fsync 父目录。
- zero-skip runner 真正 fail-closed（WP-C）：重构 scripts/run-release-security-tests.mjs，
  不在中间调用 process.exit()，main 返回退出码、顶层最后设置 process.exitCode，
  report cleanup 位于 try/finally 并在所有结果路径执行，report 缺失/空/损坏/字段缺失/字段非有限整数/
  统计不一致无论 Vitest status 是多少都必须 exit nonzero，result.status 必须严格为 0，
  total > 0、failed === 0、skipped === 0、passed + failed + skipped 与 total 一致，
  输出失败测试名但不得因 malformed assertionResults 自身崩溃；为 runner 本身增加独立单测，
  运行真实 npm run test:release-security 后确认 /tmp 无报告残留。
- SIGINT/SIGTERM 与锁生命周期（WP-D）：进程仍可能修改 staging/output/backup/journal 时绝不能提前释放锁，
  signal handler 只记录终止请求、锁由统一 finally 在所有写操作停止后释放，
  无法安全即时中断同步操作时保守地保持锁完成当前原子阶段后停止，
  最终 SIGINT 返回 130、SIGTERM 返回 143，main 不得用 runCli 的 0 覆盖 signal code，
  收到 signal 后不得输出完整成功声明，lock release 失败保持 recoverable metadata 并返回非零；
  真实子进程测试使用慢速可控 helper 在持锁期间发送 SIGINT/SIGTERM，
  另一 generator 在第一进程完全停止前绝不能获得锁，退出码精确为 130/143。
- ZIP helper 自身 fail-closed（WP-E）：\_zip_helper.py 直接验证 manifest entry（非空 POSIX relative path、
  禁止绝对路径/.. /反斜杠/空 segment/"." segment/重复 entry），与 release-artifact-contract 的 ZIP entry policy
  保持一致，非法 manifest 或任一文件失败时删除 partial ZIP；补充同 inode 同大小但读取期间内容变化的策略
  （比较 size/dev/ino/mtime_ns/ctime_ns），无法证明稳定快照时失败。
- CLI 与审计（WP-F）：--force/--recover/--recover-lock 互斥，任意冲突组合在创建 lock 前 exit 2，
  未知参数仍在创建 lock 前失败。
- 状态依据：本地 npm run verify 与 workflow 回归测试通过；PR/CI 审计证据见对应 PR 与 Actions 运行，不在本文件维护。

> **M29 strengthening（v1.1.10）——以下 M28 表述在 M29 修复完成前超出实际实现，已被 M29 强化/取代：**
>
> 1. “signal handler 只记录终止请求…收到 signal 后不得输出完整成功声明”：M28 实现依赖最多 10 次
>    `setImmediate` 的时序启发式等待信号投递；探针实证 SIGINT 15/20、SIGTERM 8/20 的 `Done:` 在
>    handler 观察到信号前打印（v1.1.9 生效前 Node 24.0.0 CI 曾因此失败）。M29 以协作式 stage 边界
>    协议取代该启发式（signal 到达后不进入新 transaction stage、lock 在所有写/子进程停止前不释放、
>    精确 130/143），该表述仅在 M29 之后成立。
> 2. “全部 M28 security tests zero-skip”：M28 runner 实际只运行 `tests/prepare-release-assets.test.ts`
>    与 `tests/zip-helper-security.test.ts` 两个文件；`tests/m28-recovery.test.ts` 与
>    `tests/run-release-security-tests.test.ts` 不在门禁内（探针：m28 中一个测试改为 it.skip 后门禁
>    仍 exit 0）。M29 建立共享清单 `scripts/release-security-test-contract.mjs`，门禁实际执行四个
>    预期文件并逐文件校验，zero-skip 表述仅在 M29 之后成立。
> 3. “journal durability / journal rename 后按平台能力 fsync 父目录”：M28 将父目录 fsync 的**任何**错误（含 EIO/ENOSPC/
>    EROFS/EBADF/close 失败）降级为 note 并继续成功发布（探针：EIO 注入后仍 SUCCESS、journal 被删、
>    output 发布）。M29 的 `fsyncParentDirectorySync` 对真实 I/O 故障 fail-closed（非零、保留
>    journal/backup/lock），仅容忍经实测证明的“平台不支持目录 fsync”错误码（EINVAL/ENOTSUP/
>    EOPNOTSUPP），该表述仅在 M29 之后成立。
> 4. “完整自动恢复”：M28 在 STAGING_VERIFIED 写入空 hash 后、OLD_OUTPUT_BACKED_UP 写入 null
>    oldSha256 后存在 crash window，磁盘 journal 无法通过 validateJournal（探针实证两个窗口）；
>    PRE_COMMIT 恢复在验证 oldSha256 前已删除 output、移动 backup（topology 不再自洽）。M29 重排
>    journal 写入顺序（先填 hash 再持久化状态、新增 OLD_OUTPUT_BACKUP_INTENT）、恢复前先比较
>    backup hash 且零磁盘 mutation，该表述仅在 M29 之后成立。

> **v1.1.8 勘误：** v1.1.8 的发行资产本身正确，但以下实现缺陷由 v1.1.9/M28 加固修复：
>
> 1. COMMITTED 恢复接受非 ZIP 文件及自洽 checksum，并删除唯一有效 backup。
> 2. 首次发布或 backup 已清除后，只剩 COMMITTED/BACKUP_CLEANED journal 时 --recover 返回"无 backup"无法恢复。
> 3. zero-skip runner 在 JSON report 缺失/损坏时可能 exit 0。
> 4. runner 的临时 JSON cleanup 位于 process.exit() 之后，永远不可达。
> 5. SIGINT/SIGTERM 释放锁但不终止/中止工作，退出码还可能被 main 覆盖。
> 6. lock/journal writeSync 返回 0 时存在无限循环。
> 7. journal 的 version/path/hash 没有与当前事务及磁盘资产严格绑定。
> 8. Python ZIP helper 不验证 manifest entry 名。
> 9. --force、--recover、--recover-lock 的冲突组合未明确拒绝。

### M27 done — Release transaction commit semantics、recovery integrity、真实并发/故障注入与零 skip 验收（v1.1.8 PATCH）

- 统一锁域：普通/`--force`/`--recover` 共用同一原子互斥锁；`--recover-lock` 是唯一不持锁操作锁文件的命令；
  `--recover` 持锁执行且 release 失败使 CLI 非零；cleaner 锁存在时 fail closed、删除任何 release 目标前停止，
  锁文件移出清理目标（journal 加入）；RELEASING.md 修正 clean 矛盾描述；25 子进程真实 `acquireLock` 并发验收。
- 锁错误完整性：open 后 write/short-write/close 失败关闭 fd 且仅清理本次创建的 inode（dev+ino 校验）；
  `release()` 抛出 `LockReleaseError` 不吞错；生成成功但释放失败 → 非零 + 部分成功提示；SIGINT/SIGTERM
  行为测试（owned lock 尽量释放、否则保留可恢复元数据、绝不删除非 owned）；元数据 schema/时间戳/nonce 校验。
- 事务 commit point：STAGING_VERIFIED → OLD_OUTPUT_BACKED_UP → NEW_OUTPUT_PROMOTED → NEW_OUTPUT_VERIFIED →
  COMMITTED → BACKUP_CLEANED；versioned journal（temp+fsync+rename 原子更新，记录 schema/nonce/version/state/
  output/backup/old-new SHA-256）；COMMITTED 后 backup 清理失败保留新 output 与残余 backup/journal 要求显式恢复；
  rollback restore 失败不吞错；12 个具名 failpoint 各有阶段命中与 hash 断言测试。
- Recovery 完整性：backup 恢复前深度验证（两普通文件、SHA256SUMS 单行、checksum 一致、verify_release_zip.py
  通过、内部版本合同）；symlink/目录/多余文件/多 backup/损坏内容全部拒绝；output+backup 并存按 journal 裁决
  （PRE_COMMIT 恢复旧 backup、COMMITTED 保留新 output 仅清 backup、journal 缺失/损坏/未知 schema 拒绝人工审计）；
  恢复后重新验证正式 output；损坏 backup 绝不被 rename 为 output。
- artifact contract 真实路径：动态 import fallback 移除（加载失败 fail closed）；`buildReleasePlan` 单一实现入共享合同，
  generator 只消费 plan、禁止本地命名模板与 assetNames 直调；`runCli` 注入 repoRoot，真实 CLI 正负向 fixture。
- symlink/并发/helper：能力探针在注册前同步执行（canonical 环境零 skip，连续两次运行结果一致）；Python helper
  O_NOFOLLOW 打开原始路径 + fstat dev+ino 身份比对 + 循环读取处理 short read + 长度/身份变化失败 + 失败清除半成品 zip；
  helper 直接测试覆盖 symlink final component/parent、lstat-open 替换、FIFO/directory、path escape、duplicate、
  short-read、deterministic bytes。
- 测试真实性：expect(true) 占位断言删除；catch unknown narrowing；failpoint 测试断言触发名+阶段 trace；full CI 新增
  Linux generator/security 专项步骤（`npm run test:release-security`，零 Playwright 依赖，任一 skip 即失败）。
- 版本：v1.1.8 PATCH；CHANGELOG、docs/releases/v1.1.8.md、双 README、本文件同步更新。v1.1.7 tag/Release/Pages
  资产未做任何修改。

> **M26 勘误：** v1.1.7 的发行资产本身正确，但以下实现缺陷由 v1.1.8/M27 加固修复：
>
> 1. `--recover` 未持锁且仅按文件名校验 backup，损坏 backup 可被提升为正式 output（exit 0）。
> 2. 部分备份删除可导致新旧 ZIP 同时丢失（rollback 删除新 output 后恢复残缺 backup）。
> 3. symlink 测试因注册时序实际始终 skip（46 passed + 2 skipped）。
> 4. rollback 测试基于 createHash 调用次数注入，失败发生在 staging 校验阶段，publish 阶段回滚零覆盖。
> 5. behavioral contract 动态 import 失败时回退字符串检查，两类假通过 fixture 实证 ok:true。
> 6. `npm run clean` 文档声称清理锁文件，实际 exit 1 且零删除。

### M26 done — 发布管线互斥锁、事务恢复、测试确定性与证据真实性（v1.1.7 PATCH）

- 原子并发锁与所有权：`acquireLock` 重构为 `fs.openSync(path, 'wx', 0o600)`（O_CREAT|O_EXCL）；锁内容使用结构化 JSON 元数据（schema version、PID、timestamp、random nonce、repo realpath）；cleanup 仅删除三方匹配的本进程锁；无效 JSON、EPERM、PID 不确定的锁不自动删除；新增 `--recover-lock` 显式恢复命令；`process.exit()` 不出现在 try/catch 中，CLI 返回 exit code；未知参数在锁创建前失败。
- 事务状态机与恢复：`generateAssets` 重构为显式事务状态机（INIT → STAGING_GENERATED → STAGING_VERIFIED → OLD_OUTPUT_BACKED_UP → NEW_OUTPUT_PROMOTED → NEW_OUTPUT_REVERIFIED → BACKUP_REMOVED）；首次发布 staging 直接 rename 到尚不存在的 output；`--force` 使用唯一 nonce 备份目录；新增 `--recover` 命令；依赖注入支持每个 failpoint 注入并断言旧资产不丢失、无含糊状态。
- 测试确定性与路径安全：移除固定路径 `/tmp/.m25-symlink-probe`，改用 `mkdtemp` 并在 `afterAll` 清理；同一 shell 连续运行两次测试数/passed/skipped 完全一致；新增 20+ 并发竞争测试、FIFO/socket/特殊字符拒绝测试；`catch` 使用 `unknown` 并正确 narrowing。
- Python ZIP helper TOCTOU 修复：先 `os.lstat` 原始路径再 `os.path.realpath`；POSIX 优先使用 `O_NOFOLLOW`；`external_attr` 包含 `S_IFREG`。
- 行为式 artifact contract：`check-release-contract` 改为导入 `getReleasePlan(version)` 并验证实际返回值；`readContract` 返回 `generatorBehavioralOk` 与 `generatorBehavioralErrors`。
- 锁清理：`clean-generated.mjs` 增加 `.release-staging.lock`；`.gitignore` 备份模式更新。
- 文档：`RELEASING.md` 新增"中断恢复"章节；CHANGELOG/ROADMAP 同步；v1.1.6 勘误记录在 CHANGELOG 中。

> **M26 勘误：** v1.1.6 的发行资产本身正确，但以下实现缺陷由 v1.1.7/M26 修复：
>
> 1. `acquireLock` 使用非原子 `existsSync → writeFileSync`（TOCTOU 竞态）。
> 2. 失败路径遗留 `.release-staging.lock`，`npm run clean` 未清理该文件。
> 3. 固定路径 `/tmp/.m25-symlink-probe` 未清理导致第二次运行 symlink 测试被意外 skip。
> 4. rollback 路径无 explicit failpoint 测试覆盖。
> 5. `_zip_helper.py` 先 `realpath` 再 `lstat` 导致 symlink 检查永不触发。
> 6. `check-release-contract` 仅检查 import 字符串，不验证实际行为。

### M25 done — 发布管线事务化、合同完整性与精确运行时下限（v1.1.6 PATCH）

- 发行资产生成器 fail-closed 与事务式发布：`walkDist` 显式分类所有 Dirent 类型；固定 `scripts/_zip_helper.py`（Python 可注入，不再动态生成临时脚本）；checksum 验证使用 Node `crypto`；事务式发布（`.release-staging/` 唯一 staging → backup/rollback → release-output）；并发锁；零遗留 `.cache/zip-*` 临时文件。新增 `tests/prepare-release-assets.test.ts`（19 测试）。
- 共享发行资产合同：`scripts/release-artifact-contract.mjs` 集中定义 ZIP 命名、Pages 模板和路径校验规则，`prepare-release-assets` 和 `check-release-contract` 均从该模块导入。
- 发布合同完整性：CHANGELOG 结构化解析（fenced code block 忽略、恰好一个 `[Unreleased]` 且为第一个 heading、当前版本为第一个 dated section）；`readContract` 读取 RELEASING.md 和 generator 共享合同导入；删除 `main()` 中 RELEASING 旁路追加逻辑。新增 10 个 CHANGELOG 结构测试和 9 个 integration fixture 测试。
- Node 精确运行时下限：engines 收紧为 `>=22.20.0 <23`；`@types/node` 精确 `22.20.1`（无 `^`）；CI `setup-node` 精确 `'22.20.0'`/`'24.0.0'`（带引号，非滚动）；runtime contract 解析完整 semver 并锁定精确下限；新增 `node:ffi` `@ts-expect-error` 负向类型 fixture。
- 类型清理：删除 `specifications.mjs` 中注释掉的 `pushIf` 死代码。
- 文档勘误：CHANGELOG v1.1.5 和 ROADMAP M24 节注明 M24 已知缺口由 M25 修复。
- 状态依据：本地 `npm run verify` 全绿（含 Node 22.20.0 与 24.0.0 隔离验证）；PR/CI 审计证据见对应 PR 与 Actions 运行，不在本文件维护。

> **M25 勘误：** M24 的以下三项在 v1.1.5 中未完全生效，由 v1.1.6/M25 修复：
>
> 1. `check-release-contract` 未实际校验 `## [Unreleased]` 缺失（删除后仍 exit 0），也未校验 generator 是否导入共享合同。
> 2. 发行资产生成器未实现 fail-closed Dirent 遍历（symlink 静默跳过）、事务式发布（失败遗留 `.cache/zip-*` 临时文件）、并发锁和 Python 可注入性。
> 3. 运行时下限只比较主版本，未锁定精确 minor/patch 下限（engines 接受 Node 22.0，但 jsdom 要求 ≥22.13.0）；CI 使用滚动版本而非精确版本。

- 修复 M23 审核发现的两项发布级门禁缺陷：`@types/node` 为 26（Current）
  但 engines 只支持 Node 22/24，typecheck 接受受支持运行时不存在的 Node 26 API
  （`node:ffi` 探针实证）；`check-release-contract` 的部分检查是假校验
  （`artifactNames` 由 `expectedArtifactNames` 自己生成；README Live 版本、
  日历日期、release notes 第一标题等也可错误通过）。
- Node 运行时下限类型合同：`@types/node` 改为 `^22.20.1`（与 engines 最低
  支持主版本 22 一致）；新增 `tests/runtime-type-contract.test.ts`（7 测试）
  结构性锁定引擎下限、CI 主/次验证与 `@types/node` 主版本一致性、Node 26-only
  API 不得存在；`tests/typecheck-contract.test.ts` 扩展检查 `@types/node` 主版本
  与 engines 下限一致。
- 发布合同真实文件检查：`scripts/check-release-contract.mjs` 重构——`readContract`
  从 Pages workflow 模板和 RELEASING.md 读取实际资产命名，不再自生成；
  `validateReleaseContract` 新增精确 Gregorian 日期验证、release notes 第一非空行
  精确标题匹配、README Live Demo 行版本校验、ROADMAP 唯一 stable 声明检查、
  lockfile 双版本必需验证；`checkReleasingArtifactNames` 导出供测试使用。
- 发布合同集成级负向测试：`tests/release-contract.test.ts` 新增 13 个 fixture
  集成测试（临时仓库 → 修改文件 → 真实 read+validate 链），覆盖 lockfile 漂移、
  缺失版本、缺少 [Unreleased]、非法日期、错误标题、陈旧 README 链接、ROADMAP
  重复/陈旧声明、Pages 模板错误、RELEASING 资产名错误；纯函数单元测试保留。
- scripts checkJs 类型覆盖：新增 `tsconfig.scripts.json`（strict + checkJs +
  Node types + buildinfo 在 ignored `node_modules/.tmp`），根 tsconfig 扩展为
  app/node/scripts/tests 四项目；`scripts/**/*.mjs` 七个文件补全 JSDoc 类型注解
  （含 `FetchLike` 结构类型、`manifest`/`document` JSON 边界窄 `any` 桥接、
  `caught` 的 `unknown` 处理），不降低 strict、不使用 `@ts-nocheck` 或
  全局 `any`；`tests/typecheck-contract.test.ts` 锁定四项目结构。
- 可复现发行资产生成：新增 `scripts/prepare-release-assets.mjs`（从 `dist/`
  确定性生成 `pmbus-calculator-vX.Y.Z-web.zip` 与 `SHA256SUMS.txt`，版本唯一
  来源 `package.json`），相同 `dist/` 两次生成 zip 与 checksum 逐字节一致；
  自动调用 `verify_release_zip.py` 与 `shasum -a 256 -c` 反向验证；
  `release-output/` ignored；`clean-generated.mjs` 新增该目标；`RELEASING.md`
  改用该唯一命令；package script `release:prepare-assets`。
- v1.1.5 PATCH：仅含 v1.1.4 后合入 main 的兼容修复与验证/发布加固（M24 全量），
  无新产品功能；CHANGELOG、`docs/releases/v1.1.5.md`、双 README、本文件同步更新。
- 状态依据：本地 `npm run verify` 全绿（含 Node 22 fresh 与 Node 24 隔离验证）；
  PR/CI 审计证据见对应 PR 与 Actions 运行，不在本文件维护。

### M23 done — TypeScript 验证门禁真实性、发布合同加固及 v1.1.4 维护发行

- 修复 typecheck 空检查：原 `tsc --noEmit` 对 `files: []` 根配置实际受检文件数为 0，
  src/tests/Playwright 配置类型错误全部漏检（负向探针实证）。改为
  `tsc -b --pretty false --verbose`，真实检查 app/node/tests 三类项目；CI 日志可见
  三个项目的构建记录；探针反转后 src/tests/Playwright 配置错误均使门禁非零退出。
- `tsconfig.tests.json`（strict、Node+Vitest globals、allowJs 边界、buildinfo 位于
  ignored `node_modules/.tmp`）由根 references 引用；`@types/node` 成为直接
  devDependency；四个 mjs 脚本导出边界补精确 JSDoc（FetchResponseLike 等结构类型），
  不用 `declare module '*.mjs'`、不降 strict。修复 strict 暴露的 59 处测试类型错误
  （含 `documentPdfs` 过期断言、E2E null 处理等真实缺陷）；PMBus 算法、命令元数据、
  UI 行为零改动。`tests/typecheck-contract.test.ts` 结构性锁定该合同。
- 发布合同：`scripts/check-release-contract.mjs`（完全离线，版本唯一来源
  package.json）校验 lockfile、CHANGELOG、release notes、双 README 链接、ROADMAP
  与 Release 资产命名一致性；`tests/release-contract.test.ts` 覆盖成功/失败场景；
  接入 `npm run verify`、full CI 与 AGENTS/CONTRIBUTING 门禁清单。
- `docs/RELEASING.md` 重写为 M19-B 后正确流程（PR head CI → checked_tree 审计 →
  detached worktree 全量验证 → zip/SHA256SUMS → annotated tag → Release → Pages →
  deployment smoke），删除“等待 main push CI”；DEPLOYING.md 顺序核对一致。
- CI：Node 24 次级验证升级为 typecheck+单测；`ci-workflow.test.ts` 同步。
- v1.1.4 PATCH：仅含 v1.1.3 后合入 main 的兼容修复与验证/发布加固
  （hygiene/spec 分发、Tailwind 范围、CI tier/ruleset、Vitest/Node、M21、M22、M23），
  无新产品功能；CHANGELOG、`docs/releases/v1.1.4.md`、双 README、本文件同步更新。
- 状态依据：本地 `npm run verify` 全绿（含 Node 22 fresh 与 Node 24 隔离验证）；
  PR/CI 审计证据见对应 PR 与 Actions 运行，不在本文件维护。

### M22 done — CommandPicker 完整 APG 焦点、选择与搜索生命周期

- 选项语义对齐 W3C APG combobox pattern：`role="option"` 从可聚焦 `<button>`
  迁移到不进入 Tab 顺序的 `<li>`（hover/active/cursor 由既有 `[role='option']`
  CSS 规则继续命中，渲染几何不变，visual snapshot 零变化）；`aria-selected=true`
  恒等于 `aria-activedescendant` 指向的 active option（render-time 守卫，
  query 过滤中间帧不悬空）；committed command 视觉标记改走 `data-current`，
  不再复用 ARIA selection（原实现方向键移动后 selected 仍停在 committed 上）。
- 键盘生命周期：ArrowUp/ArrowDown 首尾停止不循环（原为取模循环）；Enter 应用
  active option；Escape 取消并恢复 trigger 焦点；Tab/Shift+Tab 关闭 popup 并把
  焦点移动到 trigger 的逻辑后继/前驱（新增 `src/app/focus-navigation.ts`：
  DOM 顺序、排除 tabindex=-1/disabled/不可见、不因 body 末尾 portal 跳到页面
  首/末控件，jsdom 单测）；焦点经键盘或脚本移出 popup/trigger 时关闭 popup 且
  不抢焦点（document focusin）。Home/End/左右键不拦截、无冲突选项导航
  （合成键盘事件的光标默认动作在无头/有头环境不稳定，E2E 以 defaultPrevented
  与 active 不变锁定合同）。
- 搜索与零结果：「无命令」只在空 query 时是合法 option；非空 query 零匹配显示
  `role="status"` 的「无匹配命令」、移除 `aria-activedescendant`、Arrow/Enter
  安全 no-op（原实现零匹配仍保留「无命令」option 且 Enter 会清空已选命令）；
  清空 query 后恢复真实 option、active selection 与 listbox 内部滚动位置。
- 回归矩阵 `tests/e2e/command-picker-a11y.spec.ts`：19 场景 × desktop/mobile
  双 project——trigger 键盘打开、active 与唯一 aria-selected 一致、首尾不循环、
  Tab/Shift+Tab/Escape/Enter/外部焦点、option 全程无 DOM focus、零匹配/清空
  恢复/多字符收敛、Home/End 非拦截合同、pointer 选择、950×304 popup
  containment、360px 无 body 横向 overflow。实施前 14/19 在未修改 main 上
  失败（探针另证 6 项缺口）。
- 依赖、PMBus 算法、命令元数据、CI 配置与版本零改动；状态依据：本地
  `npm run verify` 全绿；PR/CI 审计证据见对应 PR 与 Actions 运行，不在本文件维护。

### M21 done — 输入校验可访问性与键盘交互可靠性

- 统一整数语法为「可选正负号 + 十进制数字」：`src/app/int-parse.ts`（由 decimal-parse
  泛化重命名）成为 reducer 与所有整数输入组件的唯一解析来源；`1e2`、`1.5`、`12abc`、
  `0x10`、仅正负号、unsafe integer 在 L11 N/Y、DIRECT Y、DIRECT m/b/R 一律拒绝，
  此前 `Number()` 宽松转换会把 `1e2`/`0x10` 当合法值接受。
- 统一输入编辑模型（IntegerInput / ValueInput / DecimalInput / HexInput）：过渡态
  （空串、单独正负号、`1e`、`1.` 等）暂存且不逐键报错；非法文本不进入 committed
  state/raw/结果；非法最终值在字段级显示唯一可见错误并保留 draft，不再静默回滚；
  合法修正后错误、ARIA 状态与旧 draft 同时清除；`aria-invalid` 仅在确实非法时出现，
  `aria-describedby` 指向真实存在的唯一错误节点。HALF 继续接受 NaN/±Infinity，
  其他模式对非有限值给出字段级错误。
- DIRECT 系数错误改为按字段隔离的 `state.direct.errors.{m,b,r}`：编辑无关字段不再
  覆盖或清除仍有效的字段错误，错误跨模式切换保留；m=0 仍为显式存储的非法状态。
  系数错误只内联显示在对应字段旁，InfoPanel 不再重复播报同一错误（移除
  direct-coeff-error / direct-m-zero 重复警告）。
- 全局快捷键 `Ctrl+1..4` 仅在非编辑上下文生效：新增 `src/app/editable-target.ts`
  （input/textarea/select/contenteditable/role=textbox/role=combobox，含祖先匹配，
  带单测）供 `App.tsx` 判定；同时拒绝 Meta/Ctrl+Alt/Ctrl+Shift 变体。编辑区按快捷键
  不再切换模式、不丢 draft、不抢焦点。
- CommandPicker 补齐 combobox 语义：搜索框获得显式 `aria-label`（不依赖 placeholder
  兜底）；query 变化后 active option 重置为 selected-or-first 的既有行为由回归测试
  锁定（`aria-activedescendant` 始终指向真实存在的 option）。
- 数值范围合同保持不变：L11 N/Y、DIRECT Y、L16 V 超范围继续 clamp；DIRECT m/b/R
  超范围继续拒绝并保留最后有效值；`m ≠ 0`。`parseFloatSafe` 迁移到
  `src/app/float-parse.ts` 供 reducer 与 ValueInput 共用，行为不变。
- 有界 viewport 业务矩阵（`tests/e2e/input-interaction.spec.ts`，pairwise 而非笛卡尔积）：
  L11@360×800 light（手动 Y/N）、L16@390×844 dark（V 非法+clamp）、DIRECT@768×1024
  light（m/b/R 与 Y 字段级错误）、HALF@1280×900 dark（NaN/±Infinity 合法、垃圾文本
  非法）、CommandPicker@950×304、快捷键 desktop+mobile 双 project；每个非法场景断言
  draft、`aria-invalid`、错误关联 ID、raw 未破坏、修正后清除、无横向 overflow、
  错误不截断不遮挡。视觉验收含 5 张错误态截图逐图检查；visual snapshot 零变化
  （+0/~0/-0），稳定页面布局与基线逐字节一致。
- 产品算法、命令元数据、依赖与 CI 配置零改动。状态依据：本地 `npm run verify` 全绿；
  PR/CI 审计证据见对应 PR 与 Actions 运行，不在本文件维护。

### M20 done — 测试运行时依赖链健康与受支持 Node LTS 对齐

- 退出问题重调查（全部为本轮实测，未复用任何旧证据）：M19-A 记录过一次的 Node 24 下
  Vitest 完成后不退出问题，本轮在 Node 24.19.0（目标/workflow 回归、4× 全量单测、
  coverage）与 Node 22.23.2（隔离 worktree、fresh `npm ci`、目标/workflow 回归、
  3× 全量单测、coverage）共 10 次 Vitest 3.2.7 运行中全部断言完成后正常自退（rc=0），
  未复现；不作为缺陷修复立项。
- 立项依据为依赖链健康：当前 `@vitest/coverage-v8@3.2.7 → test-exclude@7.0.2 →
glob@10.5.0` 在 `npm ci` 输出真实弃用警告（Node 22/24 一致）；成对升级到
  `vitest@^4.1.11` + `@vitest/coverage-v8@^4.1.11`（peer 兼容现有 Vite 6.4.3，
  Node engines `^20 || ^22 || >=24`）后 glob 完全移出依赖树（`npm ls glob` 为空），
  fresh `npm ci` 零弃用警告、0 漏洞，lockfile 净减约 570 行。
- 升级验证（隔离 worktree 双版本矩阵）：目标测试（99）、全量 492 单测、coverage、
  typecheck、lint、build 在 Node 22 与 Node 24 下全部通过；Vitest 4 的 AST-based
  V8 coverage 数字更准确（约 91.9/87.7/94.9/94.7），仍高于 80/70/80/80 阈值，
  阈值不降低；生产 build 产物与升级前逐字节一致（同 hash）；产品算法、UI 与
  snapshot 零改动（0/0/0）。
- engines 收紧为 `>=22 <23 || >=24 <25`：只表达项目实际验证与承诺的 Node 版本
  （CI 主验证 22 + 兼容检查 24），排除已 EOL 的奇数版本 23 与未验证的 25+。
- CI 保持单一 `check` job 与单一 required check：full tier 末尾新增 secondary LTS
  兼容检查——重新 setup Node 24（同一 reviewed setup-node SHA）后
  `npm ci && npm run test:run`，把本地开发实际使用的运行时纳入持续验证；
  light tier 不执行；不新增 job；Playwright 报告上传条件不变。
- `tests/ci-workflow.test.ts` 扩展：两个 setup-node 步骤同 SHA 固定、主验证仍为
  Node 22 且不被 full-tier 条件门控、secondary setup 与
  `npm ci && npm run test:run` 均受统一 full-tier 条件门控。
- 状态依据：本地 `npm run verify` 与 workflow 回归测试通过；PR/CI 审计证据见对应
  PR 与 Actions 运行，不在本文件维护。

### M19-B done — 受保护 main 与合并后重复 CI 消除

- main 由单一 ruleset `protect-main` 严格保护：所有 main 变更必须经 PR；required check
  为 GitHub Actions 的 `check`（app 从真实 check-run 查询后配置，不硬编码）；strict
  up-to-date 开启；管理员无绕过（bypass actors 为空）；force push 与删除禁止；
  人工 approval 要求为 0；无 merge queue、无签名要求、无 linear history 要求，
  保持普通 merge commit 策略。
- CI 触发模型：仅目标为 main 的 `pull_request` 与手动 `workflow_dispatch`；删除
  `push: main` 触发器。PR checkout 默认测试 merge ref（不覆盖 `ref`），配合 strict
  保护，PR CI 实际测试的树与 merge 后 main 树一致，第二次 merge CI 只会复验同一
  棵树，因此删除；不使用 `paths`/`paths-ignore`/`merge_group`；单一 `check` job、
  light/full 分级与 M18 concurrency 语义（同 PR 新提交取消旧 run、不同 PR 互不取消、
  manual run 不因 PR concurrency 被取消）全部保留。
- 证据模型：新增 `Record checked revision` 步骤（stable id `revision`）记录实际测试的
  commit（`checked_sha`）与 tree（`checked_tree`），写入受控 `$GITHUB_OUTPUT`、日志与
  step summary；merge 后比较 PR `checked_tree` 与最终 merge SHA 的 `HEAD^{tree}`，
  完全相同即验证完成，不一致属于真实阻塞（workflow_dispatch 跑 full 并定位）。
  `workflow_dispatch` 分类无条件为 full，是紧急/诊断入口，不是每次 merge 的固定步骤。
- Workflow 最小权限：顶层 `permissions: contents: read`；checkout `fetch-depth: 0` 且
  `persist-credentials: false`；删除已不可达的 push whitespace step；PR 完整 base→head
  whitespace gate 与 M19-A Playwright 报告上传条件原样保留。
- 回归测试扩展：`tests/ci-workflow.test.ts` 与 `tests/classify-ci-scope.test.ts` 覆盖
  触发矩阵、权限、checkout、revision 证据、manual 永不 light、未知事件 fail closed、
  重型步骤统一 full-tier 条件与 artifact gate 不回退。
- 产品算法、UI 与 snapshot 零改动（0/0/0）；分支保护设置属于远程治理证据，
  记录在最终任务报告，不在本文件维护动态 API 输出。
- 状态依据：本地 `npm run verify` 与两个回归测试文件通过；PR/CI 审计证据见对应 PR
  与 Actions 运行，不在本文件维护。

### M19-A done — CI 失败报告上传条件硬化

- Playwright E2E 与 production release smoke 步骤获得稳定 step id（`e2e`、`release_smoke`）；
  M18 的 concurrency、单一 `check` job、light/full 分类器与 required-check 名称全部保持不变。
- 两个报告上传条件分别收紧为
  `failure() && steps.scope.outputs.run_full != 'false' && steps.e2e.outcome == 'failure'` 与
  `... && steps.release_smoke.outcome == 'failure'`：只有对应测试步骤确实执行并失败才上传；
  light tier 不上传任何 Playwright 报告；full tier 在 typecheck/lint/coverage/build 等
  非 Playwright 步骤失败时也不上传尚未生成的报告；artifact 名称与报告目录不变。
- 新增 `tests/ci-workflow.test.ts` workflow 回归测试（零新依赖的结构化文本断言）：步骤 id、
  逐报告上传条件、共享 full-tier 条件覆盖所有重型步骤、无 `paths`/`paths-ignore`、
  单一 `check` job、concurrency PR/main 语义与分类器步骤不变。
- 本地 Node 24.19.0 观察到的 Vitest 完成后进程不退出问题：本次以有限超时（120/120/150 秒
  deadline）复现小文件、全量单测与 coverage 三种运行，均正常自退（rc=0），未在本地复现；
  不修改 engines、Vitest 版本或 CI Node 22 配置，列为 M20 候选独立调查。
- 产品算法、UI、测试、构建与发布 smoke 行为零改动；snapshot 0/0/0。
- 注：本条的 main-push CI 行为已由 M19-B 的受保护 main 策略取代（main 不再有 push CI）。
- 状态依据：本地 `npm run verify` 与 `tests/ci-workflow.test.ts` 通过；PR/CI 审计证据见
  对应 PR 与 Actions 运行，不在本文件维护。

### M18 done — 成本感知 CI 分级与单 PR 闭环

- Workflow 级 concurrency：同一 PR 的新提交自动取消该 PR 的过时 run（`cancel-in-progress`
  仅 pull_request 事件为真）；不同 PR、PR 与 main、main push 互不取消，main 不设
  cancel-in-progress，保留每个 merge SHA 的验证证据。
- 单一来源分类器 `scripts/classify-ci-scope.mjs`：light-only allowlist 只在该脚本维护
  （`docs/**`、根级 README/README_zh-CN/CHANGELOG/AGENTS/CLAUDE/CONTRIBUTING/LICENSE/
  THIRD_PARTY_NOTICES/.gitignore、`document/README.md`、`.github/ISSUE_TEMPLATE/**`、
  `.github/pull_request_template.md`）；全部 changed paths 命中才 light；diff 使用
  `--name-only --no-renames -z` 与 merge-base（PR `base...head`）/`before..sha`（push）语义。
- Fail closed：空变更集、缺失/非法 SHA、全零 push before、git diff 失败、未知事件、
  任意未知路径、light/full 混合一律 full；分类器自身、测试、workflow、配置与依赖变更
  均为 full；changed paths 只进日志，`$GITHUB_OUTPUT` 只写受控常量
  （`tier`/`run_full`/`changed_count`/`reason`）。
- CI 仍为单一 `check` job：npm ci、repo hygiene、format、markdown math 与完整
  PR base→head / push before→head whitespace gate 两个 tier 都执行；
  specs/typecheck/lint/coverage/Playwright/build/Tailwind gate/release smoke/audit
  仅 full tier（`run_full != 'false'` 的 fail-closed 条件控制全部重型步骤）；不使用
  workflow 级 `paths`/`paths-ignore`，required check 名称不变，Playwright report
  上传仅限 full tier 失败时。
- 本地入口：`npm run verify:light` 仅限分类器确认的 pure light-only 任务；
  `npm run verify` 完整强度不变。
- 单 PR 里程碑闭环：`docs/ROADMAP.md` 以 main 为正式事实来源，Done 在实现 PR 最终
  提交中翻转，PR head CI 全绿后 merge；不再创建第二个 bookkeeping PR；CI URL 与
  SHA 属于 PR/Actions/最终报告的审计证据，不写入 ROADMAP。
- 产品算法、UI 与 snapshot 零改动（0/0/0）。
- 注：本条的 main-push CI 行为已由 M19-B 的受保护 main 策略取代（main 不再有 push CI）。
- 状态依据：分类器单测（含真实 git 临时仓库集成）、历史 commit range 验证与本地
  `npm run verify`；PR/CI 审计证据见对应 PR 与 Actions 运行，不在本文件维护。

### M17 done — 生产样式源码隔离与可复现构建

- 问题：`src/styles/tokens.css` 此前依赖 Tailwind v4 默认的工作目录候选词扫描，非生产文件
  （`scripts/`、`tests/`、`docs/` 以及 `src/` 内 colocated 单测）中的英文文本会泄漏成 utility
  规则（如 `lowercase`、`table`），造成 v1.1.3 之后 main 构建 CSS 与制品哈希的无意义漂移。
- 修复：改为显式 source 配置——`source(none)` 关闭自动扫描，`@source '../'` 只登记 `src/`，
  `@source not '../**/*.test.ts'` 排除 colocated 测试；`index.html` 无 utility class，不纳入扫描。
- 门禁：`npm run check:tailwind-scope`（`scripts/check-tailwind-scope.mjs`）检查真实 `dist/`：
  生产范围外 canary utility（单一来源 `tests/tailwind-source-canary.ts`）不得生成、已知泄漏规则
  （`.lowercase` / `.table`）不得出现、产品必需 utility 必须存在；已接入 `verify` 链与 CI（Build 之后）。
- 行为不变：算法、舍入、字节序、复制格式、命令元数据与持久化契约零改动；JS 制品内容与基线一致；
  两次干净构建制品树逐文件 SHA-256 完全一致。
- 状态依据：PR #30 head `ae753e1` CI 全绿；main merge SHA `bbbe9f9` CI 全绿；本地 `npm run verify`、
  visual（23 passed，snapshot 零变化）与两次干净构建逐文件 SHA-256 一致性均通过。

### M15 done

- 代码与文档已合入 main；版本号 `1.1.2`。
- GitHub Release `v1.1.2` 已发布，release event 已自动触发 Pages 并完成部署，远程 smoke 4 passed。
- 对比度、公式语义、复制工具栏、移动端密度与视觉验收规则见 `docs/UI_CONVENTIONS.md`。

### M14 done

- 代码与文档已合入 main；版本号 `1.1.1`。
- GitHub Release `v1.1.1` 已发布，release event 已自动触发 Pages 并完成部署，远程 smoke 4 passed。
- Markdown 数学检查、popup viewport 约束、视觉与 a11y 规则见 `docs/UI_CONVENTIONS.md`。

### M13 done

- 代码与文档已合入 main；版本号 `1.1.0`。
- GitHub Release `v1.1.0` 已发布，SHA256 校验通过，Pages 已从不可变 Release 资产完成部署，远程 smoke 4 passed。
- Markdown 数学公式、Web KaTeX 公式、交互状态矩阵与 reduced-motion 规则见 `docs/UI_CONVENTIONS.md`。

### M11 release baseline

- 首次稳定发行统一为 `v1.0.0`；`package.json` 版本不带 `v`，Git tag 带 `v`。
- 发布纪律、稳定公共契约与发布流程见 `docs/RELEASING.md`。
- 变更日志见 `CHANGELOG.md`；发行说明见 `docs/releases/v1.0.0.md`。
- GitHub Release 是当前正式发行渠道，不发布 npm 包。

## 当前有序 backlog

1. READ_EIN 权威字节数选择：需要目标器件数据手册或适用规范修订，blocked。
2. DIRECT `device-datasheet` profiles：需要真实器件数据手册，blocked。
3. 独立 FormulaEditor：optional，不是缺陷。
4. PMBus 新版规范升级：独立工作，当前不得自动开展。

> M21 已交付四模式有界 viewport 业务矩阵（L11/L16/DIRECT/HALF + CommandPicker +
> 快捷键，pairwise 组合）；原「更全面 viewport 业务矩阵」backlog 项随之关闭。
> 后续如需笛卡尔积级扩展（全主题 × 全 viewport），另行立项。

## blocked 条件

- 任何需要器件真实数据手册的 profile 或数据宽度结论：没有真实器件数据手册即 blocked，不虚构。
- PMBus 规范版本升级：仅在用户明确要求并指定规范版本/PDF 时启动。

## 历史归档

- [`docs/archive/web-refactor-m0-m10.1/`](archive/web-refactor-m0-m10.1/README.md)：M0–M10.1 冻结历史快照，不作为当前任务状态。
