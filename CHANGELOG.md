# Changelog

本项目遵循 Keep a Changelog 风格。版本号遵循 Semantic Versioning 2.0.0。

## [Unreleased]

## [2.6.8] - 2026-09-03

### Fixed

- **PMBus 1.3.1 provenance 可复现（P2）**：`document/specifications.json` 的
  `validatedReference` 此前声称 "PMBus 1.3/1.3.1 public archive"，但 manifest
  只有 1.3 Parts I–III 与 SMBus 3.0 四条实体，1.3.1 声明无法经 manifest 重取或
  哈希复验。现在补充 1.3.1 Parts I–III 三条官方实体（pmbus.org 归档 URL；
  bytes/SHA-256 于 2026-09-03 fresh 下载验证：Part I 178631 B / `68a8063e…`、
  Part II 678599 B / `1717c596…`、Part III 258382 B / `407605b7…`），
  `EXPECTED_DOCUMENT_COUNT` 4→7，manifest 契约测试同步覆盖 id/revision/landing
  page；`docs/ROADMAP.md` validated reference 句与 manifest 对齐（1.3→1.3/1.3.1）。
  不跟踪任何 PDF；规范 PDF 仍只进 git-ignored `.cache/specifications/`。
- **L16 术语文案与 PMBus 1.3.1 对齐（P2）**：ULINEAR16 / SLINEAR16 并非本项目
  自创标签——PMBus 1.3.1 Part II 正式命名三种线性格式：§8.4.1 LINEAR16
  Formats、§8.4.1.1 ULINEAR16 Format（直接设置输出电压的命令如 VOUT_COMMAND
  使用 16 位无符号整数）、§8.4.1.2 SLINEAR16 Format（为输出电压加减偏移的命令
  如 VOUT_TRIM 使用 16 位二补码整数）。此前 glossary 将两者标为 project 来源并
  断言「非 PMBus 规范命名」，与规范相反。现在两条均为 `pmbus-spec` 来源并精确
  锚定 §8.4.1.1/§8.4.1.2，detail 说明 1.3 旧文统称 Linear Mode 的命名变化，
  §13.3/§13.4 偏移命令语义保留在正文；LINEAR16 保持 §8.4.1 总类条目。
  编码/解码数学、VOUT_MODE 位域、raw、字节序与持久化零变更。

## [2.6.7] - 2026-09-03

### Fixed

- **VOUT_MODE 独立术语行 `N` 触发器点击目标 ≥24×24px（P2）**：术语行的
  exponent（`N`）触发按钮实测仅 `11.5625×24 px`，低于 `docs/UI_CONVENTIONS.md`
  §10「点击目标至少 24×24px」合同——全局 `.term-trigger` 是零 padding 的
  inline 元素，单字符术语在 flex 术语行中形成过窄命中区。现在为
  `.vout-term-row .term-trigger` 增加 scoped `min-inline-size/min-block-size:
24px` 并居中文本，仅作用于该独立控件行；页头、正文、结果区、命令参考与配置
  摘要中的句内术语触发器排版与命中策略不变。新增三 viewport（360/390/1440）
  几何回归（≥24×24、两两不重叠、无裁切、无 body 横向溢出）与 mobile-contract
  真实 touchscreen tap 开/关路径；四张 VOUT_MODE 视觉基线经逐图成对审查后更新，
  变化全部限于术语行及其换行级联。

## [2.6.6] - 2026-09-03

### Fixed

- **legacy `PMBusMath.encodeLinear16` 指数语义修复（P2）**：该导出 helper 此前忽略
  指数参数 `n`，只返回 `clamp(v, 0, 65535)`，与同对 `decodeLinear16`
  （`X = V × 2^N`）不对称，也不符合 PMBus Part II §8.4.1 ULINEAR16 编码方向
  （`Y_u = X / 2^N`）——例如 `encodeLinear16(1, -8)` 返回 `1` 而非 `0x0100`，
  且可能泄漏非整数 payload。现在按既定舍入合同实现 `round(X / 2^N)` 后 clamp 到
  `0..65535`，与 canonical `encodeUlinear16` 一致（生产 L16 编码路径本就使用
  后者，产品行为不变）。新增 §8.5.2 官方算例 golden、非零正/负 N、舍入、饱和、
  round-trip 与 canonical helper 一致性覆盖。`pmbus-calculator.html` 离线归档
  保持原实现，差异已在 MIGRATION_MATRIX 披露。

## [2.6.5] - 2026-09-02

### Fixed

- **L16 Hex 字节序 byte-stream 语义修复（P1）**：L16 页的 Hex 输入/显示现在是
  所选字节序的 2 字节字节流——BE（高字节在前）输入 `1234` 与 LE（低字节在前）
  输入 `3412` 都表示寄存器 word `0x1234`。此前解析（`raw/set-from-hex`）与显示
  （`displayedRaw`）在 `byteOrder === 'be'` 时才交换，方向与 LE/BE 标签相反：
  BE 输入 `1234` 被稳定反向解码为 `0x3412`（VOUT_MODE `0x18` 下物理值
  52.0703125 而非 18.203125），且「原始 Hex」显示与实际 raw、LE/BE 字节数组
  互相矛盾。修复后解析与显示共用同一变换（LE 交换、BE 原样），切换字节序只
  翻转 Hex 呈现顺序，不改 raw 与物理值；LE/BE 字节数组、Hex 复制、C 宏与
  `rawWordHex` 继续派生自未交换 raw word，持久化格式与偏好不变。不足 4 位的
  输入先按数值左补零成规范 4 位再按字节序解释（`parseHexStrict` 语义不变）。
- 固化反向行为的单测（reducer/view-model）与 L16 相关 E2E 断言同向更新；
  新增 `l16-byte-order` 闭环 E2E（BE 输入→物理值→切 LE→显示翻转→LE 输入回环、
  物理值编码后切换字节序）与共享 `leByteStreamText` 测试助手；
  `desktop-dark-l16-stress` 视觉基线经新旧逐图审查后更新。

### Changed

- DOMAIN_MODEL §4 重写为字节流合同；terminology `le`/`be` 条目与 L16 页
  字节序提示措辞同步（不再声称 BE「仅用于寄存器显示或复制」）；copy 偏好
  （`copy.endian`）与其帮助文案不变。

## [2.6.4] - 2026-09-01

### Added

- **relative ULINEAR16 R=0 非符合性告警（Part II §8.5.2）**：规范要求相对值
  恒为正，L16 页此前只诊断派生溢出/下溢，提交的 `R=0`（raw 0000）会无标注地
  显示为精确 0。现在 view-model 经共享 `resolveL16Relative` 的同一 ratio 解码
  输出 warning `l16-relative-zero-ratio`：数学结果保持精确 `V_NOM × 0 = 0`，
  不伪造饱和或错误，物理值复制保持可用；告警区分 `nominal=0` 的 decode-only
  真零与 signed offset（bit7 不参与数学），标称参考缺失时仍然出现。验收向量
  `0x98 / 0000 | 12 → R=0, X=0` 具备状态级单测与 E2E 覆盖。

### Changed

- **DIRECT generic signed 契约澄清**：DIRECT 页脚注、README 与 DOMAIN_MODEL
  §2.3 明确本页 Y 按 §7.4 generic 契约为 16 位有符号（raw=FFFF → −1）；Part II
  §8.1.1/§8.4.3 规定输出电压命令数据为无符号正值语义，该 VOUT 输出上下文需要
  命令/器件数据，本产品不内置 unsigned profile、不静默重解释 Y；
  `decodeDirect` 等受保护算法零变更。relative DIRECT（0xC0）与 relative Half
  （0xE0）的要求警告与说明卡统一补充「相对值必须为正（§8.5.2）」，绝对
  sibling（0x40/0x60）保持无该表述。

### Docs

- **legacy HTML 已知数值偏差披露**：MIGRATION_MATRIX 新增离线归档两处已知
  偏差——`findBestLinear11` 的 `1e-15` epsilon tie 判定（早于 v2.5.10
  strictly-nearest + 全范围饱和合同）与 `encodeHalf` 的 `Math.round` 非对称
  舍入（不符合 IEEE 754 RNE）；README legacy 段落指向该披露并声明 React
  应用为数值权威。归档文件本身零修改。

## [2.6.3] - 2026-08-31

### Fixed

- **v2.6.2 正式站验收测试的系数错误（test-only）**：v2.6.2 发布 event 的
  Pages workflow remote smoke 中，新增的「DIRECT 尾零补偿科学计数法向量」
  验收用例误用了 fidelity 组的系数 (m=1, b=1, R=17)——该组下 V=1 超出
  DIRECT Y 的 16 位表示范围，应用按既有合同饱和编码为 Y=32767（raw
  0x7FFF），用例期望 raw 0001 因此失败（3 次重试一致）。这是验收测试抄错
  系数组，不是应用缺陷：同一构建在 CI e2e 的 direct-fidelity v2.6.2 用例
  （正确系数 (1, 0, 0)）通过。修正为 (m=1, b=0, R=0) 后，该用例对正式站
  实测通过（raw 0001）。应用代码、dist 资产与 v2.6.2 发布零差异；本版本
  仅包含该测试修正与版本面文档。

## [2.6.2] - 2026-08-31

### Fixed

- **已发布 Release 不可变性 fail-closed 验证**：`release-assets-verify` 在
  published 模式下要求 Release 元数据 `immutable === true`（缺失、`false` 或
  非布尔一律 exit 3 拒绝），draft 模式豁免（draft 的 `immutable` 尚无意义）；
  `verify-downloaded-assets` 经共享边界继承同一门禁；Pages workflow 合同测试
  钉住 published 模式的 metadata → download → verify → extract → deploy
  步骤顺序。`docs/RELEASING.md` 新增历史 mutable Release 操作停止策略：
  v2.5.13+ 发布为 immutable、v2.5.12- 为 mutable，历史 mutable 发布绝不能
  成为手动部署/回滚目标，旧 tag/Release 永不删除、重建或移动。
- **DIRECT 尾零补偿科学计数法精确提交**：审计最小向量
  `1` + 501 个 `0` + `e-501`（507 字符，binary64 值恰为 1）此前被
  v2.5.12 的句法移位边界按 `shift-out-of-range` 拒绝，UI 判 valid、reducer
  静默 no-op。现在词素归一化在 BigInt 之前做 O(n) 尾零剥离，并把下溢边界
  改为按有效移位（`shift + trailingZeros`）判定，下限
  `-max(500, raw.length + 323)` 保证任何 classify-valid 词素都不会被静默
  丢弃；4096 原始长度门禁与「trim 前计数」合同不变。编码/解码/舍入与受保护
  算法零变更；新增 golden 矩阵（e-500/e-501/e-502、±符号、部分补偿、深位
  golden、fail-closed 钉子、4096 字符补偿向量）与 reducer provenance、E2E
  提交断言。
- **控件 tooltip 可悬停驻留（WCAG 2.2 SC 1.4.13）**：指针离开触发器不再立即
  关闭，而是进入 150ms 确定性宽限；移入浮层或回到触发器即取消关闭，指针离开
  两者后才关闭。Escape / blur / 外点关闭、click 恰好一次、触屏零劫持与全局
  单开合同不变；surface 的 pointerenter 只取消定时器、不写状态，焦点打开的
  surface 不会被 hover 翻转来源。
- **VOUT_MODE radio 键盘合同（ARIA APG radio pattern）**：绝对值/相对值与
  格式（bits[6:5]）两组 `role=radiogroup` 此前无方向键、无 roving tabindex。
  现在选中项是唯一 tab stop，ArrowRight/Down 下一项、ArrowLeft/Up 上一项，
  循环并跳过 disabled（VID 下相对值）；焦点到达即选择，复用 click 的幂等
  守卫；选中项被 disabled 的非法组合字节（如相对+VID）按首个可用项兜底
  tab stop，键盘不进入死胡同。独立页与 L16 内嵌两处同样生效；新增纯函数
  `src/app/radio-navigation.ts` 单测 + 四条 E2E。
- **L16 内嵌 bits[6:5] 禁用原因浮层外可见**：原生 disabled 的位按钮不产生
  指针/焦点事件，禁用原因此前只存在于位 aria-label 与（永不触发的）
  tooltip 中。现在新增可见原因行（`vout-bits65-disabled-reason`），linked
  与非 LINEAR 两种措辞由 `src/app/vout-mode-formats.ts` 单一来源提供，并经
  `aria-describedby` 关联到 bit5/bit6 按钮。
- **删除无消费者的 `focus-navigation` 死代码**：`src/app/focus-navigation.ts`
  仅被自身同名测试引用，无任何生产导入方，独立绿色清理提交删除。

### Changed

- **文档**：`docs/UI_CONVENTIONS.md` §7 控件说明触发策略从「移开即消失」改写
  为 SC 1.4.13 可悬停/可驻留/可关闭合同，禁用控件条款补 aria-describedby
  关联；§14 补 L16 bits[6:5] 可见禁用原因与单一来源。视觉基线仅 L16 三个
  桌面场景因新增可见原因行更新（逐图审查：唯一差异即新原因行及其下移内容）。
- **deployment 验收**：`tests/e2e/deployment.spec.ts` 新增 v2.6.2 正式站
  验收组——DIRECT 审计向量提交 raw 0001、tooltip 可悬停驻留、radio 方向键、
  bits[6:5] 可见禁用原因。

## [2.6.1] - 2026-08-31

### Fixed

- **Pages 手动部署来源绑定**：`workflow_dispatch` 部署路径此前在 checkout 默认
  ref 之后才解析输入 tag，验证脚本（`release-assets-verify` / `download` /
  `verify-downloaded-assets`）来自 dispatch 时的 ref 树而非被部署 tag 的树。
  现在 tag 解析与 SemVer 验证前置于 checkout（纯 shell，不依赖仓库源码），
  dispatch 必须在被部署 tag 的 ref 上发起（`github.ref_type == "tag"` 且
  `github.ref_name == inputs.release_tag`），checkout 显式绑定解析出的 tag
  （`persist-credentials: false`），并在 checkout 后校验 annotated tag、40 位
  peeled commit、`HEAD` 一致与 Release 元数据 `tag_name` 完全匹配。
  `release published` 路径行为不变。新增 `tests/pages-workflow.test.ts`
  workflow 合同测试。
- **术语浮层卸载状态**：`TechnicalTerm` 在自身浮层为 active surface 时被卸载
  （如 Ctrl+1..5 模式切换对仅 L11 渲染的术语）会残留 provider 的 detached
  trigger 引用并泄漏共享 document 监听（jsdom 合同实测 added=2/removed=0）。
  现在与 `ControlTooltip` 对称地在卸载时 `closeIfActive`。应用级 E2E 锁定
  「模式切换后无残留 portal、全局单开、Escape 恢复到有效触发器」；provider
  状态本身由新增 `src/components/help/help-overlay.test.tsx` jsdom 合同守护
  （真实 Provider + TechnicalTerm + Probe，StrictMode 监听对称性）。注：React
  19 的实例级 `useId` 让重挂载获得不同 surfaceKey，掩盖了应用级可见症状——
  jsdom provider 合同是本缺陷的失败门，E2E 为回归锁。
- **ARIA 关闭态合同文档纠偏**：术语触发器 collapsed 态实际输出
  `aria-expanded="false"`，`docs/UI_CONVENTIONS.md` §7 曾写「关闭时不声明
  expanded」；按常见 disclosure 语义保留实现并修正文档——`aria-controls` /
  `aria-describedby` 仅打开时存在，控件 tooltip 仍无 `aria-expanded`；E2E
  补齐关闭态与 Escape 后的属性断言。
- **规范引用精度**：SMBus / LE 术语中「word 线上低字节在前」的引用收窄为
  「Part II §7.6 对浮点数据明示」（通用传输规则来自 SMBus/PMBus），事实陈述
  不变。

### Changed

- **术语放置覆盖单一事实源**：删除只被单测读取、且引用了不存在 testid 的
  `TERM_PLACEMENT_SURFACES` 字符串清单及其仅检查非空字符串的单测；
  `tests/e2e/terminology-popover.spec.ts` 直接导入 `GLOSSARY_TERM_IDS`，在
  页头、五种模式、结果区、显式编码请求（quantization）、relative（
  VOUT_COMMAND）、VID（vid-code-type）与展开的命令参考等真实页面状态中，从
  `data-testid="term-trigger-<id>"` 累计出现过的术语 id，断言与 registry
  完全相等——无缺失、无未知 id、不依赖手写全量清单，动态 format 与状态性
  术语均在对应状态覆盖。
- **CI light-tier 不再空转安装**：e2e job 的 `npm ci` 在 light-only 变更时
  跳过（scope 先行、`!= 'false'` fail-closed 门不变；quality job 的 light
  gates 所需安装保持无条件；workflow_dispatch 恒 full）；workflow 合同测试
  同步扩展（含 mobile 步骤的 full-tier 门断言补全）。
- **CI 语义 E2E 双 worker**：desktop 语义套件在 CI 以 2 个 worker 运行。
  采纳依据为本地无 retry 实验：1-worker 105s → 2-worker 三轮 59/59/58s
  （中位改善 44%，零 flake、零 retry、326 逻辑测试数守恒），六个高时序风险
  spec 的 2-worker × repeat-each=10 压力共 1210 次执行零失败、零 skip；
  mobile / release / visual 的 worker 策略不变，决策由
  `tests/playwright-default-config.test.ts` 钉住。

## [2.6.0] - 2026-08-31

### Added

- **全局帮助浮层体系（M42）**：概念术语气泡与控件说明两类触发策略推广到全应用，
  任一时刻至多一个帮助浮层（`HelpOverlayProvider` 全局单开：打开任一浮层自动
  关闭另一个；单一 document 监听负责外点关闭与 Escape 关闭并把焦点恢复到
  触发器；状态不进入主 reducer、不持久化）。
- **术语气泡全局放置**：帮助概念术语（`TechnicalTerm`）覆盖页头（PMBus、
  binary16、SMBus）、五种模式工作区（LINEAR11 指数/范围、LINEAR16 字节序与
  ULINEAR16/SLINEAR16 语义、DIRECT 二补码系数、HALF binary16 与 NaN/±Infinity、
  VOUT_MODE 配置字节/bit7 语义/指数/当前格式）、结果区（原始 Hex、LE/BE、量化
  误差）与命令参考（事务）；每个概念至少一个生产放置面由
  `TERM_PLACEMENT_SURFACES` 契约守护。术语数据合同扩容：`source`
  （pmbus-spec/smbus/project/generic）、`specRef` 与 `scope` 元数据；LINEAR11
  指数 N（word bits[15:11]）与 VOUT_MODE 参数 N（bits[4:0]）拆分为两个概念，
  消除「同一个 N」的语义混用。
- **控件悬停/键盘焦点说明（`ControlTooltip`）**：全部按钮与按钮型控件（模式
  tab、主题切换、LINEAR11 N 锁、VOUT_MODE 绝对/相对值、格式 radio、规范化/
  应用示例/说明折叠、16/8 位位编辑按钮、复制/前缀/空格/字节序按钮、计算过程/
  命令参考/调试面板折叠）统一获得悬停即显示、移开即消失的说明；文案只来自
  `src/app/control-help.ts` 的 typed `CONTROL_HELP` registry（per-id 参数模板，
  如 N 锁随锁定状态变化、位按钮显示位号/区域/当前值、物理值复制显示禁用原因）。
  触发合同：fine-pointer 悬停双门禁（matchMedia + `pointerType === 'mouse'`，
  触屏首 tap 永不被劫持）、键盘 `:focus-visible` 打开、blur/Escape 关闭、
  click 原动作只执行一次、`role="tooltip"` + `aria-describedby`（无
  `aria-expanded`）。
- **可见禁用原因**：VID 下 VOUT_MODE「相对值」的原生 `title` 说明改为浮层之外的
  可见段落（键盘/触屏可达），`data-testid="vout-rel-disabled-reason"`。

### Changed

- **原生 `title` 帮助全部移除**：主题切换、LINEAR11 N 锁、VID 相对值三处原生
  title 已删除；新增 `check:no-title-help` 门禁（verify 链 + CI quality job）
  拒绝 `src/` 下一切原生 title 属性回潮，control-tooltip E2E 另有运行时全量
  扫描回归。
- **VOUT_MODE 格式标签/术语单源化**：`vout-mode-formats.ts` 统一
  `VOUT_MODE_FORMATS`（value/label/termId/helpId），配置器与位区域不再各持一份
  FORMAT→术语映射副本。
- **视觉场景静止态归一**：visual 套件在截图前把指针停回 (0,0)、输入提交后释放
  焦点——v2.6.0 起真实鼠标点击会打开悬停说明、Tab 提交会在按钮上打开焦点说明，
  场景统一取「已输入、无焦点环、无浮层」的静止状态。8 张 stress 基线相应更新
  （差异仅为不再入镜的 bit 15 焦点环/焦点浮层），其余 20 张基线零变化。
- **UI_CONVENTIONS §7 重写**：从「Popover containment（术语气泡唯一）」扩展为
  「帮助浮层：术语气泡与控件说明」双合同（两类触发策略、全局单开、ARIA 身份、
  禁嵌套、registry 单源、no-title 门禁）。

### Removed

- **`src/components/result/ResultInspector.tsx`**：结果面板迁移到
  ResultSummary/ResultDetails/CopyToolbar 后零引用的死代码（`result-panel`
  live-region 合同由 ResultSummary 持有）；删除无行为影响。

## [2.5.15] - 2026-08-31

### Fixed

- **发布文档命令门禁的两个假阳性**：`check:release-docs-commands` 的提取器曾在
  第一个空格包围的 `>` 处截断全部后缀——`--mode draft > draft-verified.json
--unsupported` 这类「重定向位于参数之间」的命令被当成干净的 `--mode draft`
  调用通过并执行校验，而真实 CLI 会对未知 flag 以 exit 2 拒绝；引号不平衡的
  token（如缺结束引号的 `--metadata "draft-release.json`）此前会被 fixture
  替换静默换值后假通过，而真实 shell 根本无法解析。现在支持的语法显式为
  「至多一处尾部 stdout 文件重定向（裸 `>` token、纯文件名目标、其后不得再有
  token）+ 逐 token 引号平衡」；任何其他重定向形态原样透传给 argv 合同显式
  拒绝，提取器不再静默截断或修复，诊断包含来源文件与原始命令。Pages 形式
  （平衡的 `"${VAR}"` 模板值 + 一处尾部重定向）保持合法，正式文档命令 2/2
  通过。这不是已发布资产的缺陷——v2.5.13/v2.5.14 资产经独立核验正确且不可变。

### Changed

- **完整语义 E2E 套件以生产构建为主要验收目标**：桌面语义套件（310）与
  mobile-contract 套件（14）现在对 `vite preview` 服务的精确 `dist/` 运行，
  并挂载在官方 Pages 路径前缀 `/pmbus-calculator/` 下——整个套件同时成为
  前缀 URL 合同的实测证据；dev server 只保留 canonical visual 基线世界
  （28 张快照合同不变）。verify 链与 CI e2e job 在任何浏览器套件之前只构建
  一次，三个套件（desktop/mobile/release smoke）消费同一 dist，不再重复
  build；所有 preview webServer 使用 strictPort 且 `reuseExistingServer:false`，
  未知的或过期的服务器不能冒充绿灯。新增 `tests/e2e/helpers/app-url.ts`
  纯函数 URL 合同（`E2E_APP_BASE_PATH` 由目标配置声明，保留前缀与末尾斜线，
  拒绝 `..` 段）与 `app-base-url.spec.ts`（生产构建守卫、前缀保留、资源同源
  成功且非 HTML fallback、`?debug` 入口保留前缀）；25 个套件 spec 的 110 处
  `goto('/')` 与 2 处 `goto('/?debug')` 全部迁移到 `appUrl()`。
- **焦点与调试入口测试合同纠正**：hover/active/键盘 focus-visible 拆分为
  独立测试；focus-visible 从 fresh load 的真实 Tab 进入，断言预期具体控件
  （主题按钮、活动模式 tab）并以 Tab/Shift+Tab 在页内相邻控件间往返验证，
  不再依赖「blur 后按 Tab 必然落在任意 BUTTON/INPUT」的环境焦点假设——生产
  DOM 中 `#command-reference-toggle` 是页尾最后控件，顺序焦点导航此时允许
  离开页面（实测 preview 普通 URL Tab 后 activeElement 为 BODY、
  focus-visible=false，而 `?debug` 下落到调试按钮且 focus-visible=true）。
  调试面板 canonical 入口改为显式 `?debug` + 真实 `locator.click()`；普通
  URL 的可见性按目标构建判别（dev 自动渲染是开发契约，production 默认关闭
  是产品契约）。**未声明发现或修复任何浏览器焦点缺陷**：变化是测试起点与
  断言合同，不是产品行为。
- **维护说明与生成物文档对齐**：REPOSITORY_HYGIENE 不再手工复制清理器目标
  列表（副本已漂移：缺 mobile 目录、五份 reporter JSON 与 `.release-staging`，
  且误称 cleaner 只删除目录），例外章节不再暗示存在大小 allowlist；新增
  `tests/playwright-artifacts-consistency.test.ts` 从实际 Playwright 配置
  推导产物集合并与清理器常量双向比对。CONTRIBUTING 不再复制不完整的
  `verify:light` 步骤列表（package.json 是唯一命令真值）。

### Removed

- 无。本版本不删除任何快照、文档、兼容资源或测试覆盖；desktop 语义套件
  305→310（hover/active/focus-visible 组合测试拆为 3 个独立测试 +2，
  home 调试面板测试拆为显式入口与判别契约两个 +1，新增 2 个 URL 合同测试），
  mobile 14、release smoke 1、deployment 4、visual 28 全部保留。

## [2.5.14] - 2026-08-30

### Fixed

- **被拒编辑在 blur/Enter 时不再误提交旧草稿（P1）**：v2.5.13 中，被 DIRECT
  4096 字符资源门禁拒绝的粘贴会把当前 focus 事务标为 dirty，而受控输入仍保留
  上一个短草稿；随后的 blur/Enter 会把该旧草稿当新候选规范化提交——反例 A
  （raw FFFF，近似 −1）直接改写 raw 为 0000，反例 B（raw 0001、精确请求
  100000000000000001、误差 +1）raw 不变但精确请求 provenance 被近似值改写。
  现在 `ValueInput` 持有 rejected 候选标记（极小布尔状态，不保存超长文本）：
  blur/Enter 是 commit 层 no-op（不派发、不改 raw/参数/请求、不清错误），
  只有新的短候选通过门禁才清除标记并按其自身分类处理；同一 focus 内先前的
  合法提交保持有效，重复 focus/blur/Enter 不能伪造提交，模式切换不泄漏。
  超长文本仍然被拒绝——4096 上限不变，这是交互资源边界，不是 PMBus 规则；
  本修复不放宽长度上限，也不是算法更新。

### Changed

- **发布文档门禁绑定来源与逐条执行**：`check:release-docs-commands` 的
  expectedMode 曾是死代码（全局按 mode 聚合让两个来源互相满足对方的合同，
  mode 对调后门禁仍通过），每条 mode 只执行第一条文档命令（第二条带未知
  flag 的命令从未运行），`validated` 在任何执行前就填充，且子进程脚本路径
  相对父进程 cwd 解析。现在每个来源绑定其预期 mode，每条提取命令先过 argv
  合同（未知/重复 flag、缺值、位置参数、shell 语法显式拒绝而非解释）再逐条
  真实执行，只有实际 exit 0 才记为 execution validated；子进程以
  `process.execPath` 运行绑定 repoRoot 的入口脚本、cwd 固定为被检查根；
  失败按提取/argv 合同/fixture 构建/入口绑定/timeout/信号/CLI 非零分类并
  保留真实 exit code/stderr。
- **生成物生命周期一致（clean/hygiene/gitignore 三方对齐）**：mobile 套件的
  `output-mobile`/`report-mobile` 目录与全部五个 Playwright JSON reporter
  产物（`e2e-results*.json`）此前被生成、被 ignore、却不被 cleaner 清理
  （对这四种产物 dry-run 选择为空），被强制暂存时 hygiene 也不拒绝。现在
  cleaner 允许清单覆盖全部产物并对预期为文件的目标拒绝目录伪装（反向同理，
  自定义 target 保持既有行为），hygiene 新增 `e2e-results*.json` 拒绝规则，
  一致性测试锁定每个清理目标都被 .gitignore 覆盖；>1 MiB 大文件门禁的
  误导性诊断已修正（政策分类是统计数字，不是大小豁免；本版本未引入任何
  大小例外机制）。

### Changed (tests)

- **移动端触摸合同以真实触摸路径为准**：`locator.click()` 走 page.mouse，
  移动端仿真不会把它变成触摸；此前 mode tab 与外部关闭使用 click 且注释
  声称相反语义。现在需要证明触摸可用性的路径全部使用
  `locator.tap()`/`touchscreen.tap()`（术语气泡在 document 上监听
  pointerdown，触摸 tap 以 pointerType=touch 触发同一关闭合同），一次性
  事件观测探针证明真实 touch 事件到达（不修改应用行为），360 错误换行
  断言实测两行几何而非仅 visible，并新增 v2.5.14 被拒编辑的触摸失焦双基线
  （raw FFFF 与精确 provenance 0001）；fill/tap 等操作命名与实际一致。
  mobile-contract 套件 11 → 14 tests。
- **验证声明以 package.json 为单一真值**：AGENTS/CONTRIBUTING 不再手工
  复制 verify/verify:light 命令链（既有副本已漏掉 release-docs 门禁）；
  RELEASING 的 fresh 重建链不再在同一干净 worktree 内于 verify 之外原样
  重跑 typecheck/build/release smoke（PR head 验证与 merge 后 fresh 独立
  重建仍是两次不同可信边界；visual 与确定性资产生成仍单独执行）；
  ROADMAP 当前状态行与 UI_CONVENTIONS 的 E2E 项目描述与实际一致。

## [2.5.13] - 2026-08-30

### Fixed

- **DIRECT raw lexeme 资源边界统一（P2 修复）**：v2.5.12 的 4096 字符上限
  在 UI 按 raw 长度判断、在 exact parser/reducer 防线却先 `trim()` 再查
  trimmed 长度——直接派发 `1000000 个空格 + "1"` 会被 trim 后接受，raw 改写
  为 1 且 provenance 驻留百万字符原始请求。现在 `checkExactLexemeBoundary`
  在任何 trim/BigInt 之前对调用方原始字符串长度判定；`ValueInput.handleChange`
  在写入 draft state 之前拒绝超长输入（超长粘贴不再进入 React state，
  受控输入保留旧草稿，明确显示「输入过长，未提交」）；reducer 直接派发
  超长文本是严格 no-op；被接受的 provenance 文本长度 ≤4096。短输入的空白
  语义（首尾空白、任何指数下的 true zero）不变。这是交互资源边界，
  不是 PMBus 规则；编码策略（`Math.round` half-up + signed16 clamp）不变。

### Changed

- **E2E 语义只跑一次 + 显式移动端合同**：默认 Playwright 套件曾以
  chromium-desktop + chromium-mobile 双 project 无选择地完整执行两遍
  （292 逻辑用例 → 584 次执行），而多数 spec 内部自设 viewport，双跑并无
  独立覆盖。现在默认套件单 project 跑一次（293 tests），真实移动端风险
  集中到显式 `mobile-contract` 套件（11 tests，Pixel 7 仿真：390/360
  布局、触摸、术语气泡、命令参考、错误文案换行、逐格式转换 smoke），
  由独立 `playwright.mobile.config.ts` 承载并进入 CI 与 `npm run verify`。
  1 MiB 浏览器 paste 从 E2E 移除（资源边界由纯函数/reducer 单测锁定）；
  逻辑用例标题守恒（除 DIRECT 边界 describe 的 old→new 映射）。
- **未来 Release 平台强制不可变**：仓库设置 immutable-releases 已启用
  （v2.5.13 起的新 Release publish 后 API 报告 `immutable: true`；
  不追溯旧 Release）。RELEASING.md 增加 tag 前置复核（immutable 启用、
  admin 身份、目标 tag 不存在）与 publish 后 `immutable: true` +
  `gh release verify`/`verify-asset` attestation 复核步骤。
- **release 操作文档命令合同进入轻量 CI**：新增
  `scripts/check-release-docs-commands.mjs`（`npm run check:release-docs-commands`），
  从 `docs/RELEASING.md`（draft 模式）与 Pages workflow（published 模式）
  提取 `verify-downloaded-assets.mjs` 真实调用，在离线 fixture 上执行
  生产脚本：文档 argv 必须 exit 0，PR #74 的位置参数回归与非法 `--mode`
  必须 exit 2。该门禁在 CI 两个 tier 都运行（docs-only PR 不再绕过）。

### Removed

- 删除 `.depcheckrc`（90 bytes）：引用审计证明 depcheck 工具未安装、
  无任何脚本/CI/文档/lockfile 引用，属纯死配置。

## [2.5.12] - 2026-08-30

### Fixed

- **DIRECT 精确请求 provenance 与 raw 编码共享同一词法真值（P1）**：v2.5.11
  的 typed 提交已用完整 lexeme 精确编码 raw，但请求 provenance 与量化诊断
  仍退回 binary64——同一次事务使用两套真值。正式站反例：`m=1,b=0,R=-17`
  输入 `100000000000000001` 精确编码 `0001`，面板却报 `+0.000000
(0.0000%)` 且 status=exact；`m=1,b=1,R=17` 输入
  `-1.0000000000000000001`（精确误差 `-1e-19`）同样被读作零；精确越界
  `32767.0000000000000001` 被误判 exact 而非 saturated。现在
  `valueRequest` 是模式判别联合，DIRECT 保存 reducer 实际用于 exact 编码
  的同一 lexeme；量化分类（saturated/exact/quantized）与 requested /
  represented / absolute / relative 全部由精确有理数决定（范围端点取
  signed16 Y 极值的精确解码，按 m 符号排序），Number 字段只作近似展示，
  绝不反向决定分类；`m=0`、无 provenance、lexeme 不可解析 fail closed。
  这是同一事务内真值统一的产品缺陷修复，不是 PMBus §7.4 公式变更；
  仓库的 `Math.round` half-up + signed16 clamp 策略不变。
- **DIRECT 全部用户表面忠实呈现 exact 请求（P2）**：量化面板、计算步骤与
  复制说明由精确有理数渲染——非零误差绝不格式化为文本零：整数差值显示
  `+1`，极小/极大值用带符号科学计数法（`-1e-19`、`+1e-16`），循环有理数
  回退精确分数（`-1/6`）并辅以「约」十进制近似；面板注记在显示值无法完整
  呈现请求时保留「用户请求 <lexeme>；raw 精确表示 <exact>」。物理值复制
  合同不变：继续提供经验证可安全回录当前 raw 的文本。
- **精确十进制路径复杂度边界（输入资源策略，非 PMBus 限制）**：
  `DIRECT_EXACT_MAX_LEXEME_LENGTH = 4096`（依据：安全回录生成器 531,932
  条文本实测最大 136 字符、理论上限约 607，保留 ≥6.7×/≥30× 余量）。
  长度/语法/指数移位以纯字符串检查在任何 BigInt 构造之前完成，兆字节
  粘贴微秒级被拒绝；UI 显示「输入过长，未提交」并保留旧 raw 与旧请求，
  不静默截断、不改写为 ±Infinity/±0（刻意不用 `maxLength`——浏览器对
  超长粘贴的静默截断会把截断值当新请求提交）；true zero 文本在任意指数
  下仍合法零。
- **默认 5s 单测门禁稳定性**：download 网络拒绝契约测试此前真实睡眠
  2×2000ms（实测 4.0-4.4s，距 5s 门禁不足 1s，负载下越限）。现在注入
  记录型 `sleepImpl` 并断言退避序列 `[2000, 2000]`（合同更强、墙钟成本
  归零）；`direct-exact` 记忆化 `pow10` 并拆分两个 65536-Y 全量 sweep 为
  独立测试（语料与断言不减）。修复后默认 coverage 连续 3 次 rc 0 且无
  单测超 5s。
- **draft Release 资产本地字节验证成为仓库正式流程**：新增
  `scripts/verify-downloaded-assets.mjs` 统一字节门禁，由 operator 的
  draft pre-publish 流程（`--mode draft`，元数据可接受 `untagged-<hex>`
  占位 URL）与 Pages 工作流下载公开资产之后（`--mode published`，严格
  canonical tag URL 不放宽）共同消费。进程内复用
  `release-assets-verify.mjs` 的元数据合同，叠加本地文件存在性/普通文件
  检查、本地字节数等于元数据、`SHA256SUMS.txt` 严格格式合同、ZIP 的
  SHA-256（node:crypto）与共享 python ZIP 安全校验；失败按类分级
  （元数据 2-8、缺失 10、大小 11、sums 12、checksum 13、ZIP 安全 14），
  全部发生在解压/部署/publish 之前。

## [2.5.11] - 2026-08-28

### Fixed

- **DIRECT 合法系数组合下的精度折叠导致回录不保真（P1）**：PMBus Part II
  §7.4 的精确解码值可能超出 binary64 精度——m=1、b=1、R=17、raw FFFF 的
  精确值是 -1.00000000000000001，binary64 只能显示 -1，与 raw 0000（精确
  -1）在显示上不可区分；真实回输显示值会把 payload 静默改为 Y=0 且界面
  呈现精确零误差（该系数组合下 65536 个 Y 中 61108 个存在此折叠）。这是
  exact rational → binary64/显示 → 回录的可逆性缺陷，不是 PMBus 公式错误，
  也不是 `encodeDirect(Number)` 的错码（既有审计边界保持）。修复：
  `src/app/direct-exact.ts` 建立无依赖的 BigInt 精确参照——typed 提交路径
  以完整十进制 lexeme 经 exact rational 复现仓库 `Math.round` + signed16
  clamp 合同（DOMAIN_MODEL §2.3），折叠状态在结果区/警告/计算步骤标记
  近似值与精确值/分数，「物理值」复制改为返回经验证可安全回录的精确文本
  （独立 exact encoder 回验；循环小数用有界经验证近似并在步骤声明），
  raw/Y 编辑仍是位级真值的权威路径；untouched blur 严格 no-op 与普通
  安全向量零噪音合同不变。
- **Release 下载器网络错误重试缺少退避（P2 发布可靠性）**：
  `download-release-assets.mjs` 对 HTTP 408/429/5xx 有退避，但 fetch
  reject 的网络错误路径立即重试，与文档承诺的「有界短退避」不一致，会
  在瞬时 DNS/TLS/socket 错误下形成重试突发。现在网络 reject 与瞬时
  HTTP 状态走同一退避（`min(2s, 剩余预算)`，计入同一 5 分钟共享预算），
  共享 deadline 的 AbortSignal 触发的 abort 判定为预算耗尽并立即以
  code 10 的「deadline exhausted」诊断终止、不再重试；stderr 日志区分
  瞬时 HTTP / 网络 reject / deadline abort / 永久 HTTP / 尺寸不符。
  该修复不是已发生线上事故的响应，是使代码与可测试合同、文档一致。
- **测试证据纪律**：把 `bit-field-grid` 两个 6 视口 × 5 模式的超长用例
  按视口拆分（断言集合不变，单用例临界路径从逼近 30s 降到 <2s），降低
  冷启动负载下的超时敏感性；不全局提高 timeout，不弱化任何断言。

## [2.5.10] - 2026-08-29

### Fixed

- **LINEAR11 自动编码偏离严格最近值（P1）**：`findBestLinear11` 用固定绝对
  容差 `1e-15` 把严格不同的误差归并为并列，再偏向较小 `|N|`，导致恰在
  2^-17 中点之上的值（如 `0.0000076293945313`）被编码成 `0x0000`，而严格
  更近的是 `0x8001`（误差小约 1.0000071e-16）；负向对称输入同样错误地落在
  `0x0000` 而非 `0x87FF`。现在每个严格更小的 `|X − Y×2^N|` 都会胜出；
  bit 级完全相等的误差并列采用显式确定性 tie policy（偏好更小 `|N|`，同
  `|N|` 取 N 升序先见者）——这是计算器侧策略，PMBus Part II §7.3 只规定
  表示关系 `X = Y × 2^N`，不规定 host-side 选码规则。锁定 N 的手动编码
  路径、全局饱和边界与既有常规值不变（DOMAIN_MODEL §2.1）。
- **非零十进制输入下溢不得静默提交为 ±0（P2 输入真实性）**：
  `Number('1e-400')` 是 `+0`，旧解析层把这类文本当作合法零提交——raw 变成
  `0x0000`/`0x8000`、provenance 改写、量化误差伪造成零，用户请求的非零
  量级信息丢失。现在 `classifyFloatText` 增加可判别的 `underflow` 分类
  （语法完整 + 十进制尾数含非零数字 + Number 结果为 ±0）：
  ValueInput / NominalVoutInput 显示明确的输入范围错误并保留原始草稿，
  不提交、不清旧 raw / 请求 / 标称；reducer 直接 dispatch 同样 no-op。
  真零文本（`0e-400`、`-0e400`、`-0.0e-999`、`-.0e-999`）与最小 subnormal
  （`5e-324`、`3e-324`）的 signed-zero / 有限值合同不变；HALF `2^-25` 等
  「请求本身可表示、编码量化为零」的量化合同不变；relative L16 的派生
  下溢诊断（v2.5.9 已有）是另一错误来源，不受影响。
- **发布下载器缺少真实总时限（P2 运维）**：下载器每次 fetch 都新建
  5 分钟 `AbortSignal.timeout`，两项资产 × 3 次重试的最坏累计约 30 分钟，
  而 Pages job 自身 `timeout-minutes: 20` 可能先被平台终止，脚本定义的
  退出码 10 与诊断来不及返回。现在整个下载操作共享一个 5 分钟累计预算
  （重试与 backoff 消耗同一预算，不因重试重置），每次 fetch 的
  AbortSignal 取剩余预算，预算耗尽立即以退出码 10 与可识别诊断终止；
  重试仅限瞬时故障（网络错误与 HTTP 408/429/5xx），其他 4xx 与
  元数据/URL/size 合同错误立即失败；两项资产全部通过 size 校验后才写盘。
  发布元数据仍只作为数据（v2.5.9 数据边界不变）。
- **draft 回验的 URL 占位段合同收紧（发布链路工具修复，PR #70）**：对真实
  GitHub REST 元数据回验 v2.5.9 draft Release 时发现，draft 状态的
  `browser_download_url` 在 publish 前使用占位 tag 段
  （`releases/download/untagged-<hex>/<资产名>`）。`--mode draft` 的
  canonical URL 检查接受该占位形式（repo/资产名仍严格匹配），published
  模式（Pages 部署门禁）保持严格 tag 路径；v2.5.10 另把占位段正则从
  `untagged-\w+` 收紧为实际观察到的十六进制形式 `untagged-[0-9a-f]+`，
  实现、注释与夹具一致（保持 fail-closed；非已证实的外部攻击）。
  该修复在 v2.5.9 publish 前已合入 main（PR #70），但不在不可变的
  v2.5.9 tag 产品树中；本版本正式纳入发布源码。

## [2.5.9] - 2026-08-28

### Fixed

- **无效草稿在失焦时被"修复"成有效提交（P1）**：blur 归一化
  `fixFloatTextOnBlur` 先于分类执行，把 `NaN.` 剥成 `NaN`、`NaNe` 剥成
  `NaN`、`Infinitye` 剥成 `Infinity`、`2..` 剥成 `2.`——invalid 变成
  `value` 并提交（HALF 下 raw `3C00 → 7E00/7C00/4000`），错误被清掉；
  `1ee` 被降级成过渡态 `1e` 后静默恢复旧显示；relative 标称一次粘贴
  `12..` 失焦后 nominal 从 5 变成 12。同时旧过渡态正则接受无有效尾数的
  `e`、`e+`、`.e`、`-e+`，裸 `e` 在 blur 被归一成 0。现在：
  - 过渡态严格限定为「空串、单独正负号、裸点简写、含数字的十进制尾数 +
    未完成指数」；`e`/`.e`/`-e+`/`1ee`/`1e++`/`NaNe` 一律 invalid；
  - 新增共享失焦决策 `resolveFloatTextOnBlur`（`src/app/float-parse.ts`）：
    先分类原始草稿，再只对合法过渡态归一化，归一化必须得到完整值否则
    fail-closed；`fixFloatTextOnBlur` 成为分类约束下的纯函数，不再给
    无效文本提供有损修复；
  - `ValueInput` / `NominalVoutInput` 的 blur/Enter 改为分类在先：
    invalid / out-of-range 保留草稿与错误、不提交、不创建新 provenance、
    不清掉原有 provenance；空串语义仍由字段决定（物理值提交 0，标称清除
    为 null）；合法过渡态归一化合同不变（`.`/`+.`→0、`-.`→-0、
    `1e`/`1e+`/`1e-`→1、`12.5e-`→12.5、`-0e+`→-0、`1.` 本就是完整值）；
    untouched focus/blur/Enter 严格 no-op 与真实编辑事务语义不变；
    合法 onChange 即时提交保留（逐键输入时合法前缀仍即时提交）。
- **relative 电压派生结果缺少范围状态（P2）**：结果卡、公式、计算步骤、
  复制四处直接相乘 `V_NOM × R`，无溢出/下溢诊断——nominal=`1e308`、
  ratio=2 时显示 `Infinity`，`5e-324 × 2^-16` 下溢显示普通 0。现在新增
  共享分类器 `resolveRelativeVoltage`（`src/app/relative-voltage.ts`），
  区分缺参考值 / 有限结果 / 乘法溢出 / 非零因子下溢为零；溢出与下溢在
  结果卡与计算步骤显示 `—` 并给出明确说明（"计算结果超出 JavaScript
  Number 可表示范围" / "计算下溢：两个非零有限数相乘的结果被 Number
  舍入为 0"），公式保留 nominal 与比值、不输出虚假的正常电压，C 宏注释
  同样不输出虚假电压；「物理值」复制在范围错误时禁用并给出可访问原因，
  原始 Hex/LE/BE 复制不受影响。真正的 nominal=0 或 ratio=0 仍得到 0，
  不会被误判为下溢；大而有限（`1e308`、ratio=1）与非零 subnormal 参考值
  不被拒绝；输入层 `1e-400 → 0` 的既有解析合同不变；SLINEAR16 offset 与
  non-LINEAR fail-closed 分支不受影响。
- **发布元数据被当作 shell 程序执行（P2 防御性加固）**：
  `release-assets-verify.mjs` 对 URL 只检查 `startsWith('https://')` 并
  输出未转义的 `key=value`，真实 Pages workflow 用 `source` 消费——无害
  离线夹具证明 URL 中的 `$(…)` 命令替换会在 `source` 时实际执行。实际
  `browser_download_url` 由 GitHub 生成，目前没有证据表明普通外部攻击者
  能控制该字段，因此按数据/代码边界缺陷做防御性加固：
  - verifier stdout 改为单一 JSON 数据对象，诊断走 stderr，不再输出可
    source 的 shell 程序；新增 `--repo owner/repo` 参数；
  - URL 用解析器按 canonical 合同校验（`https://github.com/<owner>/<repo>/
releases/download/<tag>/<资产名>`，拒绝非 HTTPS、错误 host/repo/tag/
    文件名、userinfo、query/fragment、控制字符、路径逃逸与非规范编码）；
    `--zip-name`/`--sums-name` 必须是安全 basename；
  - 新增 `scripts/download-release-assets.mjs`：静态 JSON 消费 + URL 二次
    校验 + 字节数核对（错误码 9）+ 有界瞬时重试；Pages workflow 弃用
    `source`，外部数据永远不经过 `source`/`eval`/拼接 shell 再次解释；
  - 保留既有退出码合同（0/2–8），readiness 门禁之后仍执行下载字节数、
    SHA-256 与 ZIP 合同检查，发布顺序仍依赖 draft→上传→回验→publish。

### Test

- 分类/归一化联合矩阵（非法样例、正负零、科学计数法、过渡态、溢出）、
  reducer 对原始无效 action 的拒绝、HALF `NaN.`/`NaNe`/`Infinitye`/`2..`
  的失焦与 Enter（真实键盘 + 真实剪贴板，参照时点断言合法前缀的即时
  提交）、relative nominal `12..` 的粘贴与逐键对照、合法过渡态矩阵、
  relative 派生全向量（overflow/underflow/finite/true-zero/null 与
  `Number.MAX_VALUE` 邻接）、verifier URL 合同 15 例 + sentinel、下载
  消费者离线矩阵。
- Playwright 配置统一 `trace: 'retain-on-failure'`（本地 retries=0 的
  首跑失败也保留产物）并新增 JSON reporter，便于按实际报告统计
  passed/failed/skipped/flaky；nominal 清空测试改为真实键盘删除。

## [2.5.8] - 2026-08-28

### Fixed

- **解析器静默限幅，大值请求被改写（P1）**：`parseFloatSafe` 把绝对值超过
  `1e20` 的有限值截断到 `±1e20`，`1e400` 也被改写成 `1e20`。DIRECT m=1、b=0、
  R=-21 下输入 `1e21` 得到错误 raw `0000`（正确 `0001`），`-1e21` 得到
  `0000`（正确 `FFFF`），且量化误差基线被改写为假请求。现在共享解析分类
  `classifyFloatText`（`src/app/float-parse.ts`）是 ValueInput、
  NominalVoutInput 与 reducer 的单一来源：
  - 语法完整且可由 JavaScript Number 表示的有限值不再被解析层限幅，
    `1e21 → 0x0001`、`-1e21 → 0xFFFF`（m=1,b=0,R=-21）；m=-1 时 `1e21 → 0xFFFF`；
    R=-128/R=127 的可表示向量（`1e128`、`1e-127`）可精确往返；
  - L11/L16/DIRECT 饱和读数保留用户真实提交的请求值作为误差基线
    （例如 `1e30` 不再以 `1e20` 冒充请求）；
  - 完整但转换为非有限值的十进制文本（如 `±1e400`）在包括 HALF 在内的所有
    模式显示明确的数值范围错误：不提交、不改写旧 raw、不生成新请求，也
    不会被误判为「尚未输完」的过渡态；
  - HALF 显式字面量 `NaN` / `±Infinity`（Part II §7.6 一等特殊值）与十进制
    溢出文本是两类不同的输入，前者仍编码 `0x7E00` / `0x7C00` / `0xFC00`。
- **relative L16 标称参考值无法回到缺失状态（P1）**：`nominalVout` 输入
  全选删除后 blur/Enter 会静默恢复旧值，null 状态在 UI/reducer 没有清除
  路径。现在真实删除全部内容后 blur/Enter 派发新增的
  `l16/clear-nominal-vout`：提交 null（幂等），最终电压显示 `—` 与缺失
  说明，公式、计算步骤与复制不再输出由旧标称推出的电压；重新输入合法值
  恢复计算。`null`（未提供参考值）与显式输入 `0`（decode-only 合同的合法
  显示值）是两个状态；清除只影响标称通道，不改 raw、VOUT_MODE、payload
  kind 与字节序。非空非法文本不得悄悄变为 0 或清除；非空过渡态
  （`1e`、`-` 等）blur 经共享 `fixFloatTextOnBlur` 归一化后按其值提交，
  不以静默恢复旧值掩盖未完成输入。其他数值输入的空串归零合同不变。
- **发布资产就绪竞态（P1，v2.5.7 证据）**：v2.5.7 按「先公开 Release、后
  上传资产」执行，release-published 事件触发的 Pages 在 ZIP 尚未存在时读取
  失败（日志只有步骤 exit 4；`jq -er` 在资产未找到时同样返回 4，未证实是
  runner 瞬时故障）。修复：
  - 发布流程固定为 **draft → 上传全部资产 → 回验 → publish**；
  - 新增 `scripts/release-assets-verify.mjs` 单一就绪门禁（`--mode draft`
    供 publish 前回验、`--mode published` 供 Pages 入口校验），缺失、重复、
    上传中、零字节、URL 无效、draft/prerelease/tag 不匹配分别报出明确错误
    与退出码（2–8）；
  - Pages workflow 只下载校验脚本解析出的 URL，下载后先核对字节数与元数据
    一致（不一致 exit 9），再执行 `sha256sum -c` 与 ZIP 合同校验，全部
    fail-closed 于部署动作之前；网络调用带 connect/总 timeout 与仅针对瞬时
    故障的有限重试；不以长 sleep 等资产齐备，不恢复锁/journal/状态机。

### Test

- 事务测试改用真实键盘事务（选中全部 → 删除 → 逐键重输 → Tab）证明同值
  重输的提交来源；需要粘贴时使用真实异步剪贴板 API，环境不支持则如实标注
  未覆盖；`fill()` 不再被当作同值提交或剪贴板粘贴的证据。断言最终 raw、
  参数、错误、结果与 provenance，而不只断言输入框外观。覆盖 L11、L16 两种
  payload、relative 标称、DIRECT m/b/R、HALF（NaN canonical 化）与
  VOUT_MODE expert Hex 幂等；新增 360px 下范围错误文案换行/溢出与极值
  （`1e-127`/`1e128`）恢复检查。原「清空后恢复 5」的 nominal 测试改写为
  新清除合同（其旧断言未先建立 ratio=1，已在同批修正）。

## [2.5.7] - 2026-08-28

### Fixed

- **HALF 负零简写丢失符号（P1）**：`float-parse.ts` 的 `/^[+-]?\.0*$/` 分支直接
  `return 0`，使 `-.0`、`-.00` 被解析为 `+0`（raw `0x0000`），并把裸 `.`、`+.`、`-.`
  过早视为完整数值。IEEE 754 binary16 中 `+0` 与 `-0` 是不同原码（`0x0000` 与
  `0x8000`，Part II §7.6），`Number('-.0')` 本就是 `-0`，解析器不得用字面量 `0`
  覆盖其符号；§7.6.2 要求设备读回主机先前写入的精确 IEEE 编码。现在：
  - `-0`、`-0.0`、`-.0`、`-.00`、`-0e3` 都解析为真正的 JavaScript `-0`
    （`Object.is` 断言），HALF 编码为 `0x8000`、显示 `-0`；
  - `0`、`+0`、`0.0`、`.0`、`+.0`、`0e3` 编码为 `0x0000`；
  - 裸 `.`、`+.`、`-.` 是编辑过渡态，不立即提交 raw、不创建 provenance；blur
    明确规范化：`.`/`+.` → `0`（`0x0000`），`-.` → `-0`（`0x8000`）；
  - `encodeHalf` round-to-nearest-even 算法未改动。
- **untouched-blur 事务语义推广到全部共享输入（P1）**：v2.5.6 只为物理值输入
  增加了真实编辑事务检测；`HexInput`、`IntegerInput`（L11 Y/N、DIRECT Y/m/b/R、
  SLINEAR16 Y_s、VOUT_MODE N）、`DecimalInput`（L16 V）与 `NominalVoutInput`
  在 untouched blur 时仍无条件 `onCommit`——L16 输入物理值 `1`（raw `0100`、
  provenance 存在）后只 focus/blur 原始 Hex，raw 不变但量化来源被清除。现在
  全部共享输入在当前 focus 会话内没有任何真实 `onChange` 时，blur/Enter 严格
  no-op：不派发 commit、不改写 raw/参数、不清除 provenance、不清除仍存在的
  字段错误；dirty 依据真实编辑事务（共享 helper `src/app/input-transaction.ts`），
  不以解析数值相等判断。显式清空后 blur、显式重输相同值、粘贴、非法文本修复
  仍按既有合同提交。
- **点击已选语义控件清除 provenance（P2）**：L16 输入物理值 `1` 后点击当前
  已选中的「绝对值」radio，raw 不变但 provenance 消失——`vout-mode/set-relative`
  无条件走 `setVoutModeByte` 清除请求来源。现在同字节写入幂等（reducer 返回
  同一 state 引用），composer 的绝对值/相对值与格式 radio 仅在目标状态与当前
  状态不同时才派发；重复选择现有 VOUT_MODE 语义、相同格式与相同参数保持幂等，
  真正改变字节时仍清除失效 provenance。
- **`0x18` 被表述为「标准默认值」误导（P2）**：`DEFAULT_LINEAR_VOUT_MODE` 的
  注释仍声称它是 non-LINEAR 时的 fallback，UI 又称「应用默认 VOUT_MODE」——
  与 v2.5.2 起 fail-closed 行为直接矛盾，也违背 Part II §8.3（只定义位布局与
  合法组合，不存在 PMBus 标准默认字节；器件可固定 Mode/Parameter 并拒绝写入）。
  现在：
  - 常量更名为 `CALCULATOR_LINEAR_EXAMPLE_VOUT_MODE`，action 更名为
    `l16/apply-calculator-linear-example`，删除全部 stale fallback 说明；
  - UI、warning、steps、说明统一表述「应用计算器 LINEAR 示例 0x18
    （absolute、N=-8）」，并明示它不是 PMBus 规范默认值、不代表真实器件一定
    接受 VOUT_MODE 写入；
  - 反词测试（unit + E2E）禁止任何用户可见表面把 0x18 称为规范/器件默认或
    声称 non-LINEAR 自动回退；初始化字节与显式恢复后的实际数值行为不变。

### 文档

- DOMAIN_MODEL §2.2/§3 登记 0x18 计算器示例值合同与同字节写入幂等；§6.1 的
  untouched-blur no-op 合同推广到全部共享输入；UI_CONVENTIONS §8 登记共享输入
  no-op 与 signed-zero 解析/blur 规范化、§15 更新恢复入口文案合同。

## [2.5.6] - 2026-08-28

### Fixed

- **物理值输入无操作 focus/blur 重编码 raw 并伪造量化请求来源（P1）**：共享
  `ValueInput` 的 blur 无条件派发 `value/set`，用户只获得焦点再离开（未编辑任何
  字符）就会静默重编码 raw word 并伪造一次显式编码请求：
  - HALF raw `0x7C01`（非规范 NaN payload）被改写为 canonical `0x7E00`——违反
    §7.6.2「设备必须精确返回主机写入的 IEEE 编码」与本工具的 raw-lossless 承诺，
    signaling/quiet NaN 等 2,046 个非规范 NaN 原码都可能被显示层往返合并；
  - LINEAR11 raw `0801`（N=1,Y=1,X=2）被规范化为 `0002`（N=0,Y=2），数值不变但
    raw word 改变，并出现伪造的 `0%` 量化误差；
  - 所有模式即使 raw 恰好不变也会伪造 `valueRequest`/`l11.valueInput`，使本应
    隐藏的量化误差变成 `0%/特殊值` 读数（DOMAIN_MODEL §6.1 请求来源合同）。
    现在 blur 是事务化的：当前 focus 会话内没有任何 `onChange` 编辑事务时，blur
    （含 Enter 触发）是严格 no-op——不派发、不改 raw、不伪造 provenance、不清除
    已有错误；dirty 判定依据真实编辑事务，不用解析数值比较（`NaN !== NaN`、`-0`、
    文本表示差异都不可靠）。显式编辑合同不变：即时提交、blur 规范化（空/符号/尾随
    点/尾随 exponent）、HALF 显式重输 `NaN` 仍 canonical 化为 `0x7E00` 并出现
    special/warn provenance。回归矩阵在
    `tests/e2e/value-blur-lossless.spec.ts`（HALF/L11/L16/DIRECT 真实用户路径，
    同时锁定「无操作 blur 无副作用」与「显式编辑仍提交」两条相反路径）。
- **VID Table 3 明列保留 code 被写成「未列出」（P2）**：Part II §8.4.2 Table 3
  明列 `01h..04h`（保留给未来 Intel 处理器）、`10h..11h`（未来 AMD）、
  `1Ch..1Dh`（留作未来使用）与 `1Eh/1Fh`（制造商自定义），其余 code 才是
  「Table 3 未列出」。此前 `view-model.ts` 把所有 reserved code 一律写成
  「Part II §8.4.2 Table 3 未列出」（如 `0x21`/code `01h`），出处错误。现在：
  - `classifyVidCode` 机器区分 not-used / listed-reserved（含 Table 3 family 与
    reason）/ unlisted-reserved / profile-required（单一分类来源）；
  - `resolveVoutModeRequirement` 把 `vid-reserved` 拆分为
    `vid-reserved-listed` / `vid-reserved-unlisted`；状态文本、InfoPanel 警告、
    说明、计算步骤与结构化 VID code 下拉全部消费该判别式与分类来源，明列 code
    的文案表述「Table 3 明列」及对应 family，绝不含「未列出」；
  - 明列保留与未列出保留仍都不可作为通用电压 profile（`structureLegal=false`），
    仅用户可见出处文案被纠正。
- **移除矛盾的双重合法性事实源（P2）**：未使用的旧字段 `VoutModeAnalysis.isLegal`
  （`status === 'valid'`）与权威的 `requirement.structureLegal` 对 `0x3E/0x3F`
  给出矛盾结论（`isLegal=false` 而 `structureLegal=true`）。字段及其旧测试已删除，
  结构合法性只由 `resolveVoutModeRequirement().structureLegal` 输出。
- **VID code 下拉不再撑破 360px 视口**：更长的出处文案使无宽度约束的
  `<select>` 固有宽度超过容器，补 `w-full min-w-0` 与同级输入一致。

### 文档

- DOMAIN_MODEL §3 登记 Table 3 五类 VID code 出处（明列保留 vs 未列出保留）、
  §6.1 登记 untouched blur no-op 与事务化 dirty 判定、结构合法性单一事实源；
  UI_CONVENTIONS §8 新增未编辑 blur no-op 合同、§16 更新 VID 出处文案合同。

## [2.5.5] - 2026-08-28

### Fixed

- **HALF 页遗漏 PMBus §7.6.2 特殊值操作语义（P1）**：页面此前允许输入、编码并复制
  NaN / ±Infinity，却只称其为「支持的特殊值」，未告知设备的操作语义，可能让用户把
  特殊值当普通数值写入器件。新增 `src/app/half-special-semantics.ts` 单一语义来源
  （`half-finite` / `half-nan` / `half-positive-infinity` / `half-negative-infinity`，
  输出稳定 machine id、severity、send/read 双解释、spec ref），HALF 页在当前 raw word
  为特殊值时显示 §7.6.2 特殊值卡（raw 解码与 value 编码两条路径均可见；有限值不显示）：
  - NaN：作为写入数据，设备必须按 invalid data 处理、声明 communications fault 并按
    §10.8 响应；作为设备读回值，表示值不可用；
  - +Inf / -Inf：作为写入数据，设备分别解释为正 / 负满量程；作为设备读回值，分别表示
    测量通道正 / 负方向饱和；
  - 卡片同时列出两种解释（不猜测命令方向），并注明这是 PMBus 操作语义、不代表已发生
    总线通信、binary16 数学换算保持不变；
  - 量化误差分类不变：主动输入特殊值 = `special/warn`；有限 `65520` 溢出 =
    `overflow/error`；有限溢出编码出的 +Inf word 同时显示 overflow/error 读数与
    §7.6.2 卡（两个表面回答不同问题，不合并成一个状态）。
- **VOUT_MODE 结构合法性与可计算性分离（P1/P2）**：Part II §8.4.2 Table 3 明列
  `1Eh/1Fh` 为 PMBus 器件制造商自定义 VID Code Type——字节结构合法，电压映射必须来自
  器件资料。此前领域层 `isLegal=false` 被 view-model 映射成 `structureLegal=false`，
  正式页面给 `0x3E/0x3F` 配置摘要与状态 chip 加了代表非法结构的 alert 标志/class。
  现在 requirement 判别式新增 `structureLegal` 字段（valid 与 profile-required 为
  true；not-used/reserved/invalid 仍为 false），view-model 从中取值并新增正交的
  `requiresExternalData` 字段；`0x3E/0x3F` 呈现为「制造商自定义（需器件资料）」，
  不再复用非法 alert 标志；`00h`（未使用）、保留 code、relative+VID、DIRECT/Half
  非零参数保持不可用分类；Normalize 对 `0x3E/0x3F` 保持 raw 不变；L16 页继续
  fail closed，阻断原因保持「合法但缺 profile」。
- **requirement「单一来源」真正收口（P2）**：v2.5.4 中
  `resolveVoutModeRequirement` 实际只驱动 status 文本；InfoPanel 警告、说明与计算
  步骤仍各自从 `format`/`status` 推导，已出现可观察分叉。现在四个表面全部 switch 在
  同一判别式的 `req.id` 上（字段解析仍读取 format/parameter）：
  - `0xC0` 的 InfoPanel 警告本身现在同时写明 m/b/R 系数与 VOUT_COMMAND 标称参考值
    （§7.4 + §8.5.2），不再靠其他表面拼出；
  - `0x3E/0x3F` 计算步骤不再落入 `vout-mode-invalid` 分支，改用专门的
    `vout-mode-vid-profile` 步骤（not-used/reserved/invalid-combination/param-invalid
    亦有独立步骤 id）；
  - E2E helper 不再把所有表面拼接成单一字符串只检查一次——改为逐表面独立断言
    （反向禁词与必含片段均按表面检查），unit 矩阵对 `0xC0`/`0xE0` 逐表面断言。

### 文档

- DOMAIN_MODEL §2.4 登记 §7.6.2 特殊值双向语义与展示合同；§3 登记
  structureLegal / calculable / requiresExternalData 三维正交与四表面收口；
  UI_CONVENTIONS §16 更新逐表面 E2E 合同与合法性正交状态、新增 §17 特殊值卡合同。

## [2.5.4] - 2026-08-27

### Fixed

- **IEEE Half 被错误当成需要器件 Profile 的格式（P1）**：独立 VOUT_MODE 页面曾把
  `0x60`（绝对 Half）标为「IEEE Half（需器件资料）」并显示「需要器件 Profile
  （DIRECT 系数/设备数据）」警告——与同页 L16 阻断卡「Half 是合法标准格式」直接
  矛盾。按 Part II §7.6/§8.4.4，Half 的 word ↔ 数值换算是标准 IEEE 754 binary16，
  不依赖任何 m/b/R 系数、VID 表或器件 profile。新增
  `src/app/vout-mode-requirements.ts` discriminated requirement 单一来源，状态文本、
  InfoPanel 警告、说明与计算步骤共同消费：
  - `0x60`：状态「IEEE Half（标准 binary16）」，warning/explanation/steps 表述标准
    binary16 并指向 HALF 模式页；全部表面反向禁词（`需器件资料`/`器件 Profile`/
    `m/b/R`/`DIRECT 系数`），不出现标称参考值要求；
  - `0xE0`：payload 仍是标准 binary16；仅按 §8.5.2 增加相对阈值需要 VOUT_COMMAND
    标称参考值的表述，不要求任何器件数值；
  - `0x40`/`0xC0`：DIRECT 继续明确要求器件 m/b/R（§7.4），relative 叠加标称参考值；
  - `0x61`/`0xE1`：保持 invalid-parameter error 级与 00000b 约束；
  - L16 页 `half-unsupported-in-l16` 阻断卡文案不变，仅以回归测试固定；L16 页继续
    对 Half fail closed，不借用 0x18、不改造成 Half 解码器。
- **文档收口**：DOMAIN_MODEL 登记 Part II §7.2/§8.1.2 设备级互斥（器件使用 Half 则
  所有 numerical data 只能 Half；使用任一 LINEAR/DIRECT 则不得使用 Half；数据手册
  决定采用格式但不改变 binary16 解码公式）与 §3 requirement 单一来源合同；
  UI_CONVENTIONS §15 拆开合并的 DIRECT/Half 文案合同并新增 §16；两份 README 以 §7.2
  全设备互斥规则取代「器件可自由混用格式组合」表述；ROADMAP 删除与已发布 v2.5.3
  矛盾的「发布进行中」过期状态。

## [2.5.3] - 2026-08-27

### Fixed

- **VID 数据格式被错误描述为「输出电压相关命令禁止使用 VID」（P1）**：v2.5.2 的
  fail-closed 数值行为有效，但阻断文案把 §8.4.2 支持的 VID 格式扩大成了全局禁令，
  制造商自定义 code（raw `0x3E`/`0x3F`）也被一并归为禁止。现在 L16 × VOUT_MODE 组合
  由 discriminated contract（`src/app/l16-payload-contract.ts`）统一判定并驱动文案、
  输入可用性、warning 级别与测试：
  - 绝对 VID + 数值 payload → `vid-profile-required`：VID 合法但本页未选定 VID 表 /
    产品 profile，不能换算 code ↔ 电压，也不借用 LINEAR16 指数 N；不再出现
    「输出电压相关命令禁止使用 VID」；
  - 绝对 VID + SLINEAR16 offset → `vid-offset-prohibited`：仅 VOUT_TRIM /
    VOUT_CAL_OFFSET 被规范禁止（Part II §13.3/§13.4，error 级提示），并明确禁止范围
    仅限这两条命令；
  - 相对 + VID（如 `0xA0`）→ `vid-relative-invalid`：字节组合无效（Part II §8.5.3）；
  - DIRECT / IEEE Half → 合法输出电压数据格式但本页不实现解释（`direct-profile-required`
    / `half-unsupported-in-l16`），不猜测系数或 N；
  - 非法参数 → `reserved-or-invalid`。
- **非 LINEAR raw word 仍被标成 LINEAR16 V/Y（P1/P2）**：`getBitRegions` 现在接收实际
  共享 VOUT_MODE 字节——任何非 LINEAR 状态（含 `0x20`/`0x3E`/`0x40`/`0x60`、相对
  VID 与非法参数）的 16 位位域图例改为中性 `raw word [15:0]（未按 LINEAR16 解释）`，
  payload 下拉切换不会复活 V/Y 图例；LINEAR 字节（含 bit7=1 的 `0x98`）恢复
  payload-specific 图例。
- **文档与矩阵**：DOMAIN_MODEL §3 / UI_CONVENTIONS §15 登记新契约并禁止回归旧的全局
  禁令文案；ROADMAP M38 的历史「回退 0x18」摘要标注已被 v2.5.2 supersede。

## [2.5.2] - 2026-08-27

### Fixed

- **非 LINEAR 共享 VOUT_MODE 被隐式替换为 0x18 后继续 LINEAR16 编码（P1）**：v2.5.1 中
  共享字节为 VID / DIRECT / IEEE Half 时，LINEAR16 页面静默回退到
  `DEFAULT_LINEAR_VOUT_MODE = 0x18` 并继续编码——`0x20 + SLINEAR16` 下输入 `1` 生成
  `raw=0x0100`、显示 `1` 与 `0%` 量化误差，仅以 fallback 标注（Part II §8.4：输出电压
  相关命令的数据格式由当前 VOUT_MODE 决定，不能静默改用另一个字节）。现在
  fail closed：`effectiveL16VoutMode` 返回实际共享字节（`source: 'non-linear'`），
  `value/set` 对非 LINEAR 共享字节 no-op（不生成 raw、不伪造 provenance），结果为
  `—`、无伪「可表示范围」、无量化面板、计算步骤无伪 N/伪 V；VID 阻断卡引用
  §8.4 + §13.3/§13.4（禁止组合、不生成 word），DIRECT / IEEE Half 声明需要相应
  format/profile/coefficients、不猜测 N；invalid-parameter / invalid-combination
  保持 error 级。恢复编码的唯一路径是显式「应用默认 VOUT_MODE」
  （`l16/apply-default-vout-mode`）——真实写入 `0x18` 并清除旧 provenance 后，
  输入、范围、结果与量化读数恢复。
- **默认 E2E 套件混入 deployment 用例**：默认 `playwright.config.ts` 现在排除
  `deployment.spec.ts`；Pages smoke 只由 `playwright.deployment.config.ts` 对正式
  URL 运行。口径：默认 326 tests / 15 files（无 URL-gated skip），deployment
  4 tests / 1 file。
- **测试基建**：嵌套 git fixture 仓库不再继承 `git commit` 钩子导出的 `GIT_*`
  环境变量（pre-commit 下运行会寻址外层仓库 index）。

## [2.5.1] - 2026-08-27

### Fixed

- **SLINEAR16 offset 在 bit7=1 时物理输入不可达（P1-A）**：0x98 + SLINEAR16 下页面按
  signed offset 解码结果，却隐藏物理值输入并保留 relative LINEAR 的 nominal 阻断卡；
  reducer `encodeL16FromValue` 在 payload 判定前因 bit7 relative 拒绝，量化层也没有
  signed 可编码范围（200 无法分类为饱和）。现在编码/范围/UI 入口全部按 payload 上下文
  判定（Part II §13.3/§13.4）：任意 LINEAR 字节下 `value/set 3.3 → 0x034D`、
  `200 → 0x7FFF` saturated/error、范围 `-128..127.99609375`；nominal 门槛与阻断卡
  只作用于 relative ULINEAR16（比值）。
- **手动 Y_s 编辑后旧请求未失效（P1-B）**：`l16/set-slinear-y` 直接改写 raw 而不清除
  `valueRequest`，误差面板与计算步骤继续报告过期的请求-表示对。现在提交性 Y_s 编辑
  与其他 raw 变更一致清除 provenance；非法/过渡输入不改变 raw 也不清除仍有效请求。
- **DOMAIN_MODEL §2.2 与 §6.1 矛盾纠偏**：relative LINEAR 拒绝规则限定为
  ULINEAR16 比值语义；SLINEAR16 offset 的编码顺序、可编码范围与 bit7 不参与数学
  成为明确契约；provenance 失效清单加入手动 Y_s；UI_CONVENTIONS §15 记录
  payload 上下文入口与手动失效验收。

## [2.5.0] - 2026-08-27

### Added

- **格式编码量化误差读数扩展到全部数值模式（MINOR，向后兼容）**：LINEAR16 / DIRECT /
  IEEE 754 binary16 现在与 LINEAR11 共享同一 `ErrorDelta` 面板与计算过程步骤，领域模型
  重构为可判别联合（`exact / quantized / saturated / overflow / special`，
  `src/app/quantization-error.ts`），严重度由结果分类决定。

### Fixed

- **不再伪造零误差**：无显式编码请求（初始状态、手工 Hex/bit/raw 编辑、清除请求来源）时
  误差读数整体隐藏——「未输入请求」与「误差为零」是不同领域状态；请求来源
  （`l11.valueInput` + 模式标签的 `state.valueRequest`）在任何改变 raw 位或编码解释的
  动作（系数、payload kind、VOUT_MODE 字节、模式切换）后失效清除。
- **零请求值的相对误差显示「—」**：零分母（requested = 0 / −0）不再显示 0%；
  绝对误差照常保留（如 DIRECT m=1,b=1,R=−1 请求 0：+1.000000 (—)）。
- **HALF 有限值溢出不再隐藏**：65520 → +Infinity 以 overflow/error 状态呈现；
  NaN / ±Infinity 显式请求以 special 状态分类显示，不再静默消失。
- **非零小误差绝不渲染为文本零**：|x| ≥ 1e-6 用固定 6 位小数，更小非零值
  （如 binary16 次正规 ties-to-even 的 2^-25 → +0）用自适应有效数字显示。
- **移除跨格式 1e-5 绝对阈值**：PMBus 设备准确度由产品资料规定（Part II §7.8/§7.9），
  不存在通用阈值；UI 更名为「格式编码量化误差」，L11 饱和、L16 clamp、DIRECT Y 饱和
  统一为 saturated/error 分类。
- **L16 语义对齐**：SLINEAR16 offset 的量化不受 VOUT_MODE bit7 relative 影响
  （payload 语义优先，§13.3/§13.4）；fallback 0x18 时读数标注「按 fallback 0x18 计算」；
  relative ULINEAR16（比值语义）不显示物理量化误差。
- **重复选择当前模式不再清除请求来源**（same-mode dispatch 幂等）。
- DOMAIN_MODEL §2.2 fallback 矛盾消除（拒绝仅限 relative LINEAR），新增 §6 量化语义；
  UI_CONVENTIONS 新增 §15 面板契约。

### 证据

- 4 张桌面 L11 视觉基线按 REPOSITORY_HYGIENE 3.10 逐图审查更新（移除伪造零误差卡），
  其余 24 张场景（含全部移动端）不变。

## [2.4.2] - 2026-08-27

### Fixed

- **位字段网格过于紧凑**：v2.4.1 的溢出修复保留了 v2.4.0 放大的位格（按钮 36px、
  行间隙 4px），收缩轨道上位格行占满 nibble 卡片并贴合边框。恢复 v2.3.0 密度：
  按钮 28px（flex-basis 1.75rem）、行间隙 2px、cell 24px——nibble 卡片内恢复居中
  留白，收缩链仍保证不溢出。基线按 REPOSITORY_HYGIENE 3.10 审查更新（26 张，
  新旧成对对比三张关键基线无意图外变化）。

## [2.4.1] - 2026-08-27

### Fixed

- **位字段网格卡片内溢出（v2.4.0 回归）**：M39 统一位网格后 16 位 4 列 auto 轨道
  最小需求 714px 超出卡片内容宽 618px，`justify-content: center` 使溢出对称分布在
  卡片两侧（1024–1151px 双栏布局最严重，达 112px/侧）；8 位两列在 390/360px 移动端
  同样溢出。网格轨道改为可收缩 `minmax(0, 设计宽)` 并建立 nibble→bits→button→cell
  收缩链；16 位 4 列断点从 1024px 修正到 1152px 以对齐双栏工作区实际列宽。
  全模式 × 全视口（2048→360）位格几何断言与 23 张 visual 基线更新，新增
  “位格始终落在宿主卡片内容盒内”回归测试。计算语义、raw、字节序与复制合同不变。
- 文档与流程：视觉重构 PR 更新基线时必须附新旧基线 diff 审查记录
  （REPOSITORY_HYGIENE 第 3 节第 10 条），并同步 AGENTS.md PR checklist 与
  PR 模板 UI/visual evidence 字段。

## [2.4.0] - 2026-08-26

### Added

- M39：中文优先界面 + 可访问术语气泡 + 字体角色统一 + 共享位字段网格（MINOR，向后兼容）。
- **术语气泡**：canonical 英文 token（VOUT_MODE、LINEAR/VID/DIRECT/IEEE 754 binary16 等）
  通过虚下划线触发器提供单一中文解释数据源 `src/app/terminology.ts`；`TechnicalTerm` 组件
  基于 `@floating-ui/react-dom`（offset/flip/shift/size/autoUpdate + portal），支持点击/
  键盘/触屏、Escape 关闭并恢复焦点、点外关闭而气泡内不误关，viewport 边缘防裁切。
- **共享位字段网格**：新 `BitFieldGrid` + `getBitRegions` 单一来源替换原 `BitGrid` 与
  `VoutModeBitGrid` 两套实现；16 位恒为 4 nibble 组、8 位恒为 2 nibble 组；
  L16 内嵌 VOUT_MODE 为 compact 密度但保留两个四位分组与统一图例；
  bits[6:5] 在 L16 真正 disabled 且 ARIA 注明“格式位固定为 LINEAR”。
- 全模式位图例中文化（指数/尾数/符号位/数值/绝对相对/格式/参数）。

### Changed

- **中文优先语言合同**：双语 explanation model（zh/en 并排）重构为中文主文案 + canonical
  token 引用；按钮/状态/徽标/ARIA 不再中英双写（如“说明 / Details”“规范化 / Normalize”
  “应用默认 … / Apply default”、linked/fallback-default → 已关联/默认回退、
  Absolute/Relative → 绝对值/相对值）；VID code 分类标签改为 未使用/保留/制造商自定义。
- **字体角色统一**：VOUT_MODE 结果摘要改为结构化配置视图（byte 用 mono、token/状态用
  系统 UI 字体），不再经 KaTeX/serif 排版；真实数学等式仍由 KaTeX 渲染。
- 页面 `<title>` 补全第五个模式 VOUT_MODE；release/deployment smoke 同步断言。

## [2.3.0] - 2026-08-26

### Added

- M38：独立 VOUT_MODE 计算器（第五个模式）——8-bit 交互位网格（bit7 Absolute/Relative、
  bits[6:5] format、bits[4:0] parameter 双 4-bit nibble 卡），raw 位/Hex 编辑 lossless
  （可构造 `0xA0`/`0x41`/`0xE1`），语义控件 canonicalize（VID 强制 Absolute、DIRECT/Half
  参数强制 0），`Normalize` 显式规范化非法组合/参数。
- M38：标准 LINEAR16 payload 语义——`ULINEAR16`（`X = Y_u × 2^N`，`Y_u` 无符号 0..65535）
  与 `SLINEAR16 offset`（`X_offset = Y_s × 2^N`，`Y_s` 二补码 -32768..32767）；相对
  ULINEAR16 解出正比例 `R = Y_u × 2^N`，提供 nominal reference 时 `X = V_NOM × R`；
  SLINEAR16 相对 + 有符号比例被拒绝（bit7 不参与 offset payload）。
- L16 共享 `VOUT_MODE` 字节单一事实源 + `effectiveL16VoutMode` 选择器：非 LINEAR 共享字节
  回退到 `DEFAULT_LINEAR_VOUT_MODE = 0x18` 而不静默改写共享字节，linked/fallback 双语徽标。

### Fixed

- `HexInput` 固定 `0x` 前缀：前缀渲染在 `<input>` 之外，输入值只含十六进制数字；粘贴
  `18`/`0x18`/`0X18` 归一化为 `18`，裸 `0x` 过渡为空 digits（blur 归零）而非报错。
- VOUT_MODE 公式不再输出 KaTeX 非法转义 `\#`（结果面板 fallback 为纯文本的问题）。
- 修正 `format` 只取 `(byte >> 5) & 0x03` 的全字节 0x00..0xFF 遍历 golden 覆盖。

## [2.2.0] - 2026-08-26

### Added

- M37：共享 LINEAR 公式编辑器（`LinearFormulaEditor` / `ExponentEditor`），L11 与 L16 LINEAR
  复用同一 `Y/V × 2^N` 视觉；N 控件锚定到底数 2 的右上指数槽，锁按钮在相邻独立槽，
  `-16/-1/15` 与锁定切换时底数与乘号锚点不漂移。
- M37：L16 `VoutModeComposer` 结构化配置器——bit7（Absolute/Relative）、bits[6:5]
  （LINEAR/VID/DIRECT/IEEE Half）、bits[4:0]（LINEAR signed N / VID unsigned code /
  DIRECT·Half 固定 0）双向同步，实时显示 canonical byte、8-bit binary 与明确合法性状态。
- 新增单一领域来源 `src/legacy/vout-mode.ts`：`analyzeVoutMode`（0..255 全字节 total）、
  `composeVoutMode`、`classifyVidCode` / `VID_CODE_TABLE`，输出机器可测试的 validity status
  与 reason code。

### Fixed

- VOUT_MODE 相对非 LINEAR（如 `0xA0` relative VID）不再被误标为“相对 LINEAR”；
  Part II §8.5.3 的 relative-VID 非法组合被明确分类并阻止计算。
- DIRECT / IEEE Half 的 parameter 非零（如 `0x5F`、`0xE1`）被判为 invalid parameter
  （Part II §8.3 Table 2 要求 `00000b`），可解码但不再被宣称为有效配置。
- 删除 `AppState.l16.n` 冗余状态：VOUT_MODE byte 成为 L16 exponent 的唯一事实来源，
  view-model/formula/steps 统一从 analyzer 派生 N，消除双事实源漂移。
- `HexInput` 空串与裸 `0x` 过渡态合同修正：聚焦编辑中暂存为 draft、不修改 committed state、
  不逐键报错；空串 blur/Enter 归一化为 0，裸 `0x` blur/Enter 后显示“输入不完整”，非法修正
  后错误/ARIA/draft 同时清除。
- bit7 语义按 Part II §8.5 纠偏：bit7 配置 §8.5 所列 output-voltage-related commands 的
  absolute/relative 行为，VOUT_COMMAND 为 nominal reference；UI/文档不再笼统暗示任意 payload
  都是绝对/相对电压。

## [2.1.0] - 2026-08-26

### Changed

- 结果优先的响应式布局（M36）：物理值 `ResultSummary` 移至模式切换之后、主 workspace 之前，
  桌面与移动端首屏内完整可见，无需滚动；详细计算过程默认折叠为可访问 disclosure。
- `ResultInspector` 按职责拆分为 `ResultSummary`（唯一结果面板与 live region）与
  `ResultDetails`（原始 Hex / LE / BE / 量化误差 / 复制工具 / warnings / 计算过程），
  单一结果实例，不复制 view-model。
- 命令参考移动至主 workspace 之后；默认折叠时只显示按钮，说明移入展开内容顶部。
- 桌面 workspace 右栏改为 320–380px 自适应，移除整栏 sticky；移动端保持单列。
- visual scene 在截图前断言真实版本徽标并按 SemVer 形状规范化，隔离每次发布必变的
  非布局数据；release/deployment smoke 继续断言真实 `v2.1.0`。

## [2.0.2] - 2026-08-26

### Changed

- 工程质量加固（M35）：Vite 构建拆分为 `katex` / `react-vendor` / 应用三块，消除主 JS chunk
  超过 500 kB 的构建警告，并改善依赖缓存。
- 覆盖率门槛从 `lines/functions/statements 80 / branches 70` 上调至
  `lines/functions/statements 90 / branches 85`，并补充 `pow2` 回退、`encodeLinear16`、
  HALF 次正规数进位、命令事务标签等边界用例；当前实际覆盖率约
  statements 95.86% / branches 93.82% / functions 97.84% / lines 98.13%。
- 清理全部 React inline `style` prop，迁移到 `src/styles/tokens.css` 语义 class / data
  属性；新增 `npm run check:inline-style` 防回归门禁并接入 `npm run verify`、`npm run check`
  与 CI quality job。
- `HexInput` / `IntegerInput` / `DecimalInput` 移除已无调用方的 `style` prop 通道。

## [2.0.1] - 2026-08-25

### Fixed

- 线上产品名称统一为 **PMBus 数值格式计算器**：页面标题（AppHeader）与浏览器标题
  （index.html）与 README/ROADMAP/Release notes 的产品定位一致，并补充范围说明
  “数值格式换算，不实现完整 PMBus/SMBus 协议栈”。
- 新增构建时版本徽标：`__APP_VERSION__` 由 vite.config.ts 从 package.json 注入，
  页面显示只读 `v2.0.1`，不再手工维护版本文本；release/deployment smoke 增加版本断言。
- legacy `pmbus-calculator.html` 领域语义对齐（离线兼容文件不再宣称已纠正却保留旧算法）：
  - `parseVoutMode` 修正为 bits[6:5] 两位 mode + bit7 `isRelative`（Part II §8.3）；
  - `checkSpecial` 不再把 Y=1023 / Y=-1024 标记为饱和/溢出边界；
  - STATUS_WORD 说明补充“通常为 Read Word；特殊写入 0x0100 仅用于清除 UNKNOWN 位”；
  - READ_EIN 说明展示 §18.13 6 字节 vs Appendix I Table 31 5 字节的规范冲突；
  - 下拉引用由 Part II 18.14 改为 Part II 18.13；
  - 内置自检新增 0x98/0x20/0x40/0x60/0xE0 VOUT_MODE、L11 边界、STATUS_WORD/READ_EIN 说明断言。
- 命令参考视觉快照改为对 `.command-ref-table-shell` 元素截图（light/dark），
  真正覆盖表格与新增的“说明”列，不再只拍 viewport 折叠区。
- 新增 `tests/legacy-html-contract.test.ts`，在 CI 中守护 legacy 文件的领域一致性。

## [2.0.0] - 2026-08-25

### Changed

- 发布链路简化（自 v1.1.11 以来的未发布变更）：`release:prepare-assets` 恢复为可重新执行的打包步骤——每次运行
  使用唯一临时 staging 目录，生成/checksum/ZIP verifier 全部成功后才把结果移入 `release-output/`；
  删除长期 release lock、transaction journal、`--recover`/`--recover-lock`/`--audit-lock`、
  child-state sidecar、detached process-group supervisor、SIGINT/SIGTERM 生命周期状态机、
  crash/failpoint matrix、repeated-signal/orphan/PGID/stress evidence runner 与 zero-skip
  release-security 聚合 runner；对应专项测试退役，发布生成器测试纳入普通单测。
  失败时正式输出保持旧值或不存在，恢复方式为清理临时输出并重新执行；并发生成不作为受支持场景。
- CI 并行化：单一串行 `check` job 拆为 `quality`（format/typecheck/lint/coverage/build/基础合同）、
  `e2e`（Playwright 安装、用户流程、release smoke）、`compatibility`（Node 22 typecheck + unit）、
  轻量 `check` 聚合 job（继续作为 branch protection required check）。
- 文档纠偏：AGENTS.md 只保留长期产品约束/目录边界/标准验证入口；ROADMAP 只保留当前产品基线、
  下一产品目标与简短已完成索引（M25–M34 详细历史由 Git/PR 保存）；RELEASING 只描述正常发布步骤
  与失败后清理重跑。
- 产品定位正式确立为 **PMBus 数值格式计算器**：不再自称“PMBus 协议实现”，也不声明完整
  PMBus 1.5 一致性；明确不覆盖总线传输、命令执行、设备 Profile、PMBus 1.5 安全扩展与 Part IV。
  `document/specifications.json` 的 `validatedReference`/`currentPublishedRevision`/
  `productScope`/`fullRevisionCompliance` 声明保持一致。
- VOUT_MODE 位域按 PMBus Part II §8.3 修正：bit7=absolute/relative、bits[6:5]=mode、
  bits[4:0]=parameter；不再用 `(byte >> 5) & 0x07` 把 bit7 混入模式。全仓库 VOUT_MODE
  章节引用统一为 Part II §8.3。
- L16 状态约束：reducer/domain 层拒绝在 relative LINEAR、VID、DIRECT、IEEE Half
  VOUT_MODE 下通过 `value/set` 生成 LINEAR16 编码——不能只靠隐藏 UI 输入阻止错误状态。
  只有 absolute LINEAR 才显示绝对电压结果、V、N、2^N 与可表示电压范围；relative LINEAR
  仅解释 VOUT_MODE 参数位的指数/比值语义，不把 raw 标成绝对电压；VID/DIRECT/IEEE Half
  不生成虚假的 LINEAR16 V/N/range/result。
- L11 饱和语义：autoN=true 用全格式全局可表示范围判断饱和；autoN=false 按当前锁定 N
  对应的 Y=-1024..1023 范围判断；真实发生 clamp 时才显示 saturation warning；
  Y=1023/-1024 本身仍是合法边界编码，不因边界值报警。
- 四模式统一“字段解析 → 通用公式 → 数值代入 → 中间值 → 结果”计算过程展示
  （新增 `src/app/calculation-steps.ts` 与共享 CalculationSteps 组件），JSX 不再自行计算。
- 命令参考降级：主流程移除 CommandPicker，改为默认折叠的只读“命令参考”面板；移除
  `command/apply-preset` action 与全部 project-demo presets。命令参考实际渲染 metadata
  中的 note：STATUS_WORD 显示“通常为 Read Word；特殊写入 0x0100 仅用于清除 UNKNOWN 位”，
  READ_EIN 显示 Block Read 与规范字节数/有效载荷冲突（§18.13 6 字节 vs Appendix I Table 31
  5 字节）；展开/阅读任何命令都不修改 mode、raw、VOUT_MODE 或 DIRECT 参数。
- 清理本批新增的静态 inline style，迁移到既有 CSS/class 体系（tokens.css 与 legacy HTML
  class），未放宽 lint、测试或 AGENTS.md 规则。
- 文档一致性：`docs/MIGRATION_MATRIX.md` 明确 Pages 根路径返回 200（产品入口），仅 legacy
  `/pmbus-calculator.html` 路径为 404；legacy 文案改为“保留仓库内离线兼容用途，只接受
  必要纠偏，不再作为当前 Pages 产品入口”；`docs/DEPLOYING.md` 的“命令选择器”改为
  “只读命令参考”；README、README_zh-CN、DOMAIN_MODEL、specifications manifest、部署与
  发布文档的产品范围声明和 Part II §8.3 引用保持一致。
- `pmbus-calculator.html` 明确为仓库内离线历史归档（非 Pages 部署资产，对应路径 404），
  保留仓库内离线兼容用途，只接受必要纠偏，不再作为当前 Pages 产品入口。
- 版本升至 **2.0.0**（详见下方破坏性变化与迁移方式）。

### Removed

- 命令选择器（CommandPicker）及其自动修改计算状态的行为；`command/apply-preset` action
  与全部 project-demo presets 不再存在。

### Breaking changes

- 移除命令选择器与 preset 自动应用：选择命令不再切换模式、不注入参数、不重写 raw，
  也不会自动填入 VOUT_MODE 或 DIRECT 系数。
- 命令参考降级为默认折叠的只读面板：任何命令行都没有选中态、没有搜索框、没有预设入口。
- 迁移方式：需要 preset 的旧工作流改用手动输入（数据格式由器件数据手册或 VOUT_MODE
  决定）；命令码、事务、数据类型、单位、格式来源与规范章节仍可在只读命令参考中查阅。
- L16 在 non-absolute-LINEAR VOUT_MODE 下不再产生任何 LINEAR16 电压结果（此前仅 UI
  隐藏输入、reducer 仍会编码的错误行为已修正）。

## [1.1.11] - 2026-08-24

### Fixed

- release child-process lifecycle（WP-A/WP-B）：`process.once` 重复信号 raw death 修复为显式
  listener 生命周期管理——第一个 SIGINT/SIGTERM 决定最终退出码（130/143），后续同/异信号只记录
  `termination already in progress`，listeners 在 `lock.release` 完成之后才移除，重复信号绝不触发
  默认 raw death；`execFileAsync` 只在 child `close` 后 settle，timeout 先请求停止（POSIX 进程组
  SIGTERM）→ 等 close → 升级 SIGKILL → 再等 close → 清理后代 → 才 reject，active-child registry
  在锁释放前强制为空，stdin EPIPE 捕获为受控 rejection（原实现为 unhandled stream error 崩溃）。
- 成功声明只在最终协议完成后输出（WP-C）：`generateAssets` 不再打印 `Done:`，由 runCli 在
  runLocked 完成、child registry 归零、lock release 成功、listeners 移除、无已观察 signal 后才输出
  单一成功声明；signal-observed run 零 `Done:`/零 `Transaction recovered successfully`（原实现存在
  checkStop 与 Done 之间的 TOCTOU 窗口，探针实证 handler 观察后 Done 仍打印且现有测试允许）。
- 完整 zero-skip release-security manifest（WP-D）：`SECURITY_TEST_FILES` 扩展至九个文件
  （新增 m29-crash-matrix、m29-release-gates、m29-signal-protocol、m30-signal-lifecycle、
  m30-child-lifecycle；探针实证原门禁不含三个 m29 文件，其 it.skip 完全不可见），
  total=188 passed=188 skipped/todo=0，CI 日志打印实际九文件清单。
- canonical Node/npm toolchain（WP-E）：官方 release index 核对 v24 LTS latest=24.19.0/npm
  11.17.0；`.node-version`/`.nvmrc`/engines/packageManager/devEngines 全部对齐 24.19.0 与
  npm@11.17.0；CI 主验证改读 `.node-version`（24.19.0）、compatibility 精确 22.20.0、双运行时
  精确 npm 11.17.0；Pages 改读 `.node-version`；无 rolling/latest/lts/\*；`@types/node` 保持精确
  22.20.1；新增 `npm run doctor`/`check:toolchain` 门禁并接入 verify 链与 CI。
- worktree/CI hooks（WP-F）：postinstall 改为 worktree-aware wrapper，linked/detached worktree、
  CI 与非 Git 目录跳过 hook 安装并输出清晰信息，不再输出被吞的 ENOTDIR（探针实证原行为），
  主 checkout 正常安装。

### 探针与验证

- 修改前探针 A–H（未修改 main 的临时 worktree）：重复信号 raw death + lock 遗留、listener 移除→
  release 窗口信号 raw death、timeout 在 child close 前 reject 且孙进程继续写、stdin EPIPE unhandled
  崩溃、三个 m29 文件不在门禁、handler 观察后 Done 仍打印、工具链漂移、worktree npm ci ENOTDIR。
- Node 24.19.0 / npm 11.17.0：verify exit 0、单测 813（41 文件）、release-security 188 零 skip、
  coverage 92.92/89.18/95.18/94.83、visual 23 passed（+0/~0/-0）、signal stress 225 轮 bad=0。
- Node 22.20.0 / npm 11.17.0 compatibility（临时 worktree）：typecheck、test:run（813）、
  release-security（188）、coverage（同数字）、build 全过；signal stress 225 轮 bad=0。

## [1.1.10] - 2026-08-24

### Fixed

> **M29 strengthening（v1.1.10，如实披露）：** v1.1.9 的线上 Release/Pages 资产本身正确且未做任何回滚、
> tag 移动或资产覆盖；以下 M28 表述在 M29 修复完成前超出实际实现，全部由 v1.1.10/M29 强化/取代：
>
> 1. "signal handler 只记录终止请求…收到 signal 后不得输出完整成功声明"：M28 实现依赖最多 10 次
>    `setImmediate` 的时序启发式等待信号投递；修改前探针实证 SIGINT 15/20、SIGTERM 8/20 的 `Done:`
>    在 handler 观察到信号前打印（v1.1.9 生效前 Node 24.0.0 CI 曾因此失败）。
> 2. "全部 M28 security tests zero-skip"：M28 runner 实际只运行 prepare-release-assets 与
>    zip-helper-security 两个文件；探针实证 m28-recovery 中一个测试改为 it.skip 后门禁仍 exit 0。
> 3. "journal rename 后按平台能力 fsync 父目录"：M28 将父目录 fsync 的任何错误（含 EIO/ENOSPC/EROFS/
>    EBADF/close 失败）降级为 note 并继续成功发布；探针实证 EIO 注入后仍 SUCCESS、journal 被删。
> 4. "完整自动恢复"：M28 在 STAGING_VERIFIED 写入空 hash 后、OLD_OUTPUT_BACKED_UP 写入 null oldSha256
>    后存在 crash window，磁盘 journal 无法通过 validateJournal；PRE_COMMIT 恢复在验证 oldSha256 前已
>    删除 output、移动 backup（topology 不再自洽）。

- zero-skip security gate 完整覆盖（WP-A）：新建 `scripts/release-security-test-contract.mjs` 共享清单
  `SECURITY_TEST_FILES`（prepare-release-assets、zip-helper-security、m28-recovery、run-release-security-tests
  四个文件），runner 与合同测试引用同一清单、不得分别硬编码；清单文件缺失/重命名/未执行时 fail closed；
  报告必须精确包含四个预期 suite，多余 suite 也失败；skipped/todo/pending 任一大于 0 即非零；
  CI 日志列出实际覆盖的四个文件与 zero-skip 结果；runner 自身测试加入门禁时用 fake vitest fixture，
  不产生无限递归。
- 确定性 signal/lock 协议（WP-B）：删除 bounded 10×setImmediate flush loop；Python helper/verifier 子进程
  改为 async spawn，`generateAssets`/`recoverTransaction` 在事务 stage 边界（每次 journal 写、每次子进程
  完成）检查注入的终止状态，signal 被观察后不进入新 transaction stage、不打印 Done/完整成功声明；
  INIT journal 在任何长时子进程前持久化，信号到达任何时点都留下可恢复 journal；SIGINT 精确返回 130、
  SIGTERM 精确返回 143；lock 在所有写/rename/子进程停止前不释放；第二 generator 在第一进程完全停止前
  无法获得锁；Node 22.20.0 与 24.0.0 各 100 轮（50×SIGINT + 50×SIGTERM）stress 0 flaky、0 skip。
- 目录 durability fail-closed（WP-C）：新增 `fsyncParentDirectorySync`，错误分类——EINVAL/ENOTSUP/
  EOPNOTSUPP（平台不支持目录 fsync，经实测与文档说明）降级为 note；EIO/ENOSPC/EROFS/EBADF/未知错误/
  close 失败抛 DurabilityError，保留 journal/backup/lock 恢复信息、返回非零、不得报告完整成功；
  覆盖全部六个 mutation boundary（journal temp write/fsync/close、journal rename、output→backup rename、
  staging→output promotion、backup 删除、journal unlink）。
- 恢复前验证与 crash-consistent journal（WP-D）：PRE_COMMIT + backup 恢复在删除/rename 任何路径前，
  将 backup 的 zip+sums hash 与 journal.oldSha256 比较，不匹配时零磁盘 mutation（无 rm/rename 被调用）、
  journal/backup/output 原样保留；新增 `OLD_OUTPUT_BACKUP_INTENT` 状态（rename 前持久化，oldSha256 从
  未触碰的 output 计算）；hash 先填充再持久化 STAGING_VERIFIED；STAGING_GENERATED 允许空 hash；
  14 个 crash matrix failpoint（13 force + 首次发布）逐一验证：磁盘 journal 可被 validator 解析、
  --recover 可重复运行、第二次 recovery 幂等、无 journal 指向不存在 backup 的状态。
- 统一 ZIP entry contract（WP-E）：共享 fixture `tests/fixtures/zip-entry-contract.json`；JS
  `validateZipEntry`、`_zip_helper.py`、`verify_release_zip.py` 三层对同一 fixture 表一致结论；
  Windows drive absolute/drive-relative（C:/、C:\、C:）与 UNC（//、\\）三层全部拒绝；'.' 段、空段、
  backslash、control、node_modules/src、.map 三层一致拒绝；helper 直接调用 fail closed 且不留 partial ZIP。
- runner 私有临时目录与清理失败（WP-F）：报告位于 `mkdtempSync` 随机私有目录（0o700），不再使用可预测的
  `/tmp/release-security-tests-${pid}.json`；成功删除报告与目录；删除失败必须使最终门禁非零并在 stderr
  报告，原始 test failure 与 cleanup failure 同时发生时两者都报告；runner 不调用中途 process.exit；
  新增 symlink/path replacement race、rmSync EACCES/EIO、report 替换为 symlink/directory、temp dir 创建
  失败、test child timeout/signal（`RELEASE_SECURITY_TIMEOUT_MS` 可注入）与零残留 fixture。
- 文档与审计合同（WP-G）：ROADMAP/CHANGELOG 将上述四项 M28 表述标记为 M29 strengthening/superseded
  （不修改已发布 v1.1.9 tag 或 Release notes 资产）；PR 模板新增 base SHA/tree、final head SHA、push 次数、
  每次 CI URL/head/conclusion、最终成功 CI head_sha、checked_sha/checked_tree、merge SHA/tree、tree equality、
  security runner 实际覆盖文件列表、passed/failed/skipped/todo、temp residue、signal stress 次数/平台、
  journal crash matrix 数量、hygiene 两个 size 指标语义（tracked path entry 计数与 blob size 求和）。

## [1.1.9] - 2026-08-23

### Fixed

> **v1.1.8 勘误（如实披露）：** v1.1.8 的线上 Release/Pages 资产本身正确且未做任何回滚、tag 移动或资产覆盖；
> 但发布管线存在以下缺陷，全部由 v1.1.9/M28 修复：
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

- 恢复状态机以 journal 为唯一事实来源（WP-A）：recoverTransaction 先读取并严格验证 journal，
  再依据 journal state + output 是否存在 + backup 数量决定动作；COMMITTED + output + backup 时对 output
  执行完整 reverify（asset pair、SHA256SUMS、verify_release_zip.py、版本合同、实际 hash 等于 journal.newSha256），
  全部通过后才可删除 backup，任一失败保留 output/backup/journal 返回 manual audit；COMMITTED/BACKUP_CLEANED +
  output + 无 backup（首次发布 journal.delete 失败或已完成 backup cleanup 的正式恢复路径）完整验证 output 与
  journal.newSha256，成功时只清理 journal；PRE_COMMIT + 无 backup 只允许基于精确 journal/path/hash 采取保守动作，
  无法证明所有权时 manual audit；PRE_COMMIT + backup 先深度验证 backup、再恢复、恢复后再次完整验证，
  失败不删除最后一个有效副本；journal 不得仅靠 state 字符串决定删除资产。
- journal 绑定与耐久性（WP-B）：validateJournal 验证 journal.version 等于 package.json version、
  outputPath 精确等于规范化的 release-output、backupPath 为 null 或安全单段名称并与唯一实际 backup 精确一致、
  禁止绝对路径/.. /反斜杠/路径分隔符、oldSha256/newSha256 为小写 64 位十六进制、
  state 与 backupPath/oldSha256/newSha256 的必需字段组合一致、updatedAt 为严格 ISO 时间；
  抽取 writeAllSync，writeSync 返回 0/负数/NaN/非整数/大于 remaining 均立即失败、不得无限循环，
  lock 创建失败时只删除自己创建的 inode，journal 写失败不得把部分 journal 提升为正式 journal，
  close/fsync/rename 错误全部有负向测试，journal rename 后按平台能力 fsync 父目录。
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

## [1.1.8] - 2026-08-23

### Fixed

> **v1.1.7 勘误（如实披露）：** v1.1.7 的线上 Release/Pages 资产本身正确且已重新验证，
> 未做任何回滚、tag 移动或资产覆盖；但发布管线存在以下缺陷，全部由 v1.1.8/M27 修复：
>
> 1. `--recover` 不获取互斥锁即可运行，且仅按文件名/数量校验 backup——损坏的 backup
>    （非 ZIP 内容、非法 checksum）会被直接提升为正式 output 并返回 exit 0。
> 2. 部分备份删除导致数据丢失：`--force` 在 backup 清理阶段失败时，rollback 会删除
>    已验证的新 output、把残缺 backup 恢复为 output——新旧 ZIP 同时丢失。
> 3. symlink 测试实际始终 skip：`symlinkTest` 在模块加载时求值，而能力标志在
>    `beforeEach` 中才置位，注册时恒为 `it.skip`。
> 4. rollback 测试未达到 publish 阶段：基于 createHash 调用次数的注入在 staging 校验阶段
>    即失败，backup rename 与 promotion 从未执行，publish 阶段回滚零覆盖。
> 5. behavioral contract 仍可 fallback 假通过：动态 import 失败时回退到源码字符串检查，
>    "缺模块 + 错误本地命名"与"plan 正确但 generateAssets 不消费 plan"均判 ok。
> 6. `npm run clean` 声称清理锁文件但实际 exit 1 且什么都不删（锁不是目录），文档与行为矛盾。

- 统一锁域（WP-A）：普通生成、`--force`、`--recover` 全部使用同一原子互斥锁；
  `--recover-lock` 是唯一可在不持锁时操作锁文件的命令；`--recover` 先 `acquireLock`、
  在 try/finally 中执行恢复、release 失败使 CLI 非零；cleaner 发现锁时 fail closed，
  在删除任何 release 目标前停止，且永不删除锁文件；`GENERATED_TARGETS` 移除锁文件、
  新增事务 journal；RELEASING.md 同步更新。并发测试由 25 个真实子进程调用真实导出函数。
- 锁创建与释放错误完整性（WP-B）：`open('wx')` 成功后的 write 失败、short write、close 失败均关闭 fd
  并只清理由本次创建的 lock inode（fstat/lstat dev+ino 所有权校验，替换后的锁绝不误删）；
  `release()` 不再吞错——unlink/read/parse 失败抛出 `LockReleaseError` 并保留可恢复元数据；
  资产已生成但锁未释放时 CLI 非零并明确提示部分成功；新增 SIGINT/SIGTERM 行为测试
  （尽可能释放 owned lock、无法释放时保留可恢复元数据、绝不删除非 owned lock）；
  锁元数据 schemaVersion/startedAt/nonce 类型与格式校验，未知 schema 禁止自动恢复。
- 事务 commit point 与故障恢复（WP-C）：显式状态机 STAGING_VERIFIED → OLD_OUTPUT_BACKED_UP →
  NEW_OUTPUT_PROMOTED → NEW_OUTPUT_VERIFIED → COMMITTED → BACKUP_CLEANED；COMMITTED 之后 backup
  删除失败不删除已验证新 output、不用残缺 backup 覆盖、保留残余 backup/journal 并要求显式清理；
  versioned transaction journal（schema/nonce/version/state/output/backup/old/new SHA-256），
  更新走临时文件 + fsync + 原子 rename；12 个具名 failpoint（staging checksum、staging zip verifier、
  backup rename 前/后、promotion 前/后、published checksum、published zip verifier、commit journal、
  backup 删除开始前、部分删除后、journal 删除），测试断言 failpoint 名与阶段 trace，
  禁止 createHash 调用次数冒充注入；rollback restore 自身失败保留 backup/journal 且不吞错。
- Recovery 完整性（WP-D）：`recoverTransaction` 深度验证 backup（恰好两个普通文件、SHA256SUMS 仅一行、
  checksum 与实际 hash 一致、verify_release_zip.py 通过）；symlink/目录/多余文件/错误 ZIP/checksum 全部拒绝；
  output 与 backup 并存时读取 journal——PRE_COMMIT 恢复已验证旧 backup、COMMITTED 保留已验证新 output 仅清理
  backup、journal 缺失/损坏/未知 schema 一律拒绝并要求人工审计；多 backup 一律拒绝；recovery 必须持锁；
  恢复完成后重新验证正式 output；损坏 backup 绝不被 rename 为 output。
- artifact contract 真实执行路径（WP-E）：移除动态 import fallback，任何 import/解析失败一律 fail closed；
  `buildReleasePlan(version)` 成为唯一实现并放入共享合同模块，generator 与 contract checker 均直接导入；
  `generateAssets` 只消费 plan（zipName/sumsName/layout/tag/template），禁止直接调用 assetNames 或本地命名模板；
  `runCli` 支持注入 repoRoot，fixture 运行真实 CLI；新增正/负向 CLI fixture（缺失 module、plan 正确但
  generator 不消费 plan、wrong ZIP/sums/tag/template）。
- symlink、并发与 Python helper（WP-F）：symlink 能力在测试注册前同步探测（mkdtemp → symlink → finally 清理）
  再选择 it/it.skip，canonical 环境 symlink file/dir/helper 测试零 skip；同一 shell 连续两次运行结果完全一致；
  25 子进程真实 `acquireLock` 竞争严格一个 winner；Python helper 对原始路径使用 O_NOFOLLOW 打开、fstat 比较
  初始 lstat 的 dev+ino、循环 os.read 直到 EOF 并处理 short read、长度/identity 变化即失败；新增 helper 直接
  测试（symlink final component/parent、lstat 与 open 之间替换、FIFO/directory、path escape、duplicate entry、
  short-read、deterministic bytes）。
- 测试真实性（WP-G)：删除以 expect(true) 充当合同的测试；catch 使用 unknown narrowing、无理由 @ts-expect-error
  移除；每个 failpoint 测试断言 failpoint 名确实触发并记录事务阶段 trace；full CI 新增 Linux generator/security
  专项（不依赖 Playwright，零 skip 门禁 `npm run test:release-security`，任一 skip 即失败）。

## [1.1.7] - 2026-08-23

### Fixed

- 原子并发锁与所有权：`acquireLock` 从 `existsSync → writeFileSync`（TOCTOU 竞态）重构为 `fs.openSync(path, 'wx', 0o600)`（O_CREAT|O_EXCL 原子创建）；锁内容改为结构化 JSON 元数据（schema version、PID、timestamp、random nonce、repo realpath）；cleanup 仅删除 nonce/PID/repo 三方匹配的本进程锁；无效 JSON、EPERM、PID 状态不明、stale lock 均不得自动删除；新增 `--recover-lock` 显式恢复命令；`process.exit()` 不再出现在 try/catch 中，CLI 返回 exit code；未知参数在锁创建前失败且无残留。
- 事务状态机与恢复：`generateAssets` 重构为显式事务状态机（INIT → STAGING_GENERATED → STAGING_VERIFIED → OLD_OUTPUT_BACKED_UP → NEW_OUTPUT_PROMOTED → NEW_OUTPUT_REVERIFIED → BACKUP_REMOVED）；首次发布时 staging 直接 rename 到尚不存在的 output（不再预 mkdir）；已有 output 先验证恰好是合法资产对；`--force` 使用唯一 nonce 备份目录；新增 `--recover` 命令（output 缺失 + 已验证 backup 可恢复，output 与 backup 同时存在拒绝）；每个 failpoint 可注入依赖（fs rename/remove/verifier/checksum）并断言旧资产不丢失、无含糊状态、owned lock/staging 零残留。
- 测试确定性与路径安全：移除固定路径 `/tmp/.m25-symlink-probe`，改用 `fs.mkdtempSync` 创建唯一能力探针并在 `afterAll` 中无条件清理；同一 shell 连续运行 generator test 两次测试数、passed、skipped 完全一致，临时目录零残留；新增 20+ 并发竞争测试（严格一个 winner）；新增 FIFO/socket/device/文件名含特殊字符/control char 拒绝测试；`catch` 使用 `unknown` 并做正确 narrowing。
- Python ZIP helper TOCTOU 修复：`_zip_helper.py` 改为先 `os.lstat` 原始路径（检测 symlink），再 `os.path.realpath`（containment 校验）；POSIX 上优先使用 `os.open(..., O_RDONLY | O_NOFOLLOW)` 防 check-vs-read 替换；`external_attr` 包含 `stat.S_IFREG | 0o644`；新增 symlink swap/TOCTOU fixture 测试。
- 行为式 artifact contract：`check-release-contract` 不再仅检查 `includes("from './release-artifact-contract.mjs'")` 字符串，改为导入 `getReleasePlan(version)` 并验证其返回的 zipName/sumsName/pagesZipTemplate/tag 与共享合同一致；动态 import 失败时回退到源码级检查并记录；`readContract` 返回 `generatorBehavioralOk` 与 `generatorBehavioralErrors` 字段。
- 锁清理：`clean-generated.mjs` 增加 `.release-staging.lock` 到清理目标（17→18 项）；`.gitignore` 备份模式更新为 `release-output.backup*/`。
- 文档：`RELEASING.md` 新增"中断恢复"章节，记录 `--recover-lock`、`--recover` 命令与人工审计规则。

> **v1.1.6 勘误：** v1.1.6 的发行资产本身正确，但以下实现缺陷由 v1.1.7/M26 修复：
>
> 1. `acquireLock` 使用非原子 `existsSync → writeFileSync`（TOCTOU 竞态）；锁文件无结构化所有权元数据，清理仅比对 PID 字符串。
> 2. Release 资产生成器失败路径（如 dist 缺失）会遗留 `.release-staging.lock`，`npm run clean` 未清理该文件。
> 3. `tests/prepare-release-assets.test.ts` 使用固定路径 `os.tmpdir()/.m25-symlink-probe` 作为 symlink 能力探针且未清理，导致同一 shell 第二次运行 symlink 测试被意外 skip。
> 4. `generateAssets` 的 rollback 路径（`--force` 失败后恢复旧 output）仅在 `finally` 块中作为 best-effort 实现，无 explicit failpoint 测试覆盖，也未验证 backup rename 后、staging promotion 前、re-verify 中等各阶段的故障恢复。
> 5. `_zip_helper.py` 先 `os.path.realpath` 再 `os.lstat`，symlink 被 `realpath` 解析后 `S_ISLNK` 检查永不会触发（TOCTOU）。
> 6. `check-release-contract` 仅检查 generator 源码中是否包含 shared-contract import 字符串，不验证实际行为；generator 可使用硬编码错误 ZIP 名仍通过门禁。

## [1.1.6] - 2026-08-23

### Fixed

- 发布资产生成器 fail-closed 与事务式发布：`walkDist` 显式分类所有 Dirent 类型（symlink/FIFO/socket/device 均报错，禁止静默跳过）；路径校验使用分量级判断（拒绝 `..`、`node_modules`、`src`、`.map`、控制字符）；使用固定 `scripts/_zip_helper.py` 替代动态生成临时脚本；Python executable 可注入（`PYTHON3` 环境变量）；checksum 反向验证使用 Node `crypto`（不依赖 shell `shasum`）；新增事务式发布（`.release-staging/` 唯一 staging → 验证 → 发布，`--force` 使用 backup/rollback 保护旧资产）；并发锁（`.release-staging.lock`）；零遗留 `.cache/zip-*` 临时文件。新增 `tests/prepare-release-assets.test.ts`（19 测试）。
- 发布合同完整性：`check-release-contract` 新增结构化 CHANGELOG 解析——恰好一个 `## [Unreleased]`、必须是第一个 release-level heading、当前版本是其后的第一个 dated section、fenced code block 内伪标题忽略、重复/缺失/乱序全部失败；`readContract` 现在读取 RELEASING.md 和 generator 共享合同导入检查；删除 `main()` 中 RELEASING 旁路追加逻辑（纯函数、fixture 和 CLI 走同一 read→validate 路径）。新增 10 个 CHANGELOG 结构测试和 9 个 integration fixture 测试。
- 共享发行资产合同：新增 `scripts/release-artifact-contract.mjs`（`assetZipName`、`assetSumsName`、`PAGES_ZIP_TEMPLATE`、`validateZipEntry` 等），`prepare-release-assets` 和 `check-release-contract` 均从该模块导入，消除多处重复命名模板。
- Node 精确运行时下限：engines 从 `>=22 <23` 收紧为 `>=22.20.0 <23`（Node 24 保持 `>=24.0.0 <25`）；`@types/node` 从 `^22.20.1` 改为精确 `22.20.1`（防止自动漂移到更高 minor）；CI `setup-node` 从滚动 `22`/`24` 改为精确 `'22.20.0'`/`'24.0.0'`（带引号）；runtime contract 测试解析完整 major.minor.patch 并锁定精确下限；新增 `tests/node-ffi-type-probe.ts`（`@ts-expect-error` 负向 fixture，由主 typecheck 覆盖）。
- 类型边界清理：删除 `specifications.mjs` 中注释掉的 `pushIf` 死代码。
- 文档勘误：CHANGELOG v1.1.5 和 ROADMAP M24 节注明 M24 未实际验证 missing `[Unreleased]`、generator 未实现 fail-closed 遍历和事务式发布、运行时下限只比较主版本；明确这些由 v1.1.6/M25 修复。
- 文档同步：`CHANGELOG.md`、`docs/releases/v1.1.6.md`、双 README（stable/live/Release/SHA256SUMS 链接）、`ROADMAP.md`（M25 Done + stable v1.1.6）、`RELEASING.md` 全部更新。

## [1.1.5] - 2026-08-23

### Fixed

- Node 运行时下限类型合同：`@types/node` 从 26（Current）改为 22（最低支持运行时），消除类型门禁接受 Node 22/24 运行时不存在 API（如 `node:ffi`）的 false-pass；新增 `tests/runtime-type-contract.test.ts` 结构性锁定引擎下限、CI 主/次验证与 `@types/node` 主版本一致性。注：M24 只比较主版本（major），未锁定精确 minor/patch 下限（engines 接受 Node 22.0，但 jsdom 实际要求 ≥22.13.0），CI 使用滚动 `22`/`24` 而非精确版本；这些在 v1.1.6/M25 修复。
- 发布合同真实文件检查：`scripts/check-release-contract.mjs` 重构为读取真实文件表面（Pages workflow 模板、RELEASING.md），不再自生成 `artifactNames` 循环校验；新增精确 Gregorian 日期验证、release notes 第一非空行精确标题匹配、README Live Demo 行版本校验、ROADMAP 唯一 stable 声明检查、lockfile 双版本必需验证。注：M24 未实际校验 `## [Unreleased]` 缺失（删除后仍 exit 0），也未校验 generator 是否导入共享合同；这两项在 v1.1.6/M25 修复。
- 发布合同集成级负向测试：`tests/release-contract.test.ts` 新增 13 个 fixture 集成测试（lockfile 漂移、缺失 [Unreleased]、非法日期、错误标题、陈旧 README 链接、ROADMAP 重复/陈旧声明、Pages 模板错误、RELEASING 资产名错误），每个错误使真实 read+validate 链非零。
- scripts checkJs 类型覆盖：新增 `tsconfig.scripts.json`（strict + checkJs + Node types），根 tsconfig 扩展为 app/node/scripts/tests 四项目；`scripts/**/*.mjs` 七个文件补全 JSDoc 类型注解（含 `FetchLike` 结构类型、`manifest`/`document` JSON 边界 `any` 窄桥接），不降低 strict、不使用 `@ts-nocheck` 或全局 `any`。
- 可复现发行资产生成：新增 `scripts/prepare-release-assets.mjs`（从 `dist/` 确定性生成 `pmbus-calculator-vX.Y.Z-web.zip` 与 `SHA256SUMS.txt`，版本唯一来源 `package.json`），相同 `dist/` 两次生成 zip 与 checksum 逐字节一致；自动调用 `verify_release_zip.py` 与 `shasum -a 256 -c` 反向验证；`release-output/` ignored；`RELEASING.md` 改用该唯一命令。注：M24 生成器未实现 fail-closed 遍历（symlink 静默跳过）、事务式发布（失败遗留 `.cache/zip-*` 临时文件）、并发锁和 Python 可注入性；这些在 v1.1.6/M25 修复。
- 文档同步：`CHANGELOG.md`、`docs/releases/v1.1.5.md`、双 README（stable/live/Release/SHA256SUMS 链接）、`ROADMAP.md`（M24 Done + stable v1.1.5）全部更新。

## [1.1.4] - 2026-08-23

### Fixed

- TypeScript 验证门禁真实性：`npm run typecheck` 从对 solution 根配置执行 `tsc --noEmit`（受检文件数为 0）改为 `tsc -b` 构建模式，真实检查应用源码、Vite/Node 配置、单元测试、E2E 测试与全部 Playwright 配置；新增 `tsconfig.tests.json`（strict + Node/Vitest 类型）与结构性回归测试，负向探针证明 src/tests/Playwright 配置错误均使门禁非零退出；`@types/node` 成为直接 devDependency；四个 mjs 脚本边界补精确 JSDoc 类型，修复 strict 检查暴露的 59 处测试类型错误（含 `documentPdfs` 过期断言与两处 E2E null 处理）。
- 发布合同自动检查：新增完全离线的 `npm run check:release-contract`，以 `package.json` 版本为唯一来源校验 lockfile、CHANGELOG、release notes、双 README 链接、ROADMAP 声明与 Release 资产命名一致性（含成功/失败单测），接入 `npm run verify` 与 full CI。
- 发布流程文档修正：`docs/RELEASING.md` 重写为 M19-B 后的正确流程——PR head full CI → 记录 checked_sha/checked_tree → 普通 merge → tree 审计（一致不重复 CI，不一致 workflow_dispatch full CI）→ 在精确 merge SHA 的干净 detached worktree 完成发布前全量验证与 zip/SHA256SUMS 校验后才能创建 annotated tag；删除已失效的“等待 main push CI”要求。
- CI 与 Node 矩阵：full CI 的 Type check 步骤运行真实 `tsc -b`（日志可见 app/node/tests 三个项目）；Node 24 次级验证升级为 `typecheck + 单测`。
- 仓库卫生与规范分发加固（v1.1.3 后合入）：repo-hygiene 门禁与制品政策、按 blob 计算树大小、clean preflight 跨平台；第三方规范 PDF 移出 Git tree，provenance/哈希集中维护在 manifest，下载走白名单 host、流式写入与 deadline 提交门禁。
- Tailwind 构建范围可复现：`source(none)` + 显式 `@source` 隔离生产扫描范围，canary 回归防止非生产工具类再次泄漏进发行 CSS。
- CI tier 与受保护 main：fail-closed light/full 分级、Playwright report 按失败步骤门控上传、`protect-main` ruleset（PR 必须、required check、strict up-to-date、禁 force push）与 merge 后 `checked_tree` 审计替代重复 CI。
- Vitest/Node 验证加固：Vitest 4 与 coverage provider 成对升级（glob 弃用链移除）、engines 收紧为 Node 22/24、CI 增加 Node 24 次级验证。
- 输入校验与键盘可靠性（M21）：统一整数语法拒绝 `1e2`/`0x10` 等宽松转换；过渡态不逐键报错、非法终值字段级可见错误并保留 draft；DIRECT 系数错误按字段隔离；`Ctrl+1..4` 仅在非编辑上下文生效；CommandPicker 搜索框显式 `aria-label`。
- CommandPicker APG 焦点与搜索生命周期（M22）：`role="option"` 迁移到不进 Tab 顺序的 `<li>`；`aria-selected` 恒等于 `aria-activedescendant` 指向；ArrowUp/Down 首尾不循环；Tab/Shift+Tab 关闭弹层并移焦到 trigger 逻辑相邻控件；Escape 恢复 trigger 焦点；外部焦点关闭不抢焦；零匹配显示状态文案且 Enter 安全 no-op；清空 query 恢复选项、active 与滚动位置。

## [1.1.3] - 2026-08-16

### Fixed

- 结果主数值：等宽 + tabular-nums，按长度使用可预测字号档位；长精确值不截断、不换行、不 scale；结果 tile 增加 min-width/overflow 防护。
- HALF 公式：headline 已显示最终物理值时，展开式不再重复最终长小数；normal 显示 `s / E / F` 字段摘要与展开式；subnormal、zero、Infinity、NaN 保留各自语义。
- DIRECT LaTeX：负指数渲染为 `10^{-12}`，不再出现 `10^{(-12)}`；`plainText` 与 C 宏注释保持兼容。
- 量化误差：文案改为“量化误差”；`ok`/`warn`/`error` 分别映射 success/warning/danger，负号只表示方向。
- 复制工具栏：Hex 主按钮动态显示 `Hex（LE）` / `Hex（BE）`；偏好区拆为“Hex 格式”与“Hex 复制顺序”两个语义分组。
- 文案统一：`PMBus 命令`、`物理值`、`小端序（LE）`、`大端序（BE）`、`V（16 位无符号，0～65535）`、`Y（16 位有符号，−32768～32767）`、`IEEE 754 binary16（半精度）`。
- 交互与排版：BitGrid 移除 hover 放大；InfoPanel 与图例改用设计 token；暗色滚动条统一为细滚动条并覆盖 Firefox/WebKit。
- 视觉回归：新增 L11/L16/DIRECT/HALF 非零应力场景、亮暗主题、移动端与小高度弹层截图。

## [1.1.2] - 2026-08-16

### Fixed

- 对比度：拆分 `--color-accent` / `--color-accent-solid` / `--color-on-accent`，暗色选中 tab 改用 `#2563eb` + `#ffffff`；成功/失败反馈改用 surface/text/border token。
- BitGrid：region 颜色改为语义 token，移除 nibble group 投影；360/390px 下 2×2 nibble 布局，bit index 字号 10px。
- 公式：DIRECT 参数面板改为 KaTeX 通用关系式；HALF 动态公式按 sign/exponent/fraction 展示 zero/subnormal/normal/±Infinity/NaN 分解；`formulaGenericLatex` 由展示层统一提供。
- 语义：删除 L11 默认 `Y = 0，表示零值或未初始化` 提示。
- 布局：统一 Header/ModeSwitcher/CommandPicker/Workspace 左右 gutter；复制工具栏改为 6 列平衡网格，LE/BE 字节中文标签，复制字节序 segmented control。
- 测试：新增 contrast、layout-gutters 测试；visual snapshot 改用稳定场景名并归档 v1.1.1 GitHub 渲染证据。

## [1.1.1] - 2026-08-16

### Fixed

- Markdown：移除 GitHub 不支持的 `\operatorname`，HALF 表格改为分段解码定义；修复 `docs/UI_CONVENTIONS.md` 原始 fenced-block 示例；新增活动 Markdown 数学检查。
- 命令下拉框：改为 `@floating-ui/react-dom` 的 viewport-aware 定位，portal 渲染，默认向下展开，空间不足自动翻转；修复 `scrollIntoView` 意外滚动页面。
- 公式纯文本：修复 DIRECT `10^(--1)` / `--3` / `10^(-0)` 可读性；HALF 按 zero / subnormal / normal / ±Infinity / NaN 分类展示。
- 交互：删除全局 `filter: brightness` hover，统一语义 token、控件高度、图标；模式切换补全 tabs 键盘行为；复制反馈改为受控 timer，reduced-motion 下仍保留足够可读时长。
- 调试面板：正式 Pages 默认隐藏，仅 `import.meta.env.DEV` 或 `?debug=1` 显示。
- 发布：记录并修复 GitHub Pages environment 只允许 main branch 导致 release event 被拒绝的问题，新增稳定 tag policy。

## [1.1.0] - 2026-08-16

- Markdown 数学公式：活动文档中的数学表达式统一使用 GitHub 支持的 `$...$` / `$$...$$` LaTeX 语法。
- Web 公式 KaTeX 排版：新增集中式 `MathFormula` 组件与公式展示层，L11/L16/DIRECT/HALF 四种模式均由 KaTeX 正式排版，纯文本公式与 C 宏输出保持不变。
- 交互反馈系统：统一 cursor、hover、active、focus-visible、disabled 状态矩阵，支持 `prefers-reduced-motion`。
- Release/Pages smoke：生产构建与真实 Pages 部署均验证 KaTeX CSS、字体与 MathML 输出。

## [1.0.0] - 2026-08-15

- 四模式双向转换：LINEAR11 / LINEAR16 (VOUT) / DIRECT / IEEE 754 Half-Precision 均支持 Hex 与物理值双向编码解码。
- 命令字典与显式 project-demo presets：内置 13 条 PMBus 1.3 标准命令定义；preset 仅在显式点击后应用。
- copy/theme/persistence：Hex/值/C 代码复制、亮暗主题、字节序与偏好持久化。
- 严格输入校验：拒绝 partial parse、科学计数法、越界与非法输入。
- READ_EIN 冲突呈现：以显式 conflict 模型呈现 Rev 1.3 与 1.3.1 冲突，不虚构单一权威 packet length。
- 单测、coverage、E2E 与 CI 门禁：Vitest + v8 coverage、Playwright desktop/mobile Chromium E2E、build、lint、typecheck、format 与 audit。
- legacy HTML fallback：`pmbus-calculator.html` 保留为 read-only fallback。
- Agent context archive：M0–M10.1 历史上下文归档至 `docs/archive/`。
