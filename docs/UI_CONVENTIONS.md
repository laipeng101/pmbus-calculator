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

## 7. Popup containment

- 命令下拉框使用 `@floating-ui/react-dom`，portal 渲染，默认 `bottom-start`。
- 必须配置 `flip`、`shift`（viewport padding 8–12px）、`size`（availableHeight/availableWidth）和 `autoUpdate`。
- popup 宽度与 trigger 一致；搜索框始终可见；可用高度不足时只让 options list 内部滚动。
- 不得调用会滚动整个页面的 `scrollIntoView`；active option 由 list 内部滚动逻辑管理。
- popup 打开时 resize、页面滚动、触发器靠近顶部/底部都必须保持 viewport 内完整可见。

## 8. 视觉系统与验收

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

## 9. 视觉基线治理

> 完整政策见 [`docs/REPOSITORY_HYGIENE.md`](REPOSITORY_HYGIENE.md) 第 3 节；本文件只保留 UI 任务必须遵守的摘要。

- Playwright golden snapshot 是测试输入，必须提交到版本控制；actual/diff/failed screenshot 和 HTML report 是临时输出，不提交。
- snapshot 必须在 canonical darwin 环境生成，并记录 OS、Node、Playwright、Chromium 和 viewport。
- `--update-snapshots` 不是普通修复命令：必须先确认变化是预期变化并审查截图或 diff。
- 没有图像输入能力的 agent 不得自行接受或更新视觉基线，只能增加几何/overflow/换行/对比度/computed-style 断言并报告变化。
- UI 任务如必须更新基线，应使用具备图像输入能力的复核模型，或停在等待视觉审批的状态。
- 截图变化必须在 PR 中单独列出：新增/修改/删除数量、总字节变化、每张变化原因。
- 不使用 snapshot 替代数值、行为、无障碍或几何断言；不为了减小仓库而使用有损压缩。
