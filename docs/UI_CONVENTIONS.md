# UI Conventions

> 涉及界面、公式或交互时按改动定位相关章节。

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
- 中英文文档的公式语义必须一致。
- 只使用 GitHub MathJax 与 KaTeX 都支持的通用 LaTeX 子集；禁止未经验证的宏（如 `\operatorname`、`\newcommand`、`\def`）。
- 改动公式时，按需在 GitHub 上查看受影响的段落，确认公式和表格渲染。

## 2. Web 公式单一数据源

- 公式展示层集中在 `src/app/formula-presentation.ts`，输出：
  - `plainText`：纯文本公式，继续用于复制输出和 C 宏注释，保持兼容；
  - `latex`：KaTeX 源码，只用于屏幕排版；
  - `equationLatex` / `equationPlainText`：首屏“一条完整等式”，按符号关系 → 当前值代入 → 最终结果串联，终值直接取自同一 canonical 结果，不做第二次格式化；
  - `symbolicLatex` / `symbolicPlainText`：纯符号关系式，供标题区与无 KaTeX 环境使用。
- L11 / L16 / DIRECT / HALF 四种模式都从该层取得纯文本与 LaTeX；JSX 不自行拼装动态计算公式。
- 五模式共享同一“结果工作区”（`src/app/result-workspace.ts`）。数值模式固定两行：字段/参数 → 一条完整等式；
  VOUT_MODE 保持同一空间节奏，渲染 `字段` / `位解析` / `结果` 三行配置，绝不进入 KaTeX。
- 结果上下文固定为四个逻辑槽位 `raw` / `format` / `parameters` / `context`，顺序不随模式变化；
  `parameters` 用结构化键值对（label/value）承载，组件不得按字符串切分。
  编码/解码方向只从已提交的 `valueRequest` / `l11.valueInput` 推导，不读 DOM、焦点或局部标志。
- “计算过程”只保留首屏没有的补充推导/诊断（饱和、精确有理数/十进制、量化误差、标称参考与溢出/下溢）；
  普通解码返回空列表，UI 整体省略该容器，绝不重复首屏等式或结果。
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
- Release / 自托管 production bundle 的 CSP 不增加外部运行时依赖；
  `vite.config.ts` 继续只定义严格 Release CSP。字体、CSS、应用 JS 必须来自同源。
- 官方 GitHub Pages 的额外资源及验证入口见[部署指南](DEPLOYING.md#pages-专用内容)。
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
- 发布包和 Pages 的检查方法分别见[发布流程](RELEASING.md)和[部署指南](DEPLOYING.md)。

## 7. 帮助浮层：术语气泡与控件说明

术语气泡（`TechnicalTerm`）解释术语，控件说明（`ControlTooltip`）提示如何操作。

- 两类浮层都使用 `@floating-ui/react-dom`（flip/shift/size/autoUpdate 组合）并 portal
  渲染到 `document.body`；必须配置 `flip`、`shift`（viewport padding 8–12px）、`size`
  与 `autoUpdate`。打开时 resize、滚动、触发器靠近视口边缘都必须保持完整可见；可用
  高度不足时只让浮层内部滚动，不得滚动整个页面。
- `HelpOverlayProvider` 按触发器实例管理浮层。任一时刻只显示一个。点击外部关闭，Escape 关闭并恢复焦点。浮层状态只在页面内使用。
- 术语气泡通过点击、触屏或 Enter / Space 展开。触发器用 `aria-expanded` 表示状态，打开时用 `aria-controls` 和 `aria-describedby` 关联内容。不要在气泡内放交互控件。
- 控件说明在鼠标悬停或键盘 `:focus-visible` 时显示，指针可移入浮层阅读，离开触发器与浮层、失焦或按 Escape 后关闭（WCAG 2.2 SC 1.4.13）。触屏直接执行原操作。说明用 `role="tooltip"` 和 `aria-describedby` 关联。
- 在浮层外显示禁用原因并用 `aria-describedby` 关联。原生 `disabled` 控件无法通过键盘聚焦。
- 禁止在 tab、button、summary、option 等已有交互控件内部嵌套术语触发器；
  禁止把整段说明塞进原生 `title`（`npm run check:no-title-help` 门禁拒绝 `src/`
  下一切原生 title 属性，运行时回归在 control-tooltip E2E）。

## 8. 输入编辑与错误提示

- 整数语法统一为「可选正负号 + 十进制数字」；`src/app/int-parse.ts` 是 reducer 与
  所有整数输入组件的唯一解析来源，拒绝 `1e2`、`1.5`、`12abc`、`0x10`、仅正负号与
  unsafe integer。物理值解析统一走 `src/app/float-parse.ts`（`parseFloatSafe` +
  过渡态分类），reducer 与组件不得各自维护规则。有符号零（Part II §7.6）：
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
- **仅聚焦再离开输入框时不提交**：
  所有共享输入（物理值、raw Hex、整数/十进制编辑器、VOUT_MODE expert Hex 与 N、
  标称参考值）在当前 focus 会话内没有任何 `onChange` 编辑事务时，blur（含 Enter
  触发的 blur）不派发 commit、不改写 raw/参数/VOUT_MODE 字节、不伪造量化请求来源、
  不清除已有字段错误。真实编辑（含清空后 blur 规范化、显式重输相同值、粘贴、非法
  文本修复）仍按既有合同提交；HALF 中显式重输 `NaN` 仍 canonical 化为 `0x7E00`
  并出现 special/warn provenance。dirty 状态依据真实编辑事务（共享 helper
  `src/app/input-transaction.ts`），不用解析数值比较。
- **清空标称电压后停止计算实际电压**：相对 ULINEAR16 的标称输入删除
  全部内容后 blur/Enter 提交 `l16/clear-nominal-vout`（`nominalVout = null`）——
  字段保持空、最终电压显示 `—`、公式与计算步骤不再输出由旧标称推出的电压；
  `null` 与显式输入 `0` 是两个状态，清除不改 raw/VOUT_MODE/payload，
  重新输入合法值后恢复计算。非空非法文本不得悄悄变为 0 或清除：保留字段错误与
  最后有效 committed 值；非空过渡态（`1e`、`-` 等）blur 经共享
  `fixFloatTextOnBlur` 归一化后按其值提交（与物理值输入一致），不以静默恢复
  旧值掩盖未完成输入。其他数值输入的空串归零合同不变。
- **解析层保留输入的有限数值**：物理值解析使用
  `classifyFloatText`（`src/app/float-parse.ts`，ValueInput / NominalVoutInput /
  reducer 单一来源）。语法完整且可由 JavaScript Number 表示的有限值按真实值提交，
  编码格式超范围由编码器的饱和或溢出读数呈现，
  provenance 保留真实提交的请求值；完整但溢出为 ±Infinity 的十进制文本（如
  `1e400`）在包括 HALF 在内的所有模式都是明确的数值范围错误——不提交、不生成
  新请求、保留旧 raw，且不得被误判为"尚未输完"的过渡态；HALF 显式字面量
  `NaN` / `±Infinity` 与十进制溢出文本是两类不同的输入。
- **输入下溢时保留草稿和错误**：语法完整、十进制尾数含非零数字、但 `Number(text)`
  结果为 ±0 的文本（`1e-400`、`2e-324`）在 `classifyFloatText` 中分类为输入下溢
  （`underflow`），是明确的输入范围错误——不提交、不改写旧 raw / 请求 / 标称、
  不创建 provenance；blur/Enter 保留原始草稿与错误（共享 `resolveFloatTextOnBlur`
  分类在先，reducer 直接 dispatch 同样 no-op）。真零文本（`0`、`0e-400`、
  `-0e400`、`-0.0e-999`、`-.0e-999`）继续按 signed-zero 合同接受；最小 subnormal
  `5e-324` / `3e-324` 是合法有限请求，由编码格式做量化（不是输入错误）；HALF
  `2^-25` 等「请求本身可表示、编码量化为零」的量化合同不变。输入下溢错误与
  relative L16 的派生下溢（`resolveRelativeVoltage`）是两类不同错误来源，文案、
  状态与测试不得混用。这是 JavaScript Number 的事实合同，不是 PMBus 规范要求。
- **DIRECT 在保存草稿前拒绝超长输入**：原始文本
  长度超过 `DIRECT_EXACT_MAX_LEXEME_LENGTH`（4096，含首尾空白的 raw 长度）时，
  `handleChange` 在写入 draft state 之前显示「输入过长，未提交」并整体拒绝该次
  编辑——受控输入保持上一个草稿内容（粘贴文本不驻留 React state）、不运行解析
  管线、不改 committed raw/请求/provenance；不使用 HTML `maxlength`（粘贴会被
  静默截断），由受控状态显式拒绝。reducer 侧共享同一 raw 长度度量
  （DOMAIN_MODEL §2.3），直接派发超长文本是严格 no-op。
  最近一次编辑被拒绝时，当前
  focus 会话持有 rejected 标记（极小布尔状态，不保存超长文本）；blur/Enter
  是 commit 层 no-op——不派发 `value/set`、不改写 raw/参数/请求 provenance、
  不清除拒绝错误、不把受控输入里的旧短草稿当新候选提交。该状态不因重复
  focus/blur/Enter、焦点来回切换而重置；同一 focus 内此前已发生的合法提交
  保持有效（不回滚）。只有新的短候选通过资源门禁后才清除标记，并按候选自身
  分类（合法/过渡态/非法）走既有合同；显式重输同一合法值仍建立新请求。
  模式切换/组件卸载维持既有边界，标记不跨模式泄漏。
- 模式切换后不得留下与当前显示值矛盾的 stale error（错误随字段所在 workspace
  卸载清除；DIRECT 系数错误随状态保留、只在 DIRECT 模式渲染）。
- 全局快捷键 `Ctrl+1..5` 仅在非编辑上下文生效：`src/app/editable-target.ts` 判定
  input/textarea/select/contenteditable/role=textbox/role=combobox（含祖先），
  且 Meta/Alt/Shift 变体一律不作为快捷键。编辑区按快捷键不得切换模式、丢 draft
  或抢焦点；不得通过删除快捷键或隐藏提示规避问题。
- 命令参考按钮（`#command-reference-toggle`）必须有显式可访问名称
  （`aria-label`/文本），展开/收起用 `aria-expanded` 表达。

## 9. 命令参考

命令参考默认折叠。展开和阅读表格不改变计算器的输入或结果。窄屏下横向滚动限于表格容器。字段、格式来源和规范条目见[领域规则](DOMAIN_MODEL.md#5-命令参考)。

## 10. 视觉系统与验收

- 首屏先呈现结果及其 raw / 格式 / 参数来源。16 位位映射紧邻 Raw Word 输入，
  默认展开，位值、nibble 和字段图例直接可见，参数输入位于其后；DOM 与键盘顺序一致。
  收起时保留明确的位映射标题与展开入口。页头不重复一整排格式术语入口，
  各模式标题、配置摘要及说明保留对应术语帮助。
- 桌面 1280×900 的默认页面总高度上限为 1500px（包含 L16 两条位映射标题）；
  主动收起位映射后仍满足 1400px 上限。分别验收这两个状态，并保留结果、Raw、
  默认 16 位网格与物理值的首屏几何门禁，不以收起状态替代默认可见性验收。
- 结果旁的上下文统一由 view-model 提供，组件只展示：L11 指数来自 canonical raw；
  L16 字节与指数来自共享 VOUT_MODE，非 LINEAR 不显示伪 N，缺参考与显式零分开；
  DIRECT 展示当前输入系数并要求核对器件数据手册，不宣称已选择器件 profile；
  VOUT_MODE 参数是配置数据，不渲染为物理值公式。
- 表面最多三层：canvas / panel / panel-elevated；控件使用 control / control-hover / control-active。
- **可编辑控件与只读内容**：可编辑控件（text/number/hex input、
  select）使用 `.input-field` 家族（`--color-input-bg` + `--color-input-border`
  语义 token 对）；只读展示/结果框使用 `.panel-surface-muted`（muted 底 +
  subtle 边框）。两族在静止态、亮/暗主题、无 hover（触屏）下即可区分；
  禁止新控件把可编辑表面与 muted 展示面复用同一 background+border 二元组，
  也禁止在非输入元素上使用 `.input-field`/「input」命名类。`aria-invalid`
  字段由 tokens.css 的 danger 边框 + ring 规则呈现错误态；带步进器的 Hex
  字段用 `.hex-field` shell（外层单一边界，内部输入与 `+1`/`−1` 按钮共享，
  `.hex-field-input` 无自身边框，焦点态由 `.hex-field:focus-within` 承载）。
- **Hex 步进器**：只在有界十六进制整数字段
  启用（现仅 Raw Word 16 位与 VOUT_MODE 8 位）；范围由 `maxDigits` 推导，
  边界对应按钮真实 `disabled`、永不回绕；输出大写固定位宽补零；合法草稿
  从草稿值步进、空/非法草稿从 committed 值步进并清错；每次激活恰好一次
  提交且不破坏 untouched-blur no-op（事务被消费）；步进按钮 `type="button"`、
  `pointerdown`/`mousedown` preventDefault 保持输入框焦点、带字段上下文
  可访问名、可 Tab、Enter/Space 激活；不劫持输入框 ArrowUp/ArrowDown；
  目标尺寸 ≥24×24。方向合同：fine pointer 下 `+`/`−` 横向并排（shell 高度
  与普通输入框一致）；coarse pointer 下
  纵向堆叠便于拇指触达（步进区 ≥44px 宽、单按钮 ≥28px 高）；两种方向
  共享同一 shell 边界与内部分隔线。
- 阴影只用于 elevated、sticky result 和 popup；删除全局 `filter: brightness` hover。
- 控件高度约 40px，紧凑按钮不低于 32–36px（`.hex-step-btn` 步进按钮按上方
  步进器合同的专用尺寸执行）；点击目标至少 24×24px。
- 圆角：控件约 8px，panel 12px，shell 16px；间距以 8px 为基准。
- 图标为 `currentColor` SVG，`aria-hidden=true`，按钮有可访问文本或 `aria-label`。
- 中文为 UI 主语言；PMBus、L11、L16、DIRECT、HALF、Hex、LE/BE 等技术缩写保留。
- 外观改动按[截图比对](#11-视觉基线治理)核对桌面和移动端受影响的场景。
- reduced-motion 只关闭非必要动画，不得消除功能反馈；复制状态使用受控 timer（约 1.5–2s）。
- KaTeX `htmlAndMathml` 已提供 MathML；外层不得用 `role="math"`/`aria-label` 覆盖；fallback 时再提供可访问名称。

## 11. 视觉基线治理

- 运行 `npm run test:e2e:visual`。[脚本](../scripts/test-visual.sh)通过 Docker 固定 Linux x64 镜像及浏览器环境。
- 检查受影响场景的新旧截图。确认是预期变化后，用 `npm run test:e2e:visual -- --grep '<场景名>' --update-snapshots=all` 更新相应基线，再运行比对。PR 说明有意调整的场景。
- 基线随 Git 跟踪，比对结果是[临时生成物](REPOSITORY_HYGIENE.md)。数值、操作结果和无障碍行为用相应断言验证。

## 12. 中文界面与术语气泡

- 用简体中文写状态、操作提示和无障碍名称。保留 `PMBus`、`VOUT_MODE`、`LINEAR16` 等标准名称、变量符号和规范出处。错误提示说明当前影响和可执行的下一步。
- 在 [`src/app/terminology.ts`](../src/app/terminology.ts) 维护术语定义，在需要解释的位置使用 `TechnicalTerm`。控件操作提示维护在 [`src/app/control-help.ts`](../src/app/control-help.ts)。
- 术语气泡和操作说明的交互见[帮助浮层](#7-帮助浮层术语气泡与控件说明)及对应的浏览器测试。

## 13. 字体用途

| 角色 | 字体               | 用途                                             |
| ---- | ------------------ | ------------------------------------------------ |
| UI   | 系统无衬线         | 中文标题、按钮、标签、状态、说明、警告、气泡正文 |
| 数据 | `var(--font-mono)` | Hex、binary、raw 数字、bit/nibble 数字、字节摘要 |
| 数学 | KaTeX              | 真实公式、指数与等式（如 `X = Y × 2^N`）         |

- VOUT_MODE 结果工作区是结构化状态，不是公式：`字段`（bit7 / bits[6:5] / bits[4:0]）、
  `位解析`（`0x18 = 0 | 00 | 11000`）与 `结果`（绝对值/相对值 · 格式 · N 或参数非法警告）三行。
  byte 与 bit 串用数据字体、token/状态用 UI 字体，不得经 KaTeX 渲染。
  合同测试在 `tests/e2e/math-interaction.spec.ts`（配置摘要无 `.katex`、无 serif 回退）。
- 结果主数值保持等宽 + `font-variant-numeric: tabular-nums` 合同不变。

## 14. 共享位字段网格

- 16 位与 VOUT_MODE 8 位映射均默认展开，可通过具备 `aria-expanded` / `aria-controls`
  的按钮收起；隐藏位按钮不参与 Tab 顺序。两种面板分别记忆展开状态，16 位状态在
  四种数值模式间共享，8 位状态在独立 VOUT_MODE 与 L16 内嵌配置器间共享。
  持久化只经过 `src/app/persistence.ts`；旧用户、缺失/损坏偏好或存储受限时安全回到
  默认展开。收起不改变 raw、配置、输入请求或结果，Hex 与语义配置保持可操作。
- 16 位编辑器恒为 4 个 nibble 组 × 4 位；8 位编辑器恒为 2 个 nibble 组 × 4 位；
  组件 `src/components/bits/BitFieldGrid.tsx` 是唯一实现，禁止再分叉第二套 bit/nibble CSS。
- L16 内嵌 VOUT_MODE 使用 `density="compact"`：只缩小尺寸与间距，不得退化成无分组单行。
- on-bit 着色、图例与禁用态都由 `src/app/bit-regions.ts` 的 region 定义驱动；
  颜色只传达分区，不得作为唯一信息（文本图例、bit range 与 disabled 状态必须同时存在）。
- L16 的 bits[6:5] 固定 `00`：必须真正 `disabled`，ARIA 注明“格式位固定为 LINEAR”；
  禁用原因同时有浮层之外的可见行（`vout-bits65-disabled-reason`，linked 与非
  LINEAR 两种措辞来自 `src/app/vout-mode-formats.ts` 单一来源），并经
  `aria-describedby` 关联到这两个位按钮。
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
- **DIRECT 精确值**：DIRECT 面板数值由精确有理数渲染
  （`formatExactDelta` / `formatExactPercent`，与计算步骤同一来源）——整数差值
  显示为整数（`+1`），极小/极大值用带符号科学计数法（`+1e-16`、`-1e-19`），带内
  终止小数精确展开，循环有理数回退到精确分数（`-1/6`）并在注记/步骤中给出
  「约」十进制近似；相对百分比带内用 4 位小数、带外用科学计数法（`约 1e-15%`）。
  `deltaNote` 在显示值无法完整呈现请求时保留「用户请求 <lexeme>；raw 精确表示
  <exact>」（长文本 `break-all` 换行，不产生横向溢出）；请求文本与显示值一致时
  保持静默（安全普通向量不出现噪音注记）。饱和态显示 `<delta>（已编码到边界值）`。
- `deltaNote` 承载上下文附注（饱和、溢出、特殊值说明），以小字渲染在
  主值下方，不得挤占主值行或造成换行溢出。
- 计算过程中的量化步骤（`<mode>-quantization` intermediate）与面板使用同一文案来源，
  label 为「格式编码量化误差（请求值 − 表示值）」。
- LINEAR16 的输入可用性由 view-model 的 `l16Payload` 决定。使用 LINEAR 格式时，SLINEAR16 保留物理值输入并说明第 7 位不影响电压偏移。相对 ULINEAR16 显示标称电压输入和计算提示。格式规则见[领域规则](DOMAIN_MODEL.md#3-vout_mode)。
- **相对 ULINEAR16 的 R=0 告警（Part II §8.5.2）**：提交的
  比值 `R = 0`（raw 0000）是规范意义上的非符合性数据——InfoPanel 输出 warning
  `l16-relative-zero-ratio`（单一来源 `deriveL16Semantics` 的同一 ratio 解码事实），
  文案区分两类真零：`nominal=0`（decode-only 真零，ratio≠0）与 signed offset
  （bit7 不参与数学）都不触发；标称参考缺失时告警仍然出现（非符合性是 committed
  raw 的属性）。数学结果保持精确 0，不伪造饱和/错误；已提供标称参考时物理值复制保持可用；
  `l16-relative-overflow` / `l16-relative-underflow` 与本告警互斥（零比值不可能
  溢出或下溢）。
- 手动 `l16/set-slinear-y` 是 raw 变更：提交后面板隐藏（组件返回 null）、计算步骤
  不再包含量化 intermediate；非法/过渡输入不得改变 raw，也不得清除仍有效的请求。
- 共享字节不是 LINEAR 格式时，LINEAR16 页显示实际配置字节和「非 LINEAR」，隐藏物理值输入及量化读数，结果显示 `—`。提示由 `l16Payload.blocked` 提供，按[格式规则](DOMAIN_MODEL.md#3-vout_mode)交代原因和下一步。非法参数和组合用错误提示。应用计算器示例前提醒用户核对器件设置。相关场景见 [`l16-nonlinear-fail-closed.spec.ts`](../tests/e2e/l16-nonlinear-fail-closed.spec.ts)。
- L16 物理值复制与结果可用性同源：非 LINEAR、缺少标称参考及派生溢出/下溢导致
  结果为 `—` 时，复制按钮必须禁用，并通过可见说明与 `aria-describedby` 给出原因。
  已提供的标称值 `0` 与缺失参考值不同；有限零值可正常复制。修改配置、补填/清除
  参考值或切换 payload 后实时重算，Raw Word / Wire 字节等复制不依赖物理值可用性。
- 位图图例经 `getBitRegions` 根据实际字节和数据解释类型选择。非 LINEAR 格式下只标为未经 LINEAR16 解释的原始数据，保留位号和位值。
- **DIRECT 显示值与复制**。按[领域规则](DOMAIN_MODEL.md#23-direct)判断重新输入显示值后所得的 Y。
  若 Y 会变化，警告应区分浮点精度和显示位数两种原因，给出重新输入后得到的 Y，并指向「计算过程」中的精确分数或小数。
  量化误差按精确值计算，有此提示时采用至少警告级别，饱和仍显示为错误。
  「物理值」复制精确小数或经验证可以得到原 Raw Word 的近似值，说明关联到按钮的 `aria-describedby`。
  无法计算物理值或生成可重新输入的数值时，禁用该按钮并显示原因。

## 16. 独立 VOUT_MODE 页面的状态说明

- 状态、警告和说明使用 `resolveVoutModeRequirement` 的分类。[领域规则](DOMAIN_MODEL.md#3-vout_mode)记录各格式的计算条件和 VID 代码出处。
- 警告本身说明需要的器件数据。相对 DIRECT 同时说明 m、b、R 系数和标称电压。制造商自定义 VID 提示需要器件资料，保持合法配置的显示样式。保留 VID 代码按规范说明是否列于表 3。
- 修改时先核对 [`vout-mode-requirements.test.ts`](../src/app/vout-mode-requirements.test.ts) 的分类，再用 [`vout-mode-half-matrix.spec.ts`](../tests/e2e/vout-mode-half-matrix.spec.ts) 核对相关界面提示。

## 17. HALF 特殊值 §7.6.2 操作提示

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
- E2E：`tests/e2e/half-special-semantics.spec.ts`（desktop 默认套件单项目，
  390/360 几何经 setViewportSize 断言；触摸差异风险由 mobile-contract 套件
  承担）覆盖 NaN/±Inf/有限、双路径、ARIA role、1280/390/360 无横向溢出。

## 18. 官方 Pages 的源码仓库链接

- 源码链接位于主题按钮旁，与按钮顶端对齐，点击区域为 40–44px。保留键盘焦点提示和触屏反馈。
- 布局需适配桌面、窄屏和系统字号，并随页头滚动，避免遮挡主体控件或增加横向滚动。
- 注入方式和专项检查见[部署指南](DEPLOYING.md#pages-专用内容)。
