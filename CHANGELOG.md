# Changelog

本项目遵循 Keep a Changelog 风格。版本号遵循 Semantic Versioning 2.0.0。

## [Unreleased]

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
