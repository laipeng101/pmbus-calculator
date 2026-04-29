# PMBus 协议计算器

<a href="README.md"><img src="https://img.shields.io/badge/lang-en-blue.svg" alt="English"></a>
<a href="README_zh-CN.md"><img src="https://img.shields.io/badge/lang-zh--CN-red.svg" alt="简体中文"></a>

一款完全运行于浏览器端、零依赖的 PMBus 数据格式计算器。  
支持 PMBus 1.3 规范定义的 **LINEAR11 (L11)**、**LINEAR16 / VOUT (L16)**、**DIRECT** 和 **IEEE 754 半精度浮点 (HALF)** 四种编码格式。

---

## 目录

- [功能特性](#功能特性)
- [支持的格式](#支持的格式)
- [使用方法](#使用方法)
- [键盘快捷键](#键盘快捷键)
- [PMBus 命令字典](#pmbus-命令字典)
- [技术栈](#技术栈)
- [浏览器兼容性](#浏览器兼容性)
- [开源许可](#开源许可)

---

## 功能特性

- 🔁 **双向转换** — 输入物理值可得到十六进制编码，输入原始 Hex 可立即解码。
- 📐 **四种编码模式** — LINEAR11、LINEAR16 (VOUT)、DIRECT 和 IEEE 754 半精度浮点。
- 🔲 **可交互寄存器位视图** — 16 位可点击的位字段视图，按半字节（Nibble）分组，每个半字节实时显示对应 Hex 值。
- 📋 **一键复制** — 可分别复制原始 Hex 值、解码后的物理值，或直接可用的 C 语言宏定义代码。
- 📦 **PMBus 命令字典** — 快速加载 13 条标准 PMBus 1.3 命令（如 `VOUT_COMMAND`、`READ_IOUT`、`STATUS_WORD`）的典型参数。
- ♾️ **最优 N 值自动求解** — LINEAR11 模式下，工具自动寻找使表示误差最小的最优指数 N。
- 🌙 **亮色 / 暗黑模式** — 自动跟随 `prefers-color-scheme`，同时支持手动切换。
- 📱 **完整响应式设计** — Sticky 结果面板、自适应位网格、移动端触控优化。
- 🔒 **N 值锁定切换** — 在微调固件寄存器时，可将指数锁定为固定值。
- ⚙️ **VOUT_MODE 支持** — 可配置 `VOUT_MODE (0x20)` 字节以设定 LINEAR16 的指数。
- 🔢 **字节序控制** — 支持小端序（PMBus 标准）与大端序字节显示的切换。
- 🔐 **内容安全策略 (CSP)** — 严格 CSP 头，无外部请求，无任何追踪。

---

## 支持的格式

| 模式                | 说明                                               | 计算公式                      |
| ------------------- | -------------------------------------------------- | ----------------------------- |
| **LINEAR11**        | 11 位有符号尾数 + 5 位有符号指数                   | `X = Y × 2^N`                 |
| **LINEAR16 (VOUT)** | 16 位无符号尾数，指数来自 `VOUT_MODE`              | `X = V × 2^N`                 |
| **DIRECT**          | 通过三个设备专属系数进行线性变换                   | `X = (1/m) × (Y × 10^−R − b)` |
| **IEEE 半精度**     | IEEE 754 binary16（1 位符号、5 位指数、10 位尾数） | 标准半精度浮点                |

---

## 使用方法

### 旧版单文件（立即可用）

计算器是一个独立的单 HTML 文件，无需构建步骤，无需服务器。

**方式 A — 本地打开：**

1. 克隆或下载本仓库。
2. 在任意现代浏览器中直接打开 `pmbus-calculator.html`。

**方式 B — GitHub Pages / 任意静态托管：**

将 `pmbus-calculator.html` 部署到任意静态托管服务（GitHub Pages、Netlify 等），通过 URL 访问即可。

### 新版 Web App（开发中）

```bash
npm install
npm run dev      # 启动 Vite 开发服务器，访问 http://localhost:5173
npm run build    # 生产构建输出到 dist/
npm test         # 运行 Vitest 测试
```

**操作流程：**

1. 选择编码模式标签页（LINEAR11 / LINEAR16 / DIRECT / IEEE 半精度）。
2. 输入原始 Hex 值**或**物理值——另一侧字段将自动更新。
3. 点击寄存器视图中的各个位进行翻转，观察对编码结果的影响。
4. 使用 **PMBus 命令字典** 下拉框为已知命令快速加载典型参数。
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

## PMBus 命令字典

内置字典涵盖以下 PMBus 1.3 命令及其典型预设参数：

| 命令                  | 命令码 | 格式                 |
| --------------------- | ------ | -------------------- |
| `VOUT_COMMAND`        | `0x21` | LINEAR16             |
| `VOUT_OV_FAULT_LIMIT` | `0x40` | LINEAR16             |
| `READ_VOUT`           | `0x8B` | LINEAR16             |
| `READ_VIN`            | `0x88` | DIRECT               |
| `READ_IOUT`           | `0x8C` | DIRECT               |
| `READ_TEMPERATURE_1`  | `0x8D` | DIRECT               |
| `VIN_OV_FAULT_LIMIT`  | `0x55` | DIRECT               |
| `OT_FAULT_LIMIT`      | `0x4F` | DIRECT               |
| `FAN_COMMAND`         | `0x3B` | LINEAR11             |
| `READ_POUT`           | `0x96` | DIRECT               |
| `READ_FAN_SPEED_1`    | `0x90` | LINEAR11             |
| `STATUS_WORD`         | `0x79` | 状态位字             |
| `READ_EIN`            | `0x86` | DIRECT（块读取说明） |

---

## 技术栈

### 旧版（单文件，仍然可用）

- **纯 HTML + CSS + 原生 JavaScript** — 无框架，无任何外部依赖。
- CSS 自定义属性驱动完整的亮色/暗黑主题。
- 严格内容安全策略。

### 新版 Web App（重构中）

- **Vite** + **React 19** + **TypeScript** — 现代组件化架构。
- **Tailwind CSS** + CSS 变量 — 设计 Token 驱动的主题系统。
- **Vitest** — PMBus 数学核心的单元测试。
- 详见 [`AGENTS.md`](AGENTS.md) 与 [`docs/WEB_REFACTOR_PLAN.md`](docs/WEB_REFACTOR_PLAN.md)。

> **当前状态：** 旧版 `pmbus-calculator.html` 完全可用。新版 Web App 正按里程碑分阶段重建；目前已完成骨架布局与计算核心迁移，交互式 UI 尚未接入。

---

## 浏览器兼容性

任意支持 ES6+ 的现代浏览器（Chrome 60+、Firefox 55+、Safari 12+、Edge 79+）。

---

## 开源许可

本项目基于 [MIT 许可证](LICENSE) 开源。
