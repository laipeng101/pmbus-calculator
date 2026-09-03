# PMBus 数值格式计算器

<a href="README.md"><img src="https://img.shields.io/badge/lang-en-blue.svg" alt="English"></a>
<a href="README_zh-CN.md"><img src="https://img.shields.io/badge/lang-zh--CN-red.svg" alt="简体中文"></a>

一款完全运行于浏览器端、无后端的 **PMBus 数值格式计算器**。
支持 **LINEAR11 (L11)**、**LINEAR16 / VOUT (L16)**、**DIRECT** 和 **IEEE 754 半精度浮点 (HALF / binary16)** 四种编码格式的双向换算。

> **范围声明：** 本工具只做数值格式换算；它**不是** PMBus/SMBus 控制器、总线传输实现、命令执行器、设备 Profile 引擎或一致性测试套件。它覆盖 PMBus 多个修订版本中通用的数值格式语义，且**不声明**完整 PMBus 1.5 协议一致性（含 1.5 安全扩展）。
>
> **Live Demo：** https://laipeng101.github.io/pmbus-calculator/ （当前部署版本 `v3.0.0`）
>
> **Stable version：** [`v3.0.0`](https://github.com/laipeng101/pmbus-calculator/releases/tag/v3.0.0) · [Releases](https://github.com/laipeng101/pmbus-calculator/releases) · [SHA256SUMS.txt](https://github.com/laipeng101/pmbus-calculator/releases/download/v3.0.0/SHA256SUMS.txt)

---

## 目录

- [功能特性](#功能特性)
- [支持的格式](#支持的格式)
- [使用方法](#使用方法)
- [键盘快捷键](#键盘快捷键)
- [PMBus 命令参考](#pmbus-命令参考)
- [技术栈](#技术栈)
- [浏览器兼容性](#浏览器兼容性)
- [Known Limitations](#known-limitations)
- [开源许可](#开源许可)

---

## 功能特性

- 🔁 **双向转换** — L11、L16、DIRECT、HALF 四种模式均已完整双向闭环（编码/解码均已实现）。
- 📐 **四种编码模式 + 统一计算过程** — 每个模式都展示“字段解析 → 通用公式 → 数值代入 → 中间值 → 结果”；
  L16 页面拆解 VOUT_MODE 位域，并在 relative / 非 LINEAR 模式下拒绝伪造 LINEAR16 电压结果。
- 🔲 **可交互寄存器位视图** — 16 位可点击的位字段视图，按半字节（Nibble）分组，每个半字节实时显示对应 Hex 值。
- 📋 **一键复制** — 可分别复制原始 Hex 值、解码后的物理值，或直接可用的 C 语言宏定义代码。
- 📖 **只读 PMBus 命令参考** — 默认折叠的参考面板，列出 13 条 PMBus 1.3 命令的命令码、事务、数据类型、单位、格式来源与规范章节；
  参考面板不切换模式、不注入参数、不重写 raw，也不提供任何演示预设。
- ♾️ **最优 N 值自动求解** — LINEAR11 模式下，工具自动寻找使表示误差最小的最优指数 N。
- 🌙 **亮色 / 暗黑模式** — 自动跟随 `prefers-color-scheme`，同时支持手动切换。
- 📱 **完整响应式设计** — Sticky 结果面板、自适应位网格、移动端触控优化。
- 🔒 **N 值锁定切换** — 在微调固件寄存器时，可将指数锁定为固定值。
- ⚙️ **VOUT_MODE 支持** — 可配置 `VOUT_MODE (0x20)` 字节；按 PMBus Part II §8.3 拆解 bit7（absolute/relative）、bits[6:5]（模式）与 bits[4:0]（参数）。
- 🔢 **Canonical Raw Word 与线上字节** — 主 Raw Word Hex 永远表示数值原字（`3412` 就是 `0x3412`，不会被重新解释）；SMBus/PMBus 线上字节（低字节在前，SMBus 3.0 §6.5.4）与 MSB-first 表示分别显示与复制。
- 🔐 **内容安全策略 (CSP)** — 生产构建注入 CSP meta，限制运行时资源来源；无外部请求，无任何追踪。`style-src` 暂时允许 `unsafe-inline`（Tailwind 与运行时样式需要内联样式）。

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

`pmbus-calculator.html` 是独立的单 HTML 文件，无需构建步骤，无需服务器。
它保留在仓库根目录，用于**仓库内离线兼容用途**：只接受必要纠偏，不再作为当前 Pages 产品入口。Pages 根路径为产品入口（HTTP 200），仅 legacy `/pmbus-calculator.html` 路径返回 404；新版 Web App 是主要工具。

**本地打开：**

1. 克隆或下载本仓库。
2. 在任意现代浏览器中直接打开 `pmbus-calculator.html`。

### 新版 Web App（主要工具）

**源码开发方式：**

```bash
npm ci
npm run dev      # 启动 Vite 开发服务器，访问 http://localhost:5173
npm run build    # 生产构建输出到 dist/
npm test         # 运行 Vitest 测试
```

**静态构建包：** `dist/` 是静态构建产物，必须通过 HTTP 静态服务器使用（例如 `npm run preview` 或任意静态托管服务），不承诺直接双击 `dist/index.html` 以 `file://` 方式打开。

**正式部署：** 官方站点 https://laipeng101.github.io/pmbus-calculator/ 部署的是不可变的 `v3.0.0` Release 资产。见 [docs/DEPLOYING.md](docs/DEPLOYING.md)。

**操作流程：**

1. 选择编码模式标签页（LINEAR11 / LINEAR16 / DIRECT / IEEE 半精度）。
2. 输入原始 Hex 值**或**物理值——另一侧字段将自动更新。
3. 点击寄存器视图中的各个位进行翻转，观察对编码结果的影响。
4. 可选：展开 **PMBus 命令参考** 查看某条命令的命令码、事务、数据类型、单位、格式来源与规范章节；参考面板完全只读，不影响任何计算。
5. 点击 **📋 Hex**、**📋 值** 或 **C 代码** 按钮，以所需格式复制结果。

---

## 键盘快捷键

| 快捷键     | 操作                        |
| ---------- | --------------------------- |
| `Ctrl + 1` | 切换至 LINEAR11 模式        |
| `Ctrl + 2` | 切换至 LINEAR16 (VOUT) 模式 |
| `Ctrl + 3` | 切换至 DIRECT 模式          |
| `Ctrl + 4` | 切换至 IEEE 半精度模式      |

---

## PMBus 命令参考

内置参考记录 13 条 PMBus 1.3 标准命令的规范定义（命令码、事务、数据类型、单位、格式来源、规范章节）。参考面板刻意保持**只读**：选择命令不能可靠推导数据格式——器件数据手册或 `VOUT_MODE` 决定格式——因此面板不切换模式、不注入参数、不重写 raw，也不提供演示预设。

| 命令                  | 命令码 | 编码规则                                               |
| --------------------- | ------ | ------------------------------------------------------ |
| `VOUT_COMMAND`        | `0x21` | 跟随 VOUT_MODE                                         |
| `VOUT_OV_FAULT_LIMIT` | `0x40` | 跟随 VOUT_MODE                                         |
| `READ_VOUT`           | `0x8B` | 跟随 VOUT_MODE                                         |
| `READ_VIN`            | `0x88` | 由器件资料决定                                         |
| `READ_IOUT`           | `0x8C` | 由器件资料决定                                         |
| `READ_TEMPERATURE_1`  | `0x8D` | 由器件资料决定                                         |
| `VIN_OV_FAULT_LIMIT`  | `0x55` | 由器件资料决定                                         |
| `OT_FAULT_LIMIT`      | `0x4F` | 由器件资料决定                                         |
| `FAN_COMMAND_1`       | `0x3B` | 由器件资料决定                                         |
| `READ_POUT`           | `0x96` | 由器件资料决定                                         |
| `READ_FAN_SPEED_1`    | `0x90` | 由器件资料决定                                         |
| `STATUS_WORD`         | `0x79` | STATUS 位（通常 Read Word；特殊写入仅清除 UNKNOWN 位） |
| `READ_EIN`            | `0x86` | BLOCK（超过 16 位；规范内部字节数冲突在应用内展示）    |

---

## 技术栈

### 旧版（单文件归档）

- **纯 HTML + CSS + 原生 JavaScript** — 无框架，无任何外部依赖。
- CSS 自定义属性驱动完整的亮色/暗黑主题。
- 单文件页内置静态 CSP。
- 仅作为仓库内历史离线归档，不在 Pages 部署。

### 新版 Web App（主要工具）

- **Vite** + **React 19** + **TypeScript** — 现代组件化架构。
- **Tailwind CSS** + CSS 变量 — 设计 Token 驱动的主题系统。
- **Vitest** — PMBus 数学核心、reducer 与 view-model 的单元测试。
- **Playwright** — 桌面与移动 Chromium 项目的真实用户 E2E 流程。
- 实时路线图：[docs/ROADMAP.md](docs/ROADMAP.md) · 领域规则：[docs/DOMAIN_MODEL.md](docs/DOMAIN_MODEL.md) · 架构决策：[docs/adr/](docs/adr/) · 冻结的完整历史计划：[docs/archive/web-refactor-m0-m10.1/WEB_REFACTOR_PLAN_FULL.md](docs/archive/web-refactor-m0-m10.1/WEB_REFACTOR_PLAN_FULL.md)。

> **当前状态：** 新版 Web App 已具备 L11 / L16 / DIRECT / HALF 完整双向闭环，是主要工具。旧版 `pmbus-calculator.html` 仅保留仓库内离线兼容用途（只接受必要纠偏），不再作为当前 Pages 产品入口。

---

## 浏览器兼容性

```text
自动化验证：desktop Chromium + mobile Chromium。
Firefox/Safari/其他浏览器为 best effort，尚无自动化验证依据。
```

---

## Known Limitations

- 仅数值格式子集：不覆盖总线传输、命令执行、设备 Profile、PMBus 1.5 安全扩展与 Part IV。
- `DIRECT` 系数为器件专属；工具不猜测系数，提示需要器件数据手册。
- `READ_EIN` 为 block read，且规范内部存在字节数冲突；应用同时展示两个来源，不自行选定权威数字。
- 更多见 [docs/releases/v1.0.0.md#known-limitations](docs/releases/v1.0.0.md#known-limitations)。

## 开源许可

本项目源代码基于 [MIT 许可证](LICENSE) 开源。

第三方 PMBus/SMBus 规范文档**不**受本项目 MIT 许可证约束。规范来源与分发边界见
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) 与
[`document/README.md`](document/README.md)。
