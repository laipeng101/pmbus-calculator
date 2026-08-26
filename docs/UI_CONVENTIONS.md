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
  过渡态分类），reducer 与组件不得各自维护规则。
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
