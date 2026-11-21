# PMBus 数值格式计算器

<a href="README.md"><img src="https://img.shields.io/badge/lang-en-blue.svg" alt="English"></a>
<a href="README_zh-CN.md"><img src="https://img.shields.io/badge/lang-zh--CN-red.svg" alt="简体中文"></a>

一款完全运行于浏览器端、无后端的 **PMBus 数值格式计算器**。
支持 **LINEAR11 (L11)**、**LINEAR16 / VOUT (L16)**、**DIRECT** 和 **IEEE 754 半精度浮点 (HALF / binary16)** 四种编码格式的双向换算。

> **范围声明：** 本工具只做数值格式换算；它**不是** PMBus/SMBus 控制器、总线传输实现、命令执行器、设备 Profile 引擎或一致性测试套件。它覆盖 PMBus 多个修订版本中通用的数值格式语义，且**不声明**完整 PMBus 1.5 协议一致性（含 1.5 安全扩展）。
>
> [在线使用](https://laipeng101.github.io/pmbus-calculator/)
>
> [最新稳定发行](https://github.com/laipeng101/pmbus-calculator/releases/latest) · [发行历史](https://github.com/laipeng101/pmbus-calculator/releases) · [SHA256SUMS.txt](https://github.com/laipeng101/pmbus-calculator/releases/latest/download/SHA256SUMS.txt)

---

## 目录

- [功能特性](#功能特性)
- [支持的格式](#支持的格式)
- [使用方法](#使用方法)
- [隐私与官方 Pages](#隐私与官方-pages)
- [键盘快捷键](#键盘快捷键)
- [PMBus 命令参考](#pmbus-命令参考)
- [技术栈](#技术栈)
- [浏览器兼容性](#浏览器兼容性)
- [已知限制](#已知限制)
- [开源许可](#开源许可)

---

## 功能特性

- 🔁 **双向转换** — L11、L16、DIRECT、HALF 四种模式均已完整双向闭环（编码/解码均已实现）。
- 🎛️ **同一台仪表，五个档位** — 五种模式共享同一结果工作区：物理主值锚定左侧，数值模式右侧固定两行（字段/参数 → 一条完整等式：符号关系 → 当前值代入 → 最终结果），VOUT_MODE 保持三行配置（字段 → 位解析 → 结果）。下方是四个稳定上下文槽位（Raw / 格式 / 参数 / 上下文）与仅由已提交输入来源推导的解码/编码方向。参数槽位是结构化键值对，组件不按字符串切分。数值模式经 KaTeX 排版真实 LaTeX（HTML + MathML）；VOUT_MODE 绝不送入 KaTeX。
- 📐 **四种编码模式 + 一条完整等式** — 每个数值模式首屏展示“符号关系 → 当前值代入 → 最终结果”的单条等式，结果已在等式中；“计算过程”面板只保留首屏没有的补充诊断（饱和、精确有理数/精度舍入、量化误差、标称参考与溢出/下溢），没有额外内容时整体省略。
  L16 页面拆解 VOUT_MODE 位域，并在 relative / 非 LINEAR 模式下拒绝伪造 LINEAR16 电压结果。
- 🔲 **可交互位映射面板** — 16 位面板紧邻 Raw Word，保留可点击位值、半字节 Hex 和字段图例；它与 VOUT_MODE 8 位面板均默认展开，分别记忆收起状态，切换模式或刷新后仍有效。收起时仍可编辑 Hex 和参数。
- 🧭 **结果上下文** — 结果旁展示 raw、格式和参数来源，包括 L16 标称参考是否可用及当前 DIRECT 系数。
- 📋 **一键复制** — 可分别复制原始 Hex 值、解码后的物理值，或直接可用的 C 语言宏定义代码。
- 📖 **只读 PMBus 命令参考** — 展开面板可查看标准命令定义，计算过程独立于参考面板。
- ♾️ **最优 N 值自动求解** — LINEAR11 模式下，工具自动寻找使表示误差最小的最优指数 N。
- 🌙 **亮色 / 暗黑模式** — 自动跟随 `prefers-color-scheme`，同时支持手动切换。
- 📱 **完整响应式设计** — Sticky 结果面板、自适应位网格、移动端触控优化。
- 🔒 **N 值锁定切换** — 在微调固件寄存器时，可将指数锁定为固定值。
- ⚙️ **VOUT_MODE 支持** — 可配置 `VOUT_MODE (0x20)` 字节；按 PMBus Part II §8.3 拆解 bit7（absolute/relative）、bits[6:5]（模式）与 bits[4:0]（参数）。
- 🔢 **Canonical Raw Word 与线上字节** — 主 Raw Word Hex 永远表示数值原字（`3412` 就是 `0x3412`，不会被重新解释）；SMBus/PMBus 线上字节（低字节在前，SMBus 3.0 §6.5.4）与 MSB-first 表示分别显示与复制。
- ✨ **Hex +1/−1 步进器** — Raw Word（16 位）与 VOUT_MODE（8 位）Hex 字段内嵌步进按钮：每次精确步进 1，分别在 `0000`/`FFFF` 与 `00`/`FF` 边界真实禁用（永不回绕），并与手输共用同一 canonical raw 状态；全部可编辑字段在静止态（亮/暗主题）都与只读展示框视觉可区分。
- 🔐 **内容安全策略 (CSP)** — 源码、Release 与自托管构建保持严格的同源运行时资源策略，无 Analytics、无外部 tracking。只有官方 Pages 部署增加精确的 Cloudflare Web Analytics script/connect 例外；应用 JavaScript、CSS 与字体仍保持同源。既有 `style-src` 对内联样式的允许保持不变。

---

## 支持的格式

| 模式                | 说明                                                        | 计算公式                                                                  |
| ------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------- |
| **LINEAR11**        | 11 位有符号尾数 + 5 位有符号指数                            | $X = Y \times 2^N$                                                        |
| **LINEAR16 (VOUT)** | 16 位无符号尾数，指数来自 `VOUT_MODE`（仅 absolute LINEAR） | $X = V \times 2^N$                                                        |
| **DIRECT**          | 通过三个设备专属系数进行线性变换                            | $X = \frac{1}{m}\left(Y \times 10^{-R} - b\right)$                        |
| **IEEE 半精度**     | IEEE 754 binary16（1 位符号、5 位指数、10 位尾数）          | IEEE 754 binary16 分段解码（zero / subnormal / normal / ±Infinity / NaN） |

> 四个标签页是四个独立换算器，本页面不做器件能力声明。器件实际采用的格式由数据手册决定，且按 PMBus Rev. 1.3 Part II §7.2 该选择是**全设备级**的、不按命令混用：若器件对 numerical data 使用 IEEE Half，则该器件所有数值命令（含与输出电压无关的命令）只能使用 IEEE Half；若器件对任一数值命令使用 LINEAR 或 DIRECT，则不得对任何命令使用 IEEE Half。数据手册只决定格式采用，**不改变** binary16 的数值解码公式——HALF 换算不需要任何器件系数（仅 DIRECT 需要器件专属 m/b/R，§7.4）。

---

## 使用方法

### 旧版单文件（仓库内离线历史归档）

克隆或下载仓库后，可在现代浏览器中直接打开 `pmbus-calculator.html` 离线使用。需要当前的数值行为与舍入规则时，请使用新版 Web App。[已知差异与维护规则](docs/LEGACY_COMPATIBILITY.md)

### 新版 Web App（主要工具）

解压最新稳定发行的 Web ZIP 后，通过 HTTP 静态服务器提供解压内容，也可直接托管源码构建产物 `dist/`。本地可用 `npm run preview` 预览源码构建。[本地开发与验证](CONTRIBUTING.md)

**操作流程：**

1. 选择编码模式标签页（LINEAR11 / LINEAR16 / DIRECT / IEEE 半精度）。
2. 输入原始 Hex 值**或**物理值——另一侧字段将自动更新。
3. 在默认展开的位映射中点击各个位，观察对编码结果的影响；点击面板标题可收起或展开，当前浏览器会记忆该偏好。
4. 可选：展开 **PMBus 命令参考** 查看某条命令的命令码、事务、数据类型、单位、格式来源与规范章节；参考面板完全只读，不影响任何计算。
5. 点击 **📋 Hex**、**📋 值** 或 **C 代码** 按钮，以所需格式复制结果。

---

## 隐私与官方 Pages

clone、Download source ZIP、fork、普通 `npm run build`、Release Web ZIP 与自托管构建默认**无 Analytics、无外部 tracking**；默认应用产物不包含 Cloudflare beacon、Pages-only 仓库链接或其 stylesheet。

官方 GitHub Pages 部署使用面向隐私的聚合 **Cloudflare Web Analytics** 页面级统计，仅发出精确允许的 Cloudflare 请求，并在页头主题按钮旁提供源码仓库图标链接，可访问名称为“在 GitHub 查看项目源码”。移动端计算器保持完整宽度。这些内容只注入 Pages staging tree；不可变 Release ZIP 保持原样。

计算器输入与结果，包括 PMBus raw word、物理值、DIRECT 系数、VOUT_MODE 值及复制内容，均不会作为自定义 analytics event 收集。标准页面级 beacon 不附加计算器行为参数。[部署与验收](docs/DEPLOYING.md)

---

## 键盘快捷键

| 快捷键     | 操作                        |
| ---------- | --------------------------- |
| `Ctrl + 1` | 切换至 LINEAR11 模式        |
| `Ctrl + 2` | 切换至 LINEAR16 (VOUT) 模式 |
| `Ctrl + 3` | 切换至 DIRECT 模式          |
| `Ctrl + 4` | 切换至 IEEE 半精度模式      |
| `Ctrl + 5` | 切换至 VOUT_MODE 配置模式   |

---

## PMBus 命令参考

只读参考面板提供 PMBus 命令码、事务、数据类型、单位、格式来源与规范章节。命令载荷格式以器件数据手册或 `VOUT_MODE` 为准。[命令定义](src/legacy/command-metadata.ts) · [领域规则](docs/DOMAIN_MODEL.md)

---

## 技术栈

Vite、React、TypeScript 和 Tailwind CSS。[架构决策](docs/adr/) · [贡献指南](CONTRIBUTING.md)

---

## 浏览器兼容性

自动化浏览器测试覆盖桌面 Chromium、Chromium 移动设备仿真，以及 Firefox 与 WebKit 上的核心流程。Safari 与其他浏览器的兼容性以实际使用为准。[验证命令与范围](CONTRIBUTING.md)

---

## 已知限制

- 仅数值格式子集：不覆盖总线传输、命令执行、设备 Profile、PMBus 1.5 安全扩展与 Part IV。
- `DIRECT` 系数为器件专属；工具不猜测系数，提示需要器件数据手册。
- `READ_EIN` 为 block read，且规范内部存在字节数冲突；应用同时展示两个来源，不自行选定权威数字。

## 开源许可

本项目源代码基于 [MIT 许可证](LICENSE) 开源。

第三方 PMBus/SMBus 规范文档**不**受本项目 MIT 许可证约束。规范来源与分发边界见
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) 与
[`document/README.md`](document/README.md)。
