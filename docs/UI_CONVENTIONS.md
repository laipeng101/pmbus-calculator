# 界面约定

## 文案与术语

- 用简体中文写标签、状态、操作提示和可访问名称。保留 PMBus、VOUT_MODE、LINEAR16 等正式名称。提示说明当前结果受什么影响、接下来可以怎么做。
- 同一术语统一用 `TechnicalTerm`。定义维护在 [terminology.ts](../src/app/terminology.ts)，控件操作说明维护在 [control-help.ts](../src/app/control-help.ts)。
- VOUT_MODE 页集中展示配置和提示，展开「说明」可查看格式要求、所需资料和适用的换算页。[领域规则](DOMAIN_MODEL.md#3-vout_mode)
- HALF 特殊值卡片分别说明写入设备和设备返回时的含义。若有限输入编码成无穷，量化误差区域说明本次编码溢出，特殊值卡片说明已编码原始字的含义。设备规则见[领域规则](DOMAIN_MODEL.md#24-half)。

## 结果与公式

- 首屏优先展示结果，紧随其后给出 Raw Word、格式、参数和相关状态。位映射紧邻 Raw Word 输入，默认展开。阅读顺序与键盘顺序一致。计算过程只展示首屏之外的推导和诊断，无补充内容时省略。命令参考默认折叠，展开、阅读和收起均不影响输入或结果。
- 结果及上下文由 view-model 生成。动态公式的纯文本和 LaTeX 来自同一处。等式末项使用结果读数，复制文本和 C 宏注释沿用纯文本输出。VOUT_MODE 显示字段、位解析和配置结果，使用界面和数据字体。[result-workspace.ts](../src/app/result-workspace.ts) · [formula-presentation.ts](../src/app/formula-presentation.ts)
- 公式从内部模板生成。KaTeX 仅用本地依赖和字体，禁用 `trust`，同时输出 HTML 与 MathML。解析失败时保留可读的纯文本。包裹 MathML 的容器不覆盖其可访问名称。字体、样式和脚本随发行包分发，Pages 外部资源由部署流程单独注入。[MathFormula.tsx](../src/components/math/MathFormula.tsx) · [部署指南](DEPLOYING.md#pages-专用内容)
- 十六进制、位数据和结果数字采用等宽字形。主结果随长度选择字号并保持完整。长公式和宽表在各自容器内滚动，页面不横向溢出。Markdown 公式用 GitHub 支持的 `$…$`、`$$…$$` 或 `math` 代码围栏。

## 输入与错误

- 解析由共享模块负责。整数输入使用带可选正负号的十进制整数。物理值保留有符号零，拒绝十进制输入自身的溢出和下溢。HALF 可以显式输入 `NaN` 或 `±Infinity`。输入范围错误与编码饱和、溢出、量化分别按各自来源呈现。[int-parse.ts](../src/app/int-parse.ts) · [float-parse.ts](../src/app/float-parse.ts) · [领域规则](DOMAIN_MODEL.md#2-饱和与错误处理)
- 编辑中允许暂存未完成的文本。仅聚焦再离开不提交。真实编辑后，非法草稿保留并显示该字段的错误，合法修正同时清除草稿与错误。DIRECT 超长候选整体拒绝，失焦或按 Enter 都不得把旧草稿当作新输入提交。清空相对 ULINEAR16 的标称电压会停止计算实际电压，显式输入 `0` 则保留零电压。[input-transaction.ts](../src/app/input-transaction.ts) · [领域规则](DOMAIN_MODEL.md#3-vout_mode)
- 一个错误只显示在对应字段旁，用 `aria-invalid` 和 `aria-describedby` 关联。某个 DIRECT 系数的编辑不清除其他系数的错误。禁用原因显示在控件外，可聚焦的禁用入口仍保留焦点反馈。
- Hex 步进器用合法草稿或最后提交值增减 1，边界禁用且不回绕。步进按钮可用键盘单次触发，指针点击不把焦点从输入框移走。模式快捷键 `Ctrl+1…5` 只在非编辑区生效。

## 帮助浮层

- `TechnicalTerm` 解释术语，`ControlTooltip` 说明操作。任一时刻只显示一个浮层，靠近视口边缘时调整位置。空间不足时让浮层内部滚动。
- 点击、触屏或 Enter / Space 展开术语气泡。气泡中只放解释，触发器用 `aria-expanded` 和相应 ARIA 关系。避免在已有交互控件内嵌套触发器。点击外部关闭，按 Escape 关闭并还原到仍可用的焦点。
- 控件说明在鼠标悬停或键盘焦点可见时显示。指针可移入浮层阅读，离开触发器与浮层、失焦或按 Escape 后关闭。触屏直接执行操作。说明使用 `role="tooltip"` 和 `aria-describedby`。用这套交互提供操作说明，避免原生 `title` 的触屏和键盘限制。[WCAG 2.2 SC 1.4.13](https://www.w3.org/TR/WCAG22/#content-on-hover-or-focus)

## 布局与交互反馈

- 桌面优先安排结果、Raw Word、默认展开的位映射和物理值输入，窄屏改用单列。位映射收起后保留标题和展开入口。固定位置的内容不挡住输入、焦点环或说明。[首屏布局测试](../tests/e2e/result-first-layout.spec.ts)
- 用现有按钮、输入框和只读面板的样式区分可编辑与只读。浅色、深色和无悬停时都应可辨认。独立点击目标至少 24×24 CSS px，句内术语随正文排版。Hex 步进按钮在精细指针上横排，粗指针上纵排，便于触摸。[tokens.css](../src/styles/tokens.css) · [WCAG 2.2 SC 2.5.8](https://www.w3.org/TR/WCAG22/#target-size-minimum)
- 可操作控件提供悬停、按压、键盘焦点与禁用状态。仅在支持悬停的精细指针上使用 hover 效果。减少动效时保留颜色、边框和焦点反馈。复制反馈不推挤布局。
- 位映射按每 4 位分组。16 位和 8 位分别保存展开偏好，收起不改数据，隐藏的位按钮退出 Tab 顺序。内嵌 VOUT_MODE 沿用 8 位分组。颜色和图例一起表达位字段，内嵌配置中锁定的格式位有可见原因。[BitFieldGrid.tsx](../src/components/bits/BitFieldGrid.tsx) · [bit-regions.ts](../src/app/bit-regions.ts)
- 官方 Pages 的源码入口位于主题按钮旁，保持可点击、可聚焦，并随页头滚动。调整时检查窄屏和系统字号。[部署指南](DEPLOYING.md#pages-专用内容)

## 量化误差和复制

- 量化误差直接显示 view-model 提供的数值和说明。无法计算相对误差时显示 `—`，饱和、溢出和特殊值分别提示。[ErrorDelta.tsx](../src/components/result/ErrorDelta.tsx) · [领域规则](DOMAIN_MODEL.md#6-编码量化误差)
- LINEAR16 使用非 LINEAR 配置时，保留原始数据和当前配置，隐藏物理值输入与量化误差，并提示如何继续。[领域规则](DOMAIN_MODEL.md#22-linear16)
- 物理值不可用时禁用复制并说明原因，原始数据仍可复制。DIRECT 显示值重输会改变 Y 时，说明受显示位数还是浮点精度影响，给出重输后的 Y，指向计算过程中的精确值。可复制的物理值为精确文本，或能重输得到同一 Raw Word 的已验证近似文本。[领域规则](DOMAIN_MODEL.md#23-direct)

## 截图比对

运行 `npm run test:e2e:visual`。脚本用 Docker 固定 Linux x64、字体与浏览器。基线覆盖桌面、移动端、深浅主题，以及长值、术语浮层、窄屏位字段和命令表等难以用单项断言判断的外观。数值、键盘路径、触屏、横向溢出和对比度以对应测试的显式断言为准。[截图用例](../tests/e2e/visual.spec.ts)

检查新旧截图，确认差异后用 `npm run test:e2e:visual -- --grep '<场景名>' --update-snapshots=all` 更新对应基线，再运行比对。PR 写明有意调整的场景。[贡献指南](../CONTRIBUTING.md#验证)
