# ROADMAP

> 本文件是里程碑状态的唯一事实来源。不要在其他文档中重复维护进度表。
> 历史完整快照见 [`docs/archive/web-refactor-m0-m10.1/`](archive/web-refactor-m0-m10.1/README.md)。

最后更新：2026-08-23（M27 Done：Release transaction commit semantics、recovery integrity、真实并发/故障注入与零 skip 验收，v1.1.8 PATCH）

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
M0–M27 complete；stable release v1.1.8；production distribution: GitHub Pages；当前无活动功能里程碑。
```

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
