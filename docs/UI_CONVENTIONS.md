# UI Conventions

> 长期稳定规则。只有涉及 UI / 公式 / 交互动效的任务才需要读取本文件。
> 本文不重复里程碑进度；进度以 `docs/ROADMAP.md` 为准。

## 1. Markdown 数学公式

- 活动 Markdown 文档中的数学表达式使用 GitHub 官方支持的 LaTeX 语法：
  - 行内：`$...$`
  - 块级：`$$...$$`
  - 复杂块级 fenced math block：

    ````markdown
    ```math
    X = \frac{1}{m}\left(Y \times 10^{-R} - b\right)
    ```
    ````

- 只转换真正的数学表达式。API 名、函数名、命令、路径、版本号、bit range 和代码片段继续使用反引号。
- 历史快照 `docs/archive/**` 不修改、不搜索、不重新渲染。
- 中英文文档的公式语义必须一致。
- 只使用 GitHub MathJax 与 KaTeX 都支持的通用 LaTeX 子集；禁止未经验证的宏（如 `\operatorname`、`\newcommand`、`\def`）。
- 本地 `npm run check:markdown-math` 只做文本扫描；PR 创建后必须用真实 GitHub 页面浏览器检查渲染结果并截图。

## 2. Web 公式单一数据源

- 公式展示层集中在 `src/app/formula-presentation.ts`，输出：
  - `plainText`：纯文本公式，继续用于复制输出和 C 宏注释，保持兼容；
  - `latex`：KaTeX 源码，只用于屏幕排版；
  - `genericLatex`：工作区通用关系式；
  - `detailLines`：结果面板的语义化行数组（`summary` / `expansion`）。HALF 在 headline 已显示最终物理值时，展开式不重复最终长小数。
- L11 / L16 / DIRECT / HALF 四种模式都从该层取得纯文本与 LaTeX；JSX 不自行拼装动态计算公式。
- 公式只来自内部受控模板，不接受用户输入任意 TeX。
- 必须正确处理负指数、负系数、括号、`m = 0` 和 HALF 特殊值。
- 渲染组件 `src/components/math/MathFormula.tsx` 使用 `katex.render(tex, element, options)` DOM API，
  不使用 `dangerouslySetInnerHTML`。
- KaTeX 选项固定为 `throwOnError: true`、`strict: 'error'`、`trust: false`、
  `output: 'htmlAndMathml'`、`maxSize: 20`、`maxExpand: 100`。
- `katex.ParseError` 必须回退到可读纯文本公式；单个公式不得导致页面崩溃。

## 3. KaTeX 安全、CSP、MathML 与本地字体

- KaTeX 作为本地 npm 依赖安装，不使用 CDN、远程字体或运行时网络依赖。
- 在应用入口导入 `katex/dist/katex.min.css`，由 Vite 将字体打入 Release 资产。
- 生产 CSP 不增加外部域；字体、CSS、JS 必须来自 Pages 同源。
- KaTeX 输出同时包含 HTML 与 MathML；E2E 必须确认 DOM 中存在 `math` 元素且无 `.katex-error`。
- 移动端长公式只允许公式容器局部横向滚动（`.math-scroll`），不得造成 body 横向溢出。
- 结果主数值使用等宽 + `font-variant-numeric: tabular-nums`；按内容长度使用可预测字号档位，不省略、不换行、不 `transform: scale()`。
- `.math-scroll` 与命令下拉列表的滚动条必须为 Firefox/WebKit/Blink 定义一致的细滚动条颜色，不得出现原生白色滚动条。

## 4. 交互状态矩阵

| 元素                                    | cursor        | hover                    | active                                                  | focus-visible           | disabled                     |
| --------------------------------------- | ------------- | ------------------------ | ------------------------------------------------------- | ----------------------- | ---------------------------- |
| 可用 `button` / tab / option / `select` | `pointer`     | 轻微亮度、边框或阴影变化 | 轻微按压反馈（如 `translateY(1px)` 或约 `scale(0.98)`） | 高对比度 outline/ring   | `opacity` 降低并配合颜色差异 |
| 文本/数字 `input`                       | `text`        | 轻微边框或阴影变化       | 同 hover 或轻微亮度变化                                 | 高对比度 outline/ring   | `opacity` 降低               |
| disabled 或 `aria-disabled=true`        | `not-allowed` | 无 hover 动画            | 无按压动画                                              | 保留 focus-visible 提示 | 清晰可见的禁用态             |

- 所有非提交按钮显式设置 `type="button"`。
- 不向普通容器和不可点击文字设置 `cursor: pointer`。
- hover 样式放在 `@media (hover: hover) and (pointer: fine)` 内，避免触屏 sticky hover。
- 触屏仍必须通过 active、focus 和状态颜色获得反馈。
- popover 可使用短距离 opacity/translate 入场。
- 复制成功反馈可以淡入，但不得推挤布局或延迟实际复制；不得用 JavaScript timer 驱动纯视觉动画。
- 不得对计算结果持续闪烁、缩放或每次输入都播放明显动画。
- 不得使用长时间、循环或大范围平移/缩放动效。

## 5. Reduced motion

- 必须支持 `@media (prefers-reduced-motion: reduce)`。
- 减少动效模式下关闭或近似关闭非必要 animation、transform transition 和 smooth scrolling。
- 必须保留状态颜色、边框与 focus-visible 提示。
- 纯视觉动画优先使用 CSS；不需要 JavaScript timer 驱动。

## 6. UI 变更测试检查项

- Vitest：四模式 `plainText` 与 `latex` 公式；负指数、负系数、`m=0`、HALF 特殊值；
  现有 `formulaText` 与 C 宏输出兼容；KaTeX 模板不包含不受支持或不安全命令。
- Playwright：四模式 KaTeX 容器与 MathML 存在；无 `.katex-error`；输入后公式同步更新；
  cursor / hover / active / focus-visible / disabled 状态；reduced-motion；360/390 无 body 横向滚动；
  light/dark 下公式与 focus ring 可读。
- Release/Pages smoke：KaTeX CSS 与全部字体加载，资源为 Pages 同源。

## 7. Popover containment（通用规则）

术语气泡（`TechnicalTerm`）是当前唯一的 portal popover；命令参考仍是页内折叠表格：

- popover 使用 `@floating-ui/react-dom`（或等价的 flip/shift/size/autoUpdate 组合），portal 渲染。
- 必须配置 `flip`、`shift`（viewport padding 8–12px）、`size` 和 `autoUpdate`。
- popup 打开时 resize、页面滚动、触发器靠近顶部/底部都必须保持 viewport 内完整可见；
  可用高度不足时只让内部列表滚动，不得滚动整个页面。
- 术语气泡内容为非交互说明时使用 tooltip 语义：触发器携带 `aria-expanded` /
  `aria-controls` / `aria-describedby`；若未来加入可点击内容必须升级为非模态 dialog。
- 禁止在 tab、button、summary、option 等已有交互控件内部嵌套术语触发器；
  禁止把整段说明塞进原生 `title`。

## 8. 输入编辑与错误合同（M21 起长期稳定）

- 整数语法统一为「可选正负号 + 十进制数字」；`src/app/int-parse.ts` 是 reducer 与
  所有整数输入组件的唯一解析来源，拒绝 `1e2`、`1.5`、`12abc`、`0x10`、仅正负号与
  unsafe integer。物理值解析统一走 `src/app/float-parse.ts`（`parseFloatSafe` +
  过渡态分类），reducer 与组件不得各自维护规则。signed zero（v2.5.7，Part II §7.6）：
  `-0`、`-0.0`、`-.0`、`-.00`、`-0e3` 解析为真正的 `-0`（HALF 编码 `0x8000`），
  `0`、`+0`、`0.0`、`.0`、`+.0`、`0e3` 为 `+0`（`0x0000`）；裸 `.`/`+.`/`-.` 是
  编辑过渡态，blur 归一化保留符号（`.`/`+.` → `0`，`-.` → `-0`）。
- 统一编辑模型：编辑中的过渡态（空串、单独正负号、`1e`、`1.`、`0x` 等）暂存，
  不逐键重置、不逐键报错；非法文本不得修改 committed state、raw、公式或结果。
- 非法最终值必须有字段级、可见、唯一的错误，不得静默回滚；blur 后非法 draft
  保留并保持错误。合法修正后错误、ARIA 状态与旧 draft 同时清除。
- `aria-invalid="true"` 只在字段确实非法时出现；`aria-describedby` 指向当前可见、
  唯一、真实存在的错误节点（`{input-id}-error`）。同一错误不得同时出现在内联提示
  和 InfoPanel；DIRECT 系数错误按 `state.direct.errors.{m,b,r}` 字段隔离，编辑
  无关字段不得覆盖或清除另一字段仍有效的错误。
- 数值范围合同：L11 N/Y、DIRECT Y、L16 V 超范围 clamp；DIRECT m/b/R 超范围拒绝
  并保留最后有效值；`m ≠ 0`（m=0 为显式存储的非法状态）。HALF 接受
  NaN/±Infinity，其他模式拒绝非有限值。
- **未编辑的 focus/blur 是严格 no-op（v2.5.6 起；v2.5.7 推广到全部共享输入）**：
  所有共享输入（物理值、raw Hex、整数/十进制编辑器、VOUT_MODE expert Hex 与 N、
  标称参考值）在当前 focus 会话内没有任何 `onChange` 编辑事务时，blur（含 Enter
  触发的 blur）不派发 commit、不改写 raw/参数/VOUT_MODE 字节、不伪造量化请求来源、
  不清除已有字段错误。真实编辑（含清空后 blur 规范化、显式重输相同值、粘贴、非法
  文本修复）仍按既有合同提交；HALF 中显式重输 `NaN` 仍 canonical 化为 `0x7E00`
  并出现 special/warn provenance。dirty 状态依据真实编辑事务（共享 helper
  `src/app/input-transaction.ts`），不用解析数值比较。
- **标称参考值可回到缺失状态（v2.5.8）**：relative ULINEAR16 的标称输入真实删除
  全部内容后 blur/Enter 提交 `l16/clear-nominal-vout`（`nominalVout = null`）——
  字段保持空、最终电压显示 `—`、公式与计算步骤不再输出由旧标称推出的电压；
  `null` 与显式输入 `0` 是两个状态，清除不改 raw/VOUT_MODE/payload/字节序，
  重新输入合法值后恢复计算。非空非法文本不得悄悄变为 0 或清除：保留字段错误与
  最后有效 committed 值；非空过渡态（`1e`、`-` 等）blur 经共享
  `fixFloatTextOnBlur` 归一化后按其值提交（与物理值输入一致），不以静默恢复
  旧值掩盖未完成输入。其他数值输入的空串归零合同不变。
- **解析层不做静默限幅（v2.5.8）**：物理值解析统一走共享分类
  `classifyFloatText`（`src/app/float-parse.ts`，ValueInput / NominalVoutInput /
  reducer 单一来源）。语法完整且可由 JavaScript Number 表示的有限值按真实值提交
  （旧 ±1e20 clamp 移除），编码格式超范围由既有编码器的饱和/溢出读数呈现，
  provenance 保留真实提交的请求值；完整但溢出为 ±Infinity 的十进制文本（如
  `1e400`）在包括 HALF 在内的所有模式都是明确的数值范围错误——不提交、不生成
  新请求、保留旧 raw，且不得被误判为"尚未输完"的过渡态；HALF 显式字面量
  `NaN` / `±Infinity` 与十进制溢出文本是两类不同的输入。
- **输入下溢不是零（v2.5.10）**：语法完整、十进制尾数含非零数字、但 `Number(text)`
  结果为 ±0 的文本（`1e-400`、`2e-324`）在 `classifyFloatText` 中分类为输入下溢
  （`underflow`），是明确的输入范围错误——不提交、不改写旧 raw / 请求 / 标称、
  不创建 provenance；blur/Enter 保留原始草稿与错误（共享 `resolveFloatTextOnBlur`
  分类在先，reducer 直接 dispatch 同样 no-op）。真零文本（`0`、`0e-400`、
  `-0e400`、`-0.0e-999`、`-.0e-999`）继续按 signed-zero 合同接受；最小 subnormal
  `5e-324` / `3e-324` 是合法有限请求，由编码格式做量化（不是输入错误）；HALF
  `2^-25` 等「请求本身可表示、编码量化为零」的量化合同不变。输入下溢错误与
  relative L16 的派生下溢（`resolveRelativeVoltage`）是两类不同错误来源，文案、
  状态与测试不得混用。这是 JavaScript Number 的事实合同，不是 PMBus 规范要求。
- 模式切换后不得留下与当前显示值矛盾的 stale error（错误随字段所在 workspace
  卸载清除；DIRECT 系数错误随状态保留、只在 DIRECT 模式渲染）。
- 全局快捷键 `Ctrl+1..4` 仅在非编辑上下文生效：`src/app/editable-target.ts` 判定
  input/textarea/select/contenteditable/role=textbox/role=combobox（含祖先），
  且 Meta/Alt/Shift 变体一律不作为快捷键。编辑区按快捷键不得切换模式、丢 draft
  或抢焦点；不得通过删除快捷键或隐藏提示规避问题。
- 命令参考按钮（`#command-reference-toggle`）必须有显式可访问名称
  （`aria-label`/文本），展开/收起用 `aria-expanded` 表达。

## 9. 命令参考（只读，无副作用）

- 命令参考是默认折叠的只读面板：只显示命令码、事务、数据类型、单位、格式来源
  与规范章节；不得提供选择器、搜索框或预设应用入口。
- 选择/阅读任何命令不得改变 mode、raw、VOUT_MODE、DIRECT 系数或任何计算结果；
  面板本身没有任何 selection state（不写 `command/set`）。
- `command/apply-preset` 已从产品面移除；命令元数据不携带 preset。
- 表格在窄 viewport 使用容器内横向滚动（`overflow-x-auto`），不得造成 body
  横向溢出。
- 回归矩阵在 `tests/e2e/command-reference.spec.ts`：默认折叠、13 条命令行、
  只读无副作用、VOUT_MODE/模式不受影响、无预设入口、950×304 无溢出。

## 10. 视觉系统与验收

- 表面最多三层：canvas / panel / panel-elevated；控件使用 control / control-hover / control-active。
- 阴影只用于 elevated、sticky result 和 popup；删除全局 `filter: brightness` hover。
- 控件高度约 40px，紧凑按钮不低于 32–36px；点击目标至少 24×24px。
- 圆角：控件约 8px，panel 12px，shell 16px；间距以 8px 为基准。
- 图标为 `currentColor` SVG，`aria-hidden=true`，按钮有可访问文本或 `aria-label`。
- 中文为 UI 主语言；PMBus、L11、L16、DIRECT、HALF、Hex、LE/BE 等技术缩写保留。
- 视觉验收不能只凭 DOM 测试；必须包含关键 viewport 截图。
- `visual snapshot` 是回归保护，不等同于设计质量批准；没有图像读取能力时，不得声称已“逐图目检”。
- 没有图像读取能力时，必须把视觉要求转化为可执行的几何、对比度、换行、overflow、排列和 computed-style 断言；最终报告必须如实说明实际使用的验证方式。
- `npm run verify:ui` 会在 `npm run verify` 之后运行 visual snapshot；visual snapshot 当前为 darwin 基线，CI 默认不运行 `test:e2e:visual`。
- visual regression 截图前等待 `document.fonts.ready`、KaTeX 完成和动画稳定。
- reduced-motion 只关闭非必要动画，不得消除功能反馈；复制状态使用受控 timer（约 1.5–2s）。
- KaTeX `htmlAndMathml` 已提供 MathML；外层不得用 `role="math"`/`aria-label` 覆盖；fallback 时再提供可访问名称。

## 11. 视觉基线治理

> 完整政策见 [`docs/REPOSITORY_HYGIENE.md`](REPOSITORY_HYGIENE.md) 第 3 节；本文件只保留 UI 任务必须遵守的摘要。

- Playwright golden snapshot 是测试输入，必须提交到版本控制；actual/diff/failed screenshot 和 HTML report 是临时输出，不提交。
- snapshot 必须在 canonical darwin 环境生成，并记录 OS、Node、Playwright、Chromium 和 viewport。
- `--update-snapshots` 不是普通修复命令：必须先确认变化是预期变化并审查截图或 diff。
- 没有图像输入能力的 agent 不得自行接受或更新视觉基线，只能增加几何/overflow/换行/对比度/computed-style 断言并报告变化。
- UI 任务如必须更新基线，应使用具备图像输入能力的复核模型，或停在等待视觉审批的状态。
- 截图变化必须在 PR 中单独列出：新增/修改/删除数量、总字节变化、每张变化原因。
- 视觉重构 PR 更新基线时必须附**新旧基线 diff 审查记录**（先记录失败场景为预期影响面、
  更新后新旧 PNG 成对对比、核对更新集合与影响面吻合）；完整条款见
  [`docs/REPOSITORY_HYGIENE.md`](REPOSITORY_HYGIENE.md) 第 3 节第 10 条。
- 不使用 snapshot 替代数值、行为、无障碍或几何断言；不为了减小仓库而使用有损压缩。
- visual scene 中的 volatile metadata（例如由 package.json 注入的版本徽标）必须在截图前先断言真实值，
  再规范化为明确的测试占位值；不 mask，且该规范化只存在于 E2E helper，不得进入 `src/` 或生产 bundle。

## 12. 中文优先语言与术语气泡（M39 起）

- 中文是界面、按钮、状态、帮助、ARIA 与错误提示的主语言；同一按钮/标题/状态/解释
  不得中英双写，中文正文后不得追加完整英文译文（解释列表、计算步骤同样适用）。
- 英文仅保留行业不可替代的 canonical identifier：`PMBus`、`SMBus`、命令名、
  `LINEAR/LINEAR11/LINEAR16/ULINEAR16/SLINEAR16`、`VID`、`DIRECT`、
  `IEEE 754 binary16`、`Hex`、`LE/BE`、bit 编号与变量符号（X/Y/V/N/R/m/b）。
  规范引用（`Part II §8.5`）可保留，叙述必须中文。
- canonical token 的中文解释只维护在单一数据源 `src/app/terminology.ts`；组件不得
  复制同一段中文定义。新增 token 时先扩 glossary，再在重点出现位置挂 `TechnicalTerm`。
- 解释模型（`VoutModeExplanation` 等）输出中文主文案 + canonical token 引用，
  不再维护并排英文字段；组件不得用 CSS 隐藏英文来伪装完成。
- 回归矩阵：`tests/e2e/ui-language.spec.ts`（违禁双语/英文子串清单 + 显式 allowlist）、
  `tests/e2e/terminology-popover.spec.ts`（点击/键盘/触屏/单开/防裁切/无嵌套交互）。

## 13. 字体角色（M39 起）

| 角色 | 字体               | 用途                                             |
| ---- | ------------------ | ------------------------------------------------ |
| UI   | 系统无衬线         | 中文标题、按钮、标签、状态、说明、警告、气泡正文 |
| 数据 | `var(--font-mono)` | Hex、binary、raw 数字、bit/nibble 数字、字节摘要 |
| 数学 | KaTeX              | 真实公式、指数与等式（如 `X = Y × 2^N`）         |

- 配置摘要（`VOUT_MODE = 0x18 · LINEAR · 绝对值`）是结构化状态，不是公式：
  byte 用数据字体、token/状态用 UI 字体，不得经 KaTeX 渲染。
  合同测试在 `tests/e2e/math-interaction.spec.ts`（配置摘要无 `.katex`、无 serif 回退）。
- 结果主数值保持等宽 + `font-variant-numeric: tabular-nums` 合同不变。

## 14. 共享位字段网格（M39 起）

- 16 位编辑器恒为 4 个 nibble 组 × 4 位；8 位编辑器恒为 2 个 nibble 组 × 4 位；
  组件 `src/components/bits/BitFieldGrid.tsx` 是唯一实现，禁止再分叉第二套 bit/nibble CSS。
- L16 内嵌 VOUT_MODE 使用 `density="compact"`：只缩小尺寸与间距，不得退化成无分组单行。
- on-bit 着色、图例与禁用态都由 `src/app/bit-regions.ts` 的 region 定义驱动；
  颜色只传达分区，不得作为唯一信息（文本图例、bit range 与 disabled 状态必须同时存在）。
- L16 的 bits[6:5] 固定 `00`：必须真正 `disabled`，ARIA 注明“格式位固定为 LINEAR”。
- 位按钮可访问名形如“第 7 位，绝对值/相对值，当前为 0”（16 位无语义位保持
  “位 15: 0”既有合同），不得双语重复。
- 几何/结构合同测试在 `tests/e2e/bit-field-grid.spec.ts`。

## 15. 格式编码量化误差读数（ErrorDelta）

- 组件 `src/components/result/ErrorDelta.tsx` 是 L11/L16/DIRECT/HALF 共享的单一实现；
  数据一律来自 view-model（`deltaText` / `deltaKind` / `deltaNote`），组件不重算数值。
- 仅当存在显式编码请求 provenance 时渲染；无请求时组件返回 `null`，禁止展示伪造的
  `+0.000000 (0.0000%)`——「未输入请求」不是「误差为零」。
- 面板标签为「格式编码量化误差」，语义是数字格式的编码量化，不得暗示 PMBus 设备
  测量/设置准确度（Part II §7.8/§7.9：准确度由产品资料规定）。
- `data-kind` 契约：`ok`（exact）、`warn`（quantized / special）、`error`（saturated /
  overflow）；颜色由 `tokens.css` 的 `.error-delta-value[data-kind]` 提供。符号只表示
  方向（`requested − represented`），永不改变严重度。
- 零分母（requested = 0 / −0）的相对误差显示 `—`，不显示 0%。
- 绝对误差格式化必须保证非零差值绝不渲染为文本零：`|x| ≥ 1e-6` 用固定 6 位小数，
  更小的非零值用自适应有效数字（如 `+2.98023223877e-8`）。
- `deltaNote` 承载上下文附注（饱和、溢出、特殊值说明），以小字渲染在
  主值下方，不得挤占主值行或造成换行溢出。
- 计算过程中的量化步骤（`<mode>-quantization` intermediate）与面板使用同一文案来源，
  label 为「格式编码量化误差（请求值 − 表示值）」。
- L16 物理值输入与标称参考门槛由 **payload 上下文**（view-model `l16Payload`）决定，
  不以字节级 VOUT_MODE status 为唯一条件（v2.5.1）：`SLINEAR16 offset` 在任意 LINEAR
  字节（含 0x98 等 bit7=1）下保留物理值输入、signed 编码、范围与量化读数，且必须出现
  「bit7 对本 payload 不参与数学」说明；`ULINEAR16` + relative 才显示标称参考输入、
  relative 警示与阻断卡，阻断卡不得宣称 signed offset 页「需要 nominal」。
- 手动 `l16/set-slinear-y` 是 raw 变更：提交后面板隐藏（组件返回 null）、计算步骤
  不再包含量化 intermediate；非法/过渡输入不得改变 raw，也不得清除仍有效的请求。
- 非 LINEAR 共享字节的 L16 页面 fail closed（v2.5.2，Part II §8.4）：无物理值输入、
  无伪「可表示范围」、结果为 `—`、无量化面板与伪量化步骤；composer 显示实际字节与
  `非 LINEAR` source 徽标。阻断卡文案必须消费 view-model 的 discriminated blocked
  契约（`l16Payload.blocked.status`，v2.5.3），组件不得自行推导规范结论：
  - 绝对 VID + 非偏移 payload（`vid-profile-required`）：VID 是 §8.4.2 支持的输出电压
    数据格式，**禁止出现「输出电压相关命令禁止使用 VID」类全局禁令文案**；只能说
    「合法但未选定 VID 表 / 产品 profile，无法换算 code ↔ 电压」，制造商自定义
    code（raw 0x3E/0x3F）注明映射来自器件资料，不称保留或禁止；
  - 绝对 VID + SLINEAR16 offset（`vid-offset-prohibited`）：按 §13.3/§13.4 说明两条
    二补码偏移命令被禁止并声明不生成 word，同时声明**禁止范围仅限这两条命令**；
    InfoPanel 出现 error 级 `vout-mode-vid-offset-prohibited` 提示；
  - 相对 + VID（`vid-relative-invalid`）：按 §8.5.3 说明字节组合本身无效；
  - DIRECT（`direct-profile-required`）：声明 word ↔ 物理量需要器件 m/b/R 系数
    （§7.4/§8.4.3）、本页不猜测系数、不借用 LINEAR16 指数 N，且 DIRECT 是合法
    输出电压数据格式；
  - IEEE Half（`half-unsupported-in-l16`）：payload 是标准 IEEE 754 binary16
    （§7.6/§8.4.4），本页只实现 LINEAR16 解释、不猜测 N；HALF 模式页可做该换算，
    且 Half 是合法输出电压数据格式。**禁止出现「需要器件 profile / DIRECT 系数 /
    设备数据」类表述**——Half 的换算不依赖任何器件数值；
  - invalid-parameter / invalid-combination 提示保持 error 级。
    恢复入口只有显式「应用计算器 LINEAR 示例 0x18」按钮（`l16/apply-calculator-linear-example`，
    v2.5.7 更名）：点击后共享字节真实变为 `0x18`、source 徽标回到「已关联」，
    输入/范围/结果/量化读数随之恢复，旧 provenance 被清除。0x18（absolute、N=-8）
    必须表述为**计算器初始/恢复示例值**并附免责声明（不是 PMBus 规范默认值、不代表
    真实器件一定接受 VOUT_MODE 写入）；禁止称其为规范/器件默认，禁止重新引入任何
    隐式 fallback 通道或「按 fallback 0x18 计算」读数标注。反词回归在
    `tests/e2e/l16-nonlinear-fail-closed.spec.ts` 与 `src/app/view-model.test.ts`。
- 非 LINEAR 共享字节下，L16 的 16 位位域图例必须是中性 raw word 文案
  （`RAW_WORD_NEUTRAL_LABEL = "raw word [15:0]（未按 LINEAR16 解释）"`，v2.5.3）：
  `getBitRegions('L16', payloadKind, state.voutMode.byte)` 以实际共享字节为准，任何
  VID/DIRECT/IEEE Half/非法参数状态都不得显示「数值 V [15:0]」或「有符号值 Y [15:0]」；
  payload 下拉切换不得复活 V/Y 图例；LINEAR 字节（含 bit7=1）恢复 payload-specific
  图例。ARIA 标签不含 V/Y 语义（bits 无 semantic 字段），复制路径不输出图例文字。

## 16. 独立 VOUT_MODE 页面的 requirement 文案合同（v2.5.4 / v2.5.5）

- 状态文本、InfoPanel 警告、说明列表与计算步骤的规范结论一律来自
  `resolveVoutModeRequirement`（`src/app/vout-mode-requirements.ts`）；组件不得用
  `format` 数字或散落布尔重新推导。v2.5.5 起 status/warnings/explanations/steps
  四个表面全部 switch 在该判别式的 `req.id` 上（字段解析仍可读取
  format/parameter），E2E helper 不再把所有表面拼接成单一字符串——逐表面独立断言。
- DIRECT 字节（`0x40`/`0xC0` 等）：状态与警告必须继续要求器件 m/b/R 系数
  （§7.4），relative 组合再叠加 VOUT_COMMAND 标称参考值（§8.5.2）；`0xC0` 的
  **InfoPanel 警告本身**必须同时包含 m/b/R 与标称参考值，不得靠其他表面拼出。
- IEEE Half 字节（`0x60`/`0xE0` 等）：所有用户可见表面必须表述「标准
  IEEE 754 binary16（§7.6 / §8.4.4），换算不依赖器件数值」，并指向 HALF 模式页；
  **禁止出现「需器件资料」「器件 Profile」「m/b/R」「DIRECT 系数」等反向禁词**。
  `0xE0` 额外表述需要标称参考值（§8.5.2），`0x60` 不出现该表述。
- 参数非零（`0x61`/`0xE1` 等）保持「参数必须为 00000b（§8.3 Table 2）」error 级，
  不进入任何格式要求分支。
- **合法性与可计算性正交（v2.5.5）**：VID Code Type `1Eh`/`1Fh` 是 §8.4.2 Table 3
  明列的制造商自定义 code——`structureLegal=true`、`requiresVidProfile=true`、
  当前不可换算，呈现为「制造商自定义（需器件资料）」，**不得**复用代表非法结构的
  alert 标志/class 或「保留/非法」文案；`00h`（未使用）与保留 code（Table 3 明列
  保留与未列出保留，v2.5.6）仍是不可用配置。机器可测字段：`structureLegal`（结构
  合法）、`requiresExternalData`（需器件数据 = m/b/R 或 VID 表）、`calculable`
  （当前计算器可算，仅绝对 LINEAR）。
- **VID Table 3 出处文案（v2.5.6）**：`01h..04h`（未来 Intel 处理器）、`10h..11h`
  （未来 AMD 处理器）、`1Ch..1Dh`（留作未来使用）是 Table 3 **明列**的保留 code，
  全部表面（status chip、InfoPanel、说明、计算步骤、结构化 VID code 下拉）必须
  表述「Table 3 明列」与对应 family/reason，**绝不能含「未列出」**；`05h..0Fh`、
  `12h..1Bh` 等其余 code 必须表述「Table 3 未列出，保留供未来使用」。出处判别与
  reason 文本只来自 `classifyVidCode`（kind/family/reason/label）与
  `resolveVoutModeRequirement`（`vid-reserved-listed` / `vid-reserved-unlisted`），
  组件与 view-model 不得硬编码出处。结构合法性单一事实源是
  `structureLegal`：旧 `VoutModeAnalysis.isLegal` 已删除（v2.5.6）。
- E2E 反向禁词与逐表面合同在 `tests/e2e/vout-mode-half-matrix.spec.ts`；unit truth
  table（含 0..255 结构合法/可计算/外部数据三维穷举分离）在
  `src/app/vout-mode-requirements.test.ts`。

## 17. HALF 特殊值 §7.6.2 操作语义卡（v2.5.5）

- 单一来源：`resolveHalfSpecialSemantics`（`src/app/half-special-semantics.ts`），
  区分 `half-finite` / `half-nan` / `half-positive-infinity` /
  `half-negative-infinity`，输出稳定 machine id、severity、send/read 双解释与
  spec ref；组件只渲染 view-model 暴露的 `vm.halfSpecial`，不得自行判值。
- 出现条件：HALF 模式且当前 raw word 解码为 NaN / ±Infinity——raw Hex 解码与
  物理值编码两条真实路径都会看到（卡片由共享 raw word 派生，不会 stale）。
  有限值（含 ±0）永不显示。
- 卡片内容必须同时列出「作为写入数据」与「作为设备读回值」两种解释（不猜测实际
  命令方向）：NaN 写入 = invalid data + communications fault（§10.8），读回 =
  值不可用；±Inf 写入 = 正/负满量程，读回 = 测量通道正/负方向饱和。必须注明
  「这是 PMBus 操作语义，不代表已发生总线通信；binary16 数学不变」。
- 量化误差读数合同不变：主动输入特殊值 = `special/warn`；有限 `65520` 溢出 =
  `overflow/error`。有限溢出编码出的 +Inf word 同时显示 overflow/error 读数与
  §7.6.2 卡是正确形态——两个表面回答不同问题，不得合并成一个状态。
- E2E：`tests/e2e/half-special-semantics.spec.ts`（desktop/mobile 双项目）覆盖
  NaN/±Inf/有限、双路径、ARIA role、1280/390/360 无横向溢出。
