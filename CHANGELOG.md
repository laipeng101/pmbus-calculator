# Changelog

本项目遵循 Keep a Changelog 风格。版本号遵循 Semantic Versioning 2.0.0。

## [Unreleased]

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
